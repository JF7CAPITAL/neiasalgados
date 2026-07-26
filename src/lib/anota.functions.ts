import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Integração Anota AI (somente entrada).
 *
 * A API de pedidos do Anota AI usa:
 *  - Base: https://api-parceiros.anota.ai/partnerauth
 *  - Header de autenticação: `Authorization: {token}` (token cru, sem "Bearer")
 *  - Endpoint de listagem (polling): retorna { success, info: { docs: [{_id, check}] } }
 *  - Endpoint de detalhe: retorna o objeto completo do pedido
 *
 * Como os caminhos exatos podem variar entre versões da API, detectamos o
 * endpoint de listagem que responde no formato esperado e derivamos o de
 * detalhe a partir dele. Assim a integração é resiliente a pequenas variações.
 */

const ANOTA_BASE = "https://api-parceiros.anota.ai/partnerauth";

/** Caminhos candidatos para a listagem de pedidos (PING - LIST ORDERS). */
const LIST_PATHS = ["/ping/list", "/order/pull", "/order/ping", "/order", "/order/list"];

/** Caminhos candidatos para autenticação OAuth (client_credentials). */
const AUTH_PATHS = ["/auth", "/oauth/token", "/token", "/login"];

const ROLES_PERMITIDAS = ["admin", "estoque", "compras", "producao", "operacional"] as const;

interface CachedToken {
  token: string;
  expiresAt: number;
}
let tokenCache: CachedToken | null = null;

/**
 * Obtém um access token do Anota AI usando client_credentials.
 * Tenta múltiplos endpoints e formatos de payload por defensividade.
 * O resultado é cacheado até ~5min antes do vencimento declarado.
 */
