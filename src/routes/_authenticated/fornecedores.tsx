import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Truck, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/fornecedores")({
  component: FornecedoresPage,
});

type Supplier = {
  id: string; nome: string; contato: string | null;
  telefone: string | null; email: string | null; observacoes: string | null;
};

const empty: Partial<Supplier> = { nome: "", contato: "", telefone: "", email: "", observacoes: "" };

function FornecedoresPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);

  useRealtime(["suppliers"], ["suppliers"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const save = useMutation({
    mutationFn: async (s: Partial<Supplier>) => {
      const payload = {
        nome: s.nome!, contato: s.contato || null, telefone: s.telefone || null,
        email: s.email || null, observacoes: s.observacoes || null,
      };
      if (s.id) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", s.id);
        if (error) throw error;
        await logActivity("fornecedores", "editou fornecedor", s.id, { nome: s.nome });
      } else {
        const { data, error } = await supabase.from("suppliers").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("fornecedores", "criou fornecedor", data.id, { nome: s.nome });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); toast.success("Fornecedor salvo!"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (s: Supplier) => {
      const { error } = await supabase.from("suppliers").update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
      if (error) throw error;
      await logActivity("fornecedores", "excluiu fornecedor", s.id, { nome: s.nome });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); toast.success("Removido."); setToDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((s) =>
    [s.nome, s.contato, s.email].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Fornecedores" subtitle="Cadastro de fornecedores" icon={Truck}
        actions={<Button onClick={() => { setEditing({ ...empty }); setOpen(true); }}><Plus className="mr-1.5 size-4" /> Novo</Button>} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Truck} title="Nenhum fornecedor" />
        : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nome</TableHead><TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead><TableHead>Email</TableHead><TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{s.contato || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.telefone || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...s }); setOpen(true); }}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(s)}><Trash2 className="size-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} fornecedor</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nome</Label><Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Contato</Label><Input value={editing.contato ?? ""} onChange={(e) => setEditing({ ...editing, contato: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Telefone</Label><Input value={editing.telefone ?? ""} onChange={(e) => setEditing({ ...editing, telefone: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Observações</Label><Textarea value={editing.observacoes ?? ""} onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })} /></div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => save.mutate(editing)} disabled={!editing.nome || save.isPending}>
                  {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover fornecedor?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.nome}" será desativado.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete)}>Remover</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
