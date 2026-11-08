import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  notifyOrderWhatsAppLogic,
  notifyStatusMessageWhatsApp,
  notifyKeywordRulesWhatsApp,
} from "@/lib/whatsapp.functions";
/**
 * Integração Anota AI — somente webhook (a API de pedidos será descontinuada).
 *
 * O Anota faz POST em `/api/anota-webhook` com três formatos de evento:
 *  - Pedido completo (novo/atualizado): objeto com `check`, `items`, `customer`…
 *  - Cancelamento: `{ id, canceled: true, merchant, justification }`
 *  - Eventos são idempotentes por `external_order_id`.
 *
 * O ERP também mantém rotinas locais (sem depender do Anota): promoção de
 * agendados vencidos, devolução de estoque e notificações WhatsApp.
 */

const ROLES_PERMITIDAS = ["admin", "estoque", "compras", "producao", "operacional"] as const;

const CHECK_LABELS: Record<number, string> = {
  0: "Em análise",
  1: "Em produção",
  2: "Pronto",
  3: "Finalizado",
  4: "Cancelado",
  5: "Negado",
  6: "Cancelamento solicitado",
};

export const ANOTA_CHECK_LABELS = CHECK_LABELS;

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

function firstString(o: JsonRecord, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function firstNumber(o: JsonRecord, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

interface ListedOrder {
  id: string;
  check: number;
}

/** Extrai a lista de pedidos {id, check} de uma resposta de listagem. */
function extractListedOrders(json: unknown): ListedOrder[] | null {
  const root = asRecord(json);
  if (!root) return null;
  const info = asRecord(root.info);
  const candidates: unknown[] = [
    info?.docs,
    root.docs,
    root.orders,
    root.data,
    Array.isArray(json) ? json : undefined,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const out: ListedOrder[] = [];
      for (const item of c) {
        const r = asRecord(item);
        if (!r) continue;
        const id = firstString(r, ["_id", "id", "order_id", "orderId"]);
        if (!id) continue;
        const check = firstNumber(r, ["check", "status", "check_status"]) ?? 0;
        out.push({ id, check });
      }
      return out;
    }
  }
  return null;
}

interface ParsedItem {
  ref: string;
  nome: string | null;
  quantidade: number;
  /** true quando o item é um combo (contêiner) — a baixa usa a composição configurada. */
  isCombo?: boolean;
  /** ref do combo pai, para itens que vieram de dentro de um combo. */
  comboRef?: string | null;
}

interface ParsedOrder {
  externalId: string;
  numero: string | null;
  check: number;
  total: number;
  cliente: string | null;
  pedidoEm: string | null;
  items: ParsedItem[];
  raw: unknown;
}

/** Localiza o objeto do pedido dentro de uma resposta de detalhe. */
function unwrapOrder(json: unknown): JsonRecord | null {
  const root = asRecord(json);
  if (!root) return null;
  if (root._id || root.id || root.order_id) return root;
  const info = asRecord(root.info);
  if (info && (info._id || info.id || info.order_id)) return info;
  const order = asRecord(root.order);
  if (order) return order;
  const data = asRecord(root.data);
  if (data && (data._id || data.id || data.order_id)) return data;
  return root;
}

/** Extrai a quantidade real multiplicando o campo qtd da API pelo número
 *  embutido no nome (ex: "1x 50 unidades de pastelzinhos" qtd:1 → 50×1=50,
 *  "50 Pastelzinho De Queijo" qtd:1 → 50, "50 Mini Coxinhas De Frango" qtd:2 → 100,
 *  "Pastelzinho de Carne (25)" → 25, "Empada de Frango 50 UNID." → 50). */
function resolveQuantidade(apiQtd: number | null, nome: string | null): number {
  const raw = apiQtd ?? 1;
  if (!nome) return raw;
  const n = nome.trim();
  const xunid = n.match(/^\d+x\s+(\d+)\s+unidades/i);
  if (xunid) return parseInt(xunid[1], 10) * raw;
  const lead = n.match(/^(\d+)\s/);
  if (lead) return parseInt(lead[1], 10) * raw;
  const trail = n.match(/(\d+)\s*UNID/);
  if (trail) return parseInt(trail[1], 10) * raw;
  const paren = n.match(/\((\d+)\)\s*$/);
  if (paren) return parseInt(paren[1], 10) * raw;
  return raw;
}

/** Remove prefixos/sufixos numéricos do nome do produto para usar como ref
 *  no mapeamento. Ex: "1x 50 unidades de pastelzinhos" → "pastelzinhos",
 *  "50 Enroladinho…" → "Enroladinho…", "Empada de Frango 50 UNID." → "Empada de Frango",
 *  "Pastelzinho de Carne (25)" → "Pastelzinho de Carne". */
function cleanItemName(nome: string | null): string | null {
  if (!nome) return null;
  const n = nome.trim();
  const xunid = n.match(/^\d+x\s+\d+\s+unidades\s+de\s+(.+)/i);
  if (xunid) return xunid[1].trim();
  const lead = n.match(/^\d+\s+(.+)/);
  if (lead) return lead[1].trim();
  const trail = n.match(/^(.+?)\s*\d+\s*UNID/);
  if (trail) return trail[1].trim();
  const paren = n.match(/^(.+?)\s*\(\d+\)\s*$/);
  if (paren) return paren[1].trim();
  return n;
}

/** Data/hora em que o pedido agendado deve entrar em produção.
 *  Mesma lógica da tela: payload.preparationStartDateTime ou payload.schedule_order.date. */
function getScheduledDateTime(payload: unknown): Date | null {
  const root = asRecord(payload);
  if (!root) return null;
  const schedule = asRecord(root.schedule_order);
  const raw =
    (typeof root.preparationStartDateTime === "string" && root.preparationStartDateTime.trim()) ||
    (schedule && typeof schedule.date === "string" && schedule.date.trim()) ||
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Se o pedido ainda aparece como agendado (-2) no Anota mas o horário agendado
 *  já venceu, o ERP promove para produção (1) independentemente da sincronização. */
function effectiveCheckStatus(payload: unknown, check: number): number {
  if (check !== -2) return check;
  const dt = getScheduledDateTime(payload);
  if (dt && dt.getTime() <= Date.now()) return 1;
  return check;
}

/** Nomes de campos que indicam que um objeto é um contêiner
 *  (categoria/grupo/subgrupo/combo) com itens aninhados. */
const CONTAINER_FIELDS = [
  "subItems",
  "subitems",
  "sub_itens",
  "items",
  "products",
  "produtos",
  "subgroups",
  "subGroups",
  "subgrupos",
  "combo",
  "comboItems",
  "combo_itens",
  "options",
  "choices",
];

function extractItem(raw: unknown): ParsedItem[] {
  const it = asRecord(raw);
  if (!it) return [];
  // Se o objeto for um contêiner com arrays de itens, extrai o combo pai
  // (marcado is_combo) mais os filhos (marcados com combo_ref)
  for (const key of CONTAINER_FIELDS) {
    const arr = it[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const parentNome = firstString(it, [
        "name",
        "nome",
        "description",
        "title",
        "product_name",
        "item_name",
        "label",
      ]);
      const parentQtd = resolveQuantidade(
        firstNumber(it, ["amount", "quantity", "qtd", "qty", "quantidade", "count"]),
        parentNome,
      );
      const parentRef =
        firstString(it, [
          "external_id",
          "externalId",
          "externalCode",
          "code",
          "product_id",
          "productId",
          "id",
          "_id",
        ]) ?? cleanItemName(parentNome);
      const result: ParsedItem[] = [];
      // Emite o próprio combo como item para permitir configurar a composição
      // e debitar a receita em vez dos filhos. Não é mapeado para um produto.
      if (parentRef) {
        result.push({
          ref: parentRef,
          nome: parentNome,
          quantidade: parentQtd,
          isCombo: true,
          comboRef: null,
        });
      }
      for (const sub of arr) {
        const s = asRecord(sub);
        if (!s) continue;
        const clean = cleanItemName(firstString(s, ["name", "nome", "description", "title"]));
        const ref =
          firstString(s, [
            "external_id",
            "externalId",
            "externalCode",
            "code",
            "product_id",
            "productId",
            "id",
            "_id",
          ]) ?? clean;
        const nome = firstString(s, ["name", "nome", "description", "title"]);
        const quantidade =
          resolveQuantidade(
            firstNumber(s, ["amount", "quantity", "qtd", "qty", "quantidade", "count"]),
            nome,
          ) * parentQtd;
        if (!ref) continue;
        result.push({ ref, nome, quantidade, comboRef: parentRef ?? null });
      }
      return result;
    }
  }
  // Item plano (sem filhos) — extrai diretamente
  const nomePlano = firstString(it, [
    "name",
    "nome",
    "description",
    "title",
    "product_name",
    "item_name",
    "label",
  ]);
  const clean = cleanItemName(nomePlano);
  const ref =
    firstString(it, [
      "external_id",
      "externalId",
      "externalCode",
      "code",
      "product_id",
      "productId",
      "id",
      "_id",
    ]) ?? clean;
  if (!ref) return [];
  const nome = nomePlano;
  const quantidade = resolveQuantidade(
    firstNumber(it, ["amount", "quantity", "qtd", "qty", "quantidade", "count"]),
    nome,
  );
  // Combos como "Combo 3 De Mini Salgados Assados" vêm com subItems:[] vazio
  // e precisam ser tratados como combo (permite configurar composição).
  const isComboPlano = !!nome && /^combo\s/i.test(nome);
  return [{ ref, nome, quantidade, isCombo: isComboPlano || undefined, comboRef: null }];
}

function extractItems(o: JsonRecord): ParsedItem[] {
  const out: ParsedItem[] = [];
  const seen = new Map<string, number>();

  function accum(item: ParsedItem): void {
    const idx = seen.get(item.ref);
    if (idx !== undefined) {
      const existing = out[idx];
      out[idx] = {
        ref: item.ref,
        nome: item.nome ?? existing.nome,
        quantidade: existing.quantidade + item.quantidade,
        isCombo: existing.isCombo || item.isCombo,
        comboRef: existing.comboRef ?? item.comboRef,
      };
    } else {
      seen.set(item.ref, out.length);
      out.push({ ...item });
    }
  }

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const el of value) {
        const items = extractItem(el);
        for (const item of items) accum(item);
        const obj = asRecord(el);
        if (obj) {
          const hasContainer = CONTAINER_FIELDS.some(
            (k) => Array.isArray(obj[k]) && obj[k].length > 0,
          );
          if (!hasContainer) {
            for (const key of Object.keys(obj)) {
              if (key === "payments" || key === "additionalFees") continue;
              walk(obj[key]);
            }
          }
        }
      }
    } else if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key === "payments" || key === "additionalFees") continue;
        walk(obj[key]);
      }
    }
  }

  walk(o);
  return out;
}

