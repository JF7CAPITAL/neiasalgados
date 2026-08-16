import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpFromLine, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { PageHeader } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/saidas")({
  component: SaidasPage,
});

type Line = { item_id: string; qtd: number };
type Kind = "insumo" | "produto";

function SaidasPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("produto");
  const [lines, setLines] = useState<Line[]>([{ item_id: "", qtd: 0 }]);
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");

  const resetForm = () => {
    setLines([{ item_id: "", qtd: 0 }]);
    setDestino("");
    setObs("");
  };

  const { data: ingredients = [] } = useQuery({
    queryKey: ["ingredients-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, nome, unidade")
        .is("deleted_at", null)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, nome")
        .is("deleted_at", null)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const options = kind === "insumo" ? ingredients : products;

  const confirm = useMutation({
    mutationFn: async () => {
      const valid = lines.filter((l) => l.item_id && l.qtd > 0);
      if (!valid.length) throw new Error("Adicione ao menos um item com quantidade.");
      if (kind === "insumo") {
        const { error } = await supabase.from("ingredient_movements").insert(
          valid.map((l) => ({
            ingredient_id: l.item_id,
            tipo: "saida" as const,
            quantidade: l.qtd,
            motivo: destino || "Saída manual",
            observacoes: obs || null,
          })),
        );
        if (error) throw error;
        await logActivity("saidas", "registrou saídas de insumo", null, {
          itens: valid.length,
          destino,
        });
      } else {
        const { error } = await supabase.from("product_movements").insert(
          valid.map((l) => ({
            product_id: l.item_id,
            tipo: "saida" as const,
            quantidade: l.qtd,
            destino: destino || null,
            observacoes: obs || null,
          })),
        );
        if (error) throw error;
        await logActivity("saidas", "registrou saídas de produto", null, {
          itens: valid.length,
          destino,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Saídas registradas e estoque atualizado!");
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lançar Saídas"
        subtitle="Registro de saídas de estoque (insumos e produtos)"
        icon={ArrowUpFromLine}
      />

      <div className="mx-auto w-full max-w-2xl space-y-4 rounded-xl border border-border bg-card p-5">
        <Tabs
          value={kind}
          onValueChange={(v) => {
            setKind(v as Kind);
            resetForm();
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="insumo">Insumos (Almoxarifado)</TabsTrigger>
            <TabsTrigger value="produto">Produtos Acabados</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{kind === "insumo" ? "Insumo" : "Produto"}</Label>
                <Select
                  value={l.item_id}
                  onValueChange={(v) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, item_id: v } : x)))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.nome}
                        {"unidade" in o && o.unidade ? ` (${o.unidade})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1.5">
                <Label className="text-xs">Qtd</Label>
                <Input
                  type="number"
                  step="any"
                  value={l.qtd}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, j) => (j === i ? { ...x, qtd: Number(e.target.value) } : x)),
                    )
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
                disabled={lines.length === 1}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setLines([...lines, { item_id: "", qtd: 0 }])}
        >
          <Plus className="mr-1.5 size-4" /> Adicionar item
        </Button>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Destino</Label>
            <Input
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="Cliente, loja, evento..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>

        <Button className="w-full" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          {confirm.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Confirmar saída
        </Button>
      </div>
    </div>
  );
}
