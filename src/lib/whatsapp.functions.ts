import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fmtMoney, fmtDateTime } from "@/lib/format";

/**
 * Integração WhatsApp via Waha (self-hosted HTTP API).
 *
 * Waha conecta um número de WhatsApp por QR code e expõe uma API REST:
 *  - Base: WAHA_URL
 *  - Autenticação: header `X-Api-Key: WAHA_API_KEY`
 *  - Envio: POST {WAHA_URL}/api/sendText
 *    body: { session, chatId: "55XXXXXXXXXXX@c.us", text }
 *  - Saúde: GET {WAHA_URL}/api/health
 *
 * As notificações disparam a partir do sync do Anota (pedido recebido/pronto)
 * e também manualmente pela tela. O telefone do cliente vem de
 * `anota_orders.payload.customer.phone`.
 */

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

interface WahaEnv {
  url: string;
  key: string;
  session: string;
  enabled: boolean;
}

function wahaEnv(): WahaEnv | { error: string } {
  const url = (process.env.WAHA_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.WAHA_API_KEY ?? "").trim();
  const session = (process.env.WAHA_SESSION ?? "default").trim() || "default";
  const enabled = (process.env.WAHA_ENABLED ?? "true").trim().toLowerCase() !== "false";
  if (!url || !key) {
    return {
      error:
        "WhatsApp (Waha) não configurado. Defina WAHA_URL e WAHA_API_KEY nas variáveis de ambiente.",
    };
  }
  return { url, key, session, enabled };
}

/** Normaliza um telefone brasileiro para E.164 (apenas dígitos, com DDI 55). */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  if (!d.startsWith("55")) d = `55${d}`;
  return d;
}

/** Extrai o telefone do cliente do payload do pedido Anota. */
export function orderPhone(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const cust = asRecord(root.customer) ?? asRecord(root.client);
  if (!cust) return null;
  for (const k of [
    "phone",
    "phoneNumber",
    "cellphone",
    "celular",
    "telefone",
    "whatsapp",
    "mobile",
  ]) {
    const v = cust[k];
    if (typeof v === "string" && v.trim()) {
      const norm = normalizePhone(v);
      if (norm) return norm;
    }
  }
  return null;
}

interface DeliveryInfo {
  endereco: string;
  maps_link: string;
}

/** Extrai o endereço de entrega do payload e monta um link do Google Maps. */
export function orderDeliveryInfo(payload: unknown): DeliveryInfo | null {
  const root = asRecord(payload);
  if (!root) return null;
  const addr = asRecord(root.deliveryAddress) ?? asRecord(root.address);
  if (!addr) return null;

  const parts: string[] = [];
  const formatted = typeof addr.formattedAddress === "string" ? addr.formattedAddress.trim() : "";
  if (formatted) parts.push(formatted);
  const complement = typeof addr.complement === "string" ? addr.complement.trim() : "";
  if (complement) parts.push(`Complemento: ${complement}`);
  const reference = typeof addr.reference === "string" ? addr.reference.trim() : "";
  if (reference) parts.push(`Referência: ${reference}`);
  const neighborhood = typeof addr.neighborhood === "string" ? addr.neighborhood.trim() : "";
  const city = typeof addr.city === "string" ? addr.city.trim() : "";
  const state = typeof addr.state === "string" ? addr.state.trim() : "";
  const locParts = [neighborhood, city, state].filter(Boolean);
  const loc = locParts.filter((v, i) => v !== locParts[i - 1]).join(" - ");
  if (loc) parts.push(loc);

  const endereco = parts.join("\n");

  let maps_link = "";
  const coords = asRecord(addr.coordinates);
  const lat = typeof coords?.latitude === "number" ? coords.latitude : null;
  const lng = typeof coords?.longitude === "number" ? coords.longitude : null;
  if (lat !== null && lng !== null) {
    maps_link = `https://maps.google.com/?q=${lat},${lng}`;
  } else {
    const q = encodeURIComponent(formatted || endereco.split("\n")[0] || "Endereço");
    maps_link = `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  return { endereco, maps_link };
}

/** Resumo dos itens do pedido: "2x Coxinha de Frango, 1x Pastel". */
async function orderItemsText(supabase: DbClient, orderId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("anota_order_items")
      .select("nome, quantidade")
      .eq("order_id", orderId);
    if (!data || !data.length) return "";
    return data
      .map(
        (it: { nome: string | null; quantidade: number }) =>
          `${it.quantidade}x ${it.nome ?? "item"}`,
      )
      .join(", ");
  } catch {
    return "";
  }
}

/** Rótulos legíveis para códigos de forma de pagamento do Anota AI. */
const PAYMENT_LABELS: Record<string, string> = {
  credit: "Cartão de crédito",
  credit_card: "Cartão de crédito",
  card: "Cartão de crédito",
  cartao: "Cartão",
  cartao_credito: "Cartão de crédito",
  debit: "Cartão de débito",
  debit_card: "Cartão de débito",
  money: "Dinheiro",
  cash: "Dinheiro",
  dinheiro: "Dinheiro",
  pix: "Pix",
  online: "Online",
  pagamento_online: "Online",
  cardapio_online: "Online",
  vale: "Vale",
  ticket: "Vale",
  meal: "Vale refeição",
  nao_informado: "Não informado",
};

/** Extrai a forma de pagamento do payload do pedido Anota (defensivo). */
export function orderPaymentText(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";

  const rotulo = (raw: unknown): string | null => {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const key = raw.trim().toLowerCase();
    return PAYMENT_LABELS[key] ?? raw.trim();
  };

  const payments = root.payments;
  if (Array.isArray(payments)) {
    const lista: string[] = [];
    for (const p of payments) {
      const rec = asRecord(p);
      if (!rec) continue;
      const rot = rotulo(
        rec.payment_method ??
          rec.paymentMethod ??
          rec.method ??
          rec.type ??
          rec.paymentType ??
          rec.name ??
          rec.description ??
          rec.regra,
      );
      if (rot) lista.push(rot);
    }
    if (lista.length) return lista.join(", ");
  }

  return (
    rotulo(
      root.payment_type ??
        root.paymentType ??
        root.payment_method ??
        root.paymentMethod ??
        root.forma_pagamento,
    ) ?? ""
  );
}

/** Data/hora do agendamento do pedido, formatada para exibição. */
export function orderScheduleText(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";
  const schedule = asRecord(root.schedule_order);
  const raw =
    (typeof root.preparationStartDateTime === "string" && root.preparationStartDateTime.trim()) ||
    (typeof root.preparationStartDate === "string" && root.preparationStartDate.trim()) ||
    (typeof root.scheduledDateTime === "string" && root.scheduledDateTime.trim()) ||
    (typeof root.schedule_date === "string" && root.schedule_date.trim()) ||
    (schedule && typeof schedule.date === "string" && schedule.date.trim()) ||
    (schedule && typeof schedule.dateTime === "string" && schedule.dateTime.trim()) ||
    "";
  if (!raw) return "";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : fmtDateTime(d);
}

/** Valor da taxa de entrega/motoboy do pedido, formatado em R$. */
export function orderDeliveryFeeText(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";
  const info =
    asRecord(root.delivery_info) ?? asRecord(root.deliveryInfo) ?? asRecord(root.delivery);
  const candidates: unknown[] = [
    root.delivery_fee,
    root.deliveryFee,
    root.taxa_entrega,
    root.taxaEntrega,
    root.taxa_entrega_valor,
    root.shipping_fee,
    root.shippingFee,
    root.fee,
    info?.fee,
    info?.valor,
    info?.taxa,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && isFinite(c)) return fmtMoney(c);
    if (typeof c === "string" && c.trim() && !isNaN(Number(c))) return fmtMoney(Number(c));
  }
  return "";
}

/** Endereço de entrega do cliente (multilinha), se houver. */
export function orderAddressText(payload: unknown): string {
  return orderDeliveryInfo(payload)?.endereco ?? "";
}

/**
 * Monta as variáveis disponíveis nos templates de mensagem.
 * `{{pedido}}` só consulta os itens quando o template realmente o usa.
 */
async function orderTemplateVars(
  supabase: DbClient,
  order: {
    id: string;
    numero: string | null;
    external_order_id: string;
    cliente: string | null;
    total: number;
    payload: unknown;
  },
  template: string,
): Promise<Record<string, string>> {
  const numero = order.numero ?? order.external_order_id ?? "";
  const taxa = orderDeliveryFeeText(order.payload);
  const vars: Record<string, string> = {
    numero,
    total: fmtMoney(order.total),
    cliente: order.cliente ?? "cliente",
    pagamento: orderPaymentText(order.payload),
    agendamento: orderScheduleText(order.payload),
    taxa_entrega: taxa,
    taxa_motoboy: taxa,
    endereco: orderAddressText(order.payload),
    pedido: "",
  };
  if (template.includes("{{pedido}}")) {
    vars.pedido = await orderItemsText(supabase, order.id);
  }
  return vars;
}

/**
 * Monta a mensagem do motoboy: template + endereço, itens e link do Google Maps.
 * O bloco de entrega é SEMPRE anexado, mesmo se o template não tiver placeholders.
 */
async function buildMotoboyText(
  supabase: DbClient,
  order: OrderRow,
  notif: WhatsAppNotification | null | undefined,
): Promise<string> {
  const template = notif?.mensagem ?? "";
  const vars = await orderTemplateVars(supabase, order, template);
  let text = renderTemplate(template, vars);

  const block: string[] = [];
  const delivery = orderDeliveryInfo(order.payload);
  if (delivery) {
    block.push(`Endereço:\n${delivery.endereco}`);
    if (delivery.maps_link) block.push(`Mapa: ${delivery.maps_link}`);
  }
  const itens = await orderItemsText(supabase, order.id);
  if (itens) block.push(`Itens do pedido:\n${itens}`);

  if (block.length) text += `\n\n${block.join("\n\n")}`;
  return text;
}

/** Envia a mensagem (com endereço/itens/mapa) para o celular do motoboy. */
async function sendMotoboyMessage(
  supabase: DbClient,
  order: OrderRow,
  notif: WhatsAppNotification | null | undefined,
  phoneM: string,
): Promise<boolean> {
  if (!notif) return false;
  const text = await buildMotoboyText(supabase, order, notif);
  const r = await sendNotif(phoneM, text, notif);
  await logWhatsAppMessage(supabase, {
    phone: phoneFromDest(phoneM),
    chatId: phoneM,
    direction: "out",
    texto: text,
    tipo: "notificacao:motoboy",
    status: r.ok ? "enviado" : "erro",
    error: r.ok ? null : r.message,
    refOrderId: order.id,
  });
  return r.ok;
}

/** Renderiza um template substituindo {{chave}}. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`);
}