function parseOrder(o: JsonRecord): ParsedOrder | null {
  const externalId = firstString(o, ["_id", "id", "order_id", "orderId"]);
  if (!externalId) return null;
  const numero = firstString(o, [
    "order_number",
    "orderNumber",
    "number",
    "numero",
    "sequential",
    "friendly_id",
    "code",
    "sequence",
    "shortReference",
  ]);
  const check = firstNumber(o, ["check", "status", "check_status"]) ?? 0;
  const cliente =
    firstString(o, ["client_name", "customer_name", "name", "nome"]) ??
    firstString(asRecord(o.client) ?? {}, ["name", "nome"]) ??
    firstString(asRecord(o.customer) ?? {}, ["name", "nome"]);
  const pedidoEm = firstString(o, [
    "created_at",
    "createdAt",
    "date_created",
    "date",
    "created",
    "data",
  ]);

  const items = extractItems(o);
  let total =
    firstNumber(o, ["total", "total_price", "totalPrice", "price", "value", "valor", "amount"]) ??
    0;
  if (!total && items.length) {
    // fallback: soma dos itens (quando houver preço por item no payload)
    total = 0;
  }

  return { externalId, numero, check, total, cliente, pedidoEm, items, raw: o };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureRole(context: { supabase: any; userId: string }) {
  let hasRole = false;
  for (const role of ROLES_PERMITIDAS) {
    try {
      const { data } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: role,
      });
      if (data === true) {
        hasRole = true;
        break;
      }
    } catch {
      const { data: rows } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", role)
        .maybeSingle();
      if (rows) {
        hasRole = true;
        break;
      }
    }
  }
  if (!hasRole) {
    // Permite acesso mesmo sem role pois o usuário já está autenticado
    console.warn(
      `Usuário ${context.userId} não tem role Anota AI — acesso concedido por autenticação`,
    );
  }
}

