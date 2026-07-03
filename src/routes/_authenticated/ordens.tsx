import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Play, CheckCircle2, PackageCheck, Plus, FileText } from "lucide-react";
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

const emptyPO: NewPO = { ingredient_id: "", quantidade: 0, supplier_id: null, preco: 0, prioridade: "media", obs: "" };

function OrdensPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("todas");
  const [complete, setComplete] = useState<{ order: ProdOrder; produzida: number; perdas: number; obs: string } | null>(null);
  const [receive, setReceive] = useState<{ order: PurchOrder; qtd: number; preco: number } | null>(null);
  const [newPO, setNewPO] = useState<NewPO | null>(null);
  useRealtime(["production_orders", "purchase_orders"], ["orders"]);

  const { data, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const [prod, purch, prods, fills, ings, sups] = await Promise.all([
        supabase.from("production_orders").select("*").is("deleted_at", null).order("numero", { ascending: false }),
        supabase.from("purchase_orders").select("*").is("deleted_at", null).order("numero", { ascending: false }),
        supabase.from("products").select("id, nome"),
        supabase.from("fillings").select("id, nome"),
        supabase.from("ingredients").select("id, nome, unidade, preco_medio, supplier_id").is("deleted_at", null).order("nome"),
        supabase.from("suppliers").select("id, nome").is("deleted_at", null).order("nome"),
      ]);
      return {
        prod: (prod.data ?? []) as ProdOrder[],
        purch: (purch.data ?? []) as PurchOrder[],
        ingredients: (ings.data ?? []) as { id: string; nome: string; unidade: string; preco_medio: number; supplier_id: string | null }[],
        suppliers: (sups.data ?? []) as { id: string; nome: string }[],
        names: {
          ...Object.fromEntries((prods.data ?? []).map((p) => [p.id, p.nome])),
          ...Object.fromEntries((fills.data ?? []).map((f) => [f.id, f.nome])),
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Compra recebida — insumo atualizado!"); setReceive(null); },
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

  const prodRows = data.prod.filter((o) => tab === "todas" || (tab === "producao" && o.kind === "producao") || (tab === "recheio" && o.kind === "recheio"));
  const showPurch = tab === "todas" || tab === "compra";

  return (
    <div className="space-y-6">
      <PageHeader title="Ordens de Serviço" subtitle="Produção, recheios e compras — central única" icon={ClipboardList}
        actions={<Button onClick={() => setNewPO({ ...emptyPO })}><Plus className="mr-1.5 size-4" /> Nova ordem de compra</Button>} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="producao">Produção</TabsTrigger>
          <TabsTrigger value="recheio">Recheios</TabsTrigger>
          <TabsTrigger value="compra">Compras</TabsTrigger>
        </TabsList>
      </Tabs>

      {(tab !== "compra") && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold text-muted-foreground">Ordens de Produção</h3>
          {prodRows.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhuma ordem de produção" /> : (
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
          <h3 className="font-display text-sm font-semibold text-muted-foreground">Ordens de Compra</h3>
          {data.purch.length === 0 ? <EmptyState icon={PackageCheck} title="Nenhuma ordem de compra" /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nº</TableHead><TableHead>Insumo</TableHead><TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Necessário</TableHead><TableHead className="text-right">Preço médio</TableHead>
                  <TableHead>Prioridade</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data.purch.map((o) => (
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
    </div>
  );
}
