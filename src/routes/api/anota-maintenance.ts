import { createFileRoute } from "@tanstack/react-router";

import { runAnotaMaintenance } from "@/lib/anota.functions";

// ---------------------------------------------------------------------------
// Endpoint de manutenção do Anota AI (fallback do pg_cron).
//
// Reaproveita mapeamentos históricos (anota_product_map), promove agendados
// vencidos e aplica baixas pendentes de pedidos finalizados.
//
// Autenticação:
//   - Header `Authorization: Bearer <CRON_SECRET>` (enviado pelo Vercel Cron), ou
//   - Query `?token=<CRON_SECRET|ANOTA_WEBHOOK_SECRET>`.
// ---------------------------------------------------------------------------

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET ?? process.env.ANOTA_WEBHOOK_SECRET ?? "";

  const autorizado = !!expected && (auth === `Bearer ${expected}` || token === expected);
  if (!autorizado) {
    return Response.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await runAnotaMaintenance(supabaseAdmin, null);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[anota-maintenance] erro:", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/anota-maintenance")({
  ssr: false,
  component: () => null,
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
