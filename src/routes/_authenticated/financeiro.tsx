import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, Calculator, FileSpreadsheet,
  Plus, Pencil, Trash2, Lock, Unlock, Eye, EyeOff, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Save, X, RefreshCw, DollarSign, Users, Package
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtMoney, fmtNum, fmtDate } from "@/lib/format";
import { downloadExcel, downloadCSV, downloadXLSX } from "@/lib/export";
import { PageHeader, KpiCard, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroPage,
});

type DreEntry = {
  id: string;
  tipo: "receita" | "custo_direto" | "despesa_operacional" | "despesa_administrativa" | "despesa_financeira" | "outros";
  categoria: string;
  descricao: string | null;
  valor: number;
  competencia: string;
  recorrente: boolean;
  created_at: string;
  created_by: string | null;
  fonte: "auto" | "manual";
};

type DreRow = {
  secao: string;
  categoria: string;
  descricao: string;
  valor: number;
  fonte: "auto" | "manual";
  id?: string;
  editable?: boolean;
};

const DRE_TIPOS = [
  { value: "receita", label: "Receita" },
  { value: "custo_direto", label: "Custo Direto (CMV)" },
  { value: "despesa_operacional", label: "Despesa Operacional" },
  { value: "despesa_administrativa", label: "Despesa Administrativa" },
  { value: "despesa_financeira", label: "Despesa Financeira" },
  { value: "outros", label: "Outros" },
] as const;

const COMPETENCIA_DEFAULT = new Date().toISOString().split("T")[0].slice(0, 7) + "-01";

