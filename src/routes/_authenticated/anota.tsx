import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingBag, RefreshCw, Plug, Loader2, Link2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  testAnotaConnection,
  syncAnotaOrders,
  saveAnotaMapping,
  ANOTA_CHECK_LABELS,
} from "@/lib/anota.functions";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { PageHeader, KpiCard, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/anota")({
  component: AnotaPage,
});

type Filtro = "todos" | "analise" | "producao" | "finalizados";

const CHECK_TONE: Record<number, "default" | "secondary" | "destructive" | "outline"> = {
  0: "outline",
  1: "secondary",
  2: "secondary",
  3: "default",
  4: "destructive",
  5: "destructive",
  6: "destructive",
};

function checkBadge(check: number) {
  return (
    <Badge variant={CHECK_TONE[check] ?? "outline"}>{ANOTA_CHECK_LABELS[check] ?? `Status ${check}`}</Badge>
  );
}

function AnotaPage() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const testFn = useServerFn(testAnotaConnection);
  const syncFn = useServerFn(syncAnotaOrders);
  const saveMapFn = useServerFn(saveAnotaMapping);

  const { data: orders = [] } = useQuery({
    queryKey: ["anota-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_orders")
        .select("id, external_order_id, numero, check_status, total, cliente, pedido_em, estoque_aplicado, imported_at")
        .order("imported_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["anota-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_order_items")
        .select("anota_item_ref, nome, product_id, mapeado");
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

  // Itens distintos por referência (para a tela de mapeamento)
  const distinctItems = useMemo(() => {
    const map = new Map<string, { ref: string; nome: string | null; product_id: string | null; count: number }>();
    for (const it of items) {
      const ref = it.anota_item_ref;
      if (!ref) continue;
      const cur = map.get(ref);
      if (cur) {
        cur.count++;
        if (!cur.product_id && it.product_id) cur.product_id = it.product_id;
      } else {
        map.set(ref, {
          ref,
          nome: it.nome,
          product_id: it.product_id,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.nome ?? a.ref).localeCompare(b.nome ?? b.ref));
  }, [items]);

  const pendentes = distinctItems.filter((d) => !d.product_id).length;
  const finalizadosSemBaixa = orders.filter((o) => o.check_status === 3 && !o.estoque_aplicado).length;

  // Estado local dos selects de mapeamento
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({});

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { filtro } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      qc.invalidateQueries({ queryKey: ["anota-orders"] });
      qc.invalidateQueries({ queryKey: ["anota-items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMap = useMutation({
    mutationFn: () => {
      const mappings = Object.entries(mapDraft)
        .filter(([, v]) => v)
        .map(([ref, product_id]) => {
          const d = distinctItems.find((x) => x.ref === ref);
          return { anota_item_ref: ref, nome: d?.nome ?? null, product_id: product_id === "none" ? null : product_id };
        });
      if (!mappings.length) throw new Error("Nenhuma alteração de mapeamento para salvar.");
      return saveMapFn({ data: { mappings } });
    },
    onSuccess: (r) => {
      toast.success(r.message);
      setMapDraft({});
      qc.invalidateQueries({ queryKey: ["anota-orders"] });
      qc.invalidateQueries({ queryKey: ["anota-items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anota AI"
        subtitle="Importe pedidos de venda e dê baixa automática no estoque"
        icon={ShoppingBag}
        actions={
          <>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plug className="mr-2 size-4" />}
              Testar conexão
            </Button>
            <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="analise">Em análise</SelectItem>
                <SelectItem value="producao">Em produção</SelectItem>
                <SelectItem value="finalizados">Finalizados</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Sincronizar pedidos
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Pedidos importados" value={orders.length} icon={ShoppingBag} />
        <KpiCard
          label="Itens sem mapeamento"
          value={pendentes}
          icon={Link2}
          tone={pendentes ? "warning" : "success"}
          hint={pendentes ? "Vincule para permitir a baixa" : "Tudo mapeado"}
        />
        <KpiCard
          label="Finalizados sem baixa"
          value={finalizadosSemBaixa}
          icon={AlertTriangle}
          tone={finalizadosSemBaixa ? "warning" : "success"}
        />
      </div>

      <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="font-medium">Erro "Acesso negado" ao testar conexão?</p>
            <p className="text-muted-foreground">
              A API de Pedidos do Anota AI exige um <strong>token de parceiro</strong> específico (endpoint{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">api-parceiros.anota.ai/partnerauth</code>). O token
              gerado no painel/app do restaurante <strong>não funciona</strong> aqui. Abra um chamado no suporte do
              Anota AI pedindo para <strong>habilitar a API de Pedidos</strong> na sua loja e emitir o token de
              integração de parceiro; depois volte aqui e atualize o valor do segredo <code>ANOTA_AI_TOKEN</code>. O ID
              da loja não é necessário — o token de parceiro já identifica a loja.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="pedidos">
        <TabsList>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
          <TabsTrigger value="mapeamento">
            Mapeamento{pendentes ? ` (${pendentes})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pedidos" className="pt-4">
          {orders.length === 0 ? (
            <EmptyState
              title="Nenhum pedido importado"
              description="Clique em 'Sincronizar pedidos' para buscar as vendas do Anota AI."
              icon={ShoppingBag}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{o.numero ?? o.external_order_id.slice(-6)}</td>
                      <td className="px-4 py-3">{o.cliente ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDateTime(o.pedido_em ?? o.imported_at)}</td>
                      <td className="px-4 py-3">{checkBadge(o.check_status)}</td>
                      <td className="px-4 py-3 text-right tabular">{fmtMoney(o.total)}</td>
                      <td className="px-4 py-3 text-center">
                        {o.estoque_aplicado ? (
                          <CheckCircle2 className="mx-auto size-4 text-success" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="mapeamento" className="pt-4">
          {distinctItems.length === 0 ? (
            <EmptyState
              title="Nenhum item para mapear"
              description="Sincronize pedidos primeiro. Os itens vendidos aparecerão aqui para vincular aos seus produtos."
              icon={Link2}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Vincule cada item do cardápio do Anota AI a um produto do seu sistema. A baixa de estoque só é aplicada
                em pedidos finalizados com todos os itens mapeados.
              </p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Item no Anota AI</th>
                      <th className="px-4 py-3 text-center">Ocorrências</th>
                      <th className="px-4 py-3">Produto do sistema</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {distinctItems.map((d) => {
                      const value = mapDraft[d.ref] ?? d.product_id ?? "none";
                      return (
                        <tr key={d.ref} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <span className="font-medium">{d.nome ?? d.ref}</span>
                            {!d.product_id && !mapDraft[d.ref] && (
                              <Badge variant="outline" className="ml-2 text-warning">
                                Pendente
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">{d.count}</td>
                          <td className="px-4 py-3">
                            <Select
                              value={value}
                              onValueChange={(v) => setMapDraft((s) => ({ ...s, [d.ref]: v }))}
                            >
                              <SelectTrigger className="w-64">
                                <SelectValue placeholder="Selecionar produto..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— Não vincular —</SelectItem>
                                {products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => saveMap.mutate()} disabled={saveMap.isPending}>
                  {saveMap.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Salvar mapeamento
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
