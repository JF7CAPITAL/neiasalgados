import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UtensilsCrossed, Plus, Pencil, Trash2, Search, Loader2, ChefHat } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtNum, stockLevel } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { StockBadge } from "@/components/erp/StatusBadge";
import { RecipeEditor } from "@/components/erp/RecipeEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/recheios")({
  component: RecheiosPage,
});

type Filling = {
  id: string; nome: string; codigo: string | null; unidade: string;
  quantidade_atual: number; estoque_minimo: number; estoque_ideal: number; estoque_maximo: number;
  observacoes: string | null;
};
const empty: Partial<Filling> = { nome: "", codigo: "", unidade: "kg", estoque_minimo: 0, estoque_ideal: 0, estoque_maximo: 0, observacoes: "" };

function RecheiosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Filling> | null>(null);
  const [toDelete, setToDelete] = useState<Filling | null>(null);
  useRealtime(["fillings"], ["fillings"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fillings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fillings").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Filling[];
    },
  });

  const save = useMutation({
    mutationFn: async (f: Partial<Filling>) => {
      const payload = {
        nome: f.nome!, codigo: f.codigo || null, unidade: f.unidade || "kg",
        estoque_minimo: Number(f.estoque_minimo) || 0, estoque_ideal: Number(f.estoque_ideal) || 0,
        estoque_maximo: Number(f.estoque_maximo) || 0, observacoes: f.observacoes || null,
      };
      if (f.id) {
        const { error } = await supabase.from("fillings").update(payload).eq("id", f.id);
        if (error) throw error;
        await logActivity("recheios", "editou recheio", f.id, { nome: f.nome });
      } else {
        const { data, error } = await supabase.from("fillings").insert(payload).select("id").single();
        if (error) throw error;
        setEditing({ ...f, id: data.id });
        await logActivity("recheios", "criou recheio", data.id, { nome: f.nome });
        return;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fillings"] }); toast.success("Recheio salvo!"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (f: Filling) => {
      const { error } = await supabase.from("fillings").update({ deleted_at: new Date().toISOString() }).eq("id", f.id);
      if (error) throw error;
      await logActivity("recheios", "excluiu recheio", f.id, { nome: f.nome });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fillings"] }); toast.success("Removido."); setToDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((f) => [f.nome, f.codigo].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Recheios" subtitle="Produção e estoque de recheios" icon={UtensilsCrossed}
        actions={<Button onClick={() => { setEditing({ ...empty }); setOpen(true); }}><Plus className="mr-1.5 size-4" /> Novo recheio</Button>} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar recheio..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={UtensilsCrossed} title="Nenhum recheio" />
        : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Recheio</TableHead><TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mín/Ideal</TableHead><TableHead>Situação</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((f) => {
                  const lvl = stockLevel(f.quantidade_atual, f.estoque_minimo, f.estoque_ideal);
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(f.quantidade_atual, 2)} {f.unidade}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{fmtNum(f.estoque_minimo, 2)} / {fmtNum(f.estoque_ideal, 2)}</TableCell>
                      <TableCell><StockBadge level={lvl} /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...f }); setOpen(true); }}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setToDelete(f)}><Trash2 className="size-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar recheio" : "Novo recheio"}</DialogTitle></DialogHeader>
          {editing && (
            <Tabs defaultValue="dados">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="receita" disabled={!editing.id}><ChefHat className="mr-1.5 size-4" /> Receita</TabsTrigger>
              </TabsList>
              <TabsContent value="dados" className="space-y-3 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5"><Label className="text-xs">Nome</Label><Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Código</Label><Input value={editing.codigo ?? ""} onChange={(e) => setEditing({ ...editing, codigo: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Unidade</Label><Input value={editing.unidade ?? ""} onChange={(e) => setEditing({ ...editing, unidade: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Estoque mínimo</Label><Input type="number" step="any" value={editing.estoque_minimo ?? 0} onChange={(e) => setEditing({ ...editing, estoque_minimo: Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Estoque ideal</Label><Input type="number" step="any" value={editing.estoque_ideal ?? 0} onChange={(e) => setEditing({ ...editing, estoque_ideal: Number(e.target.value) })} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Estoque máximo</Label><Input type="number" step="any" value={editing.estoque_maximo ?? 0} onChange={(e) => setEditing({ ...editing, estoque_maximo: Number(e.target.value) })} /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Textarea value={editing.observacoes ?? ""} onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })} /></div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
                  <Button onClick={() => save.mutate(editing)} disabled={!editing.nome || save.isPending}>
                    {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar
                  </Button>
                </DialogFooter>
              </TabsContent>
              <TabsContent value="receita" className="pt-4">{editing.id && <RecipeEditor fillingId={editing.id} />}</TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover recheio?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.nome}" será desativado.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete)}>Remover</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
