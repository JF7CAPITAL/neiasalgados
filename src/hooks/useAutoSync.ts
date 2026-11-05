import { useEffect, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { promoteScheduledAnotaOrders } from "@/lib/anota.functions";
import { notifySync, onSync, getLastSync } from "@/lib/anota-sync";
import { isAutoPromoteEnabled } from "@/lib/sync-toggle";
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
  const promoteFn = useServerFn(promoteScheduledAnotaOrders);
  const running = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateAll = useCallback(() => {
    SYNC_QUERY_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  }, [qc]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Invalidação sempre: os dados chegam pelo webhook, não por uma
      // sincronização periódica com a API (descontinuada).
      invalidateAll();
      if (!isAutoPromoteEnabled()) return;
      const r = await promoteFn();
      if (r.ok && r.promovidos > 0) invalidateAll();
      notifySync(new Date().toISOString());
    } catch {
      // silent fail no ciclo automático
    } finally {
      running.current = false;
    }
  }, [promoteFn, invalidateAll]);

  const scheduleImmediate = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Jitter curto reduz a chance de vários navegadores promoverem ao mesmo
    // tempo em resposta ao mesmo evento de realtime.
    const jitter = Math.floor(Math.random() * 3000);
    debounceTimer.current = setTimeout(run, debounceMs + jitter);
  }, [run, debounceMs]);

  useEffect(() => {
    const unsub = onSync((ts) => setLastSync(ts));
    return unsub;
  }, []);

  // Atualização orientada a eventos: sempre que as tabelas do Anota mudarem
  // (pedido novo via webhook, status alterado, itens, mapeamentos) em qualquer
  // cliente, invalida as queries e reavalia a promoção de agendados.
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
          // Reavalia a promoção quando o status realmente mudou; as demais
          // escritas (whatsapp_*, estoque_aplicado, motivo de cancelamento…)
          // apenas atualizam a UI sem custo extra.
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

  // Roda assim que o app abre (e no primeiro ciclo do intervalo).
  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  // Roda quando o usuário volta para a aba/janela.
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
