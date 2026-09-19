import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Play, CheckCircle2, PackageCheck, Plus, FileText, Trash2, CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtNum, fmtMoney, fmtDateTime, STATUS_LABELS, PRIORITY_LABELS } from "@/lib/format";
import { printOrderDoc } from "@/lib/export";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { StatusBadge, PriorityBadge } from "@/components/erp/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/ordens")({
  component: OrdensPage,
});

type ProdOrder = {
  id: string; numero: number; kind: "producao" | "recheio"; status: string; prioridade: string;
  quantidade_necessaria: number; quantidade_ideal: number; massadas: number;
  tipo_massa: string | null; quantidade_produzida: number | null; created_at: string;
  product_id: string | null; filling_id: string | null;
};
type PurchOrder = {
  id: string; numero: number; status: string; prioridade: string;
  quantidade_necessaria: number; preco_medio: number; created_at: string;
  ingredient_id: string; supplier_id: string | null; observacoes: string | null; auto_gerada: boolean;
};
type NewPO = { ingredient_id: string; quantidade: number; supplier_id: string | null; preco: number; prioridade: string; obs: string };

type NewProdOrder = {
  product_id: string;
  quantidade: number;
  massadas: number;
  prioridade: string;
  tipo_massa: string;
  observacoes: string;
};

type NewFillingOrder = {
  filling_id: string;
  quantidade: number;
  prioridade: string;
  observacoes: string;
};

const emptyPO: NewPO = { ingredient_id: "", quantidade: 0, supplier_id: null, preco: 0, prioridade: "media", obs: "" };
const emptyProdO: NewProdOrder = { product_id: "", quantidade: 0, massadas: 1, prioridade: "media", tipo_massa: "frito", observacoes: "" };
const emptyFillingO: NewFillingOrder = { filling_id: "", quantidade: 0, prioridade: "media", observacoes: "" };

