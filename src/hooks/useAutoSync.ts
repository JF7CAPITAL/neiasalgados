import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncAnotaOrders, promoteScheduledAnotaOrders } from "@/lib/anota.functions";
import { notifySync, onSync, getLastSync } from "@/lib/anota-sync";
import { isSyncEnabled } from "@/lib/sync-toggle";

export function useAutoSync(intervalMs = 180000) {
  const [lastSync, setLastSync] = useState<string | null>(getLastSync());
  const qc = useQueryClient();
  const syncFn = useServerFn(syncAnotaOrders);
  const promoteFn = useServerFn(promoteScheduledAnotaOrders);
  const running = useRef(false);

  useEffect(() => {
    const unsub = onSync((ts) => setLastSync(ts));
    return unsub;
  }, []);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      if (!isSyncEnabled()) return;
      running.current = true;
      try {
        const r = await promoteFn();
        if (r.ok && r.promovidos > 0) {
          qc.invalidateQueries({ queryKey: ["anota-scheduled"] });
          qc.invalidateQueries({ queryKey: ["anota-orders"] });
          qc.invalidateQueries({ queryKey: ["anota-busca"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
        }
        await syncFn({ data: {} });
        notifySync(new Date().toISOString());
      } catch {
        // silent fail no auto-sync
      } finally {
        running.current = false;
      }
    };
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, syncFn, promoteFn, qc]);

  // Promove os agendados vencidos assim que o app abre, independente do sync do Anota
  useEffect(() => {
    (async () => {
      if (!isSyncEnabled()) return;
      try {
        const r = await promoteFn();
        if (r.ok && r.promovidos > 0) {
          qc.invalidateQueries({ queryKey: ["anota-scheduled"] });
          qc.invalidateQueries({ queryKey: ["anota-orders"] });
          qc.invalidateQueries({ queryKey: ["anota-busca"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
        }
      } catch {
        // silent fail no promote inicial
      }
    })();
  }, [promoteFn, qc]);

  return lastSync;
}
