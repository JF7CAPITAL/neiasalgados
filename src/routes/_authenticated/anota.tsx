import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingBag, RefreshCw, Plug, Loader2, Link2, AlertTriangle, CheckCircle2, Eye, CalendarDays, Search, Filter, Clock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  testAnotaConnection,
  syncAnotaOrders,
  saveAnotaMapping,
  ANOTA_CHECK_LABELS,
} from "@/lib/anota.functions";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { PageHeader, KpiCard, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isSyncEnabled, setSyncEnabled, onSyncToggle } from "@/lib/sync-toggle";

export const Route = createFileRoute("/_authenticated/anota")({
  component: AnotaPage,
});

type Filtro = "todos" | "analise" | "producao" | "finalizados";

function diasAte(dataStr: string): string {
  const data = new Date(dataStr);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  data.setHours(0, 0, 0, 0);
  const diff = Math.round((data.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "D+0";
  if (diff > 0) return `D+${diff}`;
  return `D${diff}`;
}

function getScheduledDate(payload: any): string | null {
  if (!payload) return null;
  return payload.preparationStartDateTime || payload.schedule_order?.date || null;
}

const CHECK_TONE: Record<number, "default" | "secondary" | "destructive" | "outline"> = {
  [ -2 ]: "outline",
  0: "outline",
  1: "secondary",
  2: "secondary",
  3: "default",
  4: "destructive",
  5: "destructive",
  6: "destructive",
};

function checkBadge(check: number, scheduledDate?: string | null) {
  if (check === -2) {
    const label = scheduledDate ? `Agendamento ${diasAte(scheduledDate)}` : "Agendamento";
    return <Badge variant="outline" className="text-info border-info/30 bg-info/15">{label}</Badge>;
  }
  return (
    <Badge variant={CHECK_TONE[check] ?? "outline"}>{ANOTA_CHECK_LABELS[check] ?? `Status ${check}`}</Badge>
  );
}

function AnotaPage() {
  const qc = useQueryClient();
  const [syncEnabled, setSyncEnabledState] = useState(() => isSyncEnabled());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [buscaData, setBuscaData] = useState(new Date().toISOString().split("T")[0]);
  const [buscaStatus, setBuscaStatus] = useState<"todos" | "producao" | "finalizados">("todos");

  useEffect(() => {
    const unsub = onSyncToggle((enabled) => setSyncEnabledState(enabled));
    return unsub;
  }, []);

  const testFn = useServerFn(testAnotaConnection);
  const syncFn = useServerFn(syncAnotaOrders);
  const saveMapFn = useServerFn(saveAnotaMapping);

  const { data: orders = [] } = useQuery({
    queryKey: ["anota-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_orders")
        .select("id, external_order_id, numero, check_status, total, cliente, pedido_em, estoque_aplicado, imported_at")
        .order("imported_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["anota-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_order_items")
        .select("anota_item_ref, nome, product_id, mapeado");
      if (error) throw error;
      return data;
    },
  });

  const { data: scheduledWithPayload = [] } = useQuery({
    queryKey: ["anota-scheduled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_orders")
        .select("id, external_order_id, numero, check_status, total, cliente, pedido_em, estoque_aplicado, imported_at, payload")
        .eq("check_status", -2)
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: buscaResults = [] } = useQuery({
    queryKey: ["anota-busca", buscaData, buscaStatus],
    queryFn: async () => {
      const from = new Date(buscaData);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      let query = supabase
        .from("anota_orders")
        .select("id, external_order_id, numero, check_status, total, cliente, pedido_em, estoque_aplicado, imported_at")
        .gte("imported_at", from.toISOString())
        .lt("imported_at", to.toISOString())
        .order("imported_at", { ascending: false });
      if (buscaStatus === "producao") query = query.eq("check_status", 1);
      else if (buscaStatus === "finalizados") query = query.eq("check_status", 3);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, nome")
        .is("deleted_at", null)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  // Itens distintos por referência (para a tela de mapeamento)
  const distinctItems = useMemo(() => {
    const map = new Map<string, { ref: string; nome: string | null; product_id: string | null; count: number }>();
    for (const it of items) {
      const ref = it.anota_item_ref;
      if (!ref) continue;
      const cur = map.get(ref);
      if (cur) {
        cur.count++;
        if (!cur.product_id && it.product_id) cur.product_id = it.product_id;
      } else {
        map.set(ref, {
          ref,
          nome: it.nome,
          product_id: it.product_id,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.nome ?? a.ref).localeCompare(b.nome ?? b.ref));
  }, [items]);

  const pendentes = distinctItems.filter((d) => !d.product_id).length;
  const finalizadosSemBaixa = orders.filter((o) => o.check_status === 3 && !o.estoque_aplicado).length;

  // Estado local dos selects de mapeamento
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const { data: orderItems = [] } = useQuery({
    queryKey: ["anota-order-items", selectedOrderId],
    queryFn: async () => {
      if (!selectedOrderId) return [];
      const { data, error } = await supabase
        .from("anota_order_items")
        .select("nome, quantidade, mapeado")
        .eq("order_id", selectedOrderId)
        .order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedOrderId,
  });

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { filtro } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      qc.invalidateQueries({ queryKey: ["anota-orders"] });
      qc.invalidateQueries({ queryKey: ["anota-items"] });
      qc.invalidateQueries({ queryKey: ["anota-scheduled"] });
      qc.invalidateQueries({ queryKey: ["anota-busca"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMap = useMutation({
    mutationFn: () => {
      const mappings = Object.entries(mapDraft)
        .filter(([, v]) => v)
        .map(([ref, product_id]) => {
          const d = distinctItems.find((x) => x.ref === ref);
          return { anota_item_ref: ref, nome: d?.nome ?? null, product_id: product_id === "none" ? null : product_id };
        });
      if (!mappings.length) throw new Error("Nenhuma alteração de mapeamento para salvar.");
      return saveMapFn({ data: { mappings } });
    },
    onSuccess: (r) => {
      toast.success(r.message);
      setMapDraft({});
      qc.invalidateQueries({ queryKey: ["anota-orders"] });
      qc.invalidateQueries({ queryKey: ["anota-items"] });
      qc.invalidateQueries({ queryKey: ["anota-scheduled"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hojeInicio = new Date();
  hojeInicio.setHours(0, 0, 0, 0);
  const hojeOrders = orders.filter((o) => new Date(o.imported_at) >= hojeInicio);
  const agendadosCount = scheduledWithPayload.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anota AI"
        subtitle="Importe pedidos de venda e dê baixa automática no estoque"
        icon={ShoppingBag}
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch
                id="sync-toggle"
                checked={syncEnabled}
                onCheckedChange={(v) => setSyncEnabled(v)}
              />
              <Label htmlFor="sync-toggle" className="text-sm">
                {syncEnabled ? "Sync ativo" : "Sync desativado"}
              </Label>
            </div>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !syncEnabled}>
              {test.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plug className="mr-2 size-4" />}
              Testar conexão
            </Button>
            <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="analise">Em análise</SelectItem>
                <SelectItem value="producao">Em produção</SelectItem>
                <SelectItem value="finalizados">Finalizados</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending || !syncEnabled}>
              {sync.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Sincronizar pedidos
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Pedidos importados" value={orders.length} icon={ShoppingBag} />
        <KpiCard
          label="Itens sem mapeamento"
          value={pendentes}
          icon={Link2}
          tone={pendentes ? "warning" : "success"}
          hint={pendentes ? "Vincule para permitir a baixa" : "Tudo mapeado"}
        />
        <KpiCard
          label="Finalizados sem baixa"
          value={finalizadosSemBaixa}
          icon={AlertTriangle}
          tone={finalizadosSemBaixa ? "warning" : "success"}
        />
      </div>

      <Tabs defaultValue="pedidos">
        <TabsList>
          <TabsTrigger value="pedidos">Pedidos{hojeOrders.length ? ` (${hojeOrders.length})` : ""}</TabsTrigger>
          <TabsTrigger value="agendados">
            Agendados{agendadosCount ? ` (${agendadosCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="buscar">Buscar pedidos</TabsTrigger>
          <TabsTrigger value="mapeamento">
            Mapeamento{pendentes ? ` (${pendentes})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pedidos" className="pt-4">
          {hojeOrders.length === 0 ? (
            <EmptyState
              title="Nenhum pedido hoje"
              description="Os pedidos sincronizados hoje aparecerão aqui."
              icon={ShoppingBag}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hojeOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedOrderId(o.id)}
                          className="font-medium underline-offset-2 hover:underline cursor-pointer text-left"
                        >
                          {o.numero ?? o.external_order_id.slice(-6)}
                        </button>
                      </td>
                      <td className="px-4 py-3">{o.cliente ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDateTime(o.pedido_em ?? o.imported_at)}</td>
                      <td className="px-4 py-3">{o.check_status === -2 ? checkBadge(-2, getScheduledDate(o as any)) : checkBadge(o.check_status)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(o.total)}</td>
                      <td className="px-4 py-3 text-center">
                        {o.estoque_aplicado ? (
                          <CheckCircle2 className="mx-auto size-4 text-success" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agendados" className="pt-4">
          {agendadosCount === 0 ? (
            <EmptyState
              title="Nenhum pedido agendado"
              description="Pedidos com check_status = -2 (agendados) aparecerão aqui."
              icon={CalendarDays}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Agendado para</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scheduledWithPayload.map((o: any) => {
                    const scheduledDate = getScheduledDate(o.payload);
                    return (
                      <tr key={o.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setSelectedOrderId(o.id)}
                            className="font-medium underline-offset-2 hover:underline cursor-pointer text-left"
                          >
                            {o.numero ?? o.external_order_id.slice(-6)}
                          </button>
                        </td>
                        <td className="px-4 py-3">{o.cliente ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{scheduledDate ? fmtDateTime(scheduledDate) : "—"}</td>
                        <td className="px-4 py-3">{checkBadge(-2, scheduledDate)}</td>
                        <td className="px-4 py-3 text-right tabular">{fmtMoney(o.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="buscar" className="pt-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <input
                type="date"
                value={buscaData}
                onChange={(e) => setBuscaData(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <Select value={buscaStatus} onValueChange={(v) => setBuscaStatus(v as any)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="producao">Em produção</SelectItem>
                  <SelectItem value="finalizados">Finalizados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {buscaResults.length === 0 ? (
            <EmptyState
              title="Nenhum pedido encontrado"
              description={`Nenhum pedido sincronizado em ${new Date(buscaData).toLocaleDateString("pt-BR")}.`}
              icon={Search}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {buscaResults.map((o: any) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedOrderId(o.id)}
                          className="font-medium underline-offset-2 hover:underline cursor-pointer text-left"
                        >
                          {o.numero ?? o.external_order_id.slice(-6)}
                        </button>
                      </td>
                      <td className="px-4 py-3">{o.cliente ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDateTime(o.pedido_em ?? o.imported_at)}</td>
                      <td className="px-4 py-3">{checkBadge(o.check_status)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(o.total)}</td>
                      <td className="px-4 py-3 text-center">
                        {o.estoque_aplicado ? (
                          <CheckCircle2 className="mx-auto size-4 text-success" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="mapeamento" className="pt-4">
          {distinctItems.length === 0 ? (
            <EmptyState
              title="Nenhum item para mapear"
              description="Sincronize pedidos primeiro. Os itens vendidos aparecerão aqui para vincular aos seus produtos."
              icon={Link2}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Vincule cada item do cardápio do Anota AI a um produto do seu sistema. A baixa de estoque só é aplicada
                em pedidos finalizados com todos os itens mapeados.
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Item no Anota AI</th>
                      <th className="px-4 py-3 text-center">Ocorrências</th>
                      <th className="px-4 py-3">Produto do sistema</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {distinctItems.map((d) => {
                      const value = mapDraft[d.ref] ?? d.product_id ?? "none";
                      return (
                        <tr key={d.ref} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <span className="font-medium">{d.nome ?? d.ref}</span>
                            {!d.product_id && !mapDraft[d.ref] && (
                              <Badge variant="outline" className="ml-2 text-warning">
                                Pendente
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{d.count}</td>
                          <td className="px-4 py-3">
                            <Select
                              value={value}
                              onValueChange={(v) => setMapDraft((s) => ({ ...s, [d.ref]: v }))}
                            >
                              <SelectTrigger className="w-64">
                                <SelectValue placeholder="Selecionar produto..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— Não vincular —</SelectItem>
                                {products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => saveMap.mutate()} disabled={saveMap.isPending}>
                  {saveMap.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Salvar mapeamento
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Pedido {selectedOrder?.numero ?? selectedOrder?.external_order_id?.slice(-6) ?? ""}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Cliente:</span>{" "}
                  <span className="font-medium">{selectedOrder.cliente ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Data:</span>{" "}
                  <span className="font-medium">{fmtDateTime(selectedOrder.pedido_em ?? selectedOrder.imported_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  {checkBadge(selectedOrder.check_status)}
                </div>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span className="font-medium">{fmtMoney(selectedOrder.total)}</span>
                </div>
              </div>
              <div className="border-t pt-3">
                <h4 className="mb-2 text-sm font-medium">Itens do pedido</h4>
                {orderItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum item encontrado. Sincronize novamente os pedidos.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qtd</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {orderItems.map((it, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{it.nome ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.quantidade}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
