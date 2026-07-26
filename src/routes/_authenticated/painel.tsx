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
  CalendarClock,
} from "lucide-react";
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
import { fmtNum, fmtDateTime, stockLevel } from "@/lib/format";
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

  useEffect(() => {
    const unsub = onSync((ts) => setLastSync(ts));
    return unsub;
  }, []);

  useRealtime(
    ["products", "ingredients", "production_orders", "purchase_orders", "product_movements", "anota_orders"],
    ["dashboard"],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [products, ingredients, prodOrders, purchOrders, movements, collabs, agendados] = await Promise.all([
        supabase.from("products").select("id, nome, quantidade_atual, quantidade_reservada, estoque_minimo, estoque_ideal").is("deleted_at", null),
        supabase.from("ingredients").select("id, nome, quantidade_atual, estoque_minimo, unidade").is("deleted_at", null),
        supabase.from("production_orders").select("id, numero, kind, status, quantidade_necessaria, quantidade_produzida, quantidade_ideal, massadas, tipo_massa, prioridade, product_id, filling_id, fim, created_at").is("deleted_at", null),
        supabase.from("purchase_orders").select("id, numero, status, prioridade, quantidade_necessaria, preco_medio, ingredient_id, supplier_id, observacoes, created_at").is("deleted_at", null),
        supabase.from("product_movements").select("id, product_id, tipo, quantidade, created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("collaborators").select("id, nome, cargo, turno, em_turno").is("deleted_at", null),
        supabase.from("anota_orders").select("id, numero, external_order_id, cliente, data_agendada, check_status").eq("agendado", true).is("data_agendada", "not", null).order("data_agendada", { ascending: true }),
      ]);
      const [pnames, inames, fnames, snames] = await Promise.all([
        supabase.from("products").select("id, nome"),
        supabase.from("ingredients").select("id, nome"),
        supabase.from("fillings").select("id, nome"),
        supabase.from("suppliers").select("id, nome"),
      ]);

      // Buscar itens dos pedidos agendados
      const agendadosIds = (agendados.data ?? []).map((a: { id: string }) => a.id);
      let agendadoItems: { nome: string | null; quantidade: number; mapeado: boolean; product_id: string | null; order_id: string }[] = [];
      if (agendadosIds.length > 0) {
        const { data: items } = await supabase
          .from("anota_order_items")
          .select("nome, quantidade, mapeado, product_id, order_id")
          .in("order_id", agendadosIds);
        agendadoItems = (items ?? []) as typeof agendadoItems;
      }

      return {
        products: products.data ?? [],
        ingredients: ingredients.data ?? [],
        prodOrders: prodOrders.data ?? [],
        purchOrders: purchOrders.data ?? [],
        movements: movements.data ?? [],
        collabs: collabs.data ?? [],
        agendados: agendados.data ?? [],
        agendadoItems,
        names: {
          ...Object.fromEntries((pnames.data ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome])),
          ...Object.fromEntries((inames.data ?? []).map((i: { id: string; nome: string }) => [i.id, i.nome])),
          ...Object.fromEntries((fnames.data ?? []).map((f: { id: string; nome: string }) => [f.id, f.nome])),
          ...Object.fromEntries((snames.data ?? []).map((s: { id: string; nome: string }) => [s.id, s.nome])),
        } as Record<string, string>,
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

  const { products, ingredients, prodOrders, purchOrders, movements, collabs, names, agendados, agendadoItems } = data;

  const nm = (id: string | null | undefined) => (id && names[id]) || "—";

  const estoqueTotal = products.reduce((s, p) => s + Number(p.quantidade_atual), 0);
  const produtosAbaixo = products.filter((p) => p.estoque_minimo > 0 && Number(p.quantidade_atual) <= Number(p.estoque_minimo));
  const insumosAbaixo = ingredients.filter((i) => i.estoque_minimo > 0 && Number(i.quantidade_atual) <= Number(i.estoque_minimo));

  // Pedidos agendados
  const agendadoCount = agendados.length;
  const agendadoTotalItens = (agendadoItems ?? []).reduce((s, i) => s + Number(i.quantidade), 0);
  const produtosComImpacto = [...new Set((agendadoItems ?? []).filter((i) => i.mapeado).map((i) => i.product_id))].filter(Boolean).length;

  const ordensPendentes = prodOrders.filter((o) => o.status === "pendente");
  const ordensAndamento = prodOrders.filter((o) => o.status === "em_andamento");
  const ordensConcluidas = prodOrders.filter((o) => o.status === "concluida");
  const comprasPendentes = purchOrders.filter((o) => o.status === "pendente");
  const colabsTurno = collabs.filter((c) => c.em_turno);
  const emProducao = ordensAndamento.length;

  const projetado = estoqueTotal + prodOrders
    .filter((o) => o.status === "pendente" || o.status === "em_andamento")
    .reduce((s) => s, 0);

  const consumoDesde = (period: "hoje" | "semana" | "mes") => {
    const from = startOf(period);
    return movements
      .filter((m) => (m.tipo === "saida" || m.tipo === "perda") && new Date(m.created_at) >= from)
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

  const closeReport = () => setReport(null);

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
    const from = startOf("hoje");
    const rows = movements
      .filter((m) => (m.tipo === "saida" || m.tipo === "perda") && new Date(m.created_at) >= from)
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
        <KpiCard label="Estoque de salgados" value={fmtNum(estoqueTotal)} hint="unidades em estoque" icon={Boxes}
          onClick={() => setReport({ title: "Estoque de Salgados", table: <ProdTable list={products} />, onPrint: pStock })} />
        <KpiCard label="Estoque projetado" value={fmtNum(projetado)} hint="com ordens abertas" icon={PackageCheck} tone="info"
          onClick={() => setReport({ title: "Estoque Projetado", table: <ProdTable list={products} />, onPrint: pStock })} />
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
        <KpiCard label="Consumo hoje" value={fmtNum(consumoDesde("hoje"))} hint="saídas + perdas" icon={TrendingDown} tone="danger"
          onClick={() => setReport({
            title: "Consumo Hoje",
            table: (() => {
              const from = startOf("hoje");
              const hoje = movements.filter((m) => (m.tipo === "saida" || m.tipo === "perda") && new Date(m.created_at) >= from);
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

      {/* Pedidos agendados */}
      {agendadoCount > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">
              <CalendarClock className="mr-2 inline size-5 text-warning" />
              Pedidos Agendados ({agendadoCount})
            </h3>
            <span className="text-sm text-muted-foreground">
              {fmtNum(agendadoTotalItens)} itens · {produtosComImpacto} produto(s) com impacto
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Data agendada</TableHead>
                  <TableHead className="text-right">Total itens</TableHead>
                  <TableHead>Itens / Impacto no estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agendados.map((o: { id: string; numero: string | null; external_order_id: string; cliente: string | null; data_agendada: string | null }) => {
                  const orderItems = (agendadoItems ?? []).filter((i) => i.order_id === o.id);
                  const mappedItems = orderItems.filter((i) => i.mapeado);
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium tabular-nums">{o.numero ?? o.external_order_id.slice(-6)}</TableCell>
                      <TableCell className="text-muted-foreground">{o.cliente ?? "—"}</TableCell>
                      <TableCell>{o.data_agendada ? new Date(o.data_agendada).toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(orderItems.reduce((s: number, i: { quantidade: number }) => s + Number(i.quantidade), 0))}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {mappedItems.length > 0 ? mappedItems.slice(0, 5).map((it: { nome: string | null; quantidade: number }, idx: number) => (
                            <span key={idx} className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs text-warning">
                              {it.nome ?? "?"} ×{it.quantidade}
                            </span>
                          )) : <span className="text-xs text-muted-foreground">Nenhum item mapeado</span>}
                          {mappedItems.length > 5 && (
                            <span className="text-xs text-muted-foreground">+{mappedItems.length - 5} mais</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

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
    </div>
  );
}
