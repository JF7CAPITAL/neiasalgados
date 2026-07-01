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
import { fmtNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/painel")({
  component: DashboardPage,
});

function startOf(period: "hoje" | "semana" | "mes"): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "semana") d.setDate(d.getDate() - 6);
  if (period === "mes") d.setDate(1);
  return d;
}

function DashboardPage() {
  useRealtime(
    ["products", "ingredients", "production_orders", "purchase_orders", "product_movements"],
    ["dashboard"],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [products, ingredients, prodOrders, purchOrders, movements, collabs] = await Promise.all([
        supabase.from("products").select("id, nome, quantidade_atual, estoque_minimo, estoque_ideal").is("deleted_at", null),
        supabase.from("ingredients").select("id, quantidade_atual, estoque_minimo").is("deleted_at", null),
        supabase.from("production_orders").select("id, status, quantidade_produzida, fim, kind").is("deleted_at", null),
        supabase.from("purchase_orders").select("id, status").is("deleted_at", null),
        supabase.from("product_movements").select("id, tipo, quantidade, created_at, product_id").order("created_at", { ascending: false }).limit(500),
        supabase.from("collaborators").select("id, em_turno").is("deleted_at", null),
      ]);
      return {
        products: products.data ?? [],
        ingredients: ingredients.data ?? [],
        prodOrders: prodOrders.data ?? [],
        purchOrders: purchOrders.data ?? [],
        movements: movements.data ?? [],
        collabs: collabs.data ?? [],
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

  const { products, ingredients, prodOrders, purchOrders, movements, collabs } = data;

  const estoqueTotal = products.reduce((s, p) => s + Number(p.quantidade_atual), 0);
  const emProducao = prodOrders
    .filter((o) => o.status === "em_andamento")
    .length;
  const projetado =
    estoqueTotal +
    prodOrders
      .filter((o) => o.status === "pendente" || o.status === "em_andamento")
      .reduce((s) => s, 0);

  const produtosAbaixo = products.filter((p) => p.estoque_minimo > 0 && p.quantidade_atual <= p.estoque_minimo).length;
  const insumosAbaixo = ingredients.filter((i) => i.estoque_minimo > 0 && i.quantidade_atual <= i.estoque_minimo).length;

  const ordensPendentes = prodOrders.filter((o) => o.status === "pendente").length;
  const ordensAndamento = emProducao;
  const ordensConcluidas = prodOrders.filter((o) => o.status === "concluida").length;
  const comprasPendentes = purchOrders.filter((o) => o.status === "pendente").length;
  const colabsTurno = collabs.filter((c) => c.em_turno).length;

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

  // Chart: last 7 days consumption
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
    { name: "Pendentes", value: ordensPendentes, color: "oklch(0.82 0.15 80)" },
    { name: "Em andamento", value: ordensAndamento, color: "oklch(0.7 0.13 235)" },
    { name: "Concluídas", value: ordensConcluidas, color: "oklch(0.72 0.16 155)" },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel de Controle"
        subtitle="Indicadores da fábrica em tempo real"
        icon={LayoutDashboard}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Estoque de salgados" value={fmtNum(estoqueTotal)} hint="unidades em estoque" icon={Boxes} />
        <KpiCard label="Estoque projetado" value={fmtNum(projetado)} hint="com ordens abertas" icon={PackageCheck} tone="info" />
        <KpiCard label="Produtos abaixo do mín." value={fmtNum(produtosAbaixo)} hint="requer produção" icon={AlertTriangle} tone={produtosAbaixo ? "danger" : "success"} />
        <KpiCard label="Insumos abaixo do mín." value={fmtNum(insumosAbaixo)} hint="requer compra" icon={Warehouse} tone={insumosAbaixo ? "danger" : "success"} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="OP pendentes" value={fmtNum(ordensPendentes)} icon={ClipboardList} tone="warning" />
        <KpiCard label="OP em andamento" value={fmtNum(ordensAndamento)} icon={Factory} tone="info" />
        <KpiCard label="OP concluídas" value={fmtNum(ordensConcluidas)} icon={PackageCheck} tone="success" />
        <KpiCard label="Compras pendentes" value={fmtNum(comprasPendentes)} icon={ShoppingCart} tone="warning" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Produzido hoje" value={fmtNum(producaoDesde("hoje"))} hint="unidades" icon={Factory} tone="success" />
        <KpiCard label="Produzido na semana" value={fmtNum(producaoDesde("semana"))} icon={Factory} tone="success" />
        <KpiCard label="Consumo hoje" value={fmtNum(consumoDesde("hoje"))} hint="saídas + perdas" icon={TrendingDown} tone="danger" />
        <KpiCard label="Colaboradores em turno" value={fmtNum(colabsTurno)} icon={Users} tone="info" />
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
    </div>
  );
}
