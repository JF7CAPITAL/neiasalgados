import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncAnotaOrders } from "@/lib/anota.functions";
import { notifySync, onSync, getLastSync } from "@/lib/anota-sync";
import { isSyncEnabled } from "@/lib/sync-toggle";

export function useAutoSync(intervalMs = 180000) {
  const [lastSync, setLastSync] = useState<string | null>(getLastSync());
  const syncFn = useServerFn(syncAnotaOrders);
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
  }, [intervalMs, syncFn]);

  return lastSync;
}