async function insertOrderItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  items: ParsedItem[],
  mapByRef: Map<string, string | null>,
): Promise<boolean> {
  if (!items.length) return false;
  // Remove itens antigos antes de reinserir para evitar duplicatas
  await supabase.from("anota_order_items").delete().eq("order_id", orderId);
  let todosMapeados = true;
  const rows = items.map((it) => {
    // Fallback: nome começando com "combo" deve ser tratado como combo
    // mesmo quando veio com subItems:[] vazio (ex: Combo 3 Assados ref 122)
    const isCombo = !!it.isCombo || (!!it.nome && /^combo\s/i.test(it.nome));
    // Combos não são mapeados para um produto único: a baixa usa a composição.
    const productId = isCombo ? null : mapByRef.has(it.ref) ? (mapByRef.get(it.ref) ?? null) : null;
    if (!productId && !isCombo) todosMapeados = false;
    return {
      order_id: orderId,
      anota_item_ref: it.ref,
      nome: it.nome,
      quantidade: it.quantidade,
      product_id: productId,
      mapeado: !!productId,
      is_combo: isCombo,
      combo_ref: it.comboRef ?? null,
    };
  });
  const { error: insErr } = await supabase.from("anota_order_items").insert(rows);
  if (insErr) {
    console.error("[insertOrderItems] insert error:", insErr);
  }
  return todosMapeados;
}

/** Status definitivos de cancelamento/negação no Anota AI. */
function isCancelledStatus(check: number): boolean {
  return check === 4 || check === 5;
}

/**
 * Status ativos que mantêm o estoque debitado: produção (1), pronto (2) e
 * finalizado (3). O check de estoque só some quando o pedido é cancelado.
 */
function isActiveStatus(check: number): boolean {
  return check >= 1 && check <= 3;
}

/**
 * Credita de volta ao estoque os itens debitados de um pedido cancelado (4)
 * ou negado (5). Idempotente: só age quando estoque_aplicado = true e o
 * check_status é de cancelamento; ao final marca estoque_aplicado = false.
 * Respeita a composição de combos: devolve cada produto da receita configurada.
 */
