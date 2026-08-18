import { createFileRoute } from "@tanstack/react-router";

import { processAnotaWebhookOrder } from "@/lib/anota.functions";

// ---------------------------------------------------------------------------
// Webhook de pedidos do Anota AI (Portal de Integração)
//
// O Anota faz um POST neste endpoint quando acontece:
//   - Pedidos Realizados  (novo pedido, incluindo agendados)
//   - Pedidos Atualizados (mudança de status)
//   - Pedidos Cancelados  (cancelamento/negação)
//
// Configuração no Portal de Integração (integracao.anota.ai):
//   Pedidos Realizados  -> POST https://<dominio>/api/anota-webhook?token=<ANOTA_WEBHOOK_SECRET>
//   Pedidos Atualizados -> POST https://<dominio>/api/anota-webhook?token=<ANOTA_WEBHOOK_SECRET>
//   Pedidos Cancelados  -> POST https://<dominio>/api/anota-webhook?token=<ANOTA_WEBHOOK_SECRET>
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/api/anota-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const token = url.searchParams.get("token") ?? "";
          const expected = process.env.ANOTA_WEBHOOK_SECRET;
          if (!expected || token !== expected) {
            // Diagnóstico: registra tentativas rejeitadas para descobrir se o
            // Anota está chamando o endpoint com token errado (ou não chamando).
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              await supabaseAdmin.from("activity_logs").insert({
                modulo: "anota_webhook",
                acao: "recebeu_nao_autorizado",
                registro_id: null,
                user_id: null,
                detalhes: {
                  metodo: request.method,
                  token_prefixo: token.slice(0, 10),
                  token_len: token.length,
                  secret_configurado: !!expected,
                } as never,
              });
            } catch (e) {
              console.error("[anota-webhook] falha ao logar 401:", e);
            }
            return Response.json({ ok: false, error: "não autorizado" }, { status: 401 });
          }

          const raw = await request.text();
          if (!raw.trim()) {
            return Response.json({ ok: false, error: "corpo vazio" });
          }

          let payload: unknown;
          try {
            payload = JSON.parse(raw);
          } catch {
            return Response.json({ ok: false, error: "JSON inválido" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Loga o payload recebido (útil para validar o formato real do Anota
          // no primeiro teste e ajustar o parse se o envelope for diferente).
          try {
            await supabaseAdmin.from("activity_logs").insert({
              modulo: "anota_webhook",
              acao: "recebeu_pedido",
              registro_id: null,
              user_id: null,
              detalhes: { payload } as never,
            });
          } catch (e) {
            console.error("[anota-webhook] falha ao logar:", e);
          }

          const result = await processAnotaWebhookOrder(supabaseAdmin, payload);
          return Response.json({
            ok: result.ok,
            acao: result.acao,
            externalId: result.externalId,
            check: result.check,
          });
        } catch (e) {
          console.error("[anota-webhook] erro:", e);
          // Responde 200 mesmo em erro para o Anota não reenviar em loop.
          return Response.json({ ok: false, error: "erro interno" });
        }
      },
    },
  },
});
