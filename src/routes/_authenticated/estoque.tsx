import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Search, ArrowRightLeft, Loader2, Printer, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtNum, stockLevel } from "@/lib/format";
import { printStockReport } from "@/lib/export";
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

export const Route = createFileRoute("/_authenticated/estoque")({
  component: EstoquePage,
});

type Product = {
  id: string; nome: string; unidade: string;
  quantidade_atual: number; quantidade_reservada: number;
  estoque_minimo: number; estoque_ideal: number;
  group_id: string | null;
};

type ProductGroup = {
  id: string;
  nome: string;
  ordem: number;
};

function EstoquePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [mv, setMv] = useState<{ product: Product; tipo: string; qtd: number; obs: string } | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupEditing, setGroupEditing] = useState<{ id?: string; nome: string } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ProductGroup | null>(null);

  useRealtime(["products", "product_movements", "anota_orders", "anota_order_items", "product_groups"], ["stock", "dashboard", "product-groups"]);

  const { data, isLoading } = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const [prodR, scheduledR] = await Promise.all([
        supabase
          .from("products")
          .select("id, nome, unidade, quantidade_atual, quantidade_reservada, estoque_minimo, estoque_ideal, group_id")
          .is("deleted_at", null).order("nome"),
        supabase
          .from("anota_orders")
          .select("id")
          .eq("check_status", -2),
      ]);
      if (prodR.error) throw prodR.error;
      const scheduledOrders = scheduledR.data ?? [];
      let scheduledItems: { product_id: string | null; quantidade: number }[] = [];
      if (scheduledOrders.length > 0) {
        const itemsR = await supabase
          .from("anota_order_items")
          .select("product_id, quantidade")
          .in("order_id", scheduledOrders.map((o: { id: string }) => o.id))
          .eq("mapeado", true)
          .not("product_id", "is", null);
        scheduledItems = itemsR.data ?? [];
      }
      const scheduledImpact = new Map<string, number>();
      for (const it of scheduledItems) {
        if (!it.product_id) continue;
        scheduledImpact.set(it.product_id, (scheduledImpact.get(it.product_id) ?? 0) + Number(it.quantidade));
      }
      return { rows: prodR.data as Product[], scheduledImpact };
    },
  });

  const rows = data?.rows ?? [];
  const scheduledImpact = data?.scheduledImpact ?? new Map<string, number>();

  const { data: groups = [] } = useQuery({
    queryKey: ["product-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_groups").select("*").order("ordem").order("nome");
      if (error) throw error;
      return data as ProductGroup[];
    },
  });

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
      qc.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Grupo removido. Produtos do grupo ficaram sem grupo.");
      setGroupToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
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

  const groupedBy = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = p.group_id ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [filtered]);

  const handlePrint = () => {
    printStockReport(filtered.map((p) => {
      const reservado = scheduledImpact.get(p.id) ?? 0;
      return {
        nome: p.nome,
        atual: Number(p.quantidade_atual),
        reservado,
        disponivel: Number(p.quantidade_atual) - reservado,
        minimo: Number(p.estoque_minimo),
        ideal: Number(p.estoque_ideal),
        situacao: Number(p.quantidade_atual) <= Number(p.estoque_minimo) ? "Abaixo do mín." : "OK",
      };
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Estoque de Acabados" subtitle="Saldos, reservas e movimentações" icon={Boxes}
        actions={<Button variant="outline" size="sm" onClick={handlePrint}><Printer className="mr-1.5 size-4" /> PDF</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => { setGroupEditing(null); setGroupOpen(true); }}>
          <FolderPlus className="mr-1.5 size-4" /> Novo grupo
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">A coluna "Reservado" mostra a quantidade agendada em pedidos futuros (agendados).</p>

      {isLoading ? <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        : filtered.length === 0 ? <EmptyState icon={Boxes} title="Nenhum produto em estoque" />
        : (
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
                  <StockTable items={items} scheduledImpact={scheduledImpact}
                    onMove={(p) => setMv({ product: p, tipo: "entrada", qtd: 0, obs: "" })} />
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
                  <StockTable items={items} scheduledImpact={scheduledImpact}
                    onMove={(p) => setMv({ product: p, tipo: "entrada", qtd: 0, obs: "" })} />
                </section>
              );
            })()}
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

function StockTable({
  items,
  scheduledImpact,
  onMove,
}: {
  items: Product[];
  scheduledImpact: Map<string, number>;
  onMove: (p: Product) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
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
          {items.map((p) => {
            const reservado = scheduledImpact.get(p.id) ?? 0;
            const disp = p.quantidade_atual - reservado;
            const lvl = stockLevel(p.quantidade_atual, p.estoque_minimo, p.estoque_ideal);
            return (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.nome}</TableCell>
                <TableCell className="text-right tabular">{fmtNum(p.quantidade_atual)}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{fmtNum(reservado)}</TableCell>
                <TableCell className="text-right tabular font-medium">{fmtNum(disp)}</TableCell>
                <TableCell><StockBadge level={lvl} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => onMove(p)}>
                    <ArrowRightLeft className="mr-1.5 size-3.5" /> Movimentar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}