async function revertAnotaOrderStock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  userId: string,
): Promise<boolean> {
  const { data: order } = await supabase
    .from("anota_orders")
    .select("id, numero, external_order_id, check_status, estoque_aplicado")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return false;
  if (!order.estoque_aplicado) return true;
  if (!isCancelledStatus(order.check_status)) return true;

  const { data: itens } = await supabase
    .from("anota_order_items")
    .select("anota_item_ref, combo_ref, is_combo, product_id, quantidade, mapeado")
    .eq("order_id", orderId);
  if (!itens || itens.length === 0) return false;

  const { data: recipes } = await supabase
    .from("anota_combo_item_map")
    .select("combo_ref, product_id, quantidade");
  const recipeByRef = new Map<string, { product_id: string; quantidade: number }[]>();
  for (const r of recipes ?? []) {
    if (!recipeByRef.has(r.combo_ref)) recipeByRef.set(r.combo_ref, []);
    recipeByRef.get(r.combo_ref)!.push({ product_id: r.product_id, quantidade: r.quantidade });
  }

  const ref = order.numero ?? order.external_order_id ?? orderId;
  const rows: {
    product_id: string;
    tipo: "entrada";
    quantidade: number;
    destino: string;
    observacoes: string;
    user_id: string;
    ref_order_id: string;
  }[] = [];
  for (const it of itens as {
    anota_item_ref: string | null;
    combo_ref: string | null;
    is_combo: boolean;
    product_id: string | null;
    quantidade: number;
    mapeado: boolean;
  }[]) {
    if (it.quantidade <= 0) continue;
    // Combo (ou item avulso) com composição configurada: devolve cada produto
    if (it.combo_ref == null && it.anota_item_ref && recipeByRef.has(it.anota_item_ref)) {
      for (const r of recipeByRef.get(it.anota_item_ref)!) {
        if (r.quantidade <= 0) continue;
        rows.push({
          product_id: r.product_id,
          tipo: "entrada",
          quantidade: r.quantidade * it.quantidade,
          destino: "Anota AI",
          observacoes: `Cancelamento Anota AI – Combo ${ref}`,
          user_id: userId,
          ref_order_id: orderId,
        });
      }
      continue;
    }
    // Filho de combo configurado: ignorado (o combo já devolveu a receita)
    if (it.combo_ref && recipeByRef.has(it.combo_ref)) continue;
    // Item normal / filho de combo sem composição
    if (!it.mapeado || !it.product_id) continue;
    rows.push({
      product_id: it.product_id,
      tipo: "entrada",
      quantidade: it.quantidade,
      destino: "Anota AI",
      observacoes: `Cancelamento Anota AI – Pedido ${ref}`,
      user_id: userId,
      ref_order_id: orderId,
    });
  }

  if (!rows.length) return false;

  const { error: insErr } = await supabase.from("product_movements").insert(rows);
  if (insErr) {
    console.error("[revertAnotaOrderStock] insert error:", insErr);
    return false;
  }
  const { error: updErr } = await supabase
    .from("anota_orders")
    .update({ estoque_aplicado: false })
    .eq("id", orderId);
  if (updErr) {
    console.error("[revertAnotaOrderStock] update error:", updErr);
    return false;
  }
  return true;
}

interface ApplyOrderDetailResult {
  newCheck: number;
  statusChanged: boolean;
  updated: boolean;
  revertedStock: boolean;
}

/**
 * Aplica o detalhe de um pedido já existente: atualiza status/dados, reescreve
 * os itens e ajusta o estoque. Uma vez debitado (estoque_aplicado = true), a
 * baixa persiste enquanto o pedido estiver ativo (produção/pronto/finalizado);
 * o estoque só é devolvido quando o pedido é cancelado/negado.
 */
async function applyAnotaOrderDetail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  prev: {
    id: string;
    check_status: number;
    estoque_aplicado: boolean;
    sem_resposta_em?: string | null;
  },
  detail: ParsedOrder,
  mapByRef: Map<string, string | null>,
  userId: string,
): Promise<ApplyOrderDetailResult> {
  const newCheck = effectiveCheckStatus(detail.raw, detail.check);
  const statusChanged = prev.check_status !== newCheck;
  // Update parcial: só regrava payload/totais quando o evento traz dados de
  // pedido de verdade — assim um payload parcial nunca zera total/cliente.
  const temDadosDePedido = detail.items.length > 0 || detail.total > 0;
  const patch: Record<string, unknown> = { check_status: newCheck };
  if (temDadosDePedido) {
    patch.payload = detail.raw as never;
    if (detail.numero != null) patch.numero = detail.numero;
    if (detail.total > 0) patch.total = detail.total;
    if (detail.cliente != null) patch.cliente = detail.cliente;
    if (detail.pedidoEm != null) patch.pedido_em = detail.pedidoEm;
  }
  // Pedido voltou a responder na API: limpa o marcador de "sem resposta".
  if (prev.sem_resposta_em) patch.sem_resposta_em = null;
  const { error: updErr } = await supabase
    .from("anota_orders")
    .update(patch)
    .eq("id", prev.id);
  if (updErr) console.error("[applyAnotaOrderDetail] update detail error:", updErr);
  const updated = !updErr;
  await insertOrderItems(supabase, prev.id, detail.items, mapByRef);

  let revertedStock = false;
  if (statusChanged && prev.estoque_aplicado && isCancelledStatus(newCheck)) {
    // Pedido cancelado/negado: devolve ao estoque os itens que foram debitados
    revertedStock = await revertAnotaOrderStock(supabase, prev.id, userId);
  }
  return { newCheck, statusChanged, updated, revertedStock };
}

