import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Plus,
  Pencil,
  Search,
  Trash2,
  Loader2,
  ChefHat,
  Folder,
  FolderPlus,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  ordem: number;
};

type ProductGroup = {
  id: string;
  nome: string;
  ordem: number;
};

const empty: Partial<Product> = {
  nome: "",
  categoria: "",
  codigo: "",
  tipo: "frito",
  unidade: "un",
  peso: 0,
  peso_recheio: 0,
  peso_massa: 0,
  status: true,
  estoque_minimo: 0,
  estoque_ideal: 0,
  estoque_maximo: 0,
  group_id: null,
};

function ProdutosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);

  useRealtime(["products", "product_groups"], ["products", "product-groups"]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .is("deleted_at", null)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["product-groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_groups").select("*").order("ordem").order("nome");
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
        const maxOrdem = groups.length ? Math.max(...groups.map((x) => x.ordem ?? 0)) + 1 : 0;
        const { error } = await supabase.from("product_groups").insert({ nome, ordem: maxOrdem });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-groups"] });
      toast.success("Grupo salvo!");
      setGroupOpen(false);
      setGroupEditing(null);
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
      const payload: Record<string, unknown> = {
        nome: p.nome!,
        categoria: p.categoria || null,
        codigo: p.codigo || null,
        tipo: p.tipo!,
        unidade: p.unidade || "un",
        peso: Number(p.peso) || 0,
        peso_recheio: Number(p.peso_recheio) || 0,
        peso_massa: Number(p.peso_massa) || 0,
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
        // define ordem como último dentro do grupo
        const sameGroup = products.filter((x) => (x.group_id ?? null) === (p.group_id ?? null));
        const maxOrdem = sameGroup.length ? Math.max(...sameGroup.map((x) => (x as Product).ordem ?? 0)) + 1 : 0;
        (payload as Record<string, unknown>).ordem = maxOrdem;
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("produtos", "criou produto", (data as { id: string }).id, { nome: p.nome });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto salvo!");
      setOpen(false);
      setEditing(null);
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

  const reorderGroups = useMutation({
    mutationFn: async (ordered: ProductGroup[]) => {
      for (let i = 0; i < ordered.length; i++) {
        const g = ordered[i];
        if (g.ordem !== i) {
          const { error } = await supabase.from("product_groups").update({ ordem: i }).eq("id", g.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-groups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderProducts = useMutation({
    mutationFn: async ({ groupId, ordered }: { groupId: string | null; ordered: Product[] }) => {
      for (let i = 0; i < ordered.length; i++) {
        const p = ordered[i];
        if ((p.ordem ?? 0) !== i || (p.group_id ?? null) !== (groupId ?? null)) {
          const { error } = await supabase.from("products").update({ ordem: i, group_id: groupId }).eq("id", p.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const isSearching = search.trim().length > 0;

  const filtered = useMemo(
    () =>
      products.filter((p) =>
        [p.nome, p.categoria, p.codigo].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()),
      ),
    [products, search],
  );

  const groupedBy = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = p.group_id ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    // garante ordem por `ordem` dentro de cada grupo (já vem ordenado do BD, mas reforça para filtered)
    for (const [k, arr] of map) {
      arr.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome));
      map.set(k, arr);
    }
    return map;
  }, [filtered]);

  const groupsOrdered = useMemo(() => [...groups].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)), [groups]);

  function openNew() {
    setEditing({ ...empty });
    setOpen(true);
  }
  function openEdit(p: Product) {
    setEditing({ ...p });
    setOpen(true);
  }

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveGroupId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = groupsOrdered.findIndex((g) => g.id === active.id);
    const newIndex = groupsOrdered.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(groupsOrdered, oldIndex, newIndex);
    // otimista: atualiza cache local antes do servidor
    qc.setQueryData(["product-groups"], next);
    reorderGroups.mutate(next);
    toast.success("Ordem dos grupos atualizada");
  }

  function handleProductDragEnd(groupId: string | null, event: DragEndEvent) {
    const { active, over } = event;
    setActiveProductId(null);
    if (!over || active.id === over.id) return;
    const key = groupId ?? "";
    const items = groupedBy.get(key) ?? [];
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    // atualização otimista local por grupo
    // reconstruir products cache mantendo outros grupos intactos
    const nextProducts = products.map((p) => p);
    // para simplificar, invalida e deixa reorderProducts persistir
    // mas faz set otimista para feedback imediato
    const otherProducts = products.filter((p) => (p.group_id ?? "") !== key);
    const reorderedWithGroup = nextProducts.filter((p) => (p.group_id ?? "") === key);
    // substitui na ordem correta (next já está na ordem desejada)
    // cria mapa de ordem nova
    const orderMap = new Map(next.map((p, idx) => [p.id, idx]));
    const updated = products
      .map((p) => (orderMap.has(p.id) ? { ...p, ordem: orderMap.get(p.id)! } : p))
      .sort((a, b) => {
        const ga = a.group_id ?? "";
        const gb = b.group_id ?? "";
        if (ga !== gb) return 0; // mantém ordem relativa entre grupos diferente
        return (a.ordem ?? 0) - (b.ordem ?? 0);
      });
    qc.setQueryData(["products"], updated);
    reorderProducts.mutate({ groupId, ordered: next });
    toast.success("Ordem dos produtos atualizada");
  }

  function moveGroup(index: number, direction: -1 | 1) {
    const next = [...groupsOrdered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    qc.setQueryData(["product-groups"], next);
    reorderGroups.mutate(next);
  }

  function moveProduct(groupId: string | null, productId: string, direction: -1 | 1) {
    const key = groupId ?? "";
    const items = [...(groupedBy.get(key) ?? [])];
    const idx = items.findIndex((p) => p.id === productId);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= items.length) return;
    const next = arrayMove(items, idx, target);
    const orderMap = new Map(next.map((p, i) => [p.id, i]));
    const updated = products.map((p) => (orderMap.has(p.id) ? { ...p, ordem: orderMap.get(p.id)! } : p));
    qc.setQueryData(["products"], updated);
    reorderProducts.mutate({ groupId, ordered: next });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos"
        subtitle="Cadastro de salgados e suas receitas — arraste para organizar"
        icon={Package}
        actions={<Button onClick={openNew}><Plus className="mr-1.5 size-4" /> Novo produto</Button>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          {isSearching && <span className="text-xs text-amber-600">Busca ativa — reordenação desabilitada</span>}
          <Button variant="outline" onClick={() => { setGroupEditing(null); setGroupOpen(true); }}>
            <FolderPlus className="mr-1.5 size-4" /> Novo grupo
          </Button>
        </div>
      </div>

      {isSearching && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <ArrowUpDown className="size-3" /> Arraste desabilitado durante busca. Limpe a busca para reordenar.
        </p>
      )}

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Package} title="Nenhum produto" description="Cadastre seu primeiro salgado para começar."
          action={<Button onClick={openNew}><Plus className="mr-1.5 size-4" /> Novo produto</Button>} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => {
            const id = e.active.id as string;
            if (groupsOrdered.some((g) => g.id === id)) setActiveGroupId(id);
          }}
          onDragEnd={handleGroupDragEnd}
        >
          <SortableContext items={groupsOrdered.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-6">
              {groupsOrdered.map((g, groupIndex) => {
                const items = groupedBy.get(g.id) ?? [];
                // quando buscando, não mostra grupos vazios, mas mantém ordem
                if (isSearching && !items.length) return null;
                // sem busca, não mostra grupos vazios (comportamento original) — mas agora permite reordenar grupos vazios?
                // mantemos vazio oculto, mas grupo vazio ainda participa da ordenação (visível como seção vazia?)
                const showEmptyGroup = !isSearching && items.length === 0;
                if (!items.length && !showEmptyGroup && isSearching) return null;
                if (!items.length && !isSearching) {
                  // mostra grupo vazio para permitir reordenar e receber produtos
                  return (
                    <SortableGroup
                      key={g.id}
                      group={g}
                      index={groupIndex}
                      onMoveUp={() => moveGroup(groupIndex, -1)}
                      onMoveDown={() => moveGroup(groupIndex, 1)}
                      isFirst={groupIndex === 0}
                      isLast={groupIndex === groupsOrdered.length - 1}
                      disabled={isSearching}
                      onRename={() => { setGroupEditing({ id: g.id, nome: g.nome }); setGroupOpen(true); }}
                      onDelete={() => setGroupToDelete(g)}
                    >
                      <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
                        Nenhum produto neste grupo — arraste produtos para cá ou use “Editar produto” para mover.
                      </div>
                    </SortableGroup>
                  );
                }
                if (!items.length) return null;
                return (
                  <SortableGroup
                    key={g.id}
                    group={g}
                    index={groupIndex}
                    onMoveUp={() => moveGroup(groupIndex, -1)}
                    onMoveDown={() => moveGroup(groupIndex, 1)}
                    isFirst={groupIndex === 0}
                    isLast={groupIndex === groupsOrdered.length - 1}
                    disabled={isSearching}
                    onRename={() => { setGroupEditing({ id: g.id, nome: g.nome }); setGroupOpen(true); }}
                    onDelete={() => setGroupToDelete(g)}
                  >
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={(e: DragStartEvent) => setActiveProductId(e.active.id as string)}
                      onDragEnd={(e) => handleProductDragEnd(g.id, e)}
                    >
                      <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                        <ProductTable
                          items={items}
                          onEdit={openEdit}
                          onDelete={setToDelete}
                          onMoveUp={(id) => moveProduct(g.id, id, -1)}
                          onMoveDown={(id) => moveProduct(g.id, id, 1)}
                          disabled={isSearching}
                        />
                      </SortableContext>
                      <DragOverlay>
                        {activeProductId ? (
                          <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-lg opacity-90">
                            {items.find((p) => p.id === activeProductId)?.nome ?? "Produto"}
                          </div>
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  </SortableGroup>
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
                      <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">— arraste para organizar</span>
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={(e: DragStartEvent) => setActiveProductId(e.active.id as string)}
                      onDragEnd={(e) => handleProductDragEnd(null, e)}
                    >
                      <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                        <ProductTable
                          items={items}
                          onEdit={openEdit}
                          onDelete={setToDelete}
                          onMoveUp={(id) => moveProduct(null, id, -1)}
                          onMoveDown={(id) => moveProduct(null, id, 1)}
                          disabled={isSearching}
                        />
                      </SortableContext>
                      <DragOverlay>
                        {activeProductId ? (
                          <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-lg opacity-90">
                            {items.find((p) => p.id === activeProductId)?.nome ?? "Produto"}
                          </div>
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  </section>
                );
              })()}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeGroupId ? (
              <div className="rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-lg opacity-90 flex items-center gap-2">
                <GripVertical className="size-4 text-muted-foreground" />
                {groupsOrdered.find((g) => g.id === activeGroupId)?.nome}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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

function SortableGroup({
  group,
  children,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  disabled,
  onRename,
  onDelete,
}: {
  group: ProductGroup;
  children: React.ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <section ref={setNodeRef} style={style} className={isDragging ? "ring-2 ring-primary/30 rounded-xl" : ""}>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          className={`flex size-7 items-center justify-center rounded-md border bg-card hover:bg-accent ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
          {...attributes}
          {...listeners}
          disabled={disabled}
          title={disabled ? "Desabilitado durante busca" : "Arraste para reordenar grupo"}
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </button>
        <Folder className="size-4 text-muted-foreground" />
        <h3 className="font-semibold">{group.nome}</h3>
        <div className="ml-1 flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveUp} disabled={disabled || isFirst} title="Mover grupo para cima">
            <ChevronUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveDown} disabled={disabled || isLast} title="Mover grupo para baixo">
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" title="Renomear grupo" onClick={onRename}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Excluir grupo" onClick={onDelete}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
      {children}
    </section>
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

function SortableProductRow({
  product,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  product: Product;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const lvl = stockLevel(product.quantidade_atual, product.estoque_minimo, product.estoque_ideal);
  return (
    <TableRow ref={setNodeRef} style={style} className={isDragging ? "bg-accent/50" : ""}>
      <TableCell>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`flex size-6 items-center justify-center rounded hover:bg-accent ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}`}
            {...attributes}
            {...listeners}
            disabled={disabled}
            title={disabled ? "Desabilitado durante busca" : "Arraste para reordenar"}
          >
            <GripVertical className="size-3.5 text-muted-foreground" />
          </button>
          <div>
            <div className="font-medium">{product.nome}</div>
            {product.codigo && <div className="text-xs text-muted-foreground">{product.codigo}</div>}
          </div>
        </div>
      </TableCell>
      <TableCell className="capitalize">{product.tipo}</TableCell>
      <TableCell className="text-right tabular font-medium">{fmtNum(product.quantidade_atual)}</TableCell>
      <TableCell className="text-right tabular text-muted-foreground">{fmtNum(product.estoque_minimo)} / {fmtNum(product.estoque_ideal)}</TableCell>
      <TableCell><StockBadge level={lvl} /></TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveUp} disabled={disabled} title="Mover para cima">
            <ChevronUp className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveDown} disabled={disabled} title="Mover para baixo">
            <ChevronDown className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onEdit(product)}><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(product)}><Trash2 className="size-4 text-destructive" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ProductTable({
  items,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  items: Product[];
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
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
            <TableHead className="w-36 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => (
            <SortableProductRow
              key={p.id}
              product={p}
              onEdit={onEdit}
              onDelete={onDelete}
              onMoveUp={() => onMoveUp(p.id)}
              onMoveDown={() => onMoveDown(p.id)}
              disabled={disabled}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
