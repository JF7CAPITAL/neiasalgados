import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtDate } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/colaboradores")({
  component: ColaboradoresPage,
});

type Collab = {
  id: string; nome: string; cpf: string | null; rg: string | null; telefone: string | null;
  celular: string | null; email: string | null; endereco: string | null; cargo: string | null;
  data_admissao: string | null; status: string; em_turno: boolean;
  turno: string | null; horario: string | null; escala: string | null; observacoes: string | null;
};
const empty: Partial<Collab> = { nome: "", status: "ativo", em_turno: false };

function ColaboradoresPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Collab> | null>(null);
  const [toDelete, setToDelete] = useState<Collab | null>(null);
  useRealtime(["collaborators"], ["collaborators"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["collaborators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Collab[];
    },
  });

  const save = useMutation({
    mutationFn: async (c: Partial<Collab>) => {
      const payload = {
        nome: c.nome!, cpf: c.cpf || null, rg: c.rg || null, telefone: c.telefone || null,
        celular: c.celular || null, email: c.email || null, endereco: c.endereco || null,
        cargo: c.cargo || null, data_admissao: c.data_admissao || null, status: c.status || "ativo",
        em_turno: c.em_turno ?? false, turno: c.turno || null, horario: c.horario || null,
        escala: c.escala || null, observacoes: c.observacoes || null,
      };
      if (c.id) {
        const { error } = await supabase.from("collaborators").update(payload).eq("id", c.id);
        if (error) throw error;
        await logActivity("rh", "editou colaborador", c.id, { nome: c.nome });
      } else {
        const { data, error } = await supabase.from("collaborators").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("rh", "criou colaborador", data.id, { nome: c.nome });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collaborators"] }); toast.success("Colaborador salvo!"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (c: Collab) => {
      const { error } = await supabase.from("collaborators").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
      if (error) throw error;
      await logActivity("rh", "excluiu colaborador", c.id, { nome: c.nome });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collaborators"] }); toast.success("Removido."); setToDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((c) => [c.nome, c.cargo, c.cpf].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Colaboradores" subtitle="Gestão de RH e turnos" icon={Users}
        actions={<Button onClick={() => { setEditing({ ...empty }); setOpen(true); }}><Plus className="mr-1.5 size-4" /> Novo</Button>} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar colaborador..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Users} title="Nenhum colaborador" />
        : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>Turno</TableHead>
                <TableHead>Admissão</TableHead><TableHead>Em turno</TableHead><TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{c.cargo || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.turno || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(c.data_admissao)}</TableCell>
                    <TableCell>{c.em_turno ? "Sim" : "Não"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...c }); setOpen(true); }}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(c)}><Trash2 className="size-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} colaborador</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <F label="Nome" cn="col-span-2"><Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></F>
              <F label="CPF"><Input value={editing.cpf ?? ""} onChange={(e) => setEditing({ ...editing, cpf: e.target.value })} /></F>
              <F label="RG"><Input value={editing.rg ?? ""} onChange={(e) => setEditing({ ...editing, rg: e.target.value })} /></F>
              <F label="Telefone"><Input value={editing.telefone ?? ""} onChange={(e) => setEditing({ ...editing, telefone: e.target.value })} /></F>
              <F label="Celular"><Input value={editing.celular ?? ""} onChange={(e) => setEditing({ ...editing, celular: e.target.value })} /></F>
              <F label="Email" cn="col-span-2"><Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></F>
              <F label="Endereço" cn="col-span-2"><Input value={editing.endereco ?? ""} onChange={(e) => setEditing({ ...editing, endereco: e.target.value })} /></F>
              <F label="Cargo"><Input value={editing.cargo ?? ""} onChange={(e) => setEditing({ ...editing, cargo: e.target.value })} /></F>
              <F label="Data admissão"><Input type="date" value={editing.data_admissao ?? ""} onChange={(e) => setEditing({ ...editing, data_admissao: e.target.value })} /></F>
              <F label="Turno"><Input value={editing.turno ?? ""} onChange={(e) => setEditing({ ...editing, turno: e.target.value })} /></F>
              <F label="Horário"><Input value={editing.horario ?? ""} onChange={(e) => setEditing({ ...editing, horario: e.target.value })} /></F>
              <F label="Escala"><Input value={editing.escala ?? ""} onChange={(e) => setEditing({ ...editing, escala: e.target.value })} /></F>
              <F label="Status"><Input value={editing.status ?? "ativo"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} /></F>
              <F label="Observações" cn="col-span-2"><Textarea value={editing.observacoes ?? ""} onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })} /></F>
              <div className="col-span-2 flex items-center gap-2">
                <Switch checked={editing.em_turno ?? false} onCheckedChange={(v) => setEditing({ ...editing, em_turno: v })} />
                <Label>Em turno agora</Label>
              </div>
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

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover colaborador?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.nome}" será desativado.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete)}>Remover</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function F({ label, children, cn }: { label: string; children: React.ReactNode; cn?: string }) {
  return <div className={"space-y-1.5 " + (cn ?? "")}><Label className="text-xs">{label}</Label>{children}</div>;
}