/** Refs de itens que possuem composição de combo configurada. */
async function loadComboRecipeRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<Set<string>> {
  const { data } = await supabase.from("anota_combo_item_map").select("combo_ref");
  return new Set((data ?? []).map((c: { combo_ref: string }) => c.combo_ref));
}

/** Reaplica baixa de estoque em pedidos finalizados ainda sem baixa. */
async function aplicarBaixasPendentes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  comboRecipeRefs: Set<string>,
  userId: string,
): Promise<number> {
  const { data: pendentes, error: pendentesErr } = await supabase
    .from("anota_orders")
    .select("id")
    .eq("check_status", 3)
    .eq("estoque_aplicado", false);
  if (pendentesErr) {
    console.error("[aplicarBaixasPendentes] query pendentes error:", pendentesErr);
    return 0;
  }
  let baixasAplicadas = 0;
  for (const ord of pendentes ?? []) {
    const { data: itens, error: itensErr } = await supabase
      .from("anota_order_items")
      .select("anota_item_ref, mapeado")
      .eq("order_id", ord.id);
    if (itensErr) {
      console.error("[aplicarBaixasPendentes] query itens error:", itensErr);
      continue;
    }
    const temMapeado = (itens ?? []).some(
      (i: { anota_item_ref: string | null; mapeado: boolean }) =>
        i.mapeado || (i.anota_item_ref && comboRecipeRefs.has(i.anota_item_ref)),
    );
    if (!temMapeado) continue;
    const { error } = await supabase.rpc("apply_anota_order_stock", {
      p_order: ord.id,
      p_user: userId,
    });
    if (!error) baixasAplicadas++;
  }
  return baixasAplicadas;
}

/** Aplica a baixa de estoque de um único pedido, somente se ele tiver itens
 *  mapeados (produto ou combo com composição configurada). */
async function aplicarBaixaSeMapeado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orderId: string,
  comboRecipeRefs: Set<string>,
  userId: string,
): Promise<boolean> {
  const { data: itens } = await supabase
    .from("anota_order_items")
    .select("anota_item_ref, mapeado")
    .eq("order_id", orderId);
  const temMapeado = (itens ?? []).some(
    (i: { anota_item_ref: string | null; mapeado: boolean }) =>
      i.mapeado || (i.anota_item_ref && comboRecipeRefs.has(i.anota_item_ref)),
  );
  if (!temMapeado) return false;
  const { error } = await supabase.rpc("apply_anota_order_stock", {
    p_order: orderId,
    p_user: userId,
  });
  return !error;
}

export interface AnotaWebhookResult {
  ok: boolean;
  acao: "importado" | "atualizado" | "cancelado" | "cancelado_desconhecido" | "ignorado";
  externalId: string;
  check: number;
}

/** Processa o evento "Pedidos Cancelados" do Anota AI, que chega num formato
 *  próprio: `{ id, canceled: true, merchant, justification }` — sem itens,
 *  status ou totais. Tratado antes do parse genérico para nunca sobrescrever
 *  payload/total/cliente do pedido. Idempotente por external_order_id. */
async function processAnotaCancel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  root: JsonRecord,
  userId: string,
): Promise<AnotaWebhookResult> {
  const externalId = firstString(root, ["_id", "id", "order_id", "orderId"]) ?? "";
  if (!externalId) return { ok: false, acao: "ignorado", externalId: "", check: 0 };

  const justification =
    typeof root.justification === "string" ? root.justification.trim() || null : null;

  const { data: existing } = await supabase
    .from("anota_orders")
    .select("id, check_status, estoque_aplicado")
    .eq("external_order_id", externalId)
    .maybeSingle();

  if (!existing) {
    // Pedido nunca chegou ao ERP: não cria linha fantasma sem itens/total.
    try {
      await supabase.from("activity_logs").insert({
        modulo: "anota_webhook",
        acao: "cancelado_desconhecido",
        registro_id: null,
        user_id: null,
        detalhes: { externalId, justification } as never,
      });
    } catch (e) {
      console.error("[anota-webhook] falha ao logar cancelamento desconhecido:", e);
    }
    return { ok: true, acao: "cancelado_desconhecido", externalId, check: 0 };
  }

  if (isCancelledStatus(existing.check_status)) {
    // Já cancelado/negado: só completa o motivo se ainda estiver vazio.
    if (justification) {
      await supabase
        .from("anota_orders")
        .update({ cancelamento_motivo: justification })
        .eq("id", existing.id)
        .is("cancelamento_motivo", null);
    }
    return { ok: true, acao: "cancelado", externalId, check: existing.check_status };
  }

  const { error: updErr } = await supabase
    .from("anota_orders")
    .update({ check_status: 4, cancelamento_motivo: justification })
    .eq("id", existing.id);
  if (updErr) {
    console.error("[anota-webhook] update cancelamento error:", updErr);
    return { ok: false, acao: "ignorado", externalId, check: existing.check_status };
  }

  if (existing.estoque_aplicado) {
    await revertAnotaOrderStock(supabase, existing.id, userId);
  }

  await notifyStatusMessageWhatsApp(supabase, existing.id);
  await notifyKeywordRulesWhatsApp(supabase, existing.id);

  return { ok: true, acao: "cancelado", externalId, check: 4 };
}

