import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Warehouse, Plus, Pencil, Trash2, Search, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtNum, fmtMoney, fmtDate, stockLevel } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { StockBadge } from "@/components/erp/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/almoxarifado")({
  component: AlmoxarifadoPage,
});

type Ingredient = {
  id: string; nome: string; categoria: string | null; codigo: string | null;
  supplier_id: string | null; unidade: string;
  quantidade_atual: number; estoque_minimo: number; estoque_ideal: number; estoque_maximo: number;
  preco_medio: number; preco_ultima_compra: number;
  localizacao: string | null; validade: string | null; lote: string | null; observacoes: string | null;
};

const empty: Partial<Ingredient> = {
  nome: "", categoria: "", codigo: "", supplier_id: null, unidade: "kg",
  estoque_minimo: 0, estoque_ideal: 0, estoque_maximo: 0, preco_medio: 0, preco_ultima_compra: 0,
  localizacao: "", lote: "", observacoes: "",
};

function AlmoxarifadoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null);
  const [toDelete, setToDelete] = useState<Ingredient | null>(null);
  const [linking, setLinking] = useState<Ingredient | null>(null);

  useRealtime(["ingredients", "recipe_items"], ["ingredients", "recipe-links-by-ingredient"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Ingredient[];
    },
  });

  const { data: recipeLinks = [] } = useQuery({
    queryKey: ["recipe-links-by-ingredient"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("ingredient_id, products(nome)")
        .not("ingredient_id", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, nome").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (i: Partial<Ingredient>) => {
      const payload = {
        nome: i.nome!, categoria: i.categoria || null, codigo: i.codigo || null,
        supplier_id: i.supplier_id || null, unidade: i.unidade || "kg",
        estoque_minimo: Number(i.estoque_minimo) || 0, estoque_ideal: Number(i.estoque_ideal) || 0,
        estoque_maximo: Number(i.estoque_maximo) || 0,
        preco_medio: Number(i.preco_medio) || 0, preco_ultima_compra: Number(i.preco_ultima_compra) || 0,
        localizacao: i.localizacao || null, lote: i.lote || null,
        validade: i.validade || null, observacoes: i.observacoes || null,
      };
      if (i.id) {
        const { error } = await supabase.from("ingredients").update(payload).eq("id", i.id);
        if (error) throw error;
        await logActivity("almoxarifado", "editou insumo", i.id, { nome: i.nome });
      } else {
        const { data, error } = await supabase.from("ingredients").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("almoxarifado", "criou insumo", data.id, { nome: i.nome });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Insumo salvo!"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (i: Ingredient) => {
      const { error } = await supabase.from("ingredients").update({ deleted_at: new Date().toISOString() }).eq("id", i.id);
      if (error) throw error;
      await logActivity("almoxarifado", "excluiu insumo", i.id, { nome: i.nome });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Removido."); setToDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((i) =>
    [i.nome, i.categoria, i.codigo].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  const nameSup = (id: string | null) => suppliers.find((s) => s.id === id)?.nome ?? "—";

  const productsByIngredient = new Map<string, string[]>();
  for (const l of recipeLinks) {
    if (!l.ingredient_id || !l.products?.nome) continue;
    const arr = productsByIngredient.get(l.ingredient_id) ?? [];
    arr.push(l.products.nome);
    productsByIngredient.set(l.ingredient_id, arr);
  }

  const linkedNames = (id: string) => {
    const ps = productsByIngredient.get(id) ?? [];
    if (!ps.length) return "—";
    return ps.length > 3 ? `${ps.slice(0, 3).join(", ")} +${ps.length - 3}` : ps.join(", ");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Almoxarifado" subtitle="Insumos e matérias-primas" icon={Warehouse}
        actions={<Button onClick={() => { setEditing({ ...empty }); setOpen(true); }}><Plus className="mr-1.5 size-4" /> Novo insumo</Button>} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar insumo..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Warehouse} title="Nenhum insumo cadastrado" />
        : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Insumo</TableHead><TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Estoque</TableHead><TableHead className="text-right">Mín/Ideal</TableHead>
                <TableHead className="text-right">Preço médio</TableHead><TableHead>Validade</TableHead>
                <TableHead>Produtos vinculados</TableHead><TableHead>Situação</TableHead><TableHead className="w-32 text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((i) => {
                  const lvl = stockLevel(i.quantidade_atual, i.estoque_minimo, i.estoque_ideal);
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.nome}</div>
                        <div className="text-xs text-muted-foreground">{i.categoria || "—"}{i.codigo ? ` · ${i.codigo}` : ""}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{nameSup(i.supplier_id)}</TableCell>
                      <TableCell className="text-right tabular font-medium">{fmtNum(i.quantidade_atual, 2)} {i.unidade}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{fmtNum(i.estoque_minimo, 2)} / {fmtNum(i.estoque_ideal, 2)}</TableCell>
                      <TableCell className="text-right tabular">{fmtMoney(i.preco_medio)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(i.validade)}</TableCell>
                      <TableCell className="text-muted-foreground">{linkedNames(i.id)}</TableCell>
                      <TableCell><StockBadge level={lvl} /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" title="Vincular produtos" onClick={() => setLinking(i)}><Link2 className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...i }); setOpen(true); }}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setToDelete(i)}><Trash2 className="size-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} insumo</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome" className="col-span-2"><Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></Field>
              <Field label="Categoria"><Input value={editing.categoria ?? ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} /></Field>
              <Field label="Código"><Input value={editing.codigo ?? ""} onChange={(e) => setEditing({ ...editing, codigo: e.target.value })} /></Field>
              <Field label="Fornecedor">
                <Select value={editing.supplier_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, supplier_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Unidade"><Input value={editing.unidade ?? ""} onChange={(e) => setEditing({ ...editing, unidade: e.target.value })} /></Field>
              <Field label="Estoque mínimo"><Num v={editing.estoque_minimo} set={(n) => setEditing({ ...editing, estoque_minimo: n })} /></Field>
              <Field label="Estoque ideal"><Num v={editing.estoque_ideal} set={(n) => setEditing({ ...editing, estoque_ideal: n })} /></Field>
              <Field label="Estoque máximo"><Num v={editing.estoque_maximo} set={(n) => setEditing({ ...editing, estoque_maximo: n })} /></Field>
              <Field label="Preço médio"><Num v={editing.preco_medio} set={(n) => setEditing({ ...editing, preco_medio: n })} /></Field>
              <Field label="Preço última compra"><Num v={editing.preco_ultima_compra} set={(n) => setEditing({ ...editing, preco_ultima_compra: n })} /></Field>
              <Field label="Localização"><Input value={editing.localizacao ?? ""} onChange={(e) => setEditing({ ...editing, localizacao: e.target.value })} /></Field>
              <Field label="Lote"><Input value={editing.lote ?? ""} onChange={(e) => setEditing({ ...editing, lote: e.target.value })} /></Field>
              <Field label="Validade"><Input type="date" value={editing.validade ?? ""} onChange={(e) => setEditing({ ...editing, validade: e.target.value })} /></Field>
              <Field label="Observações" className="col-span-2"><Textarea value={editing.observacoes ?? ""} onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })} /></Field>
              <DialogFooter className="col-span-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => save.mutate(editing)} disabled={!editing.nome || save.isPending}>
                  {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!linking} onOpenChange={(o) => !o && setLinking(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>Vincular produtos — {linking?.nome}</DialogTitle></DialogHeader>
          {linking && <LinkProductsDialog ingredient={linking} onClose={() => setLinking(null)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover insumo?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.nome}" será desativado.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete)}>Remover</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={"space-y-1.5 " + (className ?? "")}><Label className="text-xs">{label}</Label>{children}</div>;
}
function Num({ v, set }: { v: number | undefined; set: (n: number) => void }) {
  return <Input type="number" step="any" value={v ?? 0} onChange={(e) => set(Number(e.target.value))} />;
}

function LinkProductsDialog({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["recipe-by-ingredient", ingredient.id];

  const { data: products = [] } = useQuery({
    queryKey: ["products-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, nome").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("id, product_id, quantidade")
        .eq("ingredient_id", ingredient.id);
      if (error) throw error;
      return data;
    },
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtds, setQtds] = useState<Record<string, number>>({});

  useEffect(() => {
    setSelected(new Set(links.filter((l) => l.product_id).map((l) => l.product_id!)));
    setQtds(Object.fromEntries(links.filter((l) => l.product_id).map((l) => [l.product_id!, Number(l.quantidade)])));
  }, [links]);

  const save = useMutation({
    mutationFn: async () => {
      const existing = new Map(links.filter((l) => l.product_id).map((l) => [l.product_id!, l.id]));
      const existingQtd = new Map(links.filter((l) => l.product_id).map((l) => [l.product_id!, Number(l.quantidade)]));
      for (const p of products) {
        const isSel = selected.has(p.id);
        const exId = existing.get(p.id);
        const qtd = qtds[p.id] ?? 0;
        if (isSel && !exId) {
          const { error } = await supabase.from("recipe_items").insert({
            product_id: p.id,
            ingredient_id: ingredient.id,
            quantidade: qtd,
            unidade: ingredient.unidade,
          });
          if (error) throw error;
        } else if (!isSel && exId) {
          const { error } = await supabase.from("recipe_items").delete().eq("id", exId);
          if (error) throw error;
        } else if (isSel && exId && Number(qtd) !== (existingQtd.get(p.id) ?? 0)) {
          const { error } = await supabase.from("recipe_items").update({ quantidade: qtd }).eq("id", exId);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["recipe-links-by-ingredient"] });
      qc.invalidateQueries({ queryKey: ["recipe"] });
      toast.success("Vínculos atualizados!");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque os produtos que consomem este insumo. A quantidade é usada por unidade produzida (também editável na aba Receita do produto).
      </p>
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Produto</TableHead>
              <TableHead className="w-28 text-right">Qtd/unid.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">Nenhum produto cadastrado.</TableCell></TableRow>
            )}
            {products.map((p) => {
              const checked = selected.has(p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={(e) => {
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(p.id);
                          else n.delete(p.id);
                          return n;
                        });
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      className="ml-auto w-24 text-right"
                      value={qtds[p.id] ?? 0}
                      onChange={(e) => setQtds((q) => ({ ...q, [p.id]: Number(e.target.value) }))}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar vínculos
        </Button>
      </DialogFooter>
    </div>
  );
}
