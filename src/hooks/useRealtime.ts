import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes on the given tables and invalidate
 * the provided query keys whenever anything changes.
 */
export function useRealtime(tables: string[], invalidateKeys: string[]) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel("erp-realtime-" + tables.join("-"));
    tables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      });
    });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