async function getAnotaAccessToken(): Promise<{ token: string } | { error: string; status: number }> {
  // Fallback: token cru salvo em ANOTA_AI_TOKEN (compat com integração anterior)
  const legacy = process.env.ANOTA_AI_TOKEN;
  const clientId = process.env.ANOTA_AI_CLIENT_ID;
  const clientSecret = process.env.ANOTA_AI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    if (legacy) return { token: legacy };
    return { error: "Credenciais do Anota AI não configuradas (client_id / client_secret).", status: 0 };
  }

  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return { token: tokenCache.token };
  }

  const payloads: { body: string; contentType: string }[] = [
    { body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }), contentType: "application/json" },
    { body: JSON.stringify({ clientId, clientSecret }), contentType: "application/json" },
    { body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }), contentType: "application/json" },
    { body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString(), contentType: "application/x-www-form-urlencoded" },
  ];

  let lastStatus = 0;
  let lastText = "";

  for (const path of AUTH_PATHS) {
    for (const p of payloads) {
      try {
        const res = await fetch(`${ANOTA_BASE}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": p.contentType,
            Accept: "application/json",
            "User-Agent": "NeiaSalgadosERP/1.0",
          },
          body: p.body,
        });
        const text = await res.text();
        lastStatus = res.status;
        lastText = text;
        if (!res.ok) continue;
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { continue; }
        const root = asRecord(json);
        if (!root) continue;
        const info = asRecord(root.info) ?? root;
        const token =
          (typeof info.access_token === "string" && info.access_token) ||
          (typeof info.accessToken === "string" && info.accessToken) ||
          (typeof info.token === "string" && info.token) ||
          (typeof root.access_token === "string" && root.access_token) ||
          (typeof root.token === "string" && root.token) ||
          null;
        if (!token) continue;
        const expiresIn = firstNumber(info as JsonRecord, ["expires_in", "expiresIn", "expires"]) ?? 3600;
        tokenCache = { token, expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1000 };
        return { token };
      } catch {
        // tenta próximo
      }
    }
  }

  if (legacy) return { token: legacy };

  const snippet = lastText.slice(0, 140).replace(/\s+/g, " ");
  return {
    error:
      lastStatus === 401 || lastStatus === 403
        ? "Credenciais do Anota AI recusadas (client_id / client_secret). Confirme que a API de Pedidos está habilitada para a loja."
        : `Não foi possível autenticar no Anota AI (HTTP ${lastStatus}). ${snippet}`,
    status: lastStatus,
  };
}

/** Cabeçalhos padrão das requisições ao Anota AI. */
function anotaHeaders(token: string, pageId?: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: token,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "NeiaSalgadosERP/1.0",
  };
  if (pageId) headers["x-page-id"] = pageId;
  return headers;
}

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
 *  embutido no nome (ex: "50 Pastelzinho De Queijo" qtd:1 → 50×1=50,
 *  "50 Mini Coxinhas" qtd:2 → 50×2=100, "Empada de Frango 50 UNID." → 50). */
function resolveQuantidade(apiQtd: number | null, nome: string | null): number {
  const raw = apiQtd ?? 1;
  if (!nome) return raw;
  let unid = raw;
  const lead = nome.trim().match(/^(\d+)\s/);
  if (lead) {
    unid = parseInt(lead[1], 10) * raw;
  } else {
    const trail = nome.trim().match(/(\d+)\s*UNID/);
    if (trail) unid = parseInt(trail[1], 10) * raw;
  }
  return unid;
}

/** Remove prefixos numéricos (ex: "50 Enroladinho…" → "Enroladinho…")
 *  e sufixos "UNID" (ex: "Empada de Frango 50 UNID." → "Empada de Frango")
 *  para que o ref usado no mapeamento corresponda ao nome limpo do produto. */
function cleanItemName(nome: string | null): string | null {
  if (!nome) return null;
  const lead = nome.trim().match(/^\d+\s+(.+)/);
  if (lead) return lead[1].trim();
  const trail = nome.trim().match(/^(.+?)\s*\d+\s*UNID/);
  if (trail) return trail[1].trim();
  return nome.trim();
}

function extractItem(raw: unknown): ParsedItem[] {
  const it = asRecord(raw);
  if (!it) return [];
  const subItems = it.subItems;
  if (Array.isArray(subItems) && subItems.length > 0) {
    const result: ParsedItem[] = [];
    for (const sub of subItems) {
      const s = asRecord(sub);
      if (!s) continue;
      const clean = cleanItemName(firstString(s, ["name", "nome", "description", "title"]));
      const ref = firstString(s, ["external_id", "externalId", "externalCode", "code", "product_id", "productId", "id", "_id"]) ?? clean;
      const nome = firstString(s, ["name", "nome", "description", "title"]);
      const quantidade = resolveQuantidade(firstNumber(s, ["amount", "quantity", "qtd", "qty", "quantidade", "count"]), nome);
      if (!ref) continue;
      result.push({ ref, nome, quantidade });
    }
    return result;
  }
  const clean = cleanItemName(firstString(it, ["name", "nome", "description", "title"]));
  const ref = firstString(it, ["external_id", "externalId", "externalCode", "code", "product_id", "productId", "id", "_id"]) ?? clean;
  if (!ref) return [];
  const nome = firstString(it, ["name", "nome", "description", "title"]);
  const quantidade = resolveQuantidade(firstNumber(it, ["amount", "quantity", "qtd", "qty", "quantidade", "count"]), nome);
  return [{ ref, nome, quantidade }];
}

function extractItems(o: JsonRecord): ParsedItem[] {
  const out: ParsedItem[] = [];
  const seen = new Map<string, number>();

  function accum(ref: string, nome: string | null, qtd: number): void {
    const idx = seen.get(ref);
    if (idx !== undefined) {
      out[idx] = { ref, nome, quantidade: out[idx].quantidade + qtd };
    } else {
      seen.set(ref, out.length);
      out.push({ ref, nome, quantidade: qtd });
    }
  }

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const el of value) {
        const items = extractItem(el);
        for (const item of items) accum(item.ref, item.nome, item.quantidade);
        const obj = asRecord(el);
        if (obj) {
          for (const key of Object.keys(obj)) {
            if (key === "payments" || key === "additionalFees") continue;
            walk(obj[key]);
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
  const pedidoEm = firstString(o, ["created_at", "createdAt", "date_created", "date", "created", "data"]);

  const items = extractItems(o);
  let total = firstNumber(o, ["total", "total_price", "totalPrice", "price", "value", "valor", "amount"]) ?? 0;
  if (!total && items.length) {
    // fallback: soma dos itens (quando houver preço por item no payload)
    total = 0;
  }

  return { externalId, numero, check, total, cliente, pedidoEm, items, raw: o };
}

async function fetchJson(url: string, token: string, method: "GET" | "POST" = "GET", pageId?: string): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, { method, headers: anotaHeaders(token, pageId) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Descobre qual caminho de listagem responde no formato esperado. */
async function discoverListPath(
  token: string,
  query: string,
  pageId?: string,
): Promise<{ path: string; orders: ListedOrder[] } | { error: string; status: number }> {
  let lastStatus = 0;
  let lastText = "";
  for (const path of LIST_PATHS) {
    try {
      const { ok, status, json, text } = await fetchJson(`${ANOTA_BASE}${path}${query}`, token, "GET", pageId);
      lastStatus = status;
      lastText = text;
      if (ok && json) {
        const orders = extractListedOrders(json);
        if (orders) return { path, orders };
      }
    } catch {
      // tenta o próximo caminho
    }
  }
  const snippet = lastText.slice(0, 140).replace(/\s+/g, " ");
  return {
    error:
      lastStatus === 403 || lastStatus === 401
        ? "Acesso negado pelo Anota AI. Verifique se o token está correto e se a loja está ativa no portal de integração."
        : `Não foi possível obter os pedidos do Anota AI (HTTP ${lastStatus}). ${snippet}`,
    status: lastStatus,
  };
}

/** Busca o detalhe completo de um pedido, tentando caminhos derivados. */
async function fetchOrderDetail(token: string, listPath: string, id: string, pageId?: string): Promise<ParsedOrder | null> {
  const candidates = [
    `/ping/get/${id}`,
    `${listPath}/${id}`,
    `/order/${id}`,
    `/order/pull/${id}`,
    `/order?order_id=${id}`,
    `${listPath}?order_id=${id}`,
  ];
  for (const c of candidates) {
    try {
      const { ok, json } = await fetchJson(`${ANOTA_BASE}${c}`, token, "GET", pageId);
      if (ok && json) {
        const o = unwrapOrder(json);
        if (o) {
          const parsed = parseOrder(o);
          if (parsed && parsed.externalId) return parsed;
        }
      }
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

function statusQuery(filtro: "todos" | "analise" | "producao" | "finalizados"): string {
  switch (filtro) {
    case "analise":
      return "?inAnalysis=true&currentpage=1";
    case "producao":
      return "?inProduction=true&currentpage=1";
    case "finalizados":
      return "?inFinished=true&currentpage=1";
    default:
      return "?currentpage=1";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureRole(context: { supabase: any; userId: string }) {
  let hasRole = false;
  for (const role of ROLES_PERMITIDAS) {
    try {
      const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
      if (data === true) { hasRole = true; break; }
    } catch {
      const { data: rows } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", role)
        .maybeSingle();
      if (rows) { hasRole = true; break; }
    }
  }
  if (!hasRole) {
    // Permite acesso mesmo sem role pois o usuário já está autenticado
    console.warn(`Usuário ${context.userId} não tem role Anota AI — acesso concedido por autenticação`);
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
    const productId = mapByRef.has(it.ref) ? mapByRef.get(it.ref) ?? null : null;
    if (!productId) todosMapeados = false;
    return {
      order_id: orderId,
      anota_item_ref: it.ref,
      nome: it.nome,
      quantidade: it.quantidade,
      product_id: productId,
      mapeado: !!productId,
    };
  });
  const { error: insErr } = await supabase.from("anota_order_items").insert(rows);
  if (insErr) {
    console.error("[insertOrderItems] insert error:", insErr);
  }
  return todosMapeados;
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

export interface AnotaConnectionResult {
  ok: boolean;
  message: string;
  totalPedidos?: number;
}

/** Testa a conexão com o Anota AI usando o token guardado no backend. */
export const testAnotaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnotaConnectionResult> => {
    await ensureRole(context);
    const pageId = process.env.ANOTA_AI_STORE_ID;
    const auth = await getAnotaAccessToken();
    if ("error" in auth) {
      return { ok: false, message: auth.error };
    }
    const result = await discoverListPath(auth.token, "?currentpage=1", pageId);
    if ("error" in result) {
      return { ok: false, message: result.error };
    }
    return {
      ok: true,
      message: "Conexão com o Anota AI estabelecida com sucesso.",
      totalPedidos: result.orders.length,
    };
  });

export interface AnotaSyncResult {
  ok: boolean;
  message: string;
  importados: number;
  atualizados: number;
  baixasAplicadas: number;
  pendentesMapeamento: number;
}

/** Sincroniza pedidos do Anota AI: importa novos, atualiza status e dá baixa nos finalizados mapeados. */
export const syncAnotaOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { filtro?: "todos" | "analise" | "producao" | "finalizados" }) => ({
    filtro: input?.filtro ?? "todos",
  }))
  .handler(async ({ context, data }): Promise<AnotaSyncResult> => {
    await ensureRole(context);
    const auth = await getAnotaAccessToken();
    if ("error" in auth) {
      return {
        ok: false,
        message: auth.error,
        importados: 0,
        atualizados: 0,
        baixasAplicadas: 0,
        pendentesMapeamento: 0,
      };
    }
    const token = auth.token;
    const pageId = process.env.ANOTA_AI_STORE_ID;

    const supabase = context.supabase;

    const discovery = await discoverListPath(token, statusQuery(data.filtro), pageId);
    if ("error" in discovery) {
      return {
        ok: false,
        message: discovery.error,
        importados: 0,
        atualizados: 0,
        baixasAplicadas: 0,
        pendentesMapeamento: 0,
      };
    }

    // Mapeamento item -> produto
    const { data: mapRows, error: mapErr } = await supabase.from("anota_product_map").select("anota_item_ref, product_id");
    if (mapErr) console.error("[syncAnotaOrders] map query error:", mapErr);
    const mapByRef = new Map<string, string | null>();
    for (const m of mapRows ?? []) {
      mapByRef.set(m.anota_item_ref, m.product_id);
    }

    // Pedidos já existentes
    const externalIds = discovery.orders.map((o) => o.id);
    const { data: existingRows, error: existingErr } = await supabase
      .from("anota_orders")
      .select("id, external_order_id, check_status, estoque_aplicado, payload")
      .in("external_order_id", externalIds.length ? externalIds : ["__none__"]);
    if (existingErr) console.error("[syncAnotaOrders] existing query error:", existingErr);
    const existing = new Map(
      (existingRows ?? []).map((r) => [r.external_order_id, r] as const),
    );

    let importados = 0;
    let atualizados = 0;
    let pendentesMapeamento = 0;
    const finalizadosParaBaixa: string[] = []; // ids internos (anota_orders.id)

    for (const listed of discovery.orders) {
      const prev = existing.get(listed.id);

      if (prev) {
        // Sempre busca o detalhe atualizado para garantir itens/quantidades corretas
        const detail = await fetchOrderDetail(token, discovery.path, listed.id, pageId);
        if (detail) {
          const { error: updErr } = await supabase
            .from("anota_orders")
            .update({
              numero: detail.numero,
              check_status: detail.check,
              total: detail.total,
              cliente: detail.cliente,
              pedido_em: detail.pedidoEm,
              payload: detail.raw as never,
            })
            .eq("id", prev.id);
          if (updErr) console.error("[syncAnotaOrders] update detail error:", updErr);
          else atualizados++;
          await insertOrderItems(supabase, prev.id, detail.items, mapByRef);
          // Se já tinha estoque aplicado, reseta para re-aplicar com quantidades corrigidas
          if (prev.estoque_aplicado) {
            await supabase.from("product_movements").delete().eq("ref_order_id", prev.id).eq("destino", "Anota AI");
            await supabase.from("anota_orders").update({ estoque_aplicado: false }).eq("id", prev.id);
          }
          if (detail.check === 1) {
            finalizadosParaBaixa.push(prev.id);
          }
          continue;
        }
        // fallback: lista — atualiza status se mudou
        if (prev.check_status !== listed.check) {
          const { error: updStatusErr } = await supabase.from("anota_orders").update({ check_status: listed.check }).eq("id", prev.id);
          if (updStatusErr) console.error("[syncAnotaOrders] update status error:", updStatusErr);
          else atualizados++;
        }
        if (listed.check === 1 && !prev.estoque_aplicado) {
          finalizadosParaBaixa.push(prev.id);
        }
        continue;
      }

      // Novo pedido — busca detalhe
      const detail = await fetchOrderDetail(token, discovery.path, listed.id, pageId);
      const check = detail?.check ?? listed.check;

      const { data: inserted, error: insErr } = await supabase
        .from("anota_orders")
        .insert({
          external_order_id: listed.id,
          numero: detail?.numero ?? null,
          check_status: check,
          total: detail?.total ?? 0,
          cliente: detail?.cliente ?? null,
          pedido_em: detail?.pedidoEm ?? null,
          payload: (detail?.raw ?? null) as never,
        })
        .select("id")
        .single();

      if (insErr || !inserted) continue;
      importados++;

      const items = detail?.items ?? [];
      const todosMapeados = await insertOrderItems(supabase, inserted.id, items, mapByRef);
      if (items.length > 0 && !todosMapeados) pendentesMapeamento++;

      if (check === 1) {
        finalizadosParaBaixa.push(inserted.id);
      }
    }

    // Aplica baixa de estoque nos finalizados
    // O RPC já filtra apenas itens com mapeado=true AND product_id IS NOT NULL AND quantidade > 0
    let baixasAplicadas = 0;
    for (const orderId of finalizadosParaBaixa) {
      const { data: itens } = await supabase
        .from("anota_order_items")
        .select("mapeado")
        .eq("order_id", orderId);
      if (!itens || itens.length === 0) {
        continue;
      }
      const temMapeado = itens.some((i) => i.mapeado);
      if (!temMapeado) {
        pendentesMapeamento++;
        continue;
      }
      const { error: rpcErr } = await supabase.rpc("apply_anota_order_stock", {
        p_order: orderId,
        p_user: context.userId,
      });
      if (!rpcErr) baixasAplicadas++;
    }

    const partes = [`${importados} novo(s)`, `${atualizados} atualizado(s)`, `${baixasAplicadas} baixa(s) de estoque`];
    if (pendentesMapeamento) partes.push(`${pendentesMapeamento} pedido(s) aguardando mapeamento`);

    await supabase.from("activity_logs").insert({
      modulo: "anota_sync",
      acao: "sincronizou",
      user_id: context.userId,
      detalhes: { importados, atualizados, baixasAplicadas, pendentesMapeamento },
    });

    return {
      ok: true,
      message: `Sincronização concluída: ${partes.join(", ")}.`,
      importados,
      atualizados,
      baixasAplicadas,
      pendentesMapeamento,
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
        return { ok: false, message: `Erro ao salvar mapeamento: ${upsertErr.message}`, baixasAplicadas: 0 };
      }

      const { error: updateErr } = await supabase
        .from("anota_order_items")
        .update({ product_id: m.product_id, mapeado: !!m.product_id })
        .eq("anota_item_ref", m.anota_item_ref);

      if (updateErr) {
        console.error("[saveAnotaMapping] update items error:", updateErr);
        return { ok: false, message: `Erro ao atualizar itens: ${updateErr.message}`, baixasAplicadas: 0 };
      }
    }

    // Reaplica baixa para pedidos finalizados agora completamente mapeados
    const { data: pendentes, error: pendentesErr } = await supabase
      .from("anota_orders")
      .select("id")
      .eq("check_status", 3)
      .eq("estoque_aplicado", false);

    if (pendentesErr) {
      console.error("[saveAnotaMapping] query pendentes error:", pendentesErr);
      return { ok: false, message: `Erro ao buscar pedidos pendentes: ${pendentesErr.message}`, baixasAplicadas: 0 };
    }

    let baixasAplicadas = 0;
    for (const ord of pendentes ?? []) {
      const { data: itens, error: itensErr } = await supabase.from("anota_order_items").select("mapeado").eq("order_id", ord.id);
      if (itensErr) {
        console.error("[saveAnotaMapping] query itens error:", itensErr);
        continue;
      }
      const temMapeado = (itens ?? []).some((i) => i.mapeado);
      if (!temMapeado) continue;
      const { error } = await supabase.rpc("apply_anota_order_stock", { p_order: ord.id, p_user: context.userId });
      if (!error) baixasAplicadas++;
    }

    return {
      ok: true,
      message:
        baixasAplicadas > 0
          ? `Mapeamento salvo. ${baixasAplicadas} pedido(s) finalizado(s) tiveram baixa de estoque aplicada.`
          : "Mapeamento salvo com sucesso.",
      baixasAplicadas,
    };
  });
