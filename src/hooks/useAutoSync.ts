import { useEffect, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncAnotaOrders, promoteScheduledAnotaOrders } from "@/lib/anota.functions";
import { notifySync, onSync, getLastSync } from "@/lib/anota-sync";
import { isSyncEnabled } from "@/lib/sync-toggle";
import { supabase } from "@/integrations/supabase/client";

const SYNC_QUERY_KEYS = [
  "anota-orders",
  "anota-items",
  "anota-combo-map",
  "anota-scheduled",
  "anota-busca",
  "dashboard",
  "stock",
] as const;

export function useAutoSync(intervalMs = 30000, debounceMs = 15000) {
  const [lastSync, setLastSync] = useState<string | null>(getLastSync());
  const qc = useQueryClient();
  const syncFn = useServerFn(syncAnotaOrders);
  const promoteFn = useServerFn(promoteScheduledAnotaOrders);
  const running = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateAll = useCallback(() => {
    SYNC_QUERY_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  }, [qc]);

  const run = useCallback(async () => {
    if (running.current) return;
    if (!isSyncEnabled()) return;
    running.current = true;
    try {
      // Promove os agendados vencidos antes de sincronizar, assim o ERP não
      // depende do Anota para refletir o status.
      const r = await promoteFn();
      if (r.ok && r.promovidos > 0) invalidateAll();
      await syncFn({ data: {} });
      notifySync(new Date().toISOString());
      // Invalida após TODO sync (não apenas quando houve promoção) para que a
      // UI reflita pedidos novos/atualizados imediatamente.
      invalidateAll();
    } catch {
      // silent fail no auto-sync
    } finally {
      running.current = false;
    }
  }, [promoteFn, syncFn, invalidateAll]);

  const scheduleImmediate = useCallback(() => {
    if (!isSyncEnabled()) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Jitter curto reduz a chance de vários navegadores sincronizarem ao
    // mesmo tempo em resposta ao mesmo evento de realtime.
    const jitter = Math.floor(Math.random() * 3000);
    debounceTimer.current = setTimeout(run, debounceMs + jitter);
  }, [run, debounceMs]);

  useEffect(() => {
    const unsub = onSync((ts) => setLastSync(ts));
    return unsub;
  }, []);

  // Sincronização orientada a eventos: sempre que as tabelas do Anota mudarem
  // de forma relevante (pedido novo ou status alterado — em qualquer cliente),
  // dispara um sync imediato (debounced) além do intervalo fixo.
  useEffect(() => {
    const channel = supabase
      .channel("erp-anota-sync")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "anota_orders" }, () => {
        invalidateAll();
        scheduleImmediate();
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "anota_orders" },
        (payload) => {
          invalidateAll();
          const oldRow = payload.old as { check_status?: number } | null;
          const newRow = payload.new as { check_status?: number } | null;
          // Só re-sincroniza quando o status realmente mudou; as demais
          // escritas do próprio sync (whatsapp_*, estoque_aplicado, etc.)
          // apenas atualizam a UI sem custo extra de chamadas à API.
          if (oldRow && newRow && oldRow.check_status !== newRow.check_status) {
            scheduleImmediate();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "anota_order_items" },
        () => invalidateAll(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "anota_order_items" },
        () => invalidateAll(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "anota_product_map" }, () =>
        invalidateAll(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "anota_combo_item_map" }, () =>
        invalidateAll(),
      );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [invalidateAll, scheduleImmediate]);

  // Sincroniza assim que o app abre (e no primeiro ciclo do intervalo).
  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  // Sincroniza quando o usuário volta para a aba/janela.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleImmediate();
    };
    const onFocus = () => scheduleImmediate();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scheduleImmediate]);

  return lastSync;
}
