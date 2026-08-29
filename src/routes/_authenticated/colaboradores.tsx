import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Pencil, Trash2, Search, Loader2, Printer, Upload, FileText, Image, X, Download, Eye } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtDate } from "@/lib/format";
import { printCollaboratorsReport } from "@/lib/export";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { formatFileSize } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/colaboradores")({
  component: ColaboradoresPage,
});

type Collab = {
  id: string; nome: string; cpf: string | null; rg: string | null; telefone: string | null;
  celular: string | null; email: string | null; endereco: string | null; cargo: string | null;
  data_admissao: string | null; status: string; em_turno: boolean;
  turno: string | null; horario: string | null; escala: string | null; observacoes: string | null;
  foto_url: string | null;
  salario: number | null;
  saldo_devedor: number | null;
  pagamento: number | null;
};

type CollabDoc = {
  id: string;
  collaborator_id: string;
  nome: string;
  tipo: string;
  arquivo_url: string;
  tamanho_bytes: number | null;
  mime_type: string | null;
  observacoes: string | null;
  created_at: string;
};

const empty: Partial<Collab> = { nome: "", status: "ativo", em_turno: false, salario: 0, pagamento: 0, saldo_devedor: 0 };
const docTypes = ["documento", "foto", "comprovante", "contrato", "outro"] as const;

function ColaboradoresPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dados");
  const [editing, setEditing] = useState<Partial<Collab> | null>(null);
  const [toDelete, setToDelete] = useState<Collab | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  useRealtime(["collaborators"], ["collaborators"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["collaborators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Collab[];
    },
  });

  const { data: docs = [], refetch: refetchDocs } = useQuery({
    queryKey: ["collaborator-documents", editing?.id],
    queryFn: async () => {
      if (!editing?.id) return [];
      const { data, error } = await supabase
        .from("collaborator_documents")
        .select("*")
        .eq("collaborator_id", editing.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CollabDoc[];
    },
    enabled: !!editing?.id,
  });

  const save = useMutation({
    mutationFn: async (c: Partial<Collab>) => {
      const salario = Number(c.salario) || 0;
      const pagamento = Number(c.pagamento) || 0;
      // Saldo devedor = salário - pagamentos realizados (se pagamento < salário).
      // Acumula: saldo anterior + shortfall do mês atual. Para manter simplicidade
      // sem histórico mensal, o saldo exibido é o shortfall instantâneo; o
      // acúmulo ocorre naturalmente pois o saldo persiste até que pagamento cubra o salário.
      // Se já existe saldo acumulado, mantém a lógica de acúmulo incremental:
      // novo_saldo = max(0, saldo_anterior + salario - pagamento) quando salário/pagamento mudam,
      // senão mantém saldo anterior. Para edição simples, usa shortfall instantâneo.
      let saldo_devedor = Math.max(0, salario - pagamento);
      if (c.id) {
        const existing = rows.find((r) => r.id === c.id);
        if (existing) {
          const oldSalario = Number(existing.salario) || 0;
          const oldPagamento = Number(existing.pagamento) || 0;
          const oldSaldo = Number(existing.saldo_devedor) || 0;
          const salarioMudou = oldSalario !== salario;
          const pagamentoMudou = oldPagamento !== pagamento;
          if (salarioMudou || pagamentoMudou) {
            // Se mudou salário ou pagamento, recalcula considerando acúmulo:
            // saldo_anterior - oldShortfall + newShortfall preserva histórico sem dobrar.
            const oldShortfall = Math.max(0, oldSalario - oldPagamento);
            const newShortfall = Math.max(0, salario - pagamento);
            // Se havia saldo acumulado maior que shortfall (acúmulo de meses anteriores),
            // preserva o excedente: base = oldSaldo - oldShortfall (dívida antiga)
            const baseAcumulada = Math.max(0, oldSaldo - oldShortfall);
            saldo_devedor = baseAcumulada + newShortfall;
            // Abate se pagamento > salário (excedente cobre dívida antiga)
            if (pagamento > salario) {
              const excedente = pagamento - salario;
              saldo_devedor = Math.max(0, oldSaldo - excedente);
              // Se salário também mudou, ajusta com novo shortfall (já 0)
              if (newShortfall === 0) saldo_devedor = Math.max(0, oldSaldo - excedente);
            }
          } else {
            saldo_devedor = oldSaldo;
          }
        }
      }
      const payload = {
        nome: c.nome!, cpf: c.cpf || null, rg: c.rg || null, telefone: c.telefone || null,
        celular: c.celular || null, email: c.email || null, endereco: c.endereco || null,
        cargo: c.cargo || null, data_admissao: c.data_admissao || null, status: c.status || "ativo",
        em_turno: c.em_turno ?? false, turno: c.turno || null, horario: c.horario || null,
        escala: c.escala || null, observacoes: c.observacoes || null,
        salario, pagamento, saldo_devedor,
      } as any;
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

  const uploadDocument = useMutation({
    mutationFn: async ({ collaboratorId, file, tipo, observacoes }: { collaboratorId: string; file: File; tipo: string; observacoes: string }) => {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `collaborators/${collaboratorId}/${tipo}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("collaborator-documents")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("collaborator-documents").getPublicUrl(path);
      const { error: dbError } = await supabase.from("collaborator_documents").insert({
        collaborator_id: collaboratorId,
        nome: file.name,
        tipo,
        arquivo_url: data.publicUrl,
        tamanho_bytes: file.size,
        mime_type: file.type,
        observacoes,
      });
      if (dbError) throw dbError;
      return data.publicUrl;
    },
    onSuccess: () => {
      refetchDocs();
      toast.success("Documento enviado com sucesso!");
      setUploadingDoc(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDocument = useMutation({
    mutationFn: async (doc: CollabDoc) => {
      const path = doc.arquivo_url.split("/collaborator-documents/")[1];
      if (path) {
        await supabase.storage.from("collaborator-documents").remove([path]);
      }
      const { error } = await supabase.from("collaborator_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchDocs();
      toast.success("Documento removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, tipo: string) => {
    const file = e.target.files?.[0];
    if (!file || !editing?.id) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 10MB.");
      return;
    }
    setUploadingDoc(file.name);
    setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
    uploadDocument.mutate({ collaboratorId: editing.id, file, tipo, observacoes: "" });
    e.target.value = "";
  };

  const filtered = rows.filter((c) => [c.nome, c.cargo, c.cpf].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handlePrint = () => {
    const list = selected.size
      ? rows.filter((c) => selected.has(c.id))
      : filtered;
    printCollaboratorsReport(list.map((c) => ({ nome: c.nome, telefone: c.telefone ?? "", observacoes: c.observacoes ?? "" })));
  };

  const isImage = (mime: string | null) => mime?.startsWith("image/") ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title="Colaboradores" subtitle="Gestão de RH e turnos" icon={Users}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-1.5 size-4" /> Imprimir
            </Button>
            <Button onClick={() => { setEditing({ ...empty }); setActiveTab("dados"); setOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Novo
            </Button>
          </>
        } />

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
                <TableHead className="w-10">
                  <Checkbox checked={filtered.length > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>Turno</TableHead>
                <TableHead>Admissão</TableHead><TableHead>Em turno</TableHead><TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} /></TableCell>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{c.cargo || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.turno || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(c.data_admissao)}</TableCell>
                    <TableCell>{c.em_turno ? "Sim" : "Não"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...c }); setActiveTab("dados"); setOpen(true); }}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(c)}><Trash2 className="size-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEditing(null); setActiveTab("dados"); } }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} colaborador</DialogTitle></DialogHeader>
          {editing && (
            <div className="flex flex-col h-[calc(100%-80px)]">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="dados">Dados do Colaborador</TabsTrigger>
                  <TabsTrigger value="documentos">Documentos</TabsTrigger>
                </TabsList>

                <TabsContent value="dados" className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    <F label="Salário (R$)"><Input type="number" step="0.01" value={editing.salario ?? 0} onChange={(e) => setEditing({ ...editing, salario: Number(e.target.value) })} /></F>
                    <F label="Pagamentos realizados (R$)"><Input type="number" step="0.01" value={editing.pagamento ?? 0} onChange={(e) => setEditing({ ...editing, pagamento: Number(e.target.value) })} /></F>
                    <F label="Saldo devedor (R$) - calculado">
                      <Input
                        type="number"
                        step="0.01"
                        value={(() => {
                          const salario = Number(editing.salario) || 0;
                          const pagamento = Number(editing.pagamento) || 0;
                          if (!editing.id) return Math.max(0, salario - pagamento).toFixed(2);
                          const old = rows.find((r) => r.id === editing.id);
                          if (!old) return Math.max(0, salario - pagamento).toFixed(2);
                          const oldSaldo = Number(old.saldo_devedor) || 0;
                          const oldSalario = Number(old.salario) || 0;
                          const oldPagamento = Number(old.pagamento) || 0;
                          const oldShortfall = Math.max(0, oldSalario - oldPagamento);
                          const newShortfall = Math.max(0, salario - pagamento);
                          const base = Math.max(0, oldSaldo - oldShortfall);
                          let preview = base + newShortfall;
                          if (pagamento > salario) {
                            const excedente = pagamento - salario;
                            preview = Math.max(0, oldSaldo - excedente);
                          }
                          return preview.toFixed(2);
                        })()}
                        disabled
                        className="bg-muted"
                      />
                      <p className="text-[11px] text-muted-foreground">Saldo = salário − pagamentos realizados. Se pagamento &lt; salário, acumula para o próximo mês até ser quitado.</p>
                    </F>
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
                </TabsContent>

                <TabsContent value="documentos" className="flex-1 overflow-y-auto p-4 space-y-4">
                  {editing.id ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {docTypes.map((tipo) => (
                          <div key={tipo} className="space-y-1.5">
                            <Label className="text-xs capitalize">{tipo}</Label>
                            <Input
                              type="file"
                              accept="image/*,application/pdf"
                              onChange={(e) => handleFileUpload(e, tipo)}
                              className="cursor-pointer"
                              disabled={uploadingDoc === tipo || uploadDocument.isPending}
                            />
                            {uploadingDoc && uploadingDoc !== tipo && (
                              <Progress value={uploadProgress[uploadingDoc] || 0} className="h-1" />
                            )}
                          </div>
                        ))}
                      </div>

                      {docs.length > 0 && (
                        <div className="space-y-3">
                          <Label className="text-xs font-medium">Documentos anexados</Label>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {docs.map((doc) => (
                              <div key={doc.id} className="relative border rounded-lg p-3 bg-card hover:shadow-md transition-shadow">
                                <div className="aspect-square mb-2 rounded bg-muted flex items-center justify-center overflow-hidden relative">
                                  {isImage(doc.mime_type) ? (
                                    <img src={doc.arquivo_url} alt={doc.nome} className="w-full h-full object-cover" />
                                  ) : (
                                    <FileText className="size-12 text-muted-foreground" />
                                  )}
                                  <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <Button variant="ghost" size="icon" onClick={() => window.open(doc.arquivo_url, "_blank")}><Eye className="size-4" /></Button>
                                    <Button variant="ghost" size="icon" onClick={() => {
                                      const a = document.createElement("a");
                                      a.href = doc.arquivo_url;
                                      a.download = doc.nome;
                                      a.click();
                                    }}><Download className="size-4" /></Button>
                                  </div>
                                </div>
                                <div className="space-y-1 text-xs">
                                  <p className="font-medium truncate" title={doc.nome}>{doc.nome}</p>
                                  <p className="text-muted-foreground capitalize">{doc.tipo}</p>
                                  <p className="text-muted-foreground">{formatFileSize(doc.tamanho_bytes)}</p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute top-1 right-1 text-destructive hover:bg-destructive/10"
                                  onClick={() => deleteDocument.mutate(doc)}
                                  disabled={deleteDocument.isPending}
                                >
                                  <X className="size-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileText className="size-12 mx-auto mb-2 opacity-50" />
                      <p>Salve o colaborador primeiro para anexar documentos</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
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