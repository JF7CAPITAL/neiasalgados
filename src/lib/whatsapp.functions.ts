import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fmtMoney } from "@/lib/format";

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
    return { error: "WhatsApp (Waha) não configurado. Defina WAHA_URL e WAHA_API_KEY nas variáveis de ambiente." };
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
  for (const k of ["phone", "phoneNumber", "cellphone", "celular", "telefone", "whatsapp", "mobile"]) {
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
      .map((it: { nome: string | null; quantidade: number }) => `${it.quantidade}x ${it.nome ?? "item"}`)
      .join(", ");
  } catch {
    return "";
  }
}

/**
 * Monta a mensagem do motoboy: template + endereço, itens e link do Google Maps.
 * O bloco de entrega é SEMPRE anexado, mesmo se o template não tiver placeholders.
 */
async function buildMotoboyText(
  supabase: DbClient,
  order: OrderRow,
  settings: Record<string, string>,
): Promise<string> {
  const numero = order.numero ?? order.external_order_id ?? "";
  const vars: Record<string, string> = {
    numero,
    total: fmtMoney(order.total),
    cliente: order.cliente ?? "cliente",
  };
  let text = renderTemplate(settings.template_motoboy_pronto, vars);

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
  settings: Record<string, string>,
  phoneM: string,
): Promise<boolean> {
  const text = await buildMotoboyText(supabase, order, settings);
  const r = await sendWahaText(phoneM, text);
  await logWhatsApp(supabase, order, "motoboy_pronto", phoneM, r.ok ? "enviado" : "erro", r.message, text);
  return r.ok;
}

/** Renderiza um template substituindo {{chave}}. */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`);
}

const DEFAULT_SETTINGS: Record<string, string> = {
  whatsapp_enabled: "true",
  template_pedido_recebido:
    "Neia Salgados: recebemos seu pedido #{{numero}} no valor de R$ {{total}}. Já estamos preparando!",
  template_pedido_pronto: "Neia Salgados: seu pedido #{{numero}} está pronto!",
  template_motoboy_pronto: "Neia Salgados: pedido #{{numero}} ({{cliente}}) está pronto para entrega.",
};

export const WHATSAPP_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

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

async function logWhatsApp(
  supabase: DbClient,
  order: { id: string; numero?: string | null; external_order_id?: string | null },
  tipo: string,
  destino: string | null,
  status: string,
  error?: string | null,
  mensagem?: string | null,
) {
  try {
    await supabase.from("whatsapp_logs").insert({
      ref_type: "anota_order",
      ref_id: order.id,
      destino,
      tipo,
      mensagem: mensagem ?? null,
      status,
      error: error ?? null,
    });
  } catch (e) {
    console.error("[whatsapp] log insert error:", e);
  }
}

export interface WahaSendResult {
  ok: boolean;
  message: string;
  status?: number;
}

/** Envia um texto via Waha para um número em E.164 (só dígitos). */
export async function sendWahaText(to: string, text: string): Promise<WahaSendResult> {
  const env = wahaEnv();
  if ("error" in env) return { ok: false, message: env.error };
  if (!env.enabled) return { ok: false, message: "Notificações WhatsApp desativadas (WAHA_ENABLED=false)." };
  const chatId = `${to}@c.us`;
  try {
    const res = await fetch(`${env.url}/api/sendText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.key },
      body: JSON.stringify({ session: env.session, chatId, text }),
    });
    if (res.ok) return { ok: true, message: "Mensagem enviada." };
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, status: res.status, message: `Falha no Waha (HTTP ${res.status}): ${snippet}` };
  } catch (e) {
    return { ok: false, message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Core de notificação (executado no servidor)
// ---------------------------------------------------------------------------

export type NotifyType = "recebido" | "pronto" | "motoboy";

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
}

export interface NotifyOrderResult {
  ok: boolean;
  message: string;
  enviados: number;
}

async function notifyOne(
  supabase: DbClient,
  order: OrderRow,
  settings: Record<string, string>,
  destino: string | null,
  tipo: "pedido_recebido" | "pedido_pronto" | "motoboy_pronto",
  templateKey: keyof typeof DEFAULT_SETTINGS,
): Promise<boolean> {
  if (!destino) return false;
  const numero = order.numero ?? order.external_order_id ?? "";
  const text = renderTemplate(settings[templateKey], {
    numero,
    total: fmtMoney(order.total),
    cliente: order.cliente ?? "cliente",
  });
  const r = await sendWahaText(destino, text);
  await logWhatsApp(supabase, order, tipo, destino, r.ok ? "enviado" : "erro", r.message, text);
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
    return { ok: false, message: "Notificações WhatsApp estão desativadas nas configurações.", enviados: 0 };
  }

  const clientePhone = orderPhone(order.payload);
  let enviados = 0;

  if (tipo === "recebido") {
    if (!clientePhone) {
      await logWhatsApp(supabase, order, "pedido_recebido", null, "ignorado", "Cliente sem telefone no payload");
      return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
    }
    if (!order.whatsapp_notified_at || mode === "manual") {
      const ok = await notifyOne(supabase, order, settings, clientePhone, "pedido_recebido", "template_pedido_recebido");
      if (ok) {
        enviados++;
        await supabase.from("anota_orders").update({ whatsapp_notified_at: new Date().toISOString() }).eq("id", order.id);
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
      return { ok: false, message: "Motoboy vinculado não possui celular cadastrado.", enviados: 0 };
    }
    const phoneM = normalizePhone(moto.celular);
    if (!phoneM) return { ok: false, message: "Celular do motoboy inválido.", enviados: 0 };
    const ok = await sendMotoboyMessage(supabase, order, settings, phoneM);
    return { ok, message: ok ? "Motoboy notificado." : "Falha ao notificar motoboy.", enviados: ok ? 1 : 0 };
  }

  // tipo === "pronto"
  if (!clientePhone) {
    await logWhatsApp(supabase, order, "pedido_pronto", null, "ignorado", "Cliente sem telefone no payload");
    return { ok: false, message: "Cliente sem telefone no payload do pedido.", enviados: 0 };
  }
  if (!order.whatsapp_ready_notified_at || mode === "manual") {
    const ok = await notifyOne(supabase, order, settings, clientePhone, "pedido_pronto", "template_pedido_pronto");
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
        const okM = await sendMotoboyMessage(supabase, order, settings, phoneM);
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
      const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
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
      return { ok: false, message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}` };
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
      const session = arr.find(
        (s: { id?: string; name?: string }) => (s.id ?? s.name) === env.session,
      ) ?? null;
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
          return { ok: true, message: "QR Code gerado.", qrDataUrl: `data:${contentType};base64,${b64}` };
        }
        const text = await res.text();
        let json: JsonRecord | null = null;
        try { json = asRecord(JSON.parse(text)); } catch { json = null; }
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
      message: "Não foi possível obter o QR Code. Confirme se o Waha está acessível e a sessão " +
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
        return { ok: true, message: `Sessão "${env.session}" criada. Escaneie o QR Code para conectar.` };
      }
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, message: `Falha ao criar sessão (HTTP ${res.status}): ${snippet}` };
    } catch (e) {
      return { ok: false, message: `Erro de rede ao chamar o Waha: ${e instanceof Error ? e.message : String(e)}` };
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
    const { error } = await context.supabase.from("whatsapp_settings").upsert(upserts, { onConflict: "key" });
    if (error) return { ok: false, message: `Erro ao salvar: ${error.message}` };
    return { ok: true, message: "Configurações salvas com sucesso." };
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