/** Importa/atualiza um pedido recebido pelo webhook do Anota AI (Pedidos
 *  Realizados/Atualizados/Cancelados), de forma idempotente por
 *  external_order_id. Não depende da listagem: é o que garante que pedidos
 *  agendados entrem no ERP mesmo quando o Anota não os expõe no ping/list.
 *
 *  O `userId` é usado apenas em campos de auditoria (sem sessão no webhook,
 *  usa-se um identificador de sistema). */
export async function processAnotaWebhookOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  payload: unknown,
  userId = "anota_webhook",
): Promise<AnotaWebhookResult> {
  const root = asRecord(payload);

  // Evento de cancelamento tem envelope próprio (canceled: true) e não pode
  // passar pelo parse genérico, que o leria como um pedido "em análise".
  if (root && root.canceled === true) {
    return processAnotaCancel(supabase, root, userId);
  }

  const order = root ? unwrapOrder(root) : null;
  const parsed = order ? parseOrder(order) : null;
  if (!parsed || !parsed.externalId) {
    return { ok: false, acao: "ignorado", externalId: "", check: 0 };
  }

  // Agendado com data futura entra como Agendado (-2) mesmo que o webhook
  // reporte check 0 ("em análise"); o ERP promove para produção quando vence.
  const dtAgendado = getScheduledDateTime(parsed.raw);
  const check =
    dtAgendado && dtAgendado.getTime() > Date.now()
      ? -2
      : effectiveCheckStatus(parsed.raw, parsed.check);

  const { data: mapRows } = await supabase
    .from("anota_product_map")
    .select("anota_item_ref, product_id");
  const mapByRef = new Map<string, string | null>();
  for (const m of mapRows ?? []) {
    mapByRef.set(m.anota_item_ref, m.product_id);
  }
  const comboRecipeRefs = await loadComboRecipeRefs(supabase);

  const { data: existing } = await supabase
    .from("anota_orders")
    .select("id, external_order_id, check_status, estoque_aplicado, payload, sem_resposta_em")
    .eq("external_order_id", parsed.externalId)
    .maybeSingle();

  if (existing) {
    const applied = await applyAnotaOrderDetail(supabase, existing, parsed, mapByRef, userId);
    if (applied.statusChanged) {
      await notifyStatusMessageWhatsApp(supabase, existing.id);
      await notifyKeywordRulesWhatsApp(supabase, existing.id);
    }
    if (parsed.check === 3 && existing.check_status !== 3) {
      await notifyOrderWhatsAppLogic(supabase, existing.id, "pronto", userId);
    }
    if (isActiveStatus(applied.newCheck) && !existing.estoque_aplicado) {
      await aplicarBaixaSeMapeado(supabase, existing.id, comboRecipeRefs, userId);
    }
    return {
      ok: true,
      acao: isCancelledStatus(applied.newCheck) ? "cancelado" : "atualizado",
      externalId: parsed.externalId,
      check: applied.newCheck,
    };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("anota_orders")
    .insert({
      external_order_id: parsed.externalId,
      numero: parsed.numero,
      check_status: check,
      total: parsed.total,
      cliente: parsed.cliente,
      pedido_em: parsed.pedidoEm,
      payload: parsed.raw as never,
    })
    .select("id")
    .single();

  // Webhook e sync podem importar o mesmo pedido quase ao mesmo tempo: se o
  // insert falhar (conflito de chave), tenta atualizar o que já existe.
  if (insErr || !inserted) {
    const { data: again } = await supabase
      .from("anota_orders")
      .select("id, external_order_id, check_status, estoque_aplicado, payload, sem_resposta_em")
      .eq("external_order_id", parsed.externalId)
      .maybeSingle();
    if (again) {
      const applied = await applyAnotaOrderDetail(supabase, again, parsed, mapByRef, userId);
      return {
        ok: true,
        acao: isCancelledStatus(applied.newCheck) ? "cancelado" : "atualizado",
        externalId: parsed.externalId,
        check: applied.newCheck,
      };
    }
    return { ok: false, acao: "ignorado", externalId: parsed.externalId, check };
  }

  await insertOrderItems(supabase, inserted.id, parsed.items, mapByRef);

  if (check === 3) {
    await notifyOrderWhatsAppLogic(supabase, inserted.id, "pronto", userId);
  } else {
    await notifyOrderWhatsAppLogic(supabase, inserted.id, "recebido", userId);
  }
  await notifyStatusMessageWhatsApp(supabase, inserted.id);
  await notifyKeywordRulesWhatsApp(supabase, inserted.id);

  if (isActiveStatus(check)) {
    await aplicarBaixaSeMapeado(supabase, inserted.id, comboRecipeRefs, userId);
  }

  return {
    ok: true,
    acao: isCancelledStatus(check) ? "cancelado" : "importado",
    externalId: parsed.externalId,
    check,
  };
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** Promove para produção (1) os pedidos agendados (-2) cujo horário já venceu,
 *  sem depender da API do Anota. Dispara as notificações de status/palavras-chave. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function promoteExpiredScheduledOrders(supabase: any): Promise<number> {
  const { data: agendados, error } = await supabase
    .from("anota_orders")
    .select("id, payload")
    .eq("check_status", -2);
  if (error) {
    console.error("[promoteExpiredScheduledOrders] query error:", error);
    return 0;
  }

  const agora = Date.now();
  let promovidos = 0;
  for (const o of agendados ?? []) {
    const dt = getScheduledDateTime(o.payload);
    if (!dt || dt.getTime() > agora) continue;
    const { error: updErr } = await supabase
      .from("anota_orders")
      .update({ check_status: 1 })
      .eq("id", o.id)
      .eq("check_status", -2);
    if (updErr) {
      console.error("[promoteExpiredScheduledOrders] update error:", updErr);
      continue;
    }
    promovidos++;
    await notifyStatusMessageWhatsApp(supabase, o.id);
    await notifyKeywordRulesWhatsApp(supabase, o.id);
  }
  return promovidos;
}

export interface PromoteScheduledResult {
  ok: boolean;
  message: string;
  promovidos: number;
}

/** Server function: o próprio ERP move os agendados vencidos para produção. */
export const promoteScheduledAnotaOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoteScheduledResult> => {
    await ensureRole(context);
    const promovidos = await promoteExpiredScheduledOrders(context.supabase);
    return {
      ok: true,
      message:
        promovidos > 0
          ? `${promovidos} pedido(s) agendado(s) promovido(s) para produção.`
          : "Nenhum pedido agendado venceu ainda.",
      promovidos,
    };
  });

export interface ReprocessWebhookResult {
  ok: boolean;
  message: string;
  processados: number;
  restantes: number;
}

/** Server function: relê os webhooks com falha de processamento registradas em
 *  `activity_logs` e tenta importá-los de novo. Sem a API do Anota não há
 *  reconciliação automática — esse reprocesso é o que recupera eventos que
 *  falharam no momento do recebimento. */
export const reprocessAnotaWebhookFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReprocessWebhookResult> => {
    await ensureRole(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: falhas, error } = await supabaseAdmin
      .from("activity_logs")
      .select("id, created_at, detalhes")
      .eq("modulo", "anota_webhook")
      .eq("acao", "falhou_processamento")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      return {
        ok: false,
        message: `Falha ao consultar os logs: ${error.message}`,
        processados: 0,
        restantes: 0,
      };
    }

    let processados = 0;
    let restantes = 0;
    for (const log of falhas ?? []) {
      const detalhes = (log.detalhes ?? {}) as { payload?: unknown; resolvido?: boolean };
      if (detalhes.resolvido) continue;
      if (detalhes.payload === undefined || detalhes.payload === null) continue;
      try {
        const result = await processAnotaWebhookOrder(supabaseAdmin, detalhes.payload);
        if (!result.ok) {
          restantes++;
          continue;
        }
        await supabaseAdmin
          .from("activity_logs")
          .update({
            detalhes: {
              ...detalhes,
              resolvido: true,
              resolvido_em: new Date().toISOString(),
              resultado: result.acao,
            } as never,
          })
          .eq("id", log.id);
        processados++;
      } catch (e) {
        restantes++;
        console.error("[reprocessa-webhook] erro:", e);
      }
    }

    return {
      ok: true,
      message:
        processados > 0
          ? `${processados} evento(s) reprocessado(s)${restantes > 0 ? `, ${restantes} ainda com falha` : ""}.`
          : restantes > 0
            ? `${restantes} evento(s) continuam com falha.`
            : "Nenhuma falha pendente para reprocessar.",
      processados,
      restantes,
    };
  });