const DEFAULT_SETTINGS: Record<string, string> = {
  whatsapp_enabled: "true",
};

export const WHATSAPP_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

/** Identificadores fixos das notificações automáticas (além das de status). */
export const FIXED_NOTIFICATION_REGRAS = [
  "pedido_recebido",
  "pedido_pronto",
  "motoboy",
] as const;

export interface WhatsAppNotification {
  id: string;
  regra: string;
  titulo: string;
  mensagem: string;
  status: number | null;
  imagem_url: string | null;
  ativo: boolean;
}

export interface WhatsAppKeywordRule {
  id: string;
  regra: string;
  nome: string;
  palavras_chave: string;
  mensagem: string;
  imagem_url: string | null;
  ativo: boolean;
}

async function loadSettings(supabase: DbClient): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("whatsapp_settings").select("key, value");
  if (error) {
    console.error("[whatsapp] loadSettings error:", error.message);
    return { ...DEFAULT_SETTINGS };
  }
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) map[row.key] = row.value;
  return map;
}

/** Carrega todas as notificações automáticas da tabela dedicada. */
async function loadNotifications(supabase: DbClient): Promise<WhatsAppNotification[]> {
  const { data, error } = await supabase
    .from("whatsapp_notifications")
    .select("*")
    .order("regra");
  if (error) {
    console.error("[whatsapp] loadNotifications error:", error.message);
    return [];
  }
  return (data ?? []) as WhatsAppNotification[];
}

/** Carrega todas as regras de disparo por palavras-chave. */
export async function loadKeywordRules(supabase: DbClient): Promise<WhatsAppKeywordRule[]> {
  const { data, error } = await supabase
    .from("whatsapp_keyword_rules")
    .select("*")
    .order("regra");
  if (error) {
    console.error("[whatsapp] loadKeywordRules error:", error.message);
    return [];
  }
  return (data ?? []) as WhatsAppKeywordRule[];
}

/** Retorna a regra `status_<N>` para um status do pedido. */
export function statusRuleRegra(status: number): string {
  return `status_${status}`;
}

export interface WahaSendResult {
  ok: boolean;
  message: string;
  status?: number;
}

/**
 * Envia um texto via Waha. `to` pode ser um número em E.164 (só dígitos) ou
 * um chatId completo (ex.: "55...@c.us", "232573183738057@lid").
 */
