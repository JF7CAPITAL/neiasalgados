import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type RecipeItem = {
  id: string;
  ingredient_id: string | null;
  filling_id: string | null;
  quantidade: number;
  unidade: string | null;
  ingredients?: { nome: string; unidade: string } | null;
  fillings?: { nome: string; unidade: string } | null;
};

/**
 * BOM editor. Works for products (recipe_items) and fillings (filling_recipe_items).
 * For fillings, only ingredients can be linked.
 */
export function RecipeEditor({ productId, fillingId }: { productId?: string; fillingId?: string }) {
  const qc = useQueryClient();
  const isFilling = !!fillingId;
  const table = isFilling ? "filling_recipe_items" : "recipe_items";
  const ownerKey = isFilling ? "filling_id" : "product_id";
  const ownerId = fillingId ?? productId!;
  const queryKey = ["recipe", table, ownerId];

  const [type, setType] = useState<"ingredient" | "filling">("ingredient");
  const [refId, setRefId] = useState("");
  const [qtd, setQtd] = useState<number>(0);

  const { data: items = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const sel = isFilling
        ? "id, ingredient_id, quantidade, unidade, ingredients(nome, unidade)"
        : "id, ingredient_id, filling_id, quantidade, unidade, ingredients(nome, unidade), fillings(nome, unidade)";
      const { data, error } = await (supabase.from(table) as any).select(sel).eq(ownerKey, ownerId);
      if (error) throw error;
      return data as unknown as RecipeItem[];
    },
  });

  const { data: ingredients = [] } = useQuery({
    queryKey: ["ingredients-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("id, nome, unidade").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: fillings = [] } = useQuery({
    queryKey: ["fillings-lite"],
    enabled: !isFilling,
    queryFn: async () => {
      const { data, error } = await supabase.from("fillings").select("id, nome, unidade").is("deleted_at", null).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!refId) throw new Error("Selecione um item.");
      const source = type === "ingredient" ? ingredients : fillings;
      const unidade = source.find((s) => s.id === refId)?.unidade ?? "un";
      const payload: Record<string, unknown> = { [ownerKey]: ownerId, quantidade: qtd, unidade };
      if (type === "ingredient") payload.ingredient_id = refId;
      else payload.filling_id = refId;
      const { error } = await (supabase.from(table) as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setRefId(""); setQtd(0);
      toast.success("Item adicionado à receita.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const options = type === "ingredient" ? ingredients : fillings;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Vincule insumos do almoxarifado{!isFilling && " ou recheios"} consumidos por unidade produzida. Tudo parametrizável.
      </p>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[130px_1fr_110px_auto]">
        {!isFilling && (
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={type} onValueChange={(v) => { setType(v as "ingredient" | "filling"); setRefId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ingredient">Insumo</SelectItem>
                <SelectItem value="filling">Recheio</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Item</Label>
          <Select value={refId} onValueChange={setRefId}>
            <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
            <SelectContent>
              {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Qtd/unid.</Label>
          <Input type="number" step="any" value={qtd} onChange={(e) => setQtd(Number(e.target.value))} />
        </div>
        <div className="flex items-end">
          <Button onClick={() => add.mutate()} disabled={add.isPending || !refId} className="w-full">
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum item na receita ainda.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.ingredients?.nome ?? it.fillings?.nome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{it.filling_id ? "Recheio" : "Insumo"}</TableCell>
                  <TableCell className="text-right tabular">{fmtNum(it.quantidade, 3)} {it.unidade}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => del.mutate(it.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