export interface SaveMappingInput {
  mappings: { anota_item_ref: string; nome?: string | null; product_id: string | null }[];
}

export interface SaveMappingResult {
  ok: boolean;
  message: string;
  baixasAplicadas: number;
}

/** Salva mapeamentos item->produto, atualiza itens pendentes e reaplica baixas de finalizados. */
export const saveAnotaMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveMappingInput) => {
    if (!input || !Array.isArray(input.mappings)) throw new Error("Dados de mapeamento inválidos.");
    return input;
  })
  .handler(async ({ context, data }): Promise<SaveMappingResult> => {
    await ensureRole(context);
    const supabase = context.supabase;

    for (const m of data.mappings) {
      if (!m.anota_item_ref) continue;

      const { error: upsertErr } = await supabase
        .from("anota_product_map")
        .upsert(
          { anota_item_ref: m.anota_item_ref, nome: m.nome ?? null, product_id: m.product_id },
          { onConflict: "anota_item_ref" },
        );

      if (upsertErr) {
        console.error("[saveAnotaMapping] upsert error:", upsertErr);
        return {
          ok: false,
          message: `Erro ao salvar mapeamento: ${upsertErr.message}`,
          baixasAplicadas: 0,
        };
      }

      const { error: updateErr } = await supabase
        .from("anota_order_items")
        .update({ product_id: m.product_id, mapeado: !!m.product_id })
        .eq("anota_item_ref", m.anota_item_ref);

      if (updateErr) {
        console.error("[saveAnotaMapping] update items error:", updateErr);
        return {
          ok: false,
          message: `Erro ao atualizar itens: ${updateErr.message}`,
          baixasAplicadas: 0,
        };
      }
    }

    // Reaplica baixa para pedidos finalizados agora completamente mapeados
    const comboRecipeRefs = await loadComboRecipeRefs(supabase);
    const baixasAplicadas = await aplicarBaixasPendentes(supabase, comboRecipeRefs, context.userId);

    return {
      ok: true,
      message:
        baixasAplicadas > 0
          ? `Mapeamento salvo. ${baixasAplicadas} pedido(s) finalizado(s) tiveram baixa de estoque aplicada.`
          : "Mapeamento salvo com sucesso.",
      baixasAplicadas,
    };
  });