function toBRTDateString(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function todayBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function OrdensPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("todas");
  const [filtroData, setFiltroData] = useState<string>(() => todayBRT());
  const [complete, setComplete] = useState<{ order: ProdOrder; produzida: number; perdas: number; obs: string } | null>(null);
  const [receive, setReceive] = useState<{ order: PurchOrder; qtd: number; preco: number } | null>(null);
  const [newPO, setNewPO] = useState<NewPO | null>(null);
  const [newProdO, setNewProdO] = useState<NewProdOrder | null>(null);
  const [newFillingO, setNewFillingO] = useState<NewFillingOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "prod" | "purch"; id: string; numero: number } | null>(null);
  useRealtime(["production_orders", "purchase_orders"], ["orders"]);

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const [prod, purch, prods, fills, ings, sups] = await Promise.all([
        supabase.from("production_orders").select("*").is("deleted_at", null).order("numero", { ascending: false }),
        supabase.from("purchase_orders").select("*").is("deleted_at", null).order("numero", { ascending: false }),
        supabase.from("products").select("id, nome").is("deleted_at", null).eq("status", true).order("nome"),
        supabase.from("fillings").select("id, nome").is("deleted_at", null).order("nome"),
        supabase.from("ingredients").select("id, nome, unidade, preco_medio, supplier_id").is("deleted_at", null).order("nome"),
        supabase.from("suppliers").select("id, nome").is("deleted_at", null).order("nome"),
      ]);
      // Deduplica produtos por nome normalizado (case-insensitive + trim) para evitar exibir duplicatas
      // como "Crokete / crokete" – mantém apenas 1 registro por nome
      const dedupedProducts = (() => {
        const seen = new Set<string>();
        const out: { id: string; nome: string }[] = [];
        for (const p of (prods.data ?? []) as { id: string; nome: string }[]) {
          const norm = p.nome.trim().toLowerCase();
          if (!seen.has(norm)) {
            seen.add(norm);
            out.push({ id: p.id, nome: p.nome.trim() });
          }
        }
        // Caso especial: "crokete" (typo com k) deve ser considerado duplicata de "croquete"
        // Se ambos existissem como ativos, o filtro acima já removeria; mantido por segurança
        return out;
      })();
      // Deduplica recheios também
      const dedupedFillings = (() => {
        const seen = new Set<string>();
        const out: { id: string; nome: string }[] = [];
        for (const f of (fills.data ?? []) as { id: string; nome: string }[]) {
          const norm = f.nome.trim().toLowerCase();
          if (!seen.has(norm)) {
            seen.add(norm);
            out.push({ id: f.id, nome: f.nome.trim() });
          }
        }
        return out;
      })();
      return {
        prod: (prod.data ?? []) as ProdOrder[],
        purch: (purch.data ?? []) as PurchOrder[],
        products: dedupedProducts,
        fillings: dedupedFillings,
        ingredients: (ings.data ?? []) as { id: string; nome: string; unidade: string; preco_medio: number; supplier_id: string | null }[],
        suppliers: (sups.data ?? []) as { id: string; nome: string }[],
        names: {
          ...Object.fromEntries(dedupedProducts.map((p) => [p.id, p.nome])),
          ...Object.fromEntries(dedupedFillings.map((f) => [f.id, f.nome])),
          ...Object.fromEntries((ings.data ?? []).map((i) => [i.id, i.nome])),
          ...Object.fromEntries((sups.data ?? []).map((s) => [s.id, s.nome])),
        } as Record<string, string>,
      };
    },
  });

  const start = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("start_production_order", { p_order: id });
      if (error) throw error;
      await logActivity("ordens", "iniciou produção", id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Produção iniciada — insumos consumidos."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const doComplete = useMutation({
    mutationFn: async (c: NonNullable<typeof complete>) => {
      const { error } = await supabase.rpc("complete_production_order", {
        p_order: c.order.id, p_produzida: c.produzida, p_perdas: c.perdas, p_obs: c.obs || undefined,
      });
      if (error) throw error;
      await logActivity("ordens", "concluiu produção", c.order.id, { produzida: c.produzida });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["stock"] }); toast.success("Produção concluída — estoque atualizado!"); setComplete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const doReceive = useMutation({
    mutationFn: async (r: NonNullable<typeof receive>) => {
      const { error } = await supabase.rpc("receive_purchase_order", {
        p_order: r.order.id, p_quantidade: r.qtd, p_preco: r.preco || undefined,
      });
      if (error) throw error;
      await logActivity("ordens", "recebeu compra", r.order.id, { qtd: r.qtd });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["ingredients"] }); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Compra recebida — insumo atualizado!"); setReceive(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPO = useMutation({
    mutationFn: async (p: NewPO) => {
      if (!p.ingredient_id) throw new Error("Selecione o insumo.");
      if (!p.quantidade || p.quantidade <= 0) throw new Error("Informe a quantidade.");
      const { data: inserted, error } = await supabase.from("purchase_orders").insert({
        ingredient_id: p.ingredient_id,
        supplier_id: p.supplier_id || null,
        quantidade_necessaria: p.quantidade,
        preco_medio: p.preco || 0,
        prioridade: p.prioridade as "baixa" | "media" | "alta" | "urgente",
        observacoes: p.obs || null,
        auto_gerada: false,
      }).select("id").single();
      if (error) throw error;
      await logActivity("ordens", "criou ordem de compra", inserted.id, { ingredient_id: p.ingredient_id, qtd: p.quantidade });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Ordem de compra criada!"); setNewPO(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createProdO = useMutation({
    mutationFn: async (p: NewProdOrder) => {
      if (!p.product_id) throw new Error("Selecione o produto.");
      if (!p.quantidade || p.quantidade <= 0) throw new Error("Informe a quantidade.");
      const { error } = await supabase.from("production_orders").insert({
        product_id: p.product_id,
        quantidade_necessaria: p.quantidade,
        massadas: p.massadas,
        kind: "producao",
        prioridade: p.prioridade as "baixa" | "media" | "alta" | "urgente",
        tipo_massa: p.tipo_massa === "frito" ? "frito" : "assado",
        observacoes: p.observacoes || null,
        auto_gerada: false,
        status: "pendente",
      });
      if (error) throw error;
      await logActivity("ordens", "criou ordem de produção manual", "", { produto: p.product_id, qtd: p.quantidade });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Ordem de produção criada!"); setNewProdO(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createFillingO = useMutation({
    mutationFn: async (p: NewFillingOrder) => {
      if (!p.filling_id) throw new Error("Selecione o recheio.");
      if (!p.quantidade || p.quantidade <= 0) throw new Error("Informe a quantidade.");
      const { error } = await supabase.from("production_orders").insert({
        filling_id: p.filling_id,
        quantidade_necessaria: p.quantidade,
        massadas: 1,
        kind: "recheio",
        prioridade: p.prioridade as "baixa" | "media" | "alta" | "urgente",
        tipo_massa: null,
        observacoes: p.observacoes || null,
        auto_gerada: false,
        status: "pendente",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Ordem de produção de recheio criada!"); setNewFillingO(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteProd = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("production_orders").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
      await logActivity("ordens", "excluiu ordem de produção", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Ordem de produção excluída.");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePurch = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_orders").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
      await logActivity("ordens", "excluiu ordem de compra", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Ordem de compra excluída.");
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />;

  const nm = (id: string | null | undefined) => (id && data.names[id]) || "—";

  function printProd(o: ProdOrder) {
    printOrderDoc({
      docTitle: o.kind === "recheio" ? "Ordem de Produção — Recheio" : "Ordem de Produção",
      numero: o.numero,
      fields: [
        { label: "Item", value: nm(o.product_id ?? o.filling_id) },
        { label: "Tipo", value: o.kind === "recheio" ? "Recheio" : "Produto acabado" },
        { label: "Tipo de massa", value: o.tipo_massa ?? "—" },
        { label: "Quantidade necessária", value: fmtNum(o.quantidade_necessaria) },
        { label: "Quantidade ideal", value: fmtNum(o.quantidade_ideal) },
        { label: "Massadas", value: fmtNum(o.massadas, 2) },
        { label: "Quantidade produzida", value: o.quantidade_produzida != null ? fmtNum(o.quantidade_produzida) : "—" },
        { label: "Prioridade", value: PRIORITY_LABELS[o.prioridade] ?? o.prioridade },
        { label: "Status", value: STATUS_LABELS[o.status] ?? o.status },
        { label: "Criada em", value: fmtDateTime(o.created_at) },
      ],
    });
  }

  function printPurch(o: PurchOrder) {
    printOrderDoc({
      docTitle: "Ordem de Compra",
      numero: o.numero,
      fields: [
        { label: "Insumo / Matéria-prima", value: nm(o.ingredient_id) },
        { label: "Fornecedor", value: nm(o.supplier_id) },
        { label: "Quantidade", value: fmtNum(o.quantidade_necessaria, 2) },
        { label: "Preço médio (unit.)", value: fmtMoney(o.preco_medio) },
        { label: "Valor estimado", value: fmtMoney(o.quantidade_necessaria * o.preco_medio) },
        { label: "Origem", value: o.auto_gerada ? "Gerada automaticamente" : "Manual" },
        { label: "Prioridade", value: PRIORITY_LABELS[o.prioridade] ?? o.prioridade },
        { label: "Status", value: STATUS_LABELS[o.status] ?? o.status },
        { label: "Observações", value: o.observacoes ?? "—" },
        { label: "Criada em", value: fmtDateTime(o.created_at) },
      ],
    });
  }

  const showPurch = tab === "todas" || tab === "compra";
  const prodFilteredByDate = data.prod.filter((o) => toBRTDateString(o.created_at) === filtroData);
  const purchFilteredByDate = data.purch.filter((o) => toBRTDateString(o.created_at) === filtroData);

  const prodRows = prodFilteredByDate.filter((o) => tab === "todas" || (tab === "producao" && o.kind === "producao") || (tab === "recheio" && o.kind === "recheio"));
  const purchRows = purchFilteredByDate;

  return (
    <div className="space-y-6">
      <PageHeader title="Ordens de Serviço" subtitle="Produção, recheios e compras — central única" icon={ClipboardList}
        actions={<>
          <Button onClick={() => setNewProdO({ ...emptyProdO })}><Plus className="mr-1.5 size-4" /> Nova ordem de produção</Button>
          <Button variant="outline" onClick={() => setNewFillingO({ ...emptyFillingO })}><Plus className="mr-1.5 size-4" /> Nova ordem de recheio</Button>
          <Button variant="outline" onClick={() => setNewPO({ ...emptyPO })}><Plus className="mr-1.5 size-4" /> Nova ordem de compra</Button>
        </>} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="producao">Produção</TabsTrigger>
          <TabsTrigger value="recheio">Recheios</TabsTrigger>
          <TabsTrigger value="compra">Compras</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Label className="text-xs whitespace-nowrap">Filtrar por data</Label>
          <Input type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} className="w-40" />
          <Button variant="outline" size="sm" onClick={() => setFiltroData(todayBRT())}>Hoje</Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {prodFilteredByDate.length + purchFilteredByDate.length} ordem(ns) em {new Date(`${filtroData}T12:00:00-03:00`).toLocaleDateString("pt-BR")}
          {filtroData !== todayBRT() && " — filtrado"}
        </span>
      </div>

      {(tab !== "compra") && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold text-muted-foreground">Ordens de Produção — {new Date(`${filtroData}T12:00:00-03:00`).toLocaleDateString("pt-BR")}</h3>
          {prodRows.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhuma ordem de produção" description={`Nenhuma ordem em ${new Date(`${filtroData}T12:00:00-03:00`).toLocaleDateString("pt-BR")}.`} /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nº</TableHead><TableHead>Item</TableHead><TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Necessário</TableHead><TableHead className="text-right">Massadas</TableHead>
                  <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {prodRows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="tabular font-medium">#{o.numero}</TableCell>
                      <TableCell>{nm(o.product_id ?? o.filling_id)}</TableCell>
                      <TableCell className="capitalize">{o.kind}{o.tipo_massa ? ` · ${o.tipo_massa}` : ""}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(o.quantidade_necessaria)}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(o.massadas, 2)}</TableCell>
                      <TableCell><PriorityBadge priority={o.prioridade} /></TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {o.status === "pendente" && <Button size="sm" variant="outline" onClick={() => start.mutate(o.id)}><Play className="mr-1.5 size-3.5" /> Iniciar</Button>}
                          {o.status === "em_andamento" && <Button size="sm" onClick={() => setComplete({ order: o, produzida: o.quantidade_necessaria, perdas: 0, obs: "" })}><CheckCircle2 className="mr-1.5 size-3.5" /> Concluir</Button>}
                          <Button size="sm" variant="ghost" onClick={() => printProd(o)} title="Visualizar / Imprimir / PDF"><FileText className="size-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "prod", id: o.id, numero: o.numero })} title="Excluir ordem" className="text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {showPurch && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold text-muted-foreground">Ordens de Compra — {new Date(`${filtroData}T12:00:00-03:00`).toLocaleDateString("pt-BR")}</h3>
          {purchRows.length === 0 ? <EmptyState icon={PackageCheck} title="Nenhuma ordem de compra" description={`Nenhuma ordem em ${new Date(`${filtroData}T12:00:00-03:00`).toLocaleDateString("pt-BR")}.`} /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nº</TableHead><TableHead>Insumo</TableHead><TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Necessário</TableHead><TableHead className="text-right">Preço médio</TableHead>
                  <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {purchRows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="tabular font-medium">#{o.numero}</TableCell>
                      <TableCell>{nm(o.ingredient_id)}</TableCell>
                      <TableCell className="text-muted-foreground">{nm(o.supplier_id)}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(o.quantidade_necessaria, 2)}</TableCell>
                      <TableCell className="text-right tabular">{fmtMoney(o.preco_medio)}</TableCell>
                      <TableCell><PriorityBadge priority={o.prioridade} /></TableCell>
                      <TableCell><StatusBadge status={o.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(o.status === "pendente" || o.status === "em_andamento") && <Button size="sm" onClick={() => setReceive({ order: o, qtd: o.quantidade_necessaria, preco: o.preco_medio })}><PackageCheck className="mr-1.5 size-3.5" /> Receber</Button>}
                          <Button size="sm" variant="ghost" onClick={() => printPurch(o)} title="Visualizar / Imprimir / PDF"><FileText className="size-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ type: "purch", id: o.id, numero: o.numero })} title="Excluir ordem" className="text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <Dialog open={!!complete} onOpenChange={(o) => !o && setComplete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Concluir produção #{complete?.order.numero}</DialogTitle></DialogHeader>
          {complete && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Quantidade produzida</Label><Input type="number" value={complete.produzida} onChange={(e) => setComplete({ ...complete, produzida: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Perdas</Label><Input type="number" value={complete.perdas} onChange={(e) => setComplete({ ...complete, perdas: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={complete.obs} onChange={(e) => setComplete({ ...complete, obs: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setComplete(null)}>Cancelar</Button>
                <Button onClick={() => doComplete.mutate(complete)} disabled={doComplete.isPending}>
                  {doComplete.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Concluir
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!receive} onOpenChange={(o) => !o && setReceive(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receber compra #{receive?.order.numero}</DialogTitle></DialogHeader>
          {receive && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Quantidade recebida</Label><Input type="number" step="any" value={receive.qtd} onChange={(e) => setReceive({ ...receive, qtd: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Preço unitário</Label><Input type="number" step="any" value={receive.preco} onChange={(e) => setReceive({ ...receive, preco: Number(e.target.value) })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReceive(null)}>Cancelar</Button>
                <Button onClick={() => doReceive.mutate(receive)} disabled={doReceive.isPending}>
                  {doReceive.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Receber
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!newPO} onOpenChange={(o) => !o && setNewPO(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova ordem de compra — matéria-prima</DialogTitle></DialogHeader>
          {newPO && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Insumo (almoxarifado)</Label>
                <Select
                  value={newPO.ingredient_id}
                  onValueChange={(v) => {
                    const ing = data.ingredients.find((i) => i.id === v);
                    setNewPO({
                      ...newPO,
                      ingredient_id: v,
                      supplier_id: ing?.supplier_id ?? newPO.supplier_id,
                      preco: ing?.preco_medio ?? newPO.preco,
                    });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecionar insumo..." /></SelectTrigger>
                  <SelectContent>
                    {data.ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.nome} ({i.unidade})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Quantidade</Label><Input type="number" step="any" value={newPO.quantidade} onChange={(e) => setNewPO({ ...newPO, quantidade: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Preço médio (unit.)</Label><Input type="number" step="any" value={newPO.preco} onChange={(e) => setNewPO({ ...newPO, preco: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fornecedor</Label>
                  <Select value={newPO.supplier_id ?? "none"} onValueChange={(v) => setNewPO({ ...newPO, supplier_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {data.suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Prioridade</Label>
                  <Select value={newPO.prioridade} onValueChange={(v) => setNewPO({ ...newPO, prioridade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={newPO.obs} onChange={(e) => setNewPO({ ...newPO, obs: e.target.value })} /></div>
              {newPO.quantidade > 0 && newPO.preco > 0 && (
                <p className="text-xs text-muted-foreground">Valor estimado: <span className="font-medium text-foreground">{fmtMoney(newPO.quantidade * newPO.preco)}</span></p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewPO(null)}>Cancelar</Button>
                <Button onClick={() => createPO.mutate(newPO)} disabled={createPO.isPending || !newPO.ingredient_id}>
                  {createPO.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Criar ordem
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!newProdO} onOpenChange={(o) => !o && setNewProdO(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova ordem de produção</DialogTitle></DialogHeader>
          {newProdO && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Produto (salgado)</Label>
                <Select value={newProdO.product_id} onValueChange={(v) => setNewProdO({ ...newProdO, product_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar produto..." /></SelectTrigger>
                  <SelectContent>
                    {data.products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Quantidade necessária</Label><Input type="number" value={newProdO.quantidade} onChange={(e) => setNewProdO({ ...newProdO, quantidade: Number(e.target.value) })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Massadas</Label><Input type="number" step="any" value={newProdO.massadas} onChange={(e) => setNewProdO({ ...newProdO, massadas: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo de massa</Label>
                  <Select value={newProdO.tipo_massa} onValueChange={(v) => setNewProdO({ ...newProdO, tipo_massa: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="frito">Frito</SelectItem>
                      <SelectItem value="assado">Assado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Prioridade</Label>
                  <Select value={newProdO.prioridade} onValueChange={(v) => setNewProdO({ ...newProdO, prioridade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={newProdO.observacoes} onChange={(e) => setNewProdO({ ...newProdO, observacoes: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewProdO(null)}>Cancelar</Button>
                <Button onClick={() => createProdO.mutate(newProdO)} disabled={createProdO.isPending || !newProdO.product_id}>
                  {createProdO.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Criar ordem
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!newFillingO} onOpenChange={(o) => !o && setNewFillingO(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova ordem de produção — Recheio</DialogTitle></DialogHeader>
          {newFillingO && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Recheio</Label>
                <Select value={newFillingO.filling_id} onValueChange={(v) => setNewFillingO({ ...newFillingO, filling_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar recheio..." /></SelectTrigger>
                  <SelectContent>
                    {data.fillings.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Quantidade necessária</Label><Input type="number" value={newFillingO.quantidade} onChange={(e) => setNewFillingO({ ...newFillingO, quantidade: Number(e.target.value) })} /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Prioridade</Label>
                  <Select value={newFillingO.prioridade} onValueChange={(v) => setNewFillingO({ ...newFillingO, prioridade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={newFillingO.observacoes} onChange={(e) => setNewFillingO({ ...newFillingO, observacoes: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewFillingO(null)}>Cancelar</Button>
                <Button onClick={() => createFillingO.mutate(newFillingO)} disabled={createFillingO.isPending || !newFillingO.filling_id}>
                  {createFillingO.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Criar ordem
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir ordem #{deleteTarget?.numero}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir a ordem <span className="font-medium text-foreground">#{deleteTarget?.numero}</span> ({deleteTarget?.type === "prod" ? "produção" : "compra"})? Essa ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteTarget.type === "prod") deleteProd.mutate(deleteTarget.id);
                else deletePurch.mutate(deleteTarget.id);
              }}
              disabled={deleteProd.isPending || deletePurch.isPending}
            >
              {(deleteProd.isPending || deletePurch.isPending) && <Loader2 className="mr-2 size-4 animate-spin" />} Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
