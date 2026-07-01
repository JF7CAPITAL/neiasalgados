import { supabase } from "@/integrations/supabase/client";

/** Records an activity log entry. Never throws to the UI. */
export async function logActivity(
  modulo: string,
  acao: string,
  registroId?: string | null,
  detalhes?: Record<string, unknown>,
) {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      modulo,
      acao,
      registro_id: registroId ?? null,
      user_id: data.user?.id ?? null,
      detalhes: (detalhes ?? null) as never,
    });
  } catch {
    // best-effort logging
  }
}