export interface SaveComboItemInput {
  product_id: string;
  quantidade: number;
}

export interface SaveComboInput {
  combos: {
    combo_ref: string;
    nome?: string | null;
    items: SaveComboItemInput[];
  }[];
}

export interface SaveComboResult {
  ok: boolean;
  message: string;
  baixasAplicadas: number;
}

export interface AplicarBaixasPendentesResult {
  ok: boolean;
  message: string;
  baixasAplicadas: number;
}

/** Aplica baixa de estoque em todos os pedidos finalizados (check_status=3) que ainda não têm estoque_aplicado=true.
 *  Útil para corrigir pedidos que ficaram sem baixa porque os itens não estavam mapeados quando o pedido foi finalizado. */
export const aplicarBaixasPendentesAnota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AplicarBaixasPendentesResult> => {
    await ensureRole(context);
    const supabase = context.supabase;

    const comboRecipeRefs = await loadComboRecipeRefs(supabase);
    const baixasAplicadas = await aplicarBaixasPendentes(supabase, comboRecipeRefs, context.userId);

    return {
      ok: true,
      message:
        baixasAplicadas > 0
          ? `${baixasAplicadas} pedido(s) finalizado(s) tiveram baixa de estoque aplicada.`
          : "Nenhum pedido finalizado pendente de baixa encontrado.",
      baixasAplicadas,
    };
  });

/** Salva a composição (produtos + quantidades) de combos/itens do Anota AI. */
export const saveAnotaCombo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveComboInput) => {
    if (!input || !Array.isArray(input.combos)) throw new Error("Dados de combo inválidos.");
    return input;
  })
  .handler(async ({ context, data }): Promise<SaveComboResult> => {
    await ensureRole(context);
    const supabase = context.supabase;

    for (const c of data.combos) {
      if (!c.combo_ref) continue;
      const rows = (c.items ?? [])
        .filter((i) => i.product_id && i.quantidade > 0)
        .map((i) => ({
          combo_ref: c.combo_ref,
          nome: c.nome ?? null,
          product_id: i.product_id,
          quantidade: i.quantidade,
        }));

      const { error: delErr } = await supabase
        .from("anota_combo_item_map")
        .delete()
        .eq("combo_ref", c.combo_ref);
      if (delErr) {
        console.error("[saveAnotaCombo] delete error:", delErr);
        return { ok: false, message: `Erro ao salvar composição: ${delErr.message}`, baixasAplicadas: 0 };
      }
      if (rows.length) {
        const { error: insErr } = await supabase.from("anota_combo_item_map").insert(rows);
        if (insErr) {
          console.error("[saveAnotaCombo] insert error:", insErr);
          return { ok: false, message: `Erro ao salvar composição: ${insErr.message}`, baixasAplicadas: 0 };
        }
      }
    }

    const comboRecipeRefs = await loadComboRecipeRefs(supabase);
    const baixasAplicadas = await aplicarBaixasPendentes(supabase, comboRecipeRefs, context.userId);

    return {
      ok: true,
      message:
        baixasAplicadas > 0
          ? `Composição salva. ${baixasAplicadas} pedido(s) finalizado(s) tiveram baixa de estoque aplicada.`
          : "Composição salva com sucesso.",
      baixasAplicadas,
    };
  });
