import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, FileDown, FileSpreadsheet, Printer } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtNum, MOVEMENT_LABELS, STATUS_LABELS } from "@/lib/format";
import { downloadCSV, downloadExcel, printReport } from "@/lib/export";
import { PageHeader } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: RelatoriosPage,
});

type Report = { key: string; label: string; headers: { key: string; label: string }[]; rows: Record<string, unknown>[] };

function RelatoriosPage() {
  const [tab, setTab] = useState("movimentacoes");

  const { data: names = {} } = useQuery({
    queryKey: ["report-names"],
    queryFn: async () => {
      const [p, i] = await Promise.all([
        supabase.from("products").select("id, nome"),
        supabase.from("ingredients").select("id, nome"),
      ]);
      return {
        ...Object.fromEntries((p.data ?? []).map((x) => [x.id, x.nome])),
        ...Object.fromEntries((i.data ?? []).map((x) => [x.id, x.nome])),
      } as Record<string, string>;
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["report-movements"],
    queryFn: async () => {
      const { data } = await supabase.from("product_movements").select("*").order("created_at", { ascending: false }).limit(1000);
      return data ?? [];
    },
  });

  const { data: prodOrders = [] } = useQuery({
    queryKey: ["report-prod"],
    queryFn: async () => {
      const { data } = await supabase.from("production_orders").select("*").is("deleted_at", null).order("numero", { ascending: false });
      return data ?? [];
    },
  });

  const { data: purchOrders = [] } = useQuery({
    queryKey: ["report-purch"],
    queryFn: async () => {
      const { data } = await supabase.from("purchase_orders").select("*").is("deleted_at", null).order("numero", { ascending: false });
      return data ?? [];
    },
  });

  const reports: Record<string, Report> = {
    movimentacoes: {
      key: "movimentacoes", label: "Movimentações de Estoque",
      headers: [
        { key: "data", label: "Data" }, { key: "produto", label: "Produto" },
        { key: "tipo", label: "Tipo" }, { key: "quantidade", label: "Quantidade" },
        { key: "destino", label: "Destino" },
      ],
      rows: movements.map((m) => ({
        data: fmtDateTime(m.created_at), produto: names[m.product_id] ?? "—",
        tipo: MOVEMENT_LABELS[m.tipo] ?? m.tipo, quantidade: fmtNum(m.quantidade), destino: m.destino ?? "",
      })),
    },
    producao: {
      key: "producao", label: "Ordens de Produção",
      headers: [
        { key: "numero", label: "Nº" }, { key: "item", label: "Item" }, { key: "tipo", label: "Tipo" },
        { key: "necessario", label: "Necessário" }, { key: "produzido", label: "Produzido" }, { key: "status", label: "Status" },
      ],
      rows: prodOrders.map((o) => ({
        numero: o.numero, item: names[o.product_id ?? o.filling_id ?? ""] ?? "—", tipo: o.kind,
        necessario: fmtNum(o.quantidade_necessaria), produzido: fmtNum(o.quantidade_produzida ?? 0),
        status: STATUS_LABELS[o.status] ?? o.status,
      })),
    },
    compras: {
      key: "compras", label: "Ordens de Compra",
      headers: [
        { key: "numero", label: "Nº" }, { key: "insumo", label: "Insumo" },
        { key: "necessario", label: "Necessário" }, { key: "preco", label: "Preço médio" }, { key: "status", label: "Status" },
      ],
      rows: purchOrders.map((o) => ({
        numero: o.numero, insumo: names[o.ingredient_id] ?? "—", necessario: fmtNum(o.quantidade_necessaria, 2),
        preco: fmtNum(o.preco_medio, 2), status: STATUS_LABELS[o.status] ?? o.status,
      })),
    },
  };

  const current = reports[tab];

  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios" subtitle="Exporte dados em PDF, Excel e CSV" icon={BarChart3}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => printReport(current.label, current.rows, current.headers)}><Printer className="mr-1.5 size-4" /> PDF</Button>
            <Button variant="outline" size="sm" onClick={() => downloadExcel(current.key, current.rows, current.headers)}><FileSpreadsheet className="mr-1.5 size-4" /> Excel</Button>
            <Button variant="outline" size="sm" onClick={() => downloadCSV(current.key, current.rows, current.headers)}><FileDown className="mr-1.5 size-4" /> CSV</Button>
          </>
        } />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          <TabsTrigger value="producao">Produção</TabsTrigger>
          <TabsTrigger value="compras">Compras</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader><TableRow>{current.headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {current.rows.length === 0 ? (
              <TableRow><TableCell colSpan={current.headers.length} className="py-10 text-center text-muted-foreground">Sem dados.</TableCell></TableRow>
            ) : current.rows.slice(0, 200).map((r, i) => (
              <TableRow key={i}>{current.headers.map((h) => <TableCell key={h.key}>{String(r[h.key] ?? "")}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
