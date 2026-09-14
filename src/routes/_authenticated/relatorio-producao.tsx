import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Printer,
  FileSpreadsheet,
  FileDown,
  TrendingUp,
  TrendingDown,
  Minus,
  PackageOpen,
  Factory,
  Warehouse,
  UtensilsCrossed,
  AlertTriangle,
  Loader2,
  HardDriveDownload,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, hasAccess } from "@/lib/auth";
import { fmtNum, fmtDateTime } from "@/lib/format";
import { downloadCSV, downloadExcel, printProductionReport, type ReportSection } from "@/lib/export";
import {
  getRetentionStatus,
  fetchArchivableRecords,
  purgeOldRecords,
} from "@/lib/retention.functions";
import { PageHeader, KpiCard } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/relatorio-producao")({
  component: RelatorioProducaoPage,
});

type Movement = {
  id: string;
  quantidade: number;
  created_at: string;
  tipo: string;
};
type ProdMovement = Movement & { product_id: string };
type IngMovement = Movement & { ingredient_id: string };
type FilMovement = Movement & { filling_id: string };

function dayStr(d: string) {
  return new Date(d).toLocaleDateString("pt-BR");
}

function RelatorioProducaoPage() {
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 29);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [from, setFrom] = useState(iso(monthAgo));
  const [to, setTo] = useState(iso(today));

  const fromTs = new Date(`${from}T00:00:00-03:00`).toISOString();
  const toTs = new Date(`${to}T23:59:59.999-03:00`).toISOString();

  const setPreset = (days: number | "month") => {
    const end = new Date();
    const start = new Date();
    if (days === "month") {
      start.setDate(1);
    } else {
      start.setDate(end.getDate() - (days - 1));
    }
    setFrom(iso(start));
    setTo(iso(end));
  };

  const { data: names } = useQuery({
    queryKey: ["report-names-all"],
    queryFn: async () => {
      const [p, i, f] = await Promise.all([
        supabase.from("products").select("id, nome"),
        supabase.from("ingredients").select("id, nome, unidade"),
        supabase.from("fillings").select("id, nome, unidade"),
      ]);
      const products = Object.fromEntries((p.data ?? []).map((x) => [x.id, x.nome]));
      const ingredients = Object.fromEntries((i.data ?? []).map((x) => [x.id, { nome: x.nome, un: x.unidade }]));
      const fillings = Object.fromEntries((f.data ?? []).map((x) => [x.id, { nome: x.nome, un: x.unidade }]));
      return { products, ingredients, fillings };
    },
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["report-data", from, to],
    queryFn: async () => {
      const [pm, im, fm, anotaOrdersRes, prodConcluidasRes] = await Promise.all([
        supabase
          .from("product_movements")
          .select("id, product_id, quantidade, created_at, tipo")
          .gte("created_at", fromTs)
          .lte("created_at", toTs)
          .in("tipo", ["saida", "entrada"])
          .order("created_at", { ascending: true }),
        supabase
          .from("ingredient_movements")
          .select("id, ingredient_id, quantidade, created_at, tipo")
          .gte("created_at", fromTs)
          .lte("created_at", toTs)
          .eq("tipo", "saida"),
        supabase
          .from("filling_movements")
          .select("id, filling_id, quantidade, created_at, tipo")
          .gte("created_at", fromTs)
          .lte("created_at", toTs)
          .eq("tipo", "saida"),
        supabase
          .from("anota_orders")
          .select("id, pedido_em, imported_at, created_at, check_status")
          .eq("check_status", 3)
          .gte("imported_at", fromTs)
          .lte("imported_at", toTs),
        supabase
          .from("production_orders")
          .select("id, product_id, quantidade_produzida, quantidade_necessaria, created_at, fim, status, kind")
          .eq("status", "concluida")
          .eq("kind", "producao")
          .is("deleted_at", null)
          .gte("fim", fromTs)
          .lte("fim", toTs),
      ]);

      // Inclui também concluídas sem fim preenchido (fallback por created_at)
      let prodConcluidas = (prodConcluidasRes.data ?? []) as any[];
      {
        const extra = await supabase
          .from("production_orders")
          .select("id, product_id, quantidade_produzida, quantidade_necessaria, created_at, fim, status, kind")
          .eq("status", "concluida")
          .eq("kind", "producao")
          .is("deleted_at", null)
          .is("fim", null)
          .gte("created_at", fromTs)
          .lte("created_at", toTs);
        if (extra.data?.length) prodConcluidas = [...prodConcluidas, ...((extra.data ?? []) as any[])];
      }

      let anotaItems: { product_id: string | null; quantidade: number; order_id: string }[] = [];
      const anotaIds = (anotaOrdersRes.data ?? []).map((o: any) => o.id);
      if (anotaIds.length > 0) {
        // Supabase limita IN a muitos ids; paginação se necessário mas período curto raramente passa de 200
        const chunkSize = 200;
        const allItems: typeof anotaItems = [];
        for (let i = 0; i < anotaIds.length; i += chunkSize) {
          const chunk = anotaIds.slice(i, i + chunkSize);
          const r = await supabase
            .from("anota_order_items")
            .select("product_id, quantidade, order_id")
            .in("order_id", chunk)
            .not("product_id", "is", null);
          if (r.data) allItems.push(...(r.data as typeof anotaItems));
        }
        anotaItems = allItems;
      }

      return {
        product: (pm.data ?? []) as ProdMovement[],
        ingredient: (im.data ?? []) as IngMovement[],
        filling: (fm.data ?? []) as FilMovement[],
        anotaOrders: (anotaOrdersRes.data ?? []) as { id: string; pedido_em: string | null; imported_at: string; created_at: string; check_status: number }[],
        anotaItems,
        prodConcluidas: prodConcluidas as { id: string; product_id: string | null; quantidade_produzida: number | null; quantidade_necessaria: number; created_at: string; fim: string | null; status: string; kind: string }[],
      };
    },
  });

  const report = useMemo(() => {
    const ing = data?.ingredient ?? [];
    const fil = data?.filling ?? [];
    const pn = names?.products ?? {};
    const inm = names?.ingredients ?? {};
    const fln = names?.fillings ?? {};
    const anotaOrders = data?.anotaOrders ?? [];
    const anotaItems = data?.anotaItems ?? [];
    const prodConcluidas = data?.prodConcluidas ?? [];

    // Mapa order_id -> data/hora para horarios e série diária de saídas (pedidos finalizados)
    const orderDateMap = new Map<string, string>();
    for (const o of anotaOrders) {
      const d = (o as any).pedido_em || (o as any).imported_at || (o as any).created_at;
      if (d) orderDateMap.set(o.id, d);
    }

    // Cards principais: salgados que saíram = pedidos Anota finalizados (check_status=3); Produzido = OPs concluídas
    const totalSaido = anotaItems.reduce((s, it) => s + Number(it.quantidade ?? 0), 0);
    const totalProduzido = prodConcluidas.reduce((s, o) => s + Number((o.quantidade_produzida ?? o.quantidade_necessaria ?? 0) as number), 0);
    const totalInsumos = ing.reduce((s, m) => s + Number(m.quantidade), 0);
    const totalRecheio = fil.reduce((s, m) => s + Number(m.quantidade), 0);

    // Por produto: saído via anotaItems (finalizados), produzido via OPs concluídas
    const byProduct = new Map<string, { saido: number; produzido: number; horarios: string[] }>();
    const ensure = (id: string) => {
      if (!byProduct.has(id)) byProduct.set(id, { saido: 0, produzido: 0, horarios: [] });
      return byProduct.get(id)!;
    };
    for (const it of anotaItems) {
      if (!it.product_id) continue;
      const e = ensure(it.product_id);
      e.saido += Number(it.quantidade);
      const d = orderDateMap.get(it.order_id);
      if (d) e.horarios.push(fmtDateTime(d));
    }
    for (const o of prodConcluidas) {
      if (!o.product_id) continue;
      ensure(o.product_id).produzido += Number(o.quantidade_produzida ?? o.quantidade_necessaria ?? 0);
    }
    const products = [...byProduct.entries()]
      .map(([id, v]) => ({ nome: pn[id] ?? "—", ...v }))
      .sort((a, b) => b.saido - a.saido);

    // Série diária: saida = finalizados por dia (pedido_em/imported_at), producao = concluídas por dia (fim/created_at)
    const daily = new Map<string, { saida: number; producao: number }>();
    const ensD = (d: string) => {
      if (!daily.has(d)) daily.set(d, { saida: 0, producao: 0 });
      return daily.get(d)!;
    };
    for (const it of anotaItems) {
      const d = orderDateMap.get(it.order_id);
      if (!d) continue;
      ensD(dayStr(d)).saida += Number(it.quantidade);
    }
    for (const o of prodConcluidas) {
      const d = (o.fim || o.created_at) as string;
      if (d) ensD(dayStr(d)).producao += Number(o.quantidade_produzida ?? o.quantidade_necessaria ?? 0);
    }
    const dailyRows = [...daily.entries()]
      .map(([dia, v]) => ({ dia, ...v }))
      .sort((a, b) => {
        const [da, ma, ya] = a.dia.split("/").map(Number);
        const [db, mb, yb] = b.dia.split("/").map(Number);
        return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
      });
    const dailySeries = dailyRows.map((r, idx) => {
      const prev = idx > 0 ? dailyRows[idx - 1].saida : null;
      let variacao: number | null = null;
      if (prev !== null) {
        variacao = prev === 0 ? (r.saida > 0 ? 100 : 0) : ((r.saida - prev) / prev) * 100;
      }
      return { ...r, variacao };
    });

    // Insumos
    const byIng = new Map<string, number>();
    for (const m of ing) byIng.set(m.ingredient_id, (byIng.get(m.ingredient_id) ?? 0) + Number(m.quantidade));
    const insumos = [...byIng.entries()]
      .map(([id, qtd]) => ({ nome: inm[id]?.nome ?? "—", un: inm[id]?.un ?? "", qtd }))
      .sort((a, b) => b.qtd - a.qtd);

    // Recheios
    const byFil = new Map<string, number>();
    for (const m of fil) byFil.set(m.filling_id, (byFil.get(m.filling_id) ?? 0) + Number(m.quantidade));
    const recheios = [...byFil.entries()]
      .map(([id, qtd]) => ({ nome: fln[id]?.nome ?? "—", un: fln[id]?.un ?? "", qtd }))
      .sort((a, b) => b.qtd - a.qtd);

    return { totalSaido, totalProduzido, totalInsumos, totalRecheio, products, dailySeries, insumos, recheios };
  }, [data, names]);

  const periodoLabel = `${dayStr(fromTs)} a ${dayStr(toTs)}`;

  const buildSections = (): ReportSection[] => [
    {
      title: "Salgados que saíram",
      headers: ["Produto", "Saído", "Produzido", "Horários das saídas"],
      align: ["left", "right", "right", "left"],
      rows: report.products.map((p) => [p.nome, fmtNum(p.saido), fmtNum(p.produzido), p.horarios.join("; ")]),
    },
    {
      title: "Variação diária das saídas",
      headers: ["Dia", "Saída", "Produção", "Variação %"],
      align: ["left", "right", "right", "right"],
      rows: report.dailySeries.map((d) => [
        d.dia,
        fmtNum(d.saida),
        fmtNum(d.producao),
        d.variacao === null ? "—" : `${d.variacao >= 0 ? "+" : ""}${fmtNum(d.variacao, 1)}%`,
      ]),
    },
    {
      title: "Consumo de insumos",
      headers: ["Insumo", "Unidade", "Consumido"],
      align: ["left", "left", "right"],
      rows: report.insumos.map((i) => [i.nome, i.un, fmtNum(i.qtd, 2)]),
    },
    {
      title: "Consumo de recheio",
      headers: ["Recheio", "Unidade", "Consumido"],
      align: ["left", "left", "right"],
      rows: report.recheios.map((r) => [r.nome, r.un, fmtNum(r.qtd, 2)]),
    },
  ];

  const handlePDF = () => {
    printProductionReport({
      periodo: periodoLabel,
      resumo: [
        { label: "Salgados que saíram", value: fmtNum(report.totalSaido) },
        { label: "Produzido", value: fmtNum(report.totalProduzido) },
        { label: "Insumos consumidos", value: fmtNum(report.totalInsumos, 2) },
        { label: "Recheio consumido", value: fmtNum(report.totalRecheio, 2) },
      ],
      sections: buildSections(),
    });
  };

  const handleExport = (kind: "csv" | "xls") => {
    const rows = report.products.map((p) => ({
      produto: p.nome,
      saido: p.saido,
      produzido: p.produzido,
      horarios: p.horarios.join("; "),
    }));
    const headers = [
      { key: "produto", label: "Produto" },
      { key: "saido", label: "Saído" },
      { key: "produzido", label: "Produzido" },
      { key: "horarios", label: "Horários das saídas" },
    ];
    const fn = `relatorio-producao-${from}_${to}`;
    if (kind === "csv") downloadCSV(fn, rows, headers);
    else downloadExcel(fn, rows, headers);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Produção"
        subtitle="Saídas, produção, consumo e variação por período"
        icon={BarChart3}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handlePDF}>
              <Printer className="mr-1.5 size-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("xls")}>
              <FileSpreadsheet className="mr-1.5 size-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
              <FileDown className="mr-1.5 size-4" /> CSV
            </Button>
          </>
        }
      />

      <RetentionBanner />

      {/* Filtro de período */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setPreset(1)}>Hoje</Button>
          <Button variant="secondary" size="sm" onClick={() => setPreset(7)}>7 dias</Button>
          <Button variant="secondary" size="sm" onClick={() => setPreset(30)}>30 dias</Button>
          <Button variant="secondary" size="sm" onClick={() => setPreset("month")}>Mês atual</Button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Salgados que saíram" value={fmtNum(report.totalSaido)} icon={PackageOpen} tone="info" />
        <KpiCard label="Produzido" value={fmtNum(report.totalProduzido)} icon={Factory} tone="success" />
        <KpiCard label="Insumos consumidos" value={fmtNum(report.totalInsumos, 2)} icon={Warehouse} tone="warning" />
        <KpiCard label="Recheio consumido" value={fmtNum(report.totalRecheio, 2)} icon={UtensilsCrossed} tone="default" />
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      ) : (
        <>
          {/* Gráfico variação diária */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Variação diária (saídas x produção)</h3>
            {report.dailySeries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={report.dailySeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="dia" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="saida" name="Saída" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="producao" name="Produção" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Salgados que saíram */}
          <SectionTable title="Salgados que saíram">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Saído</TableHead>
                  <TableHead className="text-right">Produzido</TableHead>
                  <TableHead>Horários das saídas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.products.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Sem saídas no período.</TableCell></TableRow>
                ) : report.products.map((p) => (
                  <TableRow key={p.nome}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-right tabular">{fmtNum(p.saido)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{fmtNum(p.produzido)}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{p.horarios.join("; ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionTable>

          {/* Variação diária tabela */}
          <SectionTable title="Variação diária das saídas">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Saída</TableHead>
                  <TableHead className="text-right">Produção</TableHead>
                  <TableHead className="text-right">Variação %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.dailySeries.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Sem dados no período.</TableCell></TableRow>
                ) : report.dailySeries.map((d) => (
                  <TableRow key={d.dia}>
                    <TableCell>{d.dia}</TableCell>
                    <TableCell className="text-right tabular">{fmtNum(d.saida)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{fmtNum(d.producao)}</TableCell>
                    <TableCell className="text-right">
                      <VariacaoCell v={d.variacao} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionTable>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionTable title="Consumo de insumos">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Consumido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.insumos.length === 0 ? (
                    <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">Sem consumo no período.</TableCell></TableRow>
                  ) : report.insumos.map((i) => (
                    <TableRow key={i.nome}>
                      <TableCell className="font-medium">{i.nome}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(i.qtd, 2)} {i.un}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionTable>

            <SectionTable title="Consumo de recheio">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recheio</TableHead>
                    <TableHead className="text-right">Consumido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.recheios.length === 0 ? (
                    <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">Sem consumo no período.</TableCell></TableRow>
                  ) : report.recheios.map((r) => (
                    <TableRow key={r.nome}>
                      <TableCell className="font-medium">{r.nome}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(r.qtd, 2)} {r.un}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionTable>
          </div>
        </>
      )}
    </div>
  );
}

function VariacaoCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const Icon = v > 0 ? TrendingUp : v < 0 ? TrendingDown : Minus;
  const tone = v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center justify-end gap-1 tabular ${tone}`}>
      <Icon className="size-3.5" />
      {v >= 0 ? "+" : ""}{fmtNum(v, 1)}%
    </span>
  );
}

function SectionTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function RetentionBanner() {
  const { roles } = useAuth();
  const isAdmin = hasAccess(roles, ["admin"]);
  const qc = useQueryClient();
  const statusFn = useServerFn(getRetentionStatus);
  const fetchFn = useServerFn(fetchArchivableRecords);
  const purgeFn = useServerFn(purgeOldRecords);

  const [open, setOpen] = useState(false);
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["retention-status"],
    queryFn: () => statusFn(),
    staleTime: 5 * 60_000,
  });

  if (!status?.warn) return null;

  const reason = status.hasOld
    ? `Existem ${fmtNum(status.oldRecords)} registros com mais de 3 anos.`
    : `O histórico atingiu ${fmtNum(status.totalRecords)} registros (limite ${fmtNum(status.volumeLimit)}).`;

  const handleExport = async () => {
    setBusy(true);
    try {
      const { rows } = await fetchFn();
      let any = false;
      for (const [table, data] of Object.entries(rows)) {
        if (data.length) {
          any = true;
          downloadExcel(`backup-${table}`, data as Record<string, unknown>[]);
        }
      }
      if (!any) toast.info("Nenhum registro antigo para exportar.");
      setExported(true);
      toast.success("Backup exportado. Agora você pode liberar o espaço.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async () => {
    setBusy(true);
    try {
      const res = await purgeFn();
      toast.success(`${fmtNum(res.deleted)} registros removidos. Espaço liberado.`);
      setOpen(false);
      setExported(false);
      qc.invalidateQueries({ queryKey: ["retention-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-foreground">Histórico próximo do limite de retenção</p>
            <p className="text-xs text-muted-foreground">{reason} Exporte um backup e libere espaço para novas inserções.</p>
          </div>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => { setExported(false); setOpen(true); }}>
            <HardDriveDownload className="mr-1.5 size-4" /> Exportar e liberar espaço
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar e liberar espaço</DialogTitle>
            <DialogDescription>
              Serão removidos definitivamente os registros com mais de 3 anos. Primeiro exporte o backup em planilha; a limpeza só é liberada após o download.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{reason}</p>
            <Button variant="secondary" className="w-full" onClick={handleExport} disabled={busy}>
              {busy && !exported && <Loader2 className="mr-2 size-4 animate-spin" />}
              <HardDriveDownload className="mr-1.5 size-4" /> 1. Exportar backup (planilha)
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="destructive" onClick={handlePurge} disabled={!exported || busy}>
              {busy && exported && <Loader2 className="mr-2 size-4 animate-spin" />}
              2. Confirmar limpeza
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
