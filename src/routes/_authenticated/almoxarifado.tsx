import { useState, useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Warehouse,
  Plus,
  Pencil,
  Trash2,
  Search,
  Loader2,
  Link2,
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
  group_id: string | null;
  ordem: number;
};

type IngredientGroup = {
  id: string;
  nome: string;
  ordem: number;
};

const empty: Partial<Ingredient> = {
  nome: "", categoria: "", codigo: "", supplier_id: null, unidade: "kg",
  estoque_minimo: 0, estoque_ideal: 0, estoque_maximo: 0, preco_medio: 0, preco_ultima_compra: 0,
  localizacao: "", lote: "", observacoes: "",
  group_id: null,
};

function AlmoxarifadoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null);
  const [toDelete, setToDelete] = useState<Ingredient | null>(null);
  const [linking, setLinking] = useState<Ingredient | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeIngredientId, setActiveIngredientId] = useState<string | null>(null);

  useRealtime(
    ["ingredients", "ingredient_groups", "recipe_items"],
    ["ingredients", "ingredient-groups", "recipe-links-by-ingredient"],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .is("deleted_at", null)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return data as unknown as Ingredient[];
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ["ingredient-groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredient_groups").select("*").order("ordem").order("nome");
      if (error) throw error;
      return data as IngredientGroup[];
    },
  });

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupEditing, setGroupEditing] = useState<{ id?: string; nome: string } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<IngredientGroup | null>(null);

  const saveGroup = useMutation({
    mutationFn: async (g: { id?: string; nome: string }) => {
      const nome = g.nome.trim();
      if (!nome) throw new Error("Informe o nome do grupo.");
      if (g.id) {
        const { error } = await supabase.from("ingredient_groups").update({ nome }).eq("id", g.id);
        if (error) throw error;
      } else {
        const maxOrdem = groups.length ? Math.max(...groups.map((x) => x.ordem ?? 0)) + 1 : 0;
        const { error } = await supabase.from("ingredient_groups").insert({ nome, ordem: maxOrdem });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredient-groups"] });
      toast.success("Grupo salvo!");
      setGroupOpen(false);
      setGroupEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeGroup = useMutation({
    mutationFn: async (g: IngredientGroup) => {
      const { error } = await supabase.from("ingredient_groups").delete().eq("id", g.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredient-groups"] });
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      toast.success("Grupo removido. Insumos do grupo ficaram sem grupo.");
      setGroupToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
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
      const payload: Record<string, unknown> = {
        nome: i.nome!, categoria: i.categoria || null, codigo: i.codigo || null,
        supplier_id: i.supplier_id || null, unidade: i.unidade || "kg",
        estoque_minimo: Number(i.estoque_minimo) || 0, estoque_ideal: Number(i.estoque_ideal) || 0,
        estoque_maximo: Number(i.estoque_maximo) || 0,
        preco_medio: Number(i.preco_medio) || 0, preco_ultima_compra: Number(i.preco_ultima_compra) || 0,
        localizacao: i.localizacao || null, lote: i.lote || null,
        validade: i.validade || null, observacoes: i.observacoes || null,
        group_id: i.group_id || null,
      };
      if (i.id) {
        const { error } = await supabase.from("ingredients").update(payload as never).eq("id", i.id);
        if (error) throw error;
        await logActivity("almoxarifado", "editou insumo", i.id, { nome: i.nome });
      } else {
        // define ordem como último dentro do grupo
        const sameGroup = rows.filter((x) => (x.group_id ?? null) === (i.group_id ?? null));
        const maxOrdem = sameGroup.length ? Math.max(...sameGroup.map((x) => x.ordem ?? 0)) + 1 : 0;
        payload.ordem = maxOrdem;
        const { data, error } = await supabase.from("ingredients").insert(payload as never).select("id").single();
        if (error) throw error;
        await logActivity("almoxarifado", "criou insumo", (data as { id: string }).id, { nome: i.nome });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Insumo salvo!"); setOpen(false); setEditing(null); },
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

  const reorderGroups = useMutation({
    mutationFn: async (ordered: IngredientGroup[]) => {
      for (let i = 0; i < ordered.length; i++) {
        const g = ordered[i];
        if (g.ordem !== i) {
          const { error } = await supabase.from("ingredient_groups").update({ ordem: i }).eq("id", g.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredient-groups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderIngredients = useMutation({
    mutationFn: async ({ groupId, ordered }: { groupId: string | null; ordered: Ingredient[] }) => {
      for (let i = 0; i < ordered.length; i++) {
        const p = ordered[i];
        if ((p.ordem ?? 0) !== i || (p.group_id ?? null) !== (groupId ?? null)) {
          const { error } = await supabase.from("ingredients").update({ ordem: i, group_id: groupId }).eq("id", p.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const isSearching = search.trim().length > 0;

  const filtered = useMemo(
    () =>
      rows.filter((i) =>
        [i.nome, i.categoria, i.codigo].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );

  const groupedBy = useMemo(() => {
    const map = new Map<string, Ingredient[]>();
    for (const p of filtered) {
      const key = p.group_id ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
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
  function openEdit(i: Ingredient) {
    setEditing({ ...i });
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
    qc.setQueryData(["ingredient-groups"], next);
    reorderGroups.mutate(next);
    toast.success("Ordem dos grupos atualizada");
  }

  function handleIngredientDragEnd(groupId: string | null, event: DragEndEvent) {
    const { active, over } = event;
    setActiveIngredientId(null);
    if (!over || active.id === over.id) return;
    const key = groupId ?? "";
    const items = groupedBy.get(key) ?? [];
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    const orderMap = new Map(next.map((p, idx) => [p.id, idx]));
    const updated = rows.map((p) => (orderMap.has(p.id) ? { ...p, ordem: orderMap.get(p.id)! } : p));
    qc.setQueryData(["ingredients"], updated);
    reorderIngredients.mutate({ groupId, ordered: next });
    toast.success("Ordem dos insumos atualizada");
  }

  function moveGroup(index: number, direction: -1 | 1) {
    const next = [...groupsOrdered];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    qc.setQueryData(["ingredient-groups"], next);
    reorderGroups.mutate(next);
  }

  function moveIngredient(groupId: string | null, ingredientId: string, direction: -1 | 1) {
    const key = groupId ?? "";
    const items = [...(groupedBy.get(key) ?? [])];
    const idx = items.findIndex((p) => p.id === ingredientId);
    const target = idx + direction;
    if (idx === -1 || target < 0 || target >= items.length) return;
    const next = arrayMove(items, idx, target);
    const orderMap = new Map(next.map((p, i) => [p.id, i]));
    const updated = rows.map((p) => (orderMap.has(p.id) ? { ...p, ordem: orderMap.get(p.id)! } : p));
    qc.setQueryData(["ingredients"], updated);
    reorderIngredients.mutate({ groupId, ordered: next });
  }

  const nameSup = (id: string | null) => suppliers.find((s) => s.id === id)?.nome ?? "—";

  const productsByIngredient = new Map<string, string[]>();
  for (const l of recipeLinks) {
    const row = l as { ingredient_id: string | null; products: { nome: string } | { nome: string }[] | null };
    const prodNome = Array.isArray(row.products) ? row.products[0]?.nome : row.products?.nome;
    if (!row.ingredient_id || !prodNome) continue;
    const arr = productsByIngredient.get(row.ingredient_id) ?? [];
    arr.push(prodNome);
    productsByIngredient.set(row.ingredient_id, arr);
  }

  const linkedNames = (id: string) => {
    const ps = productsByIngredient.get(id) ?? [];
    if (!ps.length) return "—";
    return ps.length > 3 ? `${ps.slice(0, 3).join(", ")} +${ps.length - 3}` : ps.join(", ");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Almoxarifado" subtitle="Insumos e matérias-primas — arraste para organizar" icon={Warehouse}
        actions={<Button onClick={openNew}><Plus className="mr-1.5 size-4" /> Novo insumo</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar insumo..." value={search} onChange={(e) => setSearch(e.target.value)} />
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

      {isLoading ? <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Warehouse} title="Nenhum insumo cadastrado" />
        : (
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
                  if (isSearching && !items.length) return null;
                  if (!items.length && !isSearching) {
                    return (
                      <SortableGroup
                        key={g.id}
                        group={g}
                        onMoveUp={() => moveGroup(groupIndex, -1)}
                        onMoveDown={() => moveGroup(groupIndex, 1)}
                        isFirst={groupIndex === 0}
                        isLast={groupIndex === groupsOrdered.length - 1}
                        disabled={isSearching}
                        onRename={() => { setGroupEditing({ id: g.id, nome: g.nome }); setGroupOpen(true); }}
                        onDelete={() => setGroupToDelete(g)}
                      >
                        <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
                          Nenhum insumo neste grupo — arraste insumos para cá ou use “Editar insumo” para mover.
                        </div>
                      </SortableGroup>
                    );
                  }
                  if (!items.length) return null;
                  return (
                    <SortableGroup
                      key={g.id}
                      group={g}
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
                        onDragStart={(e: DragStartEvent) => setActiveIngredientId(e.active.id as string)}
                        onDragEnd={(e) => handleIngredientDragEnd(g.id, e)}
                      >
                        <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                          <IngredientTable
                            items={items}
                            nameSup={nameSup}
                            linkedNames={linkedNames}
                            onEdit={openEdit}
                            onDelete={setToDelete}
                            onLink={setLinking}
                            onMoveUp={(id) => moveIngredient(g.id, id, -1)}
                            onMoveDown={(id) => moveIngredient(g.id, id, 1)}
                            disabled={isSearching}
                          />
                        </SortableContext>
                        <DragOverlay>
                          {activeIngredientId ? (
                            <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-lg opacity-90">
                              {items.find((p) => p.id === activeIngredientId)?.nome ?? "Insumo"}
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
                        onDragStart={(e: DragStartEvent) => setActiveIngredientId(e.active.id as string)}
                        onDragEnd={(e) => handleIngredientDragEnd(null, e)}
                      >
                        <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                          <IngredientTable
                            items={items}
                            nameSup={nameSup}
                            linkedNames={linkedNames}
                            onEdit={openEdit}
                            onDelete={setToDelete}
                            onLink={setLinking}
                            onMoveUp={(id) => moveIngredient(null, id, -1)}
                            onMoveDown={(id) => moveIngredient(null, id, 1)}
                            disabled={isSearching}
                          />
                        </SortableContext>
                        <DragOverlay>
                          {activeIngredientId ? (
                            <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-lg opacity-90">
                              {items.find((p) => p.id === activeIngredientId)?.nome ?? "Insumo"}
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
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} insumo</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome" className="col-span-2"><Input value={editing.nome ?? ""} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></Field>
              <Field label="Categoria"><Input value={editing.categoria ?? ""} onChange={(e) => setEditing({ ...editing, categoria: e.target.value })} /></Field>
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
              placeholder="Ex.: Farinhas, Recheios..."
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
              Os insumos deste grupo ficarão sem grupo. O histórico dos insumos é mantido.
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
  group: IngredientGroup;
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
  return <div className={"space-y-1.5 " + (className ?? "")}><Label className="text-xs">{label}</Label>{children}</div>;
}
function Num({ v, set }: { v: number | undefined; set: (n: number) => void }) {
  return <Input type="number" step="any" value={v ?? 0} onChange={(e) => set(Number(e.target.value))} />;
}

function SortableIngredientRow({
  ingredient,
  supplierName,
  linked,
  onEdit,
  onDelete,
  onLink,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  ingredient: Ingredient;
  supplierName: string;
  linked: string;
  onEdit: (i: Ingredient) => void;
  onDelete: (i: Ingredient) => void;
  onLink: (i: Ingredient) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ingredient.id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const lvl = stockLevel(ingredient.quantidade_atual, ingredient.estoque_minimo, ingredient.estoque_ideal);
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
            <div className="font-medium">{ingredient.nome}</div>
            <div className="text-xs text-muted-foreground">{ingredient.categoria || "—"}{ingredient.codigo ? ` · ${ingredient.codigo}` : ""}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{supplierName}</TableCell>
      <TableCell className="text-right tabular font-medium">{fmtNum(ingredient.quantidade_atual, 2)} {ingredient.unidade}</TableCell>
      <TableCell className="text-right tabular text-muted-foreground">{fmtNum(ingredient.estoque_minimo, 2)} / {fmtNum(ingredient.estoque_ideal, 2)}</TableCell>
      <TableCell className="text-right tabular">{fmtMoney(ingredient.preco_medio)}</TableCell>
      <TableCell className="text-muted-foreground">{fmtDate(ingredient.validade)}</TableCell>
      <TableCell className="text-muted-foreground">{linked}</TableCell>
      <TableCell><StockBadge level={lvl} /></TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveUp} disabled={disabled} title="Mover para cima">
            <ChevronUp className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onMoveDown} disabled={disabled} title="Mover para baixo">
            <ChevronDown className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" title="Vincular produtos" onClick={() => onLink(ingredient)}><Link2 className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onEdit(ingredient)}><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(ingredient)}><Trash2 className="size-4 text-destructive" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function IngredientTable({
  items,
  nameSup,
  linkedNames,
  onEdit,
  onDelete,
  onLink,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  items: Ingredient[];
  nameSup: (id: string | null) => string;
  linkedNames: (id: string) => string;
  onEdit: (i: Ingredient) => void;
  onDelete: (i: Ingredient) => void;
  onLink: (i: Ingredient) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Insumo</TableHead><TableHead>Fornecedor</TableHead>
          <TableHead className="text-right">Estoque</TableHead><TableHead className="text-right">Mín/Ideal</TableHead>
          <TableHead className="text-right">Preço médio</TableHead><TableHead>Validade</TableHead>
          <TableHead>Produtos vinculados</TableHead><TableHead>Situação</TableHead><TableHead className="w-44 text-right">Ações</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {items.map((i) => (
            <SortableIngredientRow
              key={i.id}
              ingredient={i}
              supplierName={nameSup(i.supplier_id)}
              linked={linkedNames(i.id)}
              onEdit={onEdit}
              onDelete={onDelete}
              onLink={onLink}
              onMoveUp={() => onMoveUp(i.id)}
              onMoveDown={() => onMoveDown(i.id)}
              disabled={disabled}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