function FinanceiroPage() {
  const qc = useQueryClient();
  const [periodoInicio, setPeriodoInicio] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split("T")[0]);
  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isFirstAccess, setIsFirstAccess] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [dreEntries, setDreEntries] = useState<DreEntry[]>([]);
  const [editingEntry, setEditingEntry] = useState<DreEntry | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DreEntry | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  useRealtime(["finance_dre_entries", "finance_access"], ["finance-dre", "finance-access"]);

  // Fetch orders count for ticket médio
  const { data: ordersCount = 0 } = useQuery({
    queryKey: ["finance-orders-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("anota_orders")
        .select("*", { count: "exact", head: true })
        .eq("check_status", 3)
        .eq("estoque_aplicado", true);
      return count ?? 0;
    },
    enabled: unlocked,
  });

  // Check if password is set on mount
  useEffect(() => {
    checkPasswordSetup();
  }, []);

  const checkPasswordSetup = async () => {
    const { data } = await supabase.from("finance_access").select("id, password_hash").single();
    if (data && !data.password_hash) {
      setIsFirstAccess(true);
      setPasswordModal(true);
    } else {
      setPasswordModal(true);
    }
  };

  const verifyPassword = useCallback(async (pwd: string) => {
    const { data } = await supabase.from("finance_access").select("password_hash").single();
    if (!data) return false;
    if (!data.password_hash) return true; // first access
    // Simple hash comparison (in production, use proper hashing)
    return data.password_hash === btoa(pwd);
  }, []);

  const setPasswordHash = useMutation({
    mutationFn: async (pwd: string) => {
      const hash = btoa(pwd);
      // First get the ID
      const { data: accessData, error: selectError } = await supabase.from("finance_access").select("id").single();
      if (selectError || !accessData?.id) throw new Error("Não foi possível identificar o registro de acesso");
      const { error } = await supabase.from("finance_access").update({ password_hash: hash }).eq("id", accessData.id);
      if (error) throw error;
      await logActivity("financeiro", "definiu senha de acesso", null, {});
    },
    onSuccess: () => {
      setUnlocked(true);
      setPasswordModal(false);
      setIsFirstAccess(false);
      toast.success("Senha definida com sucesso!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlock = useMutation({
    mutationFn: async (pwd: string) => {
      const ok = await verifyPassword(pwd);
      if (!ok) throw new Error("Senha incorreta");
      return true;
    },
    onSuccess: () => {
      setUnlocked(true);
      setPasswordModal(false);
      toast.success("Acesso liberado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isFirstAccess) {
      if (password !== confirmPassword) {
        toast.error("As senhas não conferem");
        return;
      }
      if (password.length < 4) {
        toast.error("A senha deve ter pelo menos 4 caracteres");
        return;
      }
      setPasswordHash.mutate(password);
    } else {
      unlock.mutate(password);
    }
  };

  // Fetch DRE entries
  const { data: manualEntries = [], refetch: refetchEntries } = useQuery({
    queryKey: ["finance-dre-entries", periodoInicio, periodoFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_dre_entries")
        .select("*")
        .gte("competencia", periodoInicio)
        .lte("competencia", periodoFim)
        .order("competencia", { ascending: false })
        .order("tipo");
      if (error) throw error;
      return (data ?? []) as DreEntry[];
    },
    enabled: unlocked,
  });

  // Fetch auto-calculated DRE data
  const { data: autoDre = [], isLoading: dreLoading } = useQuery({
    queryKey: ["finance-dre-auto", periodoInicio, periodoFim],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dre_data", {
        p_inicio: periodoInicio,
        p_fim: periodoFim,
      });
      if (error) throw error;
      return (data ?? []) as DreRow[];
    },
    enabled: unlocked,
  });

  // Combine auto and manual entries
  const allDreRows = useMemo(() => {
    const rows: DreRow[] = [...autoDre];
    for (const e of manualEntries) {
      rows.push({
        secao: e.tipo.toUpperCase().replace("_", " "),
        categoria: e.categoria,
        descricao: e.descricao ?? "",
        valor: Number(e.valor),
        fonte: "manual",
        id: e.id,
        editable: true,
      });
    }
    return rows;
  }, [autoDre, manualEntries]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const receita = allDreRows.filter(r => r.secao === "RECEITA BRUTA").reduce((s, r) => s + r.valor, 0);
    const custoDireto = allDreRows.filter(r => r.secao === "CUSTO DIRETO (CMV)").reduce((s, r) => s + r.valor, 0);
    const lucroBruto = receita - custoDireto;
    const despesasOp = allDreRows.filter(r => r.secao === "DESPESAS OPERACIONAIS").reduce((s, r) => s + r.valor, 0);
    const outrasDespesas = allDreRows
      .filter(r => ["DESPESA ADMINISTRATIVA", "DESPESA FINANCEIRA", "OUTROS"].includes(r.secao))
      .reduce((s, r) => s + r.valor, 0);
    const resultado = lucroBruto - despesasOp - outrasDespesas;
    const margem = receita > 0 ? ((resultado / receita) * 100) : 0;

    return { receita, custoDireto, lucroBruto, despesasOp, outrasDespesas, resultado, margem };
  }, [allDreRows]);

  const saveEntry = useMutation({
    mutationFn: async (entry: Partial<DreEntry> & { id?: string }) => {
      const payload = {
        tipo: entry.tipo!,
        categoria: entry.categoria!,
        descricao: entry.descricao || null,
        valor: Number(entry.valor) || 0,
        competencia: entry.competencia || COMPETENCIA_DEFAULT,
        recorrente: entry.recorrente ?? false,
      };
      if (entry.id) {
        const { error } = await supabase.from("finance_dre_entries").update(payload).eq("id", entry.id);
        if (error) throw error;
        await logActivity("financeiro", "editou lançamento DRE", entry.id, { categoria: entry.categoria });
      } else {
        const { data, error } = await supabase.from("finance_dre_entries").insert(payload).select("id").single();
        if (error) throw error;
        await logActivity("financeiro", "criou lançamento DRE", data.id, { categoria: entry.categoria });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      toast.success("Lançamento salvo!");
      setEditingEntry(null);
      setNewEntryOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("finance_dre_entries").delete().eq("id", id);
      if (error) throw error;
      await logActivity("financeiro", "excluiu lançamento DRE", id, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      toast.success("Lançamento removido!");
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleExport = async (format: "xlsx" | "csv") => {
    setExportLoading(true);
    try {
      const headers = [
        { key: "secao", label: "Seção" },
        { key: "categoria", label: "Categoria" },
        { key: "descricao", label: "Descrição" },
        { key: "valor", label: "Valor" },
        { key: "fonte", label: "Fonte" },
      ];
      const rows = allDreRows.map(r => ({
        secao: r.secao,
        categoria: r.categoria,
        descricao: r.descricao,
        valor: fmtMoney(r.valor),
        fonte: r.fonte === "auto" ? "Automático (Plataforma)" : "Manual (Contador)",
      }));
      // Add summary rows
      const summaryRows = [
        { secao: "", categoria: "", descricao: "", valor: "", fonte: "" },
        { secao: "TOTAL", categoria: "Receita Bruta", descricao: "", valor: fmtMoney(kpis.receita), fonte: "" },
        { secao: "TOTAL", categoria: "Custo Direto (CMV)", descricao: "", valor: fmtMoney(kpis.custoDireto), fonte: "" },
        { secao: "TOTAL", categoria: "Lucro Bruto", descricao: "", valor: fmtMoney(kpis.lucroBruto), fonte: "" },
        { secao: "TOTAL", categoria: "Despesas Operacionais", descricao: "", valor: fmtMoney(kpis.despesasOp), fonte: "" },
        { secao: "TOTAL", categoria: "Outras Despesas", descricao: "", valor: fmtMoney(kpis.outrasDespesas), fonte: "" },
        { secao: "TOTAL", categoria: "Resultado Líquido", descricao: "", valor: fmtMoney(kpis.resultado), fonte: "" },
      ];
      const allRows = [...rows, ...summaryRows];
      const filename = `DRE_Neia_Salgados_${periodoInicio}_a_${periodoFim}`;
      if (format === "xlsx") {
        downloadXLSX(filename, [
          { name: "DRE Detalhado", headers, rows: allRows },
          { name: "Resumo", headers: [
            { key: "categoria", label: "Categoria" },
            { key: "valor", label: "Valor" },
          ], rows: [
            { categoria: "Receita Bruta", valor: fmtMoney(kpis.receita) },
            { categoria: "Custo Direto (CMV)", valor: fmtMoney(kpis.custoDireto) },
            { categoria: "Lucro Bruto", valor: fmtMoney(kpis.lucroBruto) },
            { categoria: "Despesas Operacionais", valor: fmtMoney(kpis.despesasOp) },
            { categoria: "Outras Despesas", valor: fmtMoney(kpis.outrasDespesas) },
            { categoria: "Resultado Líquido", valor: fmtMoney(kpis.resultado) },
            { categoria: "Margem Líquida", valor: `${kpis.margem.toFixed(1)}%` },
          ]},
        ]);
      } else {
        downloadCSV(filename, allRows, headers);
      }
      toast.success(`${format.toUpperCase()} exportado com sucesso!`);
    } catch (e) {
      toast.error("Erro ao exportar");
    } finally {
      setExportLoading(false);
    }
  };

  // Password modal - must render first
  if (passwordModal) {
    return (
      <Dialog open={true} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Lock className="size-5" />
              </div>
              <DialogTitle className="text-center">Acesso ao Financeiro</DialogTitle>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {isFirstAccess
                ? "Defina uma senha para proteger o acesso ao módulo financeiro."
                : "Digite a senha para acessar o módulo financeiro."}
            </p>
          </DialogHeader>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Senha</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isFirstAccess ? "Nova senha (mín. 4 caracteres)" : "Digite a senha"}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            {isFirstAccess && (
              <div className="space-y-1.5">
                <Label className="text-xs">Confirmar senha</Label>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirme a nova senha"
                />
              </div>
            )}
            <DialogFooter className="flex-col gap-2">
              {isFirstAccess && (
                <Button variant="outline" type="button" onClick={() => { setPassword(""); setConfirmPassword(""); }}>
                  Cancelar
                </Button>
              )}
              <Button type="submit" disabled={isFirstAccess ? (password !== confirmPassword || password.length < 4) : !password} className="w-full">
                {(isFirstAccess ? setPasswordHash : unlock).isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isFirstAccess ? "Definir senha e acessar" : "Desbloquear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  if (!unlocked) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        subtitle="DRE, indicadores e controle de custos"
        icon={Wallet}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["finance-dre-auto"] })} disabled={dreLoading}>
              <RefreshCw className={`mr-1.5 size-4 ${dreLoading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={exportLoading}>
              <FileSpreadsheet className="mr-1.5 size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")} disabled={exportLoading}>
              <FileSpreadsheet className="mr-1.5 size-4" /> Excel
            </Button>
          </>
        }
      />

      {/* Period Selector */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Período inicial</Label>
          <Input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Período final</Label>
          <Input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DollarSign className="size-4" />
          <span>Valores em BRL · Competência: {new Date(periodoInicio).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} a {new Date(periodoFim).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-7">
        <KpiCard label="Receita Bruta" value={fmtMoney(kpis.receita)} icon={TrendingUp} tone="success" hint="Vendas Anota AI finalizadas" />
        <KpiCard label="Custo Direto (CMV)" value={fmtMoney(kpis.custoDireto)} icon={Package} tone="warning" hint="Insumos consumidos no período" />
        <KpiCard label="Lucro Bruto" value={fmtMoney(kpis.lucroBruto)} icon={PiggyBank} tone={kpis.lucroBruto >= 0 ? "success" : "danger"} hint="Receita - CMV" />
        <KpiCard label="Folha (Estimada)" value={fmtMoney(kpis.despesasOp)} icon={Users} tone="info" hint="Baseado em colaboradores ativos" />
        <KpiCard label="Outras Despesas" value={fmtMoney(kpis.outrasDespesas)} icon={Calculator} tone="danger" hint="Lançamentos manuais" />
        <KpiCard label="Resultado Líquido" value={fmtMoney(kpis.resultado)} icon={TrendingDown} tone={kpis.resultado >= 0 ? "success" : "danger"} hint={kpis.resultado >= 0 ? "Lucro" : "Prejuízo"} />
        <KpiCard label="Margem Líquida" value={`${kpis.margem.toFixed(1)}%`} icon={Calculator} tone={kpis.margem >= 0 ? "success" : "danger"} hint="Resultado / Receita" />
      </div>

      {/* Insights */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" /> Insights Automáticos
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InsightCard
            title="Margem de Contribuição"
            value={`${kpis.receita > 0 ? ((kpis.lucroBruto / kpis.receita) * 100).toFixed(1) : 0}%`}
            description="Lucro Bruto / Receita"
            tone={kpis.lucroBruto >= 0 ? "success" : "danger"}
          />
          <InsightCard
            title="Custo Fixo / Receita"
            value={`${kpis.receita > 0 ? ((kpis.despesasOp / kpis.receita) * 100).toFixed(1) : 0}%`}
            description="Folha estimada sobre faturamento"
            tone={kpis.despesasOp / (kpis.receita || 1) > 0.4 ? "warning" : "success"}
          />
          <InsightCard
            title="Ponto de Equilíbrio"
            value={fmtMoney(kpis.custoDireto + kpis.despesasOp + kpis.outrasDespesas)}
            description="Faturamento mínimo p/ não ter prejuízo"
            tone="info"
          />
          <InsightCard
            title="Ticket Médio Estimado"
            value={fmtMoney(kpis.receita / Math.max(1, ordersCount))}
            description="Receita / Nº de pedidos finalizados"
            tone="info"
          />
        </div>
      </div>

      {/* DRE Table */}
      <Tabs defaultValue="dre" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dre">DRE Completo</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos Manuais</TabsTrigger>
        </TabsList>

        <TabsContent value="dre" className="pt-4">
          {dreLoading ? (
            <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
          ) : allDreRows.length === 0 ? (
            <EmptyState
              icon={Calculator}
              title="Sem dados no período"
              description="Ajuste o período ou sincronize pedidos do Anota AI para gerar o DRE."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-48">Seção</TableHead>
                    <TableHead className="w-48">Categoria</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-40 text-right">Valor</TableHead>
                    <TableHead className="w-36 text-center">Fonte</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderDreSections(allDreRows, kpis)}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="lancamentos" className="pt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Lançamentos Manuais do Contador</h3>
            <Button onClick={() => { setEditingEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, competencia: COMPETENCIA_DEFAULT, recorrente: false } as DreEntry); setNewEntryOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Novo lançamento
            </Button>
          </div>

          {manualEntries.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhum lançamento manual"
              description="Adicione ajustes, provisões, impostos e outras despesas que não vêm do sistema."
              action={<Button onClick={() => { setEditingEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, competencia: COMPETENCIA_DEFAULT, recorrente: false } as DreEntry); setNewEntryOpen(true); }}><Plus className="mr-1.5 size-4" /> Criar primeiro lançamento</Button>}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-40">Tipo</TableHead>
                    <TableHead className="w-40">Categoria</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-32 text-right">Valor</TableHead>
                    <TableHead className="w-32">Competência</TableHead>
                    <TableHead className="w-24 text-center">Recorrente</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualEntries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{e.tipo.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{e.categoria}</TableCell>
                      <TableCell className="text-muted-foreground">{e.descricao || "—"}</TableCell>
                      <TableCell className="text-right tabular font-medium">{fmtMoney(e.valor)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(e.competencia)}</TableCell>
                      <TableCell className="text-center">{e.recorrente ? "Sim" : "Não"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingEntry(e); setNewEntryOpen(true); }}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setToDelete(e)}><Trash2 className="size-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New/Edit Entry Dialog */}
      <Dialog open={newEntryOpen || !!editingEntry} onOpenChange={(o) => { if (!o) { setNewEntryOpen(false); setEditingEntry(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEntry?.id ? "Editar lançamento" : "Novo lançamento manual"}</DialogTitle>
          </DialogHeader>
          {(editingEntry || newEntryOpen) && (
            <form onSubmit={(e) => { e.preventDefault(); saveEntry.mutate(editingEntry ?? { tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, competencia: COMPETENCIA_DEFAULT, recorrente: false } as DreEntry); }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editingEntry?.tipo || "despesa_operacional"} onValueChange={(v) => setEditingEntry({ ...(editingEntry ?? {}), tipo: v as DreEntry["tipo"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DRE_TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Competência</Label>
                  <Input type="date" value={editingEntry?.competencia || COMPETENCIA_DEFAULT} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), competencia: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <Input value={editingEntry?.categoria || ""} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), categoria: e.target.value })} placeholder="Ex.: Aluguel, Energia, Honorários contábeis..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea value={editingEntry?.descricao || ""} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), descricao: e.target.value })} placeholder="Detalhes do lançamento..." rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input type="number" step="0.01" value={editingEntry?.valor || 0} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), valor: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5 flex items-end">
                  <Label className="text-xs flex items-center gap-1.5">
                    <input type="checkbox" checked={editingEntry?.recorrente || false} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), recorrente: e.target.checked })} className="size-4 accent-primary" />
                    Recorrente (repetir todo mês)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => { setNewEntryOpen(false); setEditingEntry(null); }}>Cancelar</Button>
                <Button type="submit" disabled={saveEntry.isPending || !editingEntry?.categoria}>
                  {saveEntry.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {editingEntry?.id ? "Salvar alterações" : "Criar lançamento"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover lançamento?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.categoria}" será excluído permanentemente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && deleteEntry.mutate(toDelete.id)}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InsightCard({ title, value, description, tone }: { title: string; value: string; description: string; tone: "success" | "warning" | "danger" | "info" }) {
  const tones = {
    success: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
    warning: "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    danger: "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400",
    info: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs opacity-70">{description}</p>
    </div>
  );
}

function renderDreSections(rows: DreRow[], kpis: any) {
  const sections = [
    { key: "RECEITA BRUTA", title: "RECEITA BRUTA", icon: TrendingUp, tone: "success" as const },
    { key: "CUSTO DIRETO (CMV)", title: "CUSTO DIRETO (CMV)", icon: Package, tone: "warning" as const },
    { key: "LUCRO BRUTO", title: "LUCRO BRUTO", icon: PiggyBank, tone: "info" as const },
    { key: "DESPESAS OPERACIONAIS", title: "DESPESAS OPERACIONAIS", icon: Users, tone: "danger" as const },
    { key: "DESPESA ADMINISTRATIVA", title: "DESPESAS ADMINISTRATIVAS", icon: Calculator, tone: "danger" as const },
    { key: "DESPESA FINANCEIRA", title: "DESPESAS FINANCEIRAS", icon: DollarSign, tone: "danger" as const },
    { key: "OUTROS", title: "OUTRAS DESPESAS", icon: AlertTriangle, tone: "danger" as const },
    { key: "RESULTADO LÍQUIDO", title: "RESULTADO LÍQUIDO", icon: TrendingDown, tone: "info" as const },
  ];

  return sections.map((section) => {
    const sectionRows = rows.filter(r => r.secao === section.key);
    const total = sectionRows.reduce((s, r) => s + r.valor, 0);
    const isTotalRow = ["LUCRO BRUTO", "RESULTADO LÍQUIDO"].includes(section.key);

    if (sectionRows.length === 0 && !isTotalRow) return null;

    return (
      <Collapsible key={section.key} open={true}>
        <CollapsibleTrigger className="bg-muted/30 hover:bg-muted/50" asChild>
          <TableRow>
            <TableCell className="font-semibold flex items-center gap-2">
              <section.icon className={`size-4 ${section.tone === "success" ? "text-success" : section.tone === "warning" ? "text-warning" : section.tone === "danger" ? "text-destructive" : "text-info"}`} />
              {section.title}
            </TableCell>
            <TableCell colSpan={2} />
            <TableCell className="text-right font-display text-lg font-semibold tabular">{fmtMoney(total)}</TableCell>
            <TableCell className="text-center text-xs text-muted-foreground">{sectionRows.filter(r => r.fonte === "auto").length} auto / {sectionRows.filter(r => r.fonte === "manual").length} manual</TableCell>
            <TableCell className="text-right">
              <ChevronDown className="size-4 mx-auto text-muted-foreground" />
            </TableCell>
          </TableRow>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {sectionRows.map((r, i) => (
            <TableRow key={r.id ?? i} className={r.fonte === "manual" ? "bg-amber-50/30" : ""}>
              <TableCell className="text-xs text-muted-foreground">{r.secao}</TableCell>
              <TableCell className="font-medium">{r.categoria}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{r.descricao || "—"}</TableCell>
              <TableCell className="text-right tabular font-medium">{fmtMoney(r.valor)}</TableCell>
              <TableCell className="text-center">
                <Badge variant={r.fonte === "auto" ? "default" : "outline"} className="text-xs">
                  {r.fonte === "auto" ? "Automático" : "Manual"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {r.editable && r.id && (
                  <Button variant="ghost" size="icon" onClick={() => { /* edit handled in lancamentos tab */ }}>
                    <Pencil className="size-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {isTotalRow && (
            <TableRow className="bg-muted/50 font-bold">
              <TableCell colSpan={3} className="text-right">Total {section.title}</TableCell>
              <TableCell className="text-right font-display text-lg">{fmtMoney(total)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  });
}
