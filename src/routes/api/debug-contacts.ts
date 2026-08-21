import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, orderPhone, isContactPaused } from "@/lib/whatsapp.functions";

const PROBLEM_PHONES = ["5515998556007", "5515991674016"];

async function debugContact(phone: string) {
  const results: Record<string, any> = { phone };

  // 1. Normalização
  results.normalized = normalizePhone(phone);

  // 2. Pausado
  results.paused = await isContactPaused(supabaseAdmin, phone);

  // 3. Mensagens recentes
  const { data: msgs } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("*")
    .eq("phone", phone)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  results.recentMessages = msgs?.length || 0;
  results.messageDetails = msgs?.map((m) => ({
    direction: m.direction,
    tipo: m.tipo,
    status: m.status,
    texto: m.texto?.slice(0, 80),
    created_at: m.created_at,
  }));

  // 4. Pausas ativas
  const { data: pauses } = await supabaseAdmin
    .from("whatsapp_contact_pauses")
    .select("*")
    .eq("phone", phone)
    .gte("paused_until", new Date().toISOString());
  results.activePauses = pauses;

  // 5. Mensagens processadas (dedup)
  const { data: processed } = await supabaseAdmin
    .from("whatsapp_processed_messages")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(10);
  results.processedMessages = processed?.length || 0;

  // 6. Pedidos recentes desse telefone
  const { data: orders } = await supabaseAdmin
    .from("anota_orders")
    .select("id, numero, cliente, check_status, payload, whatsapp_notified_at, whatsapp_ready_notified_at, whatsapp_statuses_notified, whatsapp_keywords_notified")
    .order("imported_at", { ascending: false })
    .limit(20);

  if (orders) {
    const matchingOrders = orders.filter((o) => {
      const p = orderPhone(o.payload);
      return p === phone;
    });
    results.matchingOrders = matchingOrders.map((o) => ({
      id: o.id,
      numero: o.numero,
      cliente: o.cliente,
      check_status: o.check_status,
      whatsapp_notified_at: o.whatsapp_notified_at,
      whatsapp_ready_notified_at: o.whatsapp_ready_notified_at,
      whatsapp_statuses_notified: o.whatsapp_statuses_notified,
      whatsapp_keywords_notified: o.whatsapp_keywords_notified,
    }));
  }

  // 7. Regras de palavra-chave ativas
  const { data: rules } = await supabaseAdmin
    .from("whatsapp_keyword_rules")
    .select("*")
    .eq("ativo", true);
  results.activeKeywordRules = rules?.map((r) => ({
    regra: r.regra,
    nome: r.nome,
    palavras_chave: r.palavras_chave,
    ativo: r.ativo,
  }));

  // 8. Notificações automáticas ativas
  const { data: notifs } = await supabaseAdmin
    .from("whatsapp_notifications")
    .select("*")
    .eq("ativo", true);
  results.activeNotifications = notifs?.map((n) => ({
    regra: n.regra,
    titulo: n.titulo,
    ativo: n.ativo,
  }));

  return results;
}

export const debugProblemContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const results = [];
    for (const phone of PROBLEM_PHONES) {
      results.push(await debugContact(phone));
    }
    return { ok: true, results };
  });