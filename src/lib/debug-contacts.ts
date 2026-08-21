// Debug script para investigar por que contatos específicos não recebem mensagens
// Execute este script no console do navegador ou crie uma rota temporária

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, orderPhone, isContactPaused } from "@/lib/whatsapp.functions";

// Contatos problemáticos
const PROBLEM_PHONES = [
  "5515998556007", // 15 99855-6007
  "5515991674016", // 15 99167-4016
];

async function debugContacts() {
  console.log("=== DEBUG CONTATOS PROBLEMÁTICOS ===\n");

  for (const phone of PROBLEM_PHONES) {
    console.log(`\n--- Telefone: ${phone} ---`);

    // 1. Verificar normalização
    console.log("1. Normalização:", normalizePhone(phone));

    // 2. Verificar se está pausado
    const paused = await isContactPaused(supabaseAdmin, phone);
    console.log("2. Pausado:", paused);

    // 3. Verificar mensagens recentes (últimas 24h)
    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", phone)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (msgErr) console.log("   Erro ao buscar mensagens:", msgErr.message);
    else {
      console.log(`3. Mensagens recentes (${msgs?.length || 0}):`);
      msgs?.forEach((m) => {
        console.log(`   - [${m.direction}] ${m.tipo} | ${m.status} | ${m.texto?.slice(0, 50)}`);
      });
    }

    // 4. Verificar pausas ativas
    const { data: pauses } = await supabaseAdmin
      .from("whatsapp_contact_pauses")
      .select("*")
      .eq("phone", phone)
      .gte("paused_until", new Date().toISOString());
    console.log("4. Pausas ativas:", pauses?.length || 0, pauses);

    // 5. Verificar mensagens processadas (deduplicação)
    const { data: processed } = await supabaseAdmin
      .from("whatsapp_processed_messages")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(10);
    console.log("5. Mensagens processadas (dedup):", processed?.length || 0);

    // 6. Buscar pedidos recentes desse telefone
    const { data: orders } = await supabaseAdmin
      .from("anota_orders")
      .select("id, numero, cliente, check_status, payload, whatsapp_notified_at, whatsapp_ready_notified_at, whatsapp_statuses_notified, whatsapp_keywords_notified")
      .order("imported_at", { ascending: false })
      .limit(10);

    if (orders) {
      const matchingOrders = orders.filter((o) => {
        const p = orderPhone(o.payload);
        return p === phone;
      });
      console.log(`6. Pedidos com esse telefone: ${matchingOrders.length}`);
      matchingOrders.forEach((o) => {
        console.log(`   - Pedido #${o.numero} | Status: ${o.check_status} | Notif Recebido: ${o.whatsapp_notified_at ? "SIM" : "NÃO"} | Notif Pronto: ${o.whatsapp_ready_notified_at ? "SIM" : "NÃO"} | Status Notificados: ${JSON.stringify(o.whatsapp_statuses_notified)} | Keywords: ${JSON.stringify(o.whatsapp_keywords_notified)}`);
      });
    }

    // 7. Verificar regras de palavra-chave ativas
    const { data: rules } = await supabaseAdmin
      .from("whatsapp_keyword_rules")
      .select("*")
      .eq("ativo", true);
    console.log(`7. Regras ativas: ${rules?.length || 0}`);
    rules?.forEach((r) => console.log(`   - ${r.regra}: ${r.palavras_chave}`));

    // 8. Verificar notificações automáticas ativas
    const { data: notifs } = await supabaseAdmin
      .from("whatsapp_notifications")
      .select("*")
      .eq("ativo", true);
    console.log(`8. Notificações automáticas ativas: ${notifs?.length || 0}`);
    notifs?.forEach((n) => console.log(`   - ${n.regra}: ${n.mensagem?.slice(0, 50)}`));
  }

  console.log("\n=== FIM DEBUG ===");
}

// Exportar para uso
export { debugContacts, PROBLEM_PHONES };