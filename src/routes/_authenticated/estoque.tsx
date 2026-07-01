import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Search, ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtNum, stockLevel } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { StockBadge } from "@/components/erp/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/estoque")({
  component: EstoquePage,
});

type Product = {
  id: string; nome: string; unidade: string;
  quantidade_atual: number; quantidade_reservada: number;
  estoque_minimo: number; estoque_ideal: number;
};

function EstoquePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [mv, setMv] = useState<{ product: Product; tipo: string; qtd: number; obs: string } | null>(null);
  useRealtime(["products", "product_movements"], ["stock", "dashboard"]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, nome, unidade, quantidade_atual, quantidade_reservada, estoque_minimo, estoque_ideal")
        .is("deleted_at", null).order("nome");
      if (error) throw error;
      return data as Product[];
    },
  });

  const apply = useMutation({
    mutationFn: async (m: { product: Product; tipo: string; qtd: number; obs: string }) => {
      const { error } = await supabase.from("product_movements").insert({
        product_id: m.product.id,
        tipo: m.tipo as "entrada" | "saida" | "ajuste" | "perda" | "inventario",
        quantidade: m.qtd,
        observacoes: m.obs || null,
      });
      if (error) throw error;
      await logActivity("estoque", `movimentação ${m.tipo}`, m.product.id, { qtd: m.qtd });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock"] }); toast.success("Movimentação registrada!"); setMv(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((p) => p.nome.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Estoque de Acabados" subtitle="Saldos, reservas e movimentações" icon={Boxes} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Boxes} title="Nenhum produto em estoque" />
        : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Atual</TableHead>
                <TableHead className="text-right">Reservado</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-32 text-right">Ação</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const disp = p.quantidade_atual - p.quantidade_reservada;
                  const lvl = stockLevel(p.quantidade_atual, p.estoque_minimo, p.estoque_ideal);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="text-right tabular">{fmtNum(p.quantidade_atual)}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{fmtNum(p.quantidade_reservada)}</TableCell>
                      <TableCell className="text-right tabular font-medium">{fmtNum(disp)}</TableCell>
                      <TableCell><StockBadge level={lvl} /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setMv({ product: p, tipo: "entrada", qtd: 0, obs: "" })}>
                          <ArrowRightLeft className="mr-1.5 size-3.5" /> Movimentar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={!!mv} onOpenChange={(o) => !o && setMv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Movimentar — {mv?.product.nome}</DialogTitle></DialogHeader>
          {mv && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select value={mv.tipo} onValueChange={(v) => setMv({ ...mv, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrada">Entrada</SelectItem>
                    <SelectItem value="saida">Saída</SelectItem>
                    <SelectItem value="ajuste">Ajuste</SelectItem>
                    <SelectItem value="perda">Perda</SelectItem>
                    <SelectItem value="inventario">Inventário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Quantidade</Label>
                <Input type="number" step="any" value={mv.qtd} onChange={(e) => setMv({ ...mv, qtd: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">Ajuste/Inventário define o saldo final; demais tipos somam/subtraem.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea value={mv.obs} onChange={(e) => setMv({ ...mv, obs: e.target.value })} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMv(null)}>Cancelar</Button>
                <Button onClick={() => apply.mutate(mv)} disabled={apply.isPending}>
                  {apply.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} Confirmar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