export async function sendWahaText(to: string, text: string): Promise<WahaSendResult> {
  const env = wahaEnv();
  if ("error" in env) return { ok: false, message: env.error };
  if (!env.enabled)
    return { ok: false, message: "Notificações WhatsApp desativadas (WAHA_ENABLED=false)." };
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  try {
    const res = await fetch(`${env.url}/api/sendText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.key },
      body: JSON.stringify({ session: env.session, chatId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, message: "Mensagem enviada." };
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      status: res.status,
      message: `Falha no Waha (HTTP ${res.status}): ${snippet}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Core de notificação (executado no servidor)
// ---------------------------------------------------------------------------
export type NotifyType = "recebido" | "pronto" | "motoboy";

/**
 * Envia uma imagem (com legenda) via Waha usando uma URL pública do Storage.
 * `to` pode ser um número em E.164 (só dígitos) ou um chatId completo.
 */
export async function sendWahaImage(to: string, imageUrl: string, caption: string): Promise<WahaSendResult> {
  const env = wahaEnv();
  if ("error" in env) return { ok: false, message: env.error };
  if (!env.enabled)
    return { ok: false, message: "Notificações WhatsApp desativadas (WAHA_ENABLED=false)." };
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  try {
    const res = await fetch(`${env.url}/api/sendImage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.key },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        session: env.session,
        chatId,
        file: {
          url: imageUrl,
          mimetype: "image/jpeg",
          filename: "notificacao.jpg",
        },
        caption,
      }),
    });
    if (res.ok) return { ok: true, message: "Imagem enviada." };
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      status: res.status,
      message: `Falha no Waha (HTTP ${res.status}): ${snippet}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Envia o texto e, se houver imagem configurada, envia a imagem como legenda. */
async function sendNotif(
  to: string,
  text: string,
  notif: Pick<WhatsAppNotification, "imagem_url">,
): Promise<WahaSendResult> {
  const hasImage = notif.imagem_url && notif.imagem_url.trim().length > 0;
  if (hasImage) return sendWahaImage(to, notif.imagem_url!.trim(), text);
  return sendWahaText(to, text);
}

// ---------------------------------------------------------------------------
// Conversas (aba Mensagens) e pausa temporária por contato
// ---------------------------------------------------------------------------

/** Grava uma mensagem (entrada ou saída) na conversa do contato. */
export async function logWhatsAppMessage(
  supabase: DbClient,
  input: {
    phone: string;
    chatId?: string | null;
    direction: "in" | "out";
    texto: string;
    tipo?: string | null;
    status?: string | null;
    error?: string | null;
    refOrderId?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("whatsapp_messages").insert({
      phone: input.phone,
      chat_id: input.chatId ?? null,
      direction: input.direction,
      texto: input.texto ?? "",
      tipo: input.tipo ?? null,
      status: input.status ?? null,
      error: input.error ?? null,
      ref_order_id: input.refOrderId ?? null,
    });
  } catch (e) {
    console.error("[whatsapp] falha ao gravar mensagem da conversa:", e);
  }
}

/** Retorna o telefone (E.164) a partir de um destino (número ou chatId). */
export function phoneFromDest(destino: string): string {
  const raw = destino.includes("@") ? destino.split("@")[0] : destino;
  return normalizePhone(raw) ?? raw;
}

// Cache local de resolução lid -> telefone real (evita chamadas repetidas ao Waha).
const lidPhoneCache = new Map<string, string>();

/**
 * Tenta extrair o telefone real (E.164) de um payload GOWS/WEBJS quando o
 * remetente chega como `@lid` (ID oculto do WhatsApp).
 */
function realPhoneFromPayload(payload: JsonRecord | null): string | null {
  if (!payload) return null;
  const data = asRecord(payload._data);
  if (data) {
    // NOWEB/GOWS: _data.key.remoteJidAlt = "5515...@s.whatsapp.net"
    const key = asRecord(data.key);
    const alt = typeof key?.remoteJidAlt === "string" ? key.remoteJidAlt : "";
    if (alt.includes("@s.whatsapp.net")) {
      const n = normalizePhone(alt.split("@")[0]);
      if (n) return n;
    }
    // GOWS (versões novas): _data.Info.SenderAlt
    const info = asRecord(data.Info);
    const senderAlt = typeof info?.SenderAlt === "string" ? info.SenderAlt : "";
    if (senderAlt) {
      const raw = senderAlt.includes("@") ? senderAlt.split("@")[0] : senderAlt;
      const n = normalizePhone(raw);
      if (n) return n;
    }
  }
  const sc = asRecord(payload.senderContact) ?? asRecord(payload.contact);
  const num = typeof sc?.number === "string" ? sc.number : "";
  if (num) {
    const n = normalizePhone(num);
    if (n) return n;
  }
  return null;
}

/**
 * Resolve o telefone real (E.164) a partir do chatId do Waha.
 * Se o chatId for `@lid`, tenta o payload, depois a API de LIDs do Waha e,
 * por fim, retorna o número cru do lid (sem prefixar 55).
 */
export async function resolveRealPhone(
  chatId: string,
  payload: JsonRecord | null,
): Promise<string> {
  const raw = chatId.split("@")[0];
  if (!chatId.includes("@lid")) return normalizePhone(raw) ?? raw;

  const fromPayload = realPhoneFromPayload(payload);
  if (fromPayload) return fromPayload;

  const cached = lidPhoneCache.get(raw);
  if (cached) return cached;

  const env = wahaEnv();
  if (!("error" in env) && env.enabled) {
    try {
      const res = await fetch(`${env.url}/api/${env.session}/lids/${encodeURIComponent(raw)}`, {
        headers: { "X-Api-Key": env.key },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { pn?: string | null } | null;
        const pn = body?.pn ?? "";
        if (pn) {
          const n = normalizePhone(pn.split("@")[0]);
          if (n) {
            lidPhoneCache.set(raw, n);
            return n;
          }
        }
      }
    } catch {
      // segue para o fallback
    }
  }

  // Sem resolução: guarda o número cru do lid (não o normaliza com 55).
  lidPhoneCache.set(raw, raw);
  return raw;
}

/** Verifica se o envio de mensagens está temporariamente pausado para o contato. */
export async function isContactPaused(supabase: DbClient, phone: string): Promise<boolean> {
  try {
    const { data } = await supabase.rpc("is_whatsapp_paused", { p_phone: phone });
    return data === true;
  } catch {
    return false;
  }
}

/** Remove pausas expiradas e mensagens com mais de 2 dias (retention). */
export async function cleanupWhatsAppData(supabase: DbClient): Promise<void> {
  try {
    await supabase.rpc("cleanup_whatsapp_messages");
    await supabase
      .from("whatsapp_contact_pauses")
      .delete()
      .lt("paused_until", new Date().toISOString());
  } catch (e) {
    console.error("[whatsapp] falha no cleanup:", e);
  }
}

interface OrderRow {
  id: string;
  numero: string | null;
  external_order_id: string;
  cliente: string | null;
  total: number;
  payload: unknown;
  motoboy_id: string | null;
  whatsapp_notified_at: string | null;
  whatsapp_ready_notified_at: string | null;
  whatsapp_statuses_notified?: string[] | null;
}

export interface NotifyOrderResult {
  ok: boolean;
  message: string;
  enviados: number;
}

async function notifyOne(
  supabase: DbClient,
  order: OrderRow,
  notif: WhatsAppNotification | null | undefined,
  destino: string | null,
): Promise<boolean> {
  if (!destino || !notif) return false;
  const text = renderTemplate(
    notif.mensagem,
    await orderTemplateVars(supabase, order, notif.mensagem),
  );
  const r = await sendNotif(destino, text, notif);
  await logWhatsAppMessage(supabase, {
    phone: phoneFromDest(destino),
    chatId: destino,
    direction: "out",
    texto: text,
    tipo: `notificacao:${notif.regra}`,
    status: r.ok ? "enviado" : "erro",
    error: r.ok ? null : r.message,
    refOrderId: order.id,
  });
  return r.ok;
}

async function doNotify(
  supabase: DbClient,
  order: OrderRow,
  tipo: NotifyType,
  mode: "auto" | "manual",
): Promise<NotifyOrderResult> {
  const settings = await loadSettings(supabase);
  if (settings.whatsapp_enabled !== "true") {
    return {
      ok: false,
      message: "Notificações WhatsApp estão desativadas nas configurações.",
      enviados: 0,
    };
  }

  const notifications = await loadNotifications(supabase);
  const clientePhone = orderPhone(order.payload);
  let enviados = 0;

  if (tipo === "recebido") {
    if (!clientePhone) {
      return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
    }
    if (await isContactPaused(supabase, clientePhone)) {
      return {
        ok: false,
        message: "Envio pausado para este contato.",
        enviados: 0,
      };
    }
    const notif = notifications.find((n) => n.regra === "pedido_recebido" && n.ativo);
    if (!order.whatsapp_notified_at || mode === "manual") {
      const ok = await notifyOne(supabase, order, notif, clientePhone);
      if (ok) {
        enviados++;
        await supabase
          .from("anota_orders")
          .update({ whatsapp_notified_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    }
    return { ok: true, message: "Confirmação de recebimento processada.", enviados };
  }

  if (tipo === "motoboy") {
    if (!order.motoboy_id) {
      return { ok: false, message: "Nenhum motoboy vinculado a este pedido.", enviados: 0 };
    }
    const { data: moto } = await supabase
      .from("collaborators")
      .select("id, nome, celular")
      .eq("id", order.motoboy_id)
      .maybeSingle();
    if (!moto?.celular) {
      return {
        ok: false,
        message: "Motoboy vinculado não possui celular cadastrado.",
        enviados: 0,
      };
    }
    const phoneM = normalizePhone(moto.celular);
    if (!phoneM) return { ok: false, message: "Celular do motoboy inválido.", enviados: 0 };
    const notif = notifications.find((n) => n.regra === "motoboy" && n.ativo);
    const ok = await sendMotoboyMessage(supabase, order, notif, phoneM);
    return {
      ok,
      message: ok ? "Motoboy notificado." : "Falha ao notificar motoboy.",
      enviados: ok ? 1 : 0,
    };
  }

  // tipo === "pronto"
  if (!clientePhone) {
    return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
  }
  if (await isContactPaused(supabase, clientePhone)) {
    return {
      ok: false,
      message: "Envio pausado para este contato.",
      enviados: 0,
    };
  }
  if (!order.whatsapp_ready_notified_at || mode === "manual") {
    const notif = notifications.find((n) => n.regra === "pedido_pronto" && n.ativo);
    const ok = await notifyOne(supabase, order, notif, clientePhone);
    if (ok) {
      enviados++;
      await supabase
        .from("anota_orders")
        .update({ whatsapp_ready_notified_at: new Date().toISOString() })
        .eq("id", order.id);
    }
  }
  if (order.motoboy_id) {
    const { data: moto } = await supabase
      .from("collaborators")
      .select("id, nome, celular")
      .eq("id", order.motoboy_id)
      .maybeSingle();
    if (moto?.celular) {
      const phoneM = normalizePhone(moto.celular);
      if (phoneM) {
        const notif = notifications.find((n) => n.regra === "motoboy" && n.ativo);
        const okM = await sendMotoboyMessage(supabase, order, notif, phoneM);
        if (okM) enviados++;
      }
    }
  }
  return { ok: true, message: "Notificação de pronto processada.", enviados };
}

/**
 * Notifica um pedido (automático, com anti-duplicação).
 * Chamada a partir do syncAnotaOrders e dos botões da tela.
 */
export async function notifyOrderWhatsAppLogic(
  supabase: DbClient,
  orderId: string,
  tipo: NotifyType,
  _userId?: string | null,
): Promise<NotifyOrderResult> {
  const { data, error } = await supabase
    .from("anota_orders")
    .select(
      "id, numero, external_order_id, cliente, total, check_status, payload, motoboy_id, whatsapp_notified_at, whatsapp_ready_notified_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Pedido não encontrado.", enviados: 0 };
  return doNotify(supabase, data, tipo, "auto");
}

/**
 * Verifica se existe uma mensagem configurada para o status atual do pedido
 * (regras "status -> mensagem") e envia ao cliente, com anti-duplicação por status.
 * Chamada pelo syncAnotaOrders quando o pedido muda de status.
 */
export async function notifyStatusMessageWhatsApp(
  supabase: DbClient,
  orderId: string,
): Promise<NotifyOrderResult> {
  const { data, error } = await supabase
    .from("anota_orders")
    .select(
      "id, numero, external_order_id, cliente, total, check_status, payload, motoboy_id, whatsapp_notified_at, whatsapp_ready_notified_at, whatsapp_statuses_notified",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Pedido não encontrado.", enviados: 0 };

  const settings = await loadSettings(supabase);
  if (settings.whatsapp_enabled !== "true") {
    return {
      ok: false,
      message: "Notificações WhatsApp estão desativadas nas configurações.",
      enviados: 0,
    };
  }

  const regra = statusRuleRegra(data.check_status);
  const notifications = await loadNotifications(supabase);
  const notif = notifications.find((n) => n.regra === regra && n.ativo);
  if (!notif || !notif.mensagem.trim()) {
    return {
      ok: false,
      message: `Nenhuma mensagem configurada para o status ${data.check_status}.`,
      enviados: 0,
    };
  }

  const notified = Array.isArray(data.whatsapp_statuses_notified)
    ? data.whatsapp_statuses_notified
    : [];
  if (notified.includes(String(data.check_status))) {
    return {
      ok: false,
      message: `Status ${data.check_status} já notificado para este pedido.`,
      enviados: 0,
    };
  }

  const clientePhone = orderPhone(data.payload);
  if (!clientePhone) {
    return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
  }
  if (await isContactPaused(supabase, clientePhone)) {
    return {
      ok: false,
      message: "Envio pausado para este contato.",
      enviados: 0,
    };
  }

  const text = renderTemplate(
    notif.mensagem,
    await orderTemplateVars(supabase, data, notif.mensagem),
  );
  const r = await sendNotif(clientePhone, text, notif);
  await logWhatsAppMessage(supabase, {
    phone: phoneFromDest(clientePhone),
    chatId: clientePhone,
    direction: "out",
    texto: text,
    tipo: `status:${data.check_status}`,
    status: r.ok ? "enviado" : "erro",
    error: r.ok ? null : r.message,
    refOrderId: data.id,
  });
  if (r.ok) {
    await supabase
      .from("anota_orders")
      .update({ whatsapp_statuses_notified: [...notified, String(data.check_status)] })
      .eq("id", data.id);
    return { ok: true, message: `Mensagem de status ${data.check_status} enviada.`, enviados: 1 };
  }
  return { ok: false, message: r.message, enviados: 0 };
}

/**
 * Normaliza texto para comparação: remove acentos (diacríticos) e
 * converte para minúsculas. Faz "cardápio" e "cardapio" serem equivalentes.
 */
export function normalizeText(v: string): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Normaliza as palavras-chave de uma regra (lista separada por vírgula,
 * ponto e vírgula ou quebra de linha).
 */
export function keywordList(palavras: string): string[] {
  return palavras
    .split(/[,\n;]/)
    .map((p) => normalizeText(p).trim())
    .filter((p) => p.length > 0);
}

/**
 * Retorna as regras (ativas) cujas palavras-chave aparecem no texto alvo.
 * Comparação sem acento e case-insensitive; basta QUALQUER palavra-chave bater.
 */
export function matchKeywordRules(
  texto: string,
  rules: WhatsAppKeywordRule[],
): WhatsAppKeywordRule[] {
  const alvo = normalizeText(texto ?? "");
  return rules.filter((rule) => {
    if (!rule.ativo) return false;
    const palavras = keywordList(rule.palavras_chave);
    if (!palavras.length) return false;
    return palavras.some((p) => alvo.includes(p));
  });
}

/**
 * Verifica se alguma regra por palavras-chave corresponde ao pedido (itens,
 * cliente e payload) e envia a mensagem configurada ao cliente, com
 * anti-duplicação por regra. Chamada pelo syncAnotaOrders para pedidos novos
 * ou atualizados.
 */
export async function notifyKeywordRulesWhatsApp(
  supabase: DbClient,
  orderId: string,
): Promise<NotifyOrderResult> {
  const { data, error } = await supabase
    .from("anota_orders")
    .select(
      "id, numero, external_order_id, cliente, total, check_status, payload, motoboy_id, whatsapp_notified_at, whatsapp_ready_notified_at, whatsapp_statuses_notified, whatsapp_keywords_notified",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Pedido não encontrado.", enviados: 0 };

  const settings = await loadSettings(supabase);
  if (settings.whatsapp_enabled !== "true") {
    return {
      ok: false,
      message: "Notificações WhatsApp estão desativadas nas configurações.",
      enviados: 0,
    };
  }

  const rules = (await loadKeywordRules(supabase)).filter((r) => r.ativo);
  if (!rules.length) {
    return { ok: false, message: "Nenhuma regra por palavra-chave ativa.", enviados: 0 };
  }

  const notified = Array.isArray(data.whatsapp_keywords_notified)
    ? data.whatsapp_keywords_notified
    : [];

  const clientePhone = orderPhone(data.payload);
  if (!clientePhone) {
    return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
  }
  if (await isContactPaused(supabase, clientePhone)) {
    return {
      ok: false,
      message: "Envio pausado para este contato.",
      enviados: 0,
    };
  }

  const itens = await orderItemsText(supabase, orderId);
  const alvo = [data.cliente ?? "", data.numero ?? "", itens, JSON.stringify(data.payload ?? {})]
    .filter(Boolean)
    .join("\n");

  let enviados = 0;
  const novosNotificados: string[] = [...notified];
  for (const rule of matchKeywordRules(alvo, rules)) {
    if (novosNotificados.includes(rule.regra)) continue;

    const text = renderTemplate(
      rule.mensagem,
      await orderTemplateVars(supabase, data, rule.mensagem),
    );
    const r = await sendNotif(clientePhone, text, rule);
    await logWhatsAppMessage(supabase, {
      phone: phoneFromDest(clientePhone),
      chatId: clientePhone,
      direction: "out",
      texto: text,
      tipo: `keyword:${rule.regra}`,
      status: r.ok ? "enviado" : "erro",
      error: r.ok ? null : r.message,
      refOrderId: data.id,
    });
    if (r.ok) {
      enviados++;
      novosNotificados.push(rule.regra);
    }
  }

  if (novosNotificados.length > notified.length) {
    await supabase
      .from("anota_orders")
      .update({ whatsapp_keywords_notified: novosNotificados })
      .eq("id", orderId);
  }

  if (!enviados) {
    return {
      ok: false,
      message: "Nenhuma palavra-chave corresponde a este pedido (ou já notificado).",
      enviados: 0,
    };
  }
  return { ok: true, message: `${enviados} regra(s) por palavra-chave disparada(s).`, enviados };
}

/** Envia manualmente (sem respeitar anti-duplicação). */
export async function sendOrderMessageManual(
  supabase: DbClient,
  orderId: string,
  tipo: NotifyType,
): Promise<NotifyOrderResult> {
  const { data, error } = await supabase
    .from("anota_orders")
    .select(
      "id, numero, external_order_id, cliente, total, check_status, payload, motoboy_id, whatsapp_notified_at, whatsapp_ready_notified_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Pedido não encontrado.", enviados: 0 };
  return doNotify(supabase, data, tipo, "manual");
}

// ---------------------------------------------------------------------------
// Roles (mesmo critério do Anota)
// ---------------------------------------------------------------------------

const ROLES_PERMITIDAS = ["admin", "estoque", "compras", "producao", "operacional"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureRole(context: { supabase: any; userId: string }) {
  for (const role of ROLES_PERMITIDAS) {
    try {
      const { data } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: role,
      });
      if (data === true) return;
    } catch {
      const { data: rows } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", role)
        .maybeSingle();
      if (rows) return;
    }
  }
  console.warn(`Usuário ${context.userId} sem role — acesso concedido por autenticação`);
}

// ---------------------------------------------------------------------------
// Server functions (usadas pela UI)
// ---------------------------------------------------------------------------

export interface WhatsAppConnectionResult {
  ok: boolean;
  message: string;
}

/** Testa a conexão com o Waha (health) e se as variáveis estão configuradas. */
export const testWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnectionResult> => {
    await ensureRole(context);
    const env = wahaEnv();
    if ("error" in env) return { ok: false, message: env.error };
    try {
      const res = await fetch(`${env.url}/api/health`, { headers: { "X-Api-Key": env.key } });
      if (res.ok) {
        const json = asRecord(await res.json().catch(() => null));
        const status = typeof json?.status === "string" ? json.status : "OK";
        return { ok: true, message: `Waha conectado. Status: ${status}.` };
      }
      return { ok: false, message: `Waha respondeu HTTP ${res.status} em /api/health.` };
    } catch (e) {
      return {
        ok: false,
        message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

export interface WahaSessionInfo {
  id?: string;
  name?: string;
  status?: string;
  state?: string;
  me?: string | null;
}

export interface WhatsAppStatusResult {
  ok: boolean;
  message: string;
  connected: boolean;
  sessionName: string;
  session?: WahaSessionInfo | null;
}

/** Verifica o status da sessão do Waha (conectada ou aguardando QR). */
export const getWhatsAppStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppStatusResult> => {
    await ensureRole(context);
    const env = wahaEnv();
    if ("error" in env) return { ok: false, message: env.error, connected: false, sessionName: "" };
    try {
      const res = await fetch(`${env.url}/api/sessions`, { headers: { "X-Api-Key": env.key } });
      if (!res.ok) {
        return {
          ok: false,
          message: `Waha respondeu HTTP ${res.status} ao listar sessões.`,
          connected: false,
          sessionName: env.session,
        };
      }
      const json: unknown = await res.json().catch(() => null);
      const arr = Array.isArray(json) ? json : [];
      const session =
        arr.find((s: { id?: string; name?: string }) => (s.id ?? s.name) === env.session) ?? null;
      const connected =
        !!session &&
        ((session as WahaSessionInfo).status === "WORKING" ||
          (session as WahaSessionInfo).state === "WORKING" ||
          !!(session as WahaSessionInfo).me);
      return {
        ok: true,
        message: connected ? "Número conectado." : "Sessão desconectada. Escaneie o QR Code.",
        connected,
        sessionName: env.session,
        session: session as WahaSessionInfo | null,
      };
    } catch (e) {
      return {
        ok: false,
        message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}`,
        connected: false,
        sessionName: env.session,
      };
    }
  });

export interface WhatsAppQrResult {
  ok: boolean;
  message: string;
  qrDataUrl?: string;
}

/** Obtém o QR Code da sessão do Waha para conectar o número. */
export const getWhatsAppQrCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppQrResult> => {
    await ensureRole(context);
    const env = wahaEnv();
    if ("error" in env) return { ok: false, message: env.error };

    const paths = [
      `${env.url}/api/sessions/${env.session}/auth/qr`,
      `${env.url}/api/${env.session}/auth/qr`,
      `${env.url}/api/session/${env.session}/qr`,
    ];
    for (const url of paths) {
      try {
        const res = await fetch(url, { headers: { "X-Api-Key": env.key } });
        if (!res.ok) continue;
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("image")) {
          const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
          return {
            ok: true,
            message: "QR Code gerado.",
            qrDataUrl: `data:${contentType};base64,${b64}`,
          };
        }
        const text = await res.text();
        let json: JsonRecord | null = null;
        try {
          json = asRecord(JSON.parse(text));
        } catch {
          json = null;
        }
        if (json && typeof json.qr === "string" && json.qr) {
          const qr = json.qr.startsWith("data:") ? json.qr : `data:image/png;base64,${json.qr}`;
          return { ok: true, message: "QR Code gerado.", qrDataUrl: qr };
        }
      } catch {
        // tenta o próximo caminho
      }
    }
    return {
      ok: false,
      message:
        "Não foi possível obter o QR Code. Confirme se o Waha está acessível e a sessão " +
        `"${env.session}" foi criada.`,
    };
  });

export interface CreateSessionResult {
  ok: boolean;
  message: string;
}

/** Cria a sessão no Waha (necessária para exibir o QR Code). */
export const createWhatsAppSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreateSessionResult> => {
    await ensureRole(context);
    const env = wahaEnv();
    if ("error" in env) return { ok: false, message: env.error };
    try {
      const res = await fetch(`${env.url}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": env.key },
        body: JSON.stringify({ name: env.session }),
      });
      if (res.ok) {
        return {
          ok: true,
          message: `Sessão "${env.session}" criada. Escaneie o QR Code para conectar.`,
        };
      }
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, message: `Falha ao criar sessão (HTTP ${res.status}): ${snippet}` };
    } catch (e) {
      return {
        ok: false,
        message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

export interface GetWhatsAppSettingsResult {
  ok: boolean;
  settings: Record<string, string>;
}

/** Retorna as configurações/mensagens do WhatsApp. */
export const getWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GetWhatsAppSettingsResult> => {
    await ensureRole(context);
    const settings = await loadSettings(context.supabase);
    return { ok: true, settings };
  });

export interface SaveWhatsAppSettingsInput {
  settings: Record<string, string>;
}

export interface SaveWhatsAppSettingsResult {
  ok: boolean;
  message: string;
}

/** Salva as configurações/mensagens do WhatsApp. */
export const saveWhatsAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveWhatsAppSettingsInput) => {
    if (!input || !input.settings) throw new Error("Dados inválidos.");
    return { settings: input.settings };
  })
  .handler(async ({ context, data }): Promise<SaveWhatsAppSettingsResult> => {
    await ensureRole(context);
    const upserts = Object.entries(data.settings)
      .filter(([k]) => WHATSAPP_SETTING_KEYS.includes(k))
      .map(([key, value]) => ({ key, value }));
    if (!upserts.length) return { ok: false, message: "Nenhuma configuração válida." };
    const { error } = await context.supabase
      .from("whatsapp_settings")
      .upsert(upserts, { onConflict: "key" });
    if (error) return { ok: false, message: `Erro ao salvar: ${error.message}` };
    return { ok: true, message: "Configurações salvas com sucesso." };
  });

export interface GetWhatsAppNotificationsResult {
  ok: boolean;
  notifications: WhatsAppNotification[];
}

/** Retorna todas as notificações automáticas configuradas. */
export const getWhatsAppNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GetWhatsAppNotificationsResult> => {
    await ensureRole(context);
    const notifications = await loadNotifications(context.supabase);
    return { ok: true, notifications };
  });

export interface SaveWhatsAppNotificationInput {
  notifications: {
    regra: string;
    titulo: string;
    mensagem: string;
    status: number | null;
    imagem_url: string | null;
    ativo: boolean;
  }[];
}

export interface SaveWhatsAppNotificationsResult {
  ok: boolean;
  message: string;
}

/** Salva (upsert por regra) todas as notificações automáticas. */
export const saveWhatsAppNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveWhatsAppNotificationInput) => {
    if (!input || !Array.isArray(input.notifications)) {
      throw new Error("Dados inválidos.");
    }
    for (const n of input.notifications) {
      if (typeof n.regra !== "string" || !n.regra.trim()) throw new Error("Regra inválida.");
      if (typeof n.mensagem !== "string" || !n.mensagem.trim()) {
        throw new Error("Mensagem vazia em uma das notificações.");
      }
    }
    return { notifications: input.notifications };
  })
  .handler(async ({ context, data }): Promise<SaveWhatsAppNotificationsResult> => {
    await ensureRole(context);
    const upserts = data.notifications.map((n) => ({
      regra: n.regra,
      titulo: n.titulo ?? "",
      mensagem: n.mensagem,
      status: n.status ?? null,
      imagem_url: n.imagem_url ?? null,
      ativo: n.ativo ?? true,
    }));
    const { error } = await context.supabase
      .from("whatsapp_notifications")
      .upsert(upserts, { onConflict: "regra" });
    if (error) return { ok: false, message: `Erro ao salvar: ${error.message}` };
    return { ok: true, message: "Notificações salvas com sucesso." };
  });

export interface SetOrderMotoboyInput {
  orderId: string;
  motoboyId: string | null;
}

export interface SetOrderMotoboyResult {
  ok: boolean;
  message: string;
}

/** Vincula/desvincula o motoboy (colaborador) a um pedido. */
export const setOrderMotoboy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SetOrderMotoboyInput) => {
    if (!input || !input.orderId) throw new Error("Pedido inválido.");
    return { orderId: input.orderId, motoboyId: input.motoboyId ?? null };
  })
  .handler(async ({ context, data }): Promise<SetOrderMotoboyResult> => {
    await ensureRole(context);
    const { error } = await context.supabase
      .from("anota_orders")
      .update({ motoboy_id: data.motoboyId })
      .eq("id", data.orderId);
    if (error) return { ok: false, message: `Erro ao vincular motoboy: ${error.message}` };
    return {
      ok: true,
      message: data.motoboyId ? "Motoboy vinculado ao pedido." : "Motoboy desvinculado do pedido.",
    };
  });

export interface SendOrderMessageInput {
  orderId: string;
  tipo: NotifyType;
}

export interface SendOrderMessageResult {
  ok: boolean;
  message: string;
  enviados: number;
}

/** Envia manualmente uma mensagem (confirmação/pronto/motoboy) para um pedido. */
export const sendOrderMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SendOrderMessageInput) => {
    if (!input || !input.orderId || !["recebido", "pronto", "motoboy"].includes(input.tipo)) {
      throw new Error("Dados inválidos.");
    }
    return { orderId: input.orderId, tipo: input.tipo as NotifyType };
  })
  .handler(async ({ context, data }): Promise<SendOrderMessageResult> => {
    await ensureRole(context);
    const r = await sendOrderMessageManual(context.supabase, data.orderId, data.tipo);
    await context.supabase.from("activity_logs").insert({
      modulo: "whatsapp",
      acao: "enviou_mensagem",
      user_id: context.userId,
      registro_id: data.orderId,
      detalhes: { tipo: data.tipo, resultado: r.message, enviados: r.enviados },
    });
    return { ok: r.ok, message: r.message, enviados: r.enviados };
  });

export interface GetWhatsAppKeywordRulesResult {
  ok: boolean;
  rules: WhatsAppKeywordRule[];
}

/** Retorna todas as regras de disparo por palavras-chave. */
export const getWhatsAppKeywordRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GetWhatsAppKeywordRulesResult> => {
    await ensureRole(context);
    const rules = await loadKeywordRules(context.supabase);
    return { ok: true, rules };
  });

export interface SaveWhatsAppKeywordRuleInput {
  rules: {
    regra: string;
    nome: string;
    palavras_chave: string;
    mensagem: string;
    imagem_url: string | null;
    ativo: boolean;
  }[];
}

export interface SaveWhatsAppKeywordRulesResult {
  ok: boolean;
  message: string;
}

/** Salva (upsert por regra) todas as regras por palavras-chave e remove as removidas. */
export const saveWhatsAppKeywordRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveWhatsAppKeywordRuleInput) => {
    if (!input || !Array.isArray(input.rules)) {
      throw new Error("Dados inválidos.");
    }
    for (const r of input.rules) {
      if (typeof r.regra !== "string" || !r.regra.trim()) throw new Error("Regra inválida.");
      if (typeof r.palavras_chave !== "string" || !r.palavras_chave.trim()) {
        throw new Error("Informe ao menos uma palavra-chave em cada regra.");
      }
      if (typeof r.mensagem !== "string" || !r.mensagem.trim()) {
        throw new Error("Mensagem vazia em uma das regras.");
      }
    }
    return { rules: input.rules };
  })
  .handler(async ({ context, data }): Promise<SaveWhatsAppKeywordRulesResult> => {
    await ensureRole(context);
    const upserts = data.rules.map((r) => ({
      regra: r.regra,
      nome: r.nome ?? "",
      palavras_chave: r.palavras_chave,
      mensagem: r.mensagem,
      imagem_url: r.imagem_url ?? null,
      ativo: r.ativo ?? true,
    }));
    const { error } = await context.supabase
      .from("whatsapp_keyword_rules")
      .upsert(upserts, { onConflict: "regra" });
    if (error) return { ok: false, message: `Erro ao salvar: ${error.message}` };

    const { data: existentes, error: listErr } = await context.supabase
      .from("whatsapp_keyword_rules")
      .select("regra");
    if (!listErr && existentes) {
      const mantidas = new Set(data.rules.map((r) => r.regra));
      const aRemover = existentes
        .filter((e) => !mantidas.has(e.regra))
        .map((e) => e.regra);
      if (aRemover.length) {
        await context.supabase
          .from("whatsapp_keyword_rules")
          .delete()
          .in("regra", aRemover);
      }
    }
    return { ok: true, message: "Regras por palavra-chave salvas com sucesso." };
  });

// ---------------------------------------------------------------------------
// Conversas (aba Mensagens)
// ---------------------------------------------------------------------------

export interface WhatsAppMessageRow {
  id: string;
  phone: string;
  chatId: string | null;
  direction: "in" | "out";
  texto: string;
  tipo: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
}

export interface WhatsAppConversation {
  phone: string;
  nome: string;
  lastMessage: string;
  lastMessageAt: string;
  count: number;
  unread: number;
  paused_until: string | null;
}

export interface GetWhatsAppConversationsResult {
  ok: boolean;
  conversations: WhatsAppConversation[];
}

/** Resolve o nome do cliente a partir dos pedidos Anota recentes (best-effort). */
async function contactNameByPhone(
  supabase: DbClient,
  phones: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!phones.length) return map;
  const { data: orders } = await supabase
    .from("anota_orders")
    .select("cliente, payload")
    .gte("imported_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .not("cliente", "is", null);
  for (const o of orders ?? []) {
    const p = orderPhone(o.payload);
    if (p && !map.has(p)) map.set(p, (o.cliente ?? "").trim());
  }
  return map;
}

function fmtPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

/** Lista as conversas iniciadas no dia atual (retidas por até 2 dias). */
export const getWhatsAppConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GetWhatsAppConversationsResult> => {
    await ensureRole(context);
    await cleanupWhatsAppData(context.supabase);

    const hojeInicio = new Date();
    hojeInicio.setHours(0, 0, 0, 0);

    // Agrupa por telefone as mensagens da janela de retenção (2 dias), mas
    // expõe apenas conversas cuja primeira mensagem foi hoje.
    const { data: rows, error } = await context.supabase
      .from("whatsapp_messages")
      .select("id, phone, chat_id, direction, texto, tipo, status, error, created_at")
      .gte("created_at", hojeInicio.toISOString())
      .order("created_at", { ascending: true });
    if (error) return { ok: false, conversations: [] };

    // Busca a primeira mensagem de cada telefone (para filtrar iniciadas hoje)
    // mantendo a visibilidade de 2 dias.
    const byPhone = new Map<string, WhatsAppMessageRow[]>();
    for (const r of rows ?? []) {
      const item: WhatsAppMessageRow = {
        id: r.id,
        phone: r.phone,
        chatId: r.chat_id,
        direction: r.direction as "in" | "out",
        texto: r.texto,
        tipo: r.tipo,
        status: r.status,
        error: r.error,
        created_at: r.created_at,
      };
      const list = byPhone.get(r.phone) ?? [];
      list.push(item);
      byPhone.set(r.phone, list);
    }

    const nomes = await contactNameByPhone(context.supabase, [...byPhone.keys()]);

    const { data: pauses } = await context.supabase
      .from("whatsapp_contact_pauses")
      .select("phone, paused_until")
      .gte("paused_until", new Date().toISOString());
    const pausedMap = new Map<string, string>();
    for (const p of pauses ?? []) pausedMap.set(p.phone, p.paused_until);

    const conversations: WhatsAppConversation[] = [...byPhone.entries()].map(([phone, msgs]) => {
      const sorted = [...msgs].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        phone,
        nome: nomes.get(phone) || fmtPhoneBR(phone),
        lastMessage: last.texto,
        lastMessageAt: last.created_at,
        count: sorted.length,
        unread: sorted.filter(
          (m) => m.direction === "in" && +new Date(m.created_at) >= +new Date(hojeInicio),
        ).length,
        paused_until: pausedMap.get(phone) ?? null,
      };
    });

    conversations.sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));

    return { ok: true, conversations };
  });

