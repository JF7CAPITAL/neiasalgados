import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Boxes,
  AlertTriangle,
  Warehouse,
  ClipboardList,
  Factory,
  ShoppingCart,
  TrendingDown,
  Users,
  PackageCheck,
  Printer,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useRealtime } from "@/hooks/useRealtime";
import { PageHeader, KpiCard } from "@/components/erp/PageHeader";
import { fmtNum, fmtDateTime, fmtMoney, stockLevel } from "@/lib/format";
import { getLastSync, onSync } from "@/lib/anota-sync";
import { StockBadge } from "@/components/erp/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  printStockReport,
  printBelowMinimumReport,
  printConsumptionReport,
  printProdOrdersReport,
  printPurchaseOrdersReport,
  printColabsTurnoReport,
  printReport,
  printHTML,
} from "@/lib/export";

export const Route = createFileRoute("/_authenticated/painel")({
  component: DashboardPage,
});

type ReportDialog = {
  title: string;
  table: React.ReactNode;
  onPrint: () => void;
} | null;

function startOf(period: "hoje" | "semana" | "mes"): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "semana") d.setDate(d.getDate() - 6);
  if (period === "mes") d.setDate(1);
  return d;
}

function DashboardPage() {
  const [lastSync, setLastSync] = useState(getLastSync());
  const [report, setReport] = useState<ReportDialog>(null);
  const [verAgendados, setVerAgendados] = useState(false);
  const [agendamentoReport, setAgendamentoReport] = useState<ReportDialog>(null);
  const [forecastDrill, setForecastDrill] = useState<{ nome: string; productId: string } | null>(null);

  useEffect(() => {
    const unsub = onSync((ts) => setLastSync(ts));
    return unsub;
  }, []);

  useRealtime(
    ["products", "ingredients", "production_orders", "purchase_orders", "product_movements"],
    ["dashboard"],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const hoje = startOf("hoje").toISOString();
      const [products, ingredients, prodOrders, purchOrders, movements, collabs, anotaOrders] = await Promise.all([
        supabase.from("products").select("id, nome, quantidade_atual, quantidade_reservada, estoque_minimo, estoque_ideal").is("deleted_at", null),
        supabase.from("ingredients").select("id, nome, quantidade_atual, estoque_minimo, unidade").is("deleted_at", null),
        supabase.from("production_orders").select("id, numero, kind, status, quantidade_necessaria, quantidade_produzida, quantidade_ideal, massadas, tipo_massa, prioridade, product_id, filling_id, fim, created_at").is("deleted_at", null),
        supabase.from("purchase_orders").select("id, numero, status, prioridade, quantidade_necessaria, preco_medio, ingredient_id, supplier_id, observacoes, created_at").is("deleted_at", null),
        supabase.from("product_movements").select("id, product_id, tipo, quantidade, destino, created_at, ref_order_id").order("created_at", { ascending: false }).limit(500),
        supabase.from("collaborators").select("id, nome, cargo, turno, em_turno").is("deleted_at", null),
        supabase.from("anota_orders").select("id, created_at").gte("created_at", hoje),
      ]);
      const [pnames, inames, fnames, snames] = await Promise.all([
        supabase.from("products").select("id, nome"),
        supabase.from("ingredients").select("id, nome"),
        supabase.from("fillings").select("id, nome"),
        supabase.from("suppliers").select("id, nome"),
      ]);
      const ordensHoje = new Set((anotaOrders.data ?? []).map((o: { id: string }) => o.id));
      const scheduledR = await supabase
        .from("anota_orders")
        .select("id, numero, cliente, total, payload")
        .eq("check_status", -2);
      const scheduledOrders = scheduledR.data ?? [];
      let scheduledItems: any[] = [];
      if (scheduledOrders.length > 0) {
        const itemsR = await supabase
          .from("anota_order_items")
          .select("order_id, nome, quantidade, product_id, mapeado")
          .in("order_id", scheduledOrders.map((o) => o.id))
          .eq("mapeado", true)
          .not("product_id", "is", null);
        scheduledItems = itemsR.data ?? [];
      }
      return {
        products: products.data ?? [],
        ingredients: ingredients.data ?? [],
        prodOrders: prodOrders.data ?? [],
        purchOrders: purchOrders.data ?? [],
        movements: movements.data ?? [],
        collabs: collabs.data ?? [],
        ordensHoje,
        names: {
          ...Object.fromEntries((pnames.data ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome])),
          ...Object.fromEntries((inames.data ?? []).map((i: { id: string; nome: string }) => [i.id, i.nome])),
          ...Object.fromEntries((fnames.data ?? []).map((f: { id: string; nome: string }) => [f.id, f.nome])),
          ...Object.fromEntries((snames.data ?? []).map((s: { id: string; nome: string }) => [s.id, s.nome])),
        } as Record<string, string>,
        scheduledOrders,
        scheduledItems,
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Painel" subtitle="Carregando indicadores..." icon={LayoutDashboard} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  const { products, ingredients, prodOrders, purchOrders, movements, collabs, names, ordensHoje } = data;
  const scheduledOrders: any[] = (data as any).scheduledOrders ?? [];
  const scheduledItems: any[] = (data as any).scheduledItems ?? [];

  const scheduledImpact = new Map<string, number>();
  for (const item of scheduledItems) {
    const pid = item.product_id as string;
    if (!pid) continue;
    scheduledImpact.set(pid, (scheduledImpact.get(pid) ?? 0) + Number(item.quantidade));
  }
  const totalScheduledImpact = Array.from(scheduledImpact.values()).reduce((s, v) => s + v, 0);

  const nm = (id: string | null | undefined) => (id && names[id]) || "—";

  const estoqueTotal = products.reduce((s, p) => s + Number(p.quantidade_atual), 0);
  const produtosAbaixo = products.filter((p) => p.estoque_minimo > 0 && Number(p.quantidade_atual) <= Number(p.estoque_minimo));
  const insumosAbaixo = ingredients.filter((i) => i.estoque_minimo > 0 && Number(i.quantidade_atual) <= Number(i.estoque_minimo));

  const ordensPendentes = prodOrders.filter((o) => o.status === "pendente");
  const ordensAndamento = prodOrders.filter((o) => o.status === "em_andamento");
  const ordensConcluidas = prodOrders.filter((o) => o.status === "concluida");
  const comprasPendentes = purchOrders.filter((o) => o.status === "pendente");
  const colabsTurno = collabs.filter((c) => c.em_turno);
  const emProducao = ordensAndamento.length;

  const producaoAberta = prodOrders
    .filter((o) => o.status === "pendente" || o.status === "em_andamento")
    .reduce((s, o) => s + Number(o.quantidade_necessaria ?? 0), 0);
  const projetado = estoqueTotal + producaoAberta - totalScheduledImpact;

  const orderDateMap = new Map<string, string>();
  for (const o of scheduledOrders) {
    const pay = o.payload ?? {};
    const date = pay.preparationStartDateTime || pay.schedule_order?.date || null;
    if (date) orderDateMap.set(o.id, date.split("T")[0]);
  }
  const productDayMap = new Map<string, Map<string, number>>();
  for (const item of scheduledItems) {
    const day = orderDateMap.get(item.order_id);
    if (!day) continue;
    if (!productDayMap.has(item.product_id)) productDayMap.set(item.product_id, new Map());
    const dm = productDayMap.get(item.product_id)!;
    dm.set(day, (dm.get(day) ?? 0) + Number(item.quantidade));
  }

  const isConsumoAnota = (m: typeof movements[0], period: "hoje" | "semana" | "mes") => {
    if (m.tipo !== "saida" || m.destino !== "Anota AI") return false;
    const from = startOf(period);
    if (period === "hoje" && m.ref_order_id && ordensHoje.has(m.ref_order_id)) return true;
    return new Date(m.created_at) >= from;
  };
  const consumoDesde = (period: "hoje" | "semana" | "mes") => {
    return movements
      .filter((m) => isConsumoAnota(m, period))
      .reduce((s, m) => s + Number(m.quantidade), 0);
  };
  const producaoDesde = (period: "hoje" | "semana" | "mes") => {
    const from = startOf(period);
    return prodOrders
      .filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= from && o.kind === "producao")
      .reduce((s, o) => s + Number(o.quantidade_produzida ?? 0), 0);
  };

  // Chart: stock by top products
  const stockChart = [...products]
    .sort((a, b) => Number(b.quantidade_atual) - Number(a.quantidade_atual))
    .slice(0, 8)
    .map((p) => ({ nome: p.nome.length > 12 ? p.nome.slice(0, 12) + "…" : p.nome, estoque: Number(p.quantidade_atual) }));

  // Chart: last 7 days
  const dias: { dia: string; consumo: number; producao: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const consumo = movements
      .filter((m) => (m.tipo === "saida" || m.tipo === "perda") && new Date(m.created_at) >= d && new Date(m.created_at) < next)
      .reduce((s, m) => s + Number(m.quantidade), 0);
    const producao = prodOrders
      .filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= d && new Date(o.fim) < next)
      .reduce((s, o) => s + Number(o.quantidade_produzida ?? 0), 0);
    dias.push({ dia: d.toLocaleDateString("pt-BR", { weekday: "short" }), consumo, producao });
  }

  const statusPie = [
    { name: "Pendentes", value: ordensPendentes.length, color: "oklch(0.82 0.15 80)" },
    { name: "Em andamento", value: emProducao, color: "oklch(0.7 0.13 235)" },
    { name: "Concluídas", value: ordensConcluidas.length, color: "oklch(0.72 0.16 155)" },
  ].filter((s) => s.value > 0);

  const closeReport = () => { setReport(null); setAgendamentoReport(null); setForecastDrill(null); };

  const pStock = () => {
    const rows = products.map((p) => ({
      nome: p.nome,
      atual: Number(p.quantidade_atual),
      reservado: Number(p.quantidade_reservada),
      disponivel: Number(p.quantidade_atual) - Number(p.quantidade_reservada),
      minimo: Number(p.estoque_minimo),
      ideal: Number(p.estoque_ideal),
      situacao: Number(p.quantidade_atual) <= Number(p.estoque_minimo) ? "Abaixo do mín." : "OK",
    }));
    printStockReport(rows);
  };

  const pBelowMin = () => printBelowMinimumReport(produtosAbaixo.map((p) => ({ nome: p.nome, atual: Number(p.quantidade_atual), minimo: Number(p.estoque_minimo) })));

  const pConsumoHoje = () => {
    const rows = movements
      .filter((m) => isConsumoAnota(m, "hoje"))
      .map((m) => ({ produto: nm(m.product_id), quantidade: Number(m.quantidade), horario: fmtDateTime(m.created_at) }));
    printConsumptionReport("Consumo Hoje", rows);
  };

  const pOP = (title: string, list: typeof prodOrders) => {
    printProdOrdersReport(list.map((o) => ({
      numero: o.numero, item: nm(o.product_id ?? o.filling_id),
      tipo: o.kind + (o.tipo_massa ? ` · ${o.tipo_massa}` : ""),
      necessaria: Number(o.quantidade_necessaria),
      produzida: o.quantidade_produzida != null ? fmtNum(o.quantidade_produzida) : "—",
      prioridade: o.prioridade, status: o.status,
    })));
  };

  const pComprasPendentes = () => {
    printPurchaseOrdersReport(comprasPendentes.map((o) => ({
      numero: o.numero, insumo: nm(o.ingredient_id), fornecedor: nm(o.supplier_id),
      quantidade: Number(o.quantidade_necessaria), valor: String(o.preco_medio * o.quantidade_necessaria),
      prioridade: o.prioridade, status: o.status,
    })));
  };

  const pColabsTurno = () => printColabsTurnoReport(colabsTurno.map((c) => ({ nome: c.nome, cargo: c.cargo ?? "", turno: c.turno ?? "" })));

  const ProdTable = ({ list }: { list: typeof products }) => (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Produto</TableHead><TableHead className="text-right">Atual</TableHead>
        <TableHead className="text-right">Reservado</TableHead><TableHead className="text-right">Disponível</TableHead>
        <TableHead>Mínimo</TableHead><TableHead>Ideal</TableHead><TableHead>Situação</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {list.map((p) => {
          const disp = Number(p.quantidade_atual) - Number(p.quantidade_reservada);
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.nome}</TableCell>
              <TableCell className="text-right tabular">{fmtNum(p.quantidade_atual)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{fmtNum(p.quantidade_reservada)}</TableCell>
              <TableCell className="text-right tabular font-medium">{fmtNum(disp)}</TableCell>
              <TableCell>{fmtNum(p.estoque_minimo)}</TableCell>
              <TableCell>{fmtNum(p.estoque_ideal)}</TableCell>
              <TableCell><StockBadge level={stockLevel(Number(p.quantidade_atual), Number(p.estoque_minimo), Number(p.estoque_ideal))} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  // Reusable dialog for any report
  const ReportDialog = ({ title, table, onPrint }: NonNullable<ReportDialog>) => (
    <Dialog open={true} onOpenChange={(o) => !o && closeReport()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{title}</DialogTitle>
            <Button variant="outline" size="sm" onClick={onPrint}>
              <Printer className="mr-1.5 size-4" /> Imprimir / PDF
            </Button>
          </div>
        </DialogHeader>
        <div className="overflow-x-auto">{table}</div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel de Controle"
        subtitle={lastSync ? `Última sincronização Anota AI: ${fmtDateTime(lastSync)} — Clique nos cards para ver detalhes` : "Clique nos cards para ver detalhes"}
        icon={LayoutDashboard}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Estoque de salgados" value={fmtNum(verAgendados ? estoqueTotal - totalScheduledImpact : estoqueTotal)} hint={verAgendados ? `${fmtNum(totalScheduledImpact)} unidades em agendamentos` : "unidades em estoque"} icon={Boxes} tone={verAgendados ? "warning" : "default"}
          onClick={() => setReport({ title: "Estoque de Salgados", table: <ProdTable list={products} />, onPrint: pStock })} />
        <KpiCard label="Estoque projetado" value={fmtNum(projetado)} hint={`+${fmtNum(producaoAberta)} produção -${fmtNum(totalScheduledImpact)} agendados`} icon={PackageCheck} tone="info"
          onClick={() => {
            const rows = products
              .map((p) => ({
                id: p.id,
                nome: p.nome,
                atual: Number(p.quantidade_atual),
                producao: prodOrders
                  .filter((o) => (o.product_id === p.id || o.filling_id === p.id) && (o.status === "pendente" || o.status === "em_andamento"))
                  .reduce((s, o) => s + Number(o.quantidade_necessaria ?? 0), 0),
                agendado: scheduledImpact.get(p.id) ?? 0,
              }))
              .map((r) => ({ ...r, projetado: r.atual + r.producao - r.agendado }));
            setReport({
              title: "Estoque Projetado",
              table: (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Clique em um produto para ver a previsão de saída dos próximos 7 dias.</p>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Produto</th>
                        <th className="px-3 py-2 text-right">Atual</th>
                        <th className="px-3 py-2 text-right">Produção</th>
                        <th className="px-3 py-2 text-right">Agendado</th>
                        <th className="px-3 py-2 text-right">Projetado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setForecastDrill({ nome: r.nome, productId: r.id })}>
                          <td className="px-3 py-2 font-medium underline-offset-2 hover:underline">{r.nome}</td>
                          <td className="px-3 py-2 text-right tabular">{fmtNum(r.atual)}</td>
                          <td className="px-3 py-2 text-right tabular text-info">{fmtNum(r.producao)}</td>
                          <td className="px-3 py-2 text-right tabular text-destructive">{fmtNum(r.agendado)}</td>
                          <td className="px-3 py-2 text-right tabular font-semibold">{fmtNum(r.projetado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
              onPrint: () => printReport("Estoque Projetado", rows.map((r) => ({ ...r, atual: String(r.atual), producao: String(r.producao), agendado: String(r.agendado), projetado: String(r.projetado) })), [
                { key: "nome", label: "Produto" },
                { key: "atual", label: "Atual" },
                { key: "producao", label: "Produção" },
                { key: "agendado", label: "Agendado" },
                { key: "projetado", label: "Projetado" },
              ]),
            });
          }} />
        <KpiCard label="Produtos abaixo do mín." value={fmtNum(produtosAbaixo.length)} hint="requer produção" icon={AlertTriangle} tone={produtosAbaixo.length ? "danger" : "success"}
          onClick={() => setReport({
            title: "Produtos Abaixo do Mínimo",
            table: produtosAbaixo.length
              ? <Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Atual</TableHead><TableHead className="text-right">Mínimo</TableHead></TableRow></TableHeader><TableBody>{produtosAbaixo.map((p) => (<TableRow key={p.id}><TableCell className="font-medium">{p.nome}</TableCell><TableCell className="text-right tabular text-destructive">{fmtNum(p.quantidade_atual)}</TableCell><TableCell className="text-right tabular">{fmtNum(p.estoque_minimo)}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhum produto abaixo do mínimo.</p>,
            onPrint: pBelowMin,
          })} />
        <KpiCard label="Insumos abaixo do mín." value={fmtNum(insumosAbaixo.length)} hint="requer compra" icon={Warehouse} tone={insumosAbaixo.length ? "danger" : "success"}
          onClick={() => setReport({
            title: "Insumos Abaixo do Mínimo",
            table: insumosAbaixo.length
              ? <Table><TableHeader><TableRow><TableHead>Insumo</TableHead><TableHead className="text-right">Atual</TableHead><TableHead className="text-right">Mínimo</TableHead></TableRow></TableHeader><TableBody>{insumosAbaixo.map((i) => (<TableRow key={i.id}><TableCell className="font-medium">{i.nome}</TableCell><TableCell className="text-right tabular text-destructive">{fmtNum(i.quantidade_atual)}</TableCell><TableCell className="text-right tabular">{fmtNum(i.estoque_minimo)}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhum insumo abaixo do mínimo.</p>,
            onPrint: () => {}, // no dedicated print for ingredients yet
          })} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Pedidos agendados" value={fmtNum(scheduledOrders?.length ?? 0)} hint={`${fmtNum(totalScheduledImpact)} itens no total`} icon={CalendarDays} tone="info"
          action={<div onClick={(e) => e.stopPropagation()}><Switch checked={verAgendados} onCheckedChange={setVerAgendados} /></div>}
          onClick={() => {
            if (!scheduledOrders?.length) return;
            const rows = products
              .map((p) => ({
                id: p.id,
                produto: p.nome,
                atual: Number(p.quantidade_atual),
                impacto: scheduledImpact.get(p.id) ?? 0,
                saldo: Number(p.quantidade_atual) - (scheduledImpact.get(p.id) ?? 0),
              }))
              .filter((r) => r.impacto > 0);
            setAgendamentoReport({
              title: "Pedidos Agendados — Impacto no Estoque",
              table: (
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Impacto por produto</h4>
                    <p className="mb-2 text-xs text-muted-foreground">Clique em um produto para ver a previsão de saída dos próximos 7 dias.</p>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Estoque atual</th><th className="px-3 py-2 text-right">Agendado</th><th className="px-3 py-2 text-right">Saldo final</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r, i) => (
                          <tr key={i} className="hover:bg-muted/30 cursor-pointer" onClick={() => setForecastDrill({ nome: r.produto, productId: r.id })}>
                            <td className="px-3 py-2 font-medium underline-offset-2 hover:underline">{r.produto}</td>
                            <td className="px-3 py-2 text-right tabular">{fmtNum(r.atual)}</td>
                            <td className="px-3 py-2 text-right tabular text-destructive">{fmtNum(r.impacto)}</td>
                            <td className="px-3 py-2 text-right tabular font-semibold">{fmtNum(r.saldo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Pedidos agendados</h4>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Data/Hora</th><th className="px-3 py-2 text-right">Total</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(scheduledOrders ?? []).map((o: any, i: number) => {
                          const pay = o.payload ?? {};
                          const prepDate = pay.preparationStartDateTime || pay.schedule_order?.date || null;
                          const orderItems = (scheduledItems ?? []).filter((it: any) => it.order_id === o.id);
                          return (
                            <tr key={o.id || i}>
                              <td className="px-3 py-2 font-medium">{o.cliente ?? "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{prepDate ? fmtDateTime(prepDate) : "—"}</td>
                              <td className="px-3 py-2 text-right tabular">{fmtMoney(o.total)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
              onPrint: () => printReport("Pedidos Agendados — Impacto no Estoque", rows.map((r) => ({ ...r, atual: String(r.atual), impacto: String(r.impacto), saldo: String(r.saldo) })), [
                { key: "produto", label: "Produto" },
                { key: "atual", label: "Estoque atual" },
                { key: "impacto", label: "Agendado" },
                { key: "saldo", label: "Saldo final" },
              ]),
            });
          }}
        />
        <KpiCard label="OP pendentes" value={fmtNum(ordensPendentes.length)} icon={ClipboardList} tone="warning"
          onClick={() => setReport({
            title: "Ordens de Produção Pendentes",
            table: ordensPendentes.length
              ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Necessário</TableHead><TableHead>Prioridade</TableHead></TableRow></TableHeader><TableBody>{ordensPendentes.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_necessaria)}</TableCell><TableCell>{o.prioridade}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhuma OP pendente.</p>,
            onPrint: () => pOP("OP Pendentes", ordensPendentes),
          })} />
        <KpiCard label="OP em andamento" value={fmtNum(emProducao)} icon={Factory} tone="info"
          onClick={() => setReport({
            title: "Ordens em Andamento",
            table: ordensAndamento.length
              ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Necessário</TableHead><TableHead>Prioridade</TableHead></TableRow></TableHeader><TableBody>{ordensAndamento.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_necessaria)}</TableCell><TableCell>{o.prioridade}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhuma OP em andamento.</p>,
            onPrint: () => pOP("OP em Andamento", ordensAndamento),
          })} />
        <KpiCard label="OP concluídas" value={fmtNum(ordensConcluidas.length)} icon={PackageCheck} tone="success"
          onClick={() => setReport({
            title: "Ordens Concluídas",
            table: ordensConcluidas.length
              ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Produzido</TableHead></TableRow></TableHeader><TableBody>{ordensConcluidas.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_produzida ?? 0)}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhuma OP concluída.</p>,
            onPrint: () => pOP("OP Concluídas", ordensConcluidas),
          })} />
        <KpiCard label="Compras pendentes" value={fmtNum(comprasPendentes.length)} icon={ShoppingCart} tone="warning"
          onClick={() => setReport({
            title: "Compras Pendentes",
            table: comprasPendentes.length
              ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Insumo</TableHead><TableHead className="text-right">Necessário</TableHead><TableHead>Prioridade</TableHead></TableRow></TableHeader><TableBody>{comprasPendentes.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.ingredient_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_necessaria, 2)}</TableCell><TableCell>{o.prioridade}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhuma compra pendente.</p>,
            onPrint: pComprasPendentes,
          })} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Produzido hoje" value={fmtNum(producaoDesde("hoje"))} hint="unidades" icon={Factory} tone="success"
          onClick={() => setReport({
            title: "Produção de Hoje",
            table: (() => {
              const from = startOf("hoje");
              const hoje = prodOrders.filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= from && o.kind === "producao");
              return hoje.length
                ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Produzido</TableHead></TableRow></TableHeader><TableBody>{hoje.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_produzida ?? 0)}</TableCell></TableRow>))}</TableBody></Table>
                : <p className="py-8 text-center text-muted-foreground">Nada produzido hoje.</p>;
            })(),
            onPrint: () => pOP("Produzido Hoje", prodOrders.filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= startOf("hoje") && o.kind === "producao")),
          })} />
        <KpiCard label="Produzido na semana" value={fmtNum(producaoDesde("semana"))} icon={Factory} tone="success"
          onClick={() => setReport({
            title: "Produção da Semana",
            table: (() => {
              const from = startOf("semana");
              const week = prodOrders.filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= from && o.kind === "producao");
              return week.length
                ? <Table><TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Produzido</TableHead></TableRow></TableHeader><TableBody>{week.map((o) => (<TableRow key={o.id}><TableCell className="tabular font-medium">#{o.numero}</TableCell><TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(o.quantidade_produzida ?? 0)}</TableCell></TableRow>))}</TableBody></Table>
                : <p className="py-8 text-center text-muted-foreground">Nada produzido na semana.</p>;
            })(),
            onPrint: () => pOP("Produzido na Semana", prodOrders.filter((o) => o.status === "concluida" && o.fim && new Date(o.fim) >= startOf("semana") && o.kind === "producao")),
          })} />
        <KpiCard label="Consumo hoje" value={fmtNum(consumoDesde("hoje"))} hint="produção Anota AI" icon={TrendingDown} tone="danger"
          onClick={() => setReport({
            title: "Consumo Hoje",
            table: (() => {
              const hoje = movements.filter((m) => isConsumoAnota(m, "hoje"));
              return hoje.length
                ? <Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead>Horário</TableHead></TableRow></TableHeader><TableBody>{hoje.map((m, i) => (<TableRow key={m.id || i}><TableCell className="font-medium">{nm(m.product_id)}</TableCell><TableCell className="text-right tabular">{fmtNum(m.quantidade)}</TableCell><TableCell className="text-xs text-muted-foreground">{fmtDateTime(m.created_at)}</TableCell></TableRow>))}</TableBody></Table>
                : <p className="py-8 text-center text-muted-foreground">Nenhum consumo hoje.</p>;
            })(),
            onPrint: pConsumoHoje,
          })} />
        <KpiCard label="Colaboradores em turno" value={fmtNum(colabsTurno.length)} icon={Users} tone="info"
          onClick={() => setReport({
            title: "Colaboradores em Turno",
            table: colabsTurno.length
              ? <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>Turno</TableHead></TableRow></TableHeader><TableBody>{colabsTurno.map((c) => (<TableRow key={c.id}><TableCell className="font-medium">{c.nome}</TableCell><TableCell>{c.cargo || "—"}</TableCell><TableCell>{c.turno || "—"}</TableCell></TableRow>))}</TableBody></Table>
              : <p className="py-8 text-center text-muted-foreground">Nenhum colaborador em turno.</p>,
            onPrint: pColabsTurno,
          })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="mb-4 font-display text-base font-semibold">Produção x Consumo (7 dias)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dias}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.31 0.012 265)" vertical={false} />
              <XAxis dataKey="dia" stroke="oklch(0.7 0.02 265)" fontSize={12} />
              <YAxis stroke="oklch(0.7 0.02 265)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.23 0.011 265)",
                  border: "1px solid oklch(0.31 0.012 265)",
                  borderRadius: 8,
                  color: "oklch(0.97 0.003 265)",
                }}
              />
              <Legend />
              <Bar dataKey="producao" name="Produção" fill="oklch(0.72 0.16 155)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="consumo" name="Consumo" fill="oklch(0.79 0.16 68)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-display text-base font-semibold">Ordens de Produção</h3>
          {statusPie.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                  {statusPie.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.23 0.011 265)",
                    border: "1px solid oklch(0.31 0.012 265)",
                    borderRadius: 8,
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Nenhuma ordem registrada.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 font-display text-base font-semibold">Estoque por produto</h3>
        {stockChart.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stockChart} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.31 0.012 265)" horizontal={false} />
              <XAxis type="number" stroke="oklch(0.7 0.02 265)" fontSize={12} />
              <YAxis type="category" dataKey="nome" stroke="oklch(0.7 0.02 265)" fontSize={12} width={90} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.23 0.011 265)",
                  border: "1px solid oklch(0.31 0.012 265)",
                  borderRadius: 8,
                }}
                cursor={{ fill: "oklch(0.33 0.015 265)" }}
              />
              <Bar dataKey="estoque" name="Estoque" fill="oklch(0.79 0.16 68)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">Cadastre produtos para ver o estoque.</p>
        )}
      </div>

      {report && <ReportDialog {...report} />}
      {agendamentoReport && <ReportDialog {...agendamentoReport} />}
      <Dialog open={!!forecastDrill} onOpenChange={(o) => !o && setForecastDrill(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Previsão 7 dias — {forecastDrill?.nome}</DialogTitle>
              <Button variant="outline" size="sm" onClick={() => {
                if (!forecastDrill) return;
                const dm = productDayMap.get(forecastDrill.productId);
                const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
                const dias: { label: string; qtd: number }[] = [];
                for (let i = 0; i < 7; i++) {
                  const d = new Date(hoje); d.setDate(d.getDate() + i);
                  const key = d.toISOString().split("T")[0];
                  dias.push({
                    label: d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }),
                    qtd: dm?.get(key) ?? 0,
                  });
                }
                const total = dias.reduce((s, d) => s + d.qtd, 0);
                printHTML(`
                  <h2 style="font-size:16px;font-weight:700;margin-bottom:16px">Previsão 7 dias — ${forecastDrill.nome}</h2>
                  <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead><tr style="background:#f5f5f4;text-align:left">
                      <th style="padding:8px 10px">Dia</th>
                      <th style="padding:8px 10px;text-align:right">Qtd agendada</th>
                    </tr></thead>
                    <tbody>
                      ${dias.map((d) => `<tr style="border-bottom:1px solid #eee">
                        <td style="padding:8px 10px;font-weight:500">${d.label}</td>
                        <td style="padding:8px 10px;text-align:right">${d.qtd ? fmtNum(d.qtd) : "—"}</td>
                      </tr>`).join("")}
                    </tbody>
                    <tfoot><tr style="font-weight:700;border-top:2px solid #333">
                      <td style="padding:8px 10px">Total</td>
                      <td style="padding:8px 10px;text-align:right">${fmtNum(total)}</td>
                    </tr></tfoot>
                  </table>
                `);
              }}>
                <Printer className="mr-1.5 size-4" /> Imprimir / PDF
              </Button>
            </div>
          </DialogHeader>
          {forecastDrill && (() => {
            const dm = productDayMap.get(forecastDrill.productId);
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const dias: { label: string; qtd: number }[] = [];
            for (let i = 0; i < 7; i++) {
              const d = new Date(hoje); d.setDate(d.getDate() + i);
              const key = d.toISOString().split("T")[0];
              dias.push({
                label: d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }),
                qtd: dm?.get(key) ?? 0,
              });
            }
            const total = dias.reduce((s, d) => s + d.qtd, 0);
            return (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Dia</th>
                    <th className="px-3 py-2 text-right">Qtd agendada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dias.map((d, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium">{d.label}</td>
                      <td className="px-3 py-2 text-right tabular">{d.qtd ? fmtNum(d.qtd) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-foreground font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular">{fmtNum(total)}</td>
                  </tr>
                </tfoot>
              </table>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
