import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Pencil, Search, Trash2, Loader2, ChefHat, Folder, FolderPlus } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/produtos")({
  component: ProdutosPage,
});

type Product = {
  id: string;
  nome: string;
  categoria: string | null;
  codigo: string | null;
  tipo: "frito" | "assado";
  unidade: string;
  peso: number;
  peso_recheio: number;
  peso_massa: number;
  status: boolean;
  quantidade_atual: number;
  estoque_minimo: number;
  estoque_ideal: number;
  estoque_maximo: number;
  group_id: string | null;
};

type ProductGroup = {
  id: string;
  nome: string;
  ordem: number;
};

const empty: Partial<Product> = {
  nome: "", categoria: "", codigo: "", tipo: "frito", unidade: "un",
  peso: 0, peso_recheio: 0, peso_massa: 0, status: true,
  estoque_minimo: 0, estoque_ideal: 0, estoque_maximo: 0, group_id: null,
};

function ProdutosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);

  useRealtime(["products"], ["products"]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products").select("*").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["product-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_groups").select("*").order("ordem").order("nome");
      if (error) throw error;
      return data as ProductGroup[];
    },
  });

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupEditing, setGroupEditing] = useState<{ id?: string; nome: string } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ProductGroup | null>(null);

  const saveGroup = useMutation({
    mutationFn: async (g: { id?: string; nome: string }) => {
      const nome = g.nome.trim();
      if (!nome) throw new Error("Informe o nome do grupo.");
      if (g.id) {
        const { error } = await supabase.from("product_groups").update({ nome }).eq("id", g.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("product_groups").insert({ nome });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-groups"] });
      toast.success("Grupo salvo!");
      setGroupOpen(false); setGroupEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGroup = useMutation({
    mutationFn: async (g: ProductGroup) => {
      const { error } = await supabase.from("product_groups").delete().eq("id", g.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-groups"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Grupo removido. Produtos do grupo ficaram sem grupo.");
      setGroupToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async (p: Partial<Product>) => {
      const payload = {
        nome: p.nome!, categoria: p.categoria || null, codigo: p.codigo || null,
        tipo: p.tipo!, unidade: p.unidade || "un",
        peso: Number(p.peso) || 0, peso_recheio: Number(p.peso_recheio) || 0, peso_massa: Number(p.peso_massa) || 0,
        status: p.status ?? true,
        estoque_minimo: Number(p.estoque_minimo) || 0,
        estoque_ideal: Number(p.estoque_ideal) || 0,
        estoque_maximo: Number(p.estoque_maximo) || 0,
        group_id: p.group_id || null,
      };
      if (p.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", p.id);
        if (error) throw error;
        await logActivity("produtos", "editou produto", p.id, { nome: p.nome });
      } else {
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("produtos", "criou produto", data.id, { nome: p.nome });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto salvo!");
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
      if (error) throw error;
      await logActivity("produtos", "excluiu produto", p.id, { nome: p.nome });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto removido.");
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = products.filter((p) =>
    [p.nome, p.categoria, p.codigo].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));

  const groupedBy = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = p.group_id ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [filtered]);

  function openNew() { setEditing({ ...empty }); setOpen(true); }
  function openEdit(p: Product) { setEditing({ ...p }); setOpen(true); }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos" subtitle="Cadastro de salgados e suas receitas" icon={Package}
        actions={<Button onClick={openNew}><Plus className="mr-1.5 size-4" /> Novo produto</Button>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => { setGroupEditing(null); setGroupOpen(true); }}>
          <FolderPlus className="mr-1.5 size-4" /> Novo grupo
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum produto" description="Cadastre seu primeiro salgado para começar."
          action={<Button onClick={openNew}><Plus className="mr-1.5 size-4" /> Novo produto</Button>} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const items = groupedBy.get(g.id) ?? [];
            if (!items.length) return null;
            return (
              <section key={g.id}>
                <div className="mb-2 flex items-center gap-2">
                  <Folder className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold">{g.nome}</h3>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="icon" title="Renomear grupo"
                      onClick={() => { setGroupEditing({ id: g.id, nome: g.nome }); setGroupOpen(true); }}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Excluir grupo"
                      onClick={() => setGroupToDelete(g)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <ProductTable items={items} onEdit={openEdit} onDelete={setToDelete} />
              </section>
            );
          })}
          {(() => {
            const items = groupedBy.get("") ?? [];
            if (!items.length) return null;
            return (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Folder className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold text-muted-foreground">Sem grupo</h3>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <ProductTable items={items} onEdit={openEdit} onDelete={setToDelete} />
              </section>
            );
          })()}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
          {editing && (
            <Tabs defaultValue="dados">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="receita" disabled={!editing.id}>
                  <ChefHat className="mr-1.5 size-4" /> Receita
                </TabsTrigger>
              </TabsList>

              <TabsContent value="dados" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nome" className="col-span-2">
                    <Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} />
                  </Field>
                  <Field label="Categoria">
                    <Input value={editing.categoria ?? ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} />
                  </Field>
                  <Field label="Grupo">
                    <Select
                      value={editing.group_id ?? "none"}
                      onValueChange={(v) => setEditing({ ...editing, group_id: v === "none" ? null : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Sem grupo —</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Código interno">
                    <Input value={editing.codigo ?? ""} onChange={(e) => setEditing({ ...editing, codigo: e.target.value })} />
                  </Field>
                  <Field label="Tipo de massa">
                    <Select value={editing.tipo} onValueChange={(v) => setEditing({ ...editing, tipo: v as "frito" | "assado" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="frito">Frito (916/massada)</SelectItem>
                        <SelectItem value="assado">Assado (350/massada)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Unidade">
                    <Input value={editing.unidade ?? ""} onChange={(e) => setEditing({ ...editing, unidade: e.target.value })} />
                  </Field>
                  <Field label="Peso (g)"><NumInput v={editing.peso} set={(n) => setEditing({ ...editing, peso: n })} /></Field>
                  <Field label="Peso recheio (g)"><NumInput v={editing.peso_recheio} set={(n) => setEditing({ ...editing, peso_recheio: n })} /></Field>
                  <Field label="Peso massa (g)"><NumInput v={editing.peso_massa} set={(n) => setEditing({ ...editing, peso_massa: n })} /></Field>
                  <Field label="Estoque mínimo"><NumInput v={editing.estoque_minimo} set={(n) => setEditing({ ...editing, estoque_minimo: n })} /></Field>
                  <Field label="Estoque ideal"><NumInput v={editing.estoque_ideal} set={(n) => setEditing({ ...editing, estoque_ideal: n })} /></Field>
                  <Field label="Estoque máximo"><NumInput v={editing.estoque_maximo} set={(n) => setEditing({ ...editing, estoque_maximo: n })} /></Field>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.status ?? true} onCheckedChange={(c) => setEditing({ ...editing, status: c })} />
                  <Label>Produto ativo</Label>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button onClick={() => save.mutate(editing)} disabled={!editing.nome || save.isPending}>
                    {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="receita" className="pt-4">
                {editing.id && <RecipeEditor productId={editing.id} />}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover produto?</AlertDialogTitle>
            <AlertDialogDescription>
              O produto "{toDelete?.nome}" será desativado (exclusão lógica). O histórico é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete)}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={groupOpen} onOpenChange={(o) => { setGroupOpen(o); if (!o) setGroupEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{groupEditing?.id ? "Renomear grupo" : "Novo grupo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Nome do grupo</Label>
            <Input
              autoFocus
              value={groupEditing?.nome ?? ""}
              onChange={(e) => setGroupEditing((s) => ({ ...(s ?? {}), nome: e.target.value }))}
              placeholder="Ex.: Fritos, Assados..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && groupEditing?.nome?.trim() && !saveGroup.isPending) {
                  saveGroup.mutate(groupEditing);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupOpen(false)}>Cancelar</Button>
            <Button onClick={() => groupEditing && saveGroup.mutate(groupEditing)}
              disabled={!groupEditing?.nome?.trim() || saveGroup.isPending}>
              {saveGroup.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!groupToDelete} onOpenChange={(o) => !o && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir grupo "{groupToDelete?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Os produtos deste grupo ficarão sem grupo. O histórico dos produtos é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => groupToDelete && removeGroup.mutate(groupToDelete)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function NumInput({ v, set }: { v: number | undefined; set: (n: number) => void }) {
  return <Input type="number" step="any" value={v ?? 0} onChange={(e) => set(Number(e.target.value))} />;
}

function ProductTable({
  items,
  onEdit,
  onDelete,
}: {
  items: Product[];
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Estoque</TableHead>
            <TableHead className="text-right">Mín/Ideal</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="w-24 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => {
            const lvl = stockLevel(p.quantidade_atual, p.estoque_minimo, p.estoque_ideal);
            return (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.nome}</div>
                  {p.codigo && <div className="text-xs text-muted-foreground">{p.codigo}</div>}
                </TableCell>
                <TableCell className="capitalize">{p.tipo}</TableCell>
                <TableCell className="text-right tabular font-medium">{fmtNum(p.quantidade_atual)}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{fmtNum(p.estoque_minimo)} / {fmtNum(p.estoque_ideal)}</TableCell>
                <TableCell><StockBadge level={lvl} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => onEdit(p)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(p)}><Trash2 className="size-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