export interface GetWhatsAppConversationResult {
  ok: boolean;
  messages: WhatsAppMessageRow[];
  nome: string;
}

/** Retorna as mensagens (até 2 dias) de um contato específico. */
export const getWhatsAppConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone?: string }) => {
    if (!input || !input.phone) throw new Error("Telefone inválido.");
    return { phone: input.phone };
  })
  .handler(async ({ context, data }): Promise<GetWhatsAppConversationResult> => {
    await ensureRole(context);
    await cleanupWhatsAppData(context.supabase);

    const limite = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("whatsapp_messages")
      .select("id, phone, chat_id, direction, texto, tipo, status, error, created_at")
      .eq("phone", data.phone)
      .gte("created_at", limite)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, messages: [], nome: data.phone };

    const nomes = await contactNameByPhone(context.supabase, [data.phone]);
    return {
      ok: true,
      messages: (rows ?? []).map((r) => ({
        id: r.id,
        phone: r.phone,
        chatId: r.chat_id,
        direction: r.direction as "in" | "out",
        texto: r.texto,
        tipo: r.tipo,
        status: r.status,
        error: r.error,
        created_at: r.created_at,
      })),
      nome: nomes.get(data.phone) || fmtPhoneBR(data.phone),
    };
  });

export interface SetWhatsAppPauseInput {
  phone: string;
  minutes: number;
}

export interface SetWhatsAppPauseResult {
  ok: boolean;
  message: string;
  paused_until: string | null;
}

/** Pausa temporariamente o envio de mensagens para um contato por X minutos. */
export const pauseWhatsAppContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SetWhatsAppPauseInput) => {
    if (!input || !input.phone) throw new Error("Telefone inválido.");
    const minutes = Number(input.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error("Informe um período maior que zero.");
    }
    return { phone: input.phone, minutes: Math.min(minutes, 24 * 60) };
  })
  .handler(async ({ context, data }): Promise<SetWhatsAppPauseResult> => {
    await ensureRole(context);
    const until = new Date(Date.now() + data.minutes * 60 * 1000).toISOString();
    const { error } = await context.supabase
      .from("whatsapp_contact_pauses")
      .upsert(
        { phone: data.phone, paused_until: until, updated_at: new Date().toISOString() },
        { onConflict: "phone" },
      );
    if (error)
      return { ok: false, message: `Erro ao pausar: ${error.message}`, paused_until: null };
    await context.supabase.from("activity_logs").insert({
      modulo: "whatsapp",
      acao: "pausou_contato",
      user_id: context.userId,
      registro_id: null,
      detalhes: { phone: data.phone, minutes: data.minutes, paused_until: until },
    });
    return {
      ok: true,
      message: `Envio pausado por ${data.minutes} min para este contato.`,
      paused_until: until,
    };
  });

export interface ClearWhatsAppPauseInput {
  phone: string;
}

export interface ClearWhatsAppPauseResult {
  ok: boolean;
  message: string;
}

/** Reativa imediatamente o envio de mensagens para um contato. */
export const unpauseWhatsAppContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ClearWhatsAppPauseInput) => {
    if (!input || !input.phone) throw new Error("Telefone inválido.");
    return { phone: input.phone };
  })
  .handler(async ({ context, data }): Promise<ClearWhatsAppPauseResult> => {
    await ensureRole(context);
    const { error } = await context.supabase
      .from("whatsapp_contact_pauses")
      .delete()
      .eq("phone", data.phone);
    if (error) return { ok: false, message: `Erro ao reativar: ${error.message}` };
    await context.supabase.from("activity_logs").insert({
      modulo: "whatsapp",
      acao: "reativou_contato",
      user_id: context.userId,
      registro_id: null,
      detalhes: { phone: data.phone },
    });
    return { ok: true, message: "Envio reativado para este contato." };
  });
