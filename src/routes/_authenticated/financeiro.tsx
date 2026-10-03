import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, TrendingUp, TrendingDown, PiggyBank, Calculator, FileSpreadsheet,
  Plus, Pencil, Trash2, Lock, Unlock, Eye, EyeOff, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Save, X, RefreshCw, DollarSign, Users, Package,
  CreditCard, ShoppingCart, ArrowUpRight, ArrowDownRight, List, CalendarDays,
  Truck, ReceiptText, Bike, Landmark, ArrowUpCircle, ArrowDownCircle
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/db";
import { useRealtime } from "@/hooks/useRealtime";
import { fmtMoney, fmtNum, fmtDate, fmtDateTime } from "@/lib/format";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroPage,
});

type DreEntry = {
  id: string;
  tipo: "receita" | "custo_direto" | "custo_variavel" | "despesa_operacional" | "despesa_administrativa" | "despesa_financeira" | "outros";
  categoria: string;
  descricao: string | null;
  valor: number;
  competencia: string;
  vencimento?: string | null;
  pago?: boolean | null;
  data_pagamento?: string | null;
  recorrente: boolean;
  recorrencia_tipo?: 'indefinida' | 'determinada' | null;
  recorrencia_quantidade?: number | null;
  recorrencia_grupo_id?: string | null;
  inclui_ponto_equilibrio?: boolean | null;
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
  vencimento?: string | null;
  data_pagamento?: string | null;
  pago?: boolean | null;
  id?: string;
  editable?: boolean;
  recorrencia_grupo_id?: string | null;
  recorrencia_tipo?: 'indefinida' | 'determinada' | null;
  recorrencia_quantidade?: number | null;
};

type FinanceAccount = {
  id: string;
  nome: string;
  saldo: number;
  cor?: string | null;
  created_at?: string;
};

const ACCOUNTS_LS_KEY = "neia_finance_accounts_v1";
const SHOW_BALANCES_LS_KEY = "neia_finance_show_balances_v1";

function loadAccountsLS(): FinanceAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((a: any) => a && typeof a.nome === "string").map((a: any) => ({
      id: String(a.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      nome: String(a.nome),
      saldo: Number(a.saldo) || 0,
      cor: a.cor ?? null,
      created_at: a.created_at ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

function persistAccountsLS(list: FinanceAccount[]) {
  try { localStorage.setItem(ACCOUNTS_LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

const DRE_TIPOS = [
  { value: "receita", label: "Receita" },
  { value: "custo_direto", label: "Custo Direto (CMV)" },
  { value: "custo_variavel", label: "Custo Variável" },
  { value: "despesa_operacional", label: "Despesa Operacional" },
  { value: "despesa_administrativa", label: "Despesa Administrativa" },
  { value: "despesa_financeira", label: "Despesa Financeira" },
  { value: "outros", label: "Outros" },
] as const;

const COMPETENCIA_DEFAULT = new Date().toISOString().split("T")[0].slice(0, 7) + "-01";
const VENCIMENTO_DEFAULT = new Date().toISOString().split("T")[0];

// ---------------------------------------------------------------------------
// Taxas de entrega / outras taxas (pedidos Anota AI)
// O payload do Anota varia por versão/loja, então a extração é defensiva:
// - taxa de entrega: delivery_fee, deliveryFee, taxa_entrega, shipping_fee, fee, delivery_info.fee etc.
// - outras taxas: additionalFees / additional_fees / fees / taxas (array com valor + nome)
// ---------------------------------------------------------------------------
function numOrZero(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return 0;
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractDeliveryFee(payload: unknown): number {
  const root = asRec(payload);
  if (!root) return 0;
  const info =
    asRec(root.delivery_info) ?? asRec(root.deliveryInfo) ?? asRec(root.delivery);
  const candidates: unknown[] = [
    root.delivery_fee,
    root.deliveryFee,
    root.taxa_entrega,
    root.taxaEntrega,
    root.taxa_entrega_valor,
    root.taxaEntregaValor,
    root.shipping_fee,
    root.shippingFee,
    root.delivery_tax,
    root.deliveryTax,
    info?.fee,
    info?.valor,
    info?.taxa,
    info?.price,
  ];
  for (const c of candidates) {
    const n = numOrZero(c);
    if (n > 0) return n;
  }
  return 0;
}

function extractOtherFees(payload: unknown): { total: number; itens: { nome: string; valor: number }[] } {
  const root = asRec(payload);
  if (!root) return { total: 0, itens: [] };
  const rawList =
    root.additionalFees ?? root.additional_fees ?? root.additionalfees ??
    root.fees ?? root.taxas ?? root.outras_taxas ?? root.outrasTaxas;
  if (!Array.isArray(rawList)) return { total: 0, itens: [] };
  const itens: { nome: string; valor: number }[] = [];
  for (const entry of rawList) {
    const rec = asRec(entry);
    // Alguns formatos usam número direto no array
    if (!rec) {
      const n = numOrZero(entry);
      if (n > 0) itens.push({ nome: "Taxa adicional", valor: n });
      continue;
    }
    const valor = numOrZero(
      rec.value ?? rec.valor ?? rec.amount ?? rec.price ?? rec.preco ?? rec.total,
    );
    if (valor <= 0) continue;
    const nomeRaw =
      rec.name ?? rec.nome ?? rec.description ?? rec.descricao ?? rec.label ?? rec.tipo ?? rec.type;
    const nome = typeof nomeRaw === "string" && nomeRaw.trim() ? nomeRaw.trim() : "Taxa adicional";
    itens.push({ nome, valor });
  }
  return { total: itens.reduce((s, i) => s + i.valor, 0), itens };
}

// Agregadores de folha por lista de colaboradores (staff ou motoboys)
function somaPagamentos(list: any[]): number {
  return list.reduce((s: number, c: any) => s + (Number(c.pagamento) || 0), 0);
}
function somaSalarios(list: any[]): number {
  return list.reduce((s: number, c: any) => s + (Number(c.salario) || 0), 0);
}
function somaSaldoDevedor(list: any[]): number {
  return list.reduce((s: number, c: any) => s + (Number(c.saldo_devedor) || 0), 0);
}
// Fallback derivado caso saldo_devedor ainda não esteja preenchido (salário - pagamento)
function somaSaldoDerivado(list: any[]): number {
  return list.reduce((s: number, c: any) => {
    const saldoStored = Number(c.saldo_devedor);
    if (!isNaN(saldoStored) && saldoStored !== 0) return s + saldoStored;
    return s + Math.max(0, (Number(c.salario) || 0) - (Number(c.pagamento) || 0));
  }, 0);
}
// Recalcula o saldo devedor ao alterar o pagamento acumulado para um novo valor
// (usado ao registrar e ao estornar/excluir pagamentos). Mantém a lógica de
// acúmulo: base = saldoAtual - shortfall anterior; excedente abate o saldo.
function recalcSaldoFolha(salario: number, pagamentoAtual: number, saldoAtual: number, novoPagamento: number): number {
  const oldShortfall = Math.max(0, salario - pagamentoAtual);
  const newShortfall = Math.max(0, salario - novoPagamento);
  const baseAcumulada = Math.max(0, saldoAtual - oldShortfall);
  if (novoPagamento > salario) {
    const excedente = novoPagamento - salario;
    return Math.max(0, saldoAtual - excedente);
  }
  return baseAcumulada + newShortfall;
}
// Folha acumulada no período (X a Y) para uma lista: espelha a regra do
// backend (calc_folha_pagamento): meses corridos inclusive entre as
// competências, contando cada colaborador a partir do mês de admissão.
function calcFolhaAcumulada(list: any[], periodoInicio: string, periodoFim: string, folhaMeses: number): number {
  if (folhaMeses <= 0) return 0;
  const ini = new Date(periodoInicio + "T12:00:00");
  const fim = new Date(periodoFim + "T12:00:00");
  return list.reduce((s: number, c: any) => {
    const salario = Number(c.salario) || 0;
    if (salario <= 0) return s;
    const adm = c.data_admissao ? new Date(c.data_admissao + "T12:00:00") : null;
    const effIni = adm && !isNaN(adm.getTime()) && adm > ini ? adm : ini;
    if (effIni > fim) return s;
    const meses = (fim.getFullYear() * 12 + fim.getMonth()) - (effIni.getFullYear() * 12 + effIni.getMonth()) + 1;
    return s + salario * Math.max(0, meses);
  }, 0);
}

type ManualGroup = {
  key: string;
  gid: string | null;
  entries: DreEntry[];
  rep: DreEntry;
  total: number;
  pagos: number;
  pendentes: number;
  vencidos: number;
  proximoVenc: string | null;
  valorMensal: number;
};

function FinanceiroPage() {
  const qc = useQueryClient();
  const [periodoInicio, setPeriodoInicio] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split("T")[0]);
  // Inputs de data com debounce: cada tecla no calendário disparava ~10 refetches
  // e travava o navegador; o período efetivo (queries) só atualiza após a pausa.
  const [periodoInicioInput, setPeriodoInicioInput] = useState(periodoInicio);
  const [periodoFimInput, setPeriodoFimInput] = useState(periodoFim);
  const dataValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T12:00:00").getTime());
  useEffect(() => {
    if (!periodoInicioInput || periodoInicioInput === periodoInicio || !dataValida(periodoInicioInput)) return;
    const t = setTimeout(() => setPeriodoInicio(periodoInicioInput), 600);
    return () => clearTimeout(t);
  }, [periodoInicioInput, periodoInicio]);
  useEffect(() => {
    if (!periodoFimInput || periodoFimInput === periodoFim || !dataValida(periodoFimInput)) return;
    const t = setTimeout(() => setPeriodoFim(periodoFimInput), 600);
    return () => clearTimeout(t);
  }, [periodoFimInput, periodoFim]);
  const [passwordModal, setPasswordModal] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isFirstAccess, setIsFirstAccess] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [dreEntries, setDreEntries] = useState<DreEntry[]>([]);
  const [editingEntry, setEditingEntry] = useState<DreEntry | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DreEntry | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ManualGroup | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [exportLoading, setExportLoading] = useState(false);
  const [showFolhaDetail, setShowFolhaDetail] = useState(false);
  const [showInsumosDetail, setShowInsumosDetail] = useState(false);
  const [showReceitaDetail, setShowReceitaDetail] = useState(false);
  const [showVencimentosDetail, setShowVencimentosDetail] = useState(false);
  const [showTaxasDetail, setShowTaxasDetail] = useState(false);
  // --- Filtros do detalhamento de taxas (dia | semana | mês | personalizado + motoboy) ---
  const [taxTipo, setTaxTipo] = useState<"dia" | "semana" | "mes" | "personalizado">("mes");
  const [taxData, setTaxData] = useState(() => new Date().toISOString().split("T")[0]);
  const [taxInicio, setTaxInicio] = useState(() => new Date().toISOString().split("T")[0].slice(0, 7) + "-01");
  const [taxFim, setTaxFim] = useState(() => new Date().toISOString().split("T")[0]);
  const [taxMotoboy, setTaxMotoboy] = useState<string>("todos");
  const [showMotoboysDetail, setShowMotoboysDetail] = useState(false);
  const [showPontoEquilibrioDetail, setShowPontoEquilibrioDetail] = useState(false);
  const [showMargemDetail, setShowMargemDetail] = useState(false);
  const [adiantarPagamento, setAdiantarPagamento] = useState<Record<string, number>>({});
  // --- Contas (múltiplas: Bradesco, Itaú, Santander...) com olho p/ ocultar saldo ---
  const [showBalances, setShowBalances] = useState(() => {
    try { return localStorage.getItem(SHOW_BALANCES_LS_KEY) !== "0"; } catch { return true; }
  });
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [accountForm, setAccountForm] = useState({ nome: "", saldo: 0 });
  const [adjustDialog, setAdjustDialog] = useState<{ account: FinanceAccount; tipo: "entrada" | "saida" } | null>(null);
  const [adjustValor, setAdjustValor] = useState<number>(0);
  const [accountToDelete, setAccountToDelete] = useState<FinanceAccount | null>(null);
  // --- Novo lançamento manual inline (form visível acima da lista) ---
  const [inlineEntry, setInlineEntry] = useState({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, recorrente: false, recorrencia_tipo: "nao" as string, recorrencia_quantidade: 3 });
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "RECEITA BRUTA": true,
    "CUSTO DIRETO (CMV)": true,
    "CUSTO VARIAVEL": true,
    "DESPESAS COM INSUMOS": true,
    "TAXAS DE ENTREGA": true,
    "OUTRAS TAXAS": true,
    "LUCRO BRUTO": true,
    "DESPESAS OPERACIONAIS": true,
    "FOLHA DOS MOTOBOYS": true,
    "DESPESA ADMINISTRATIVA": true,
    "DESPESA FINANCEIRA": true,
    "OUTROS": true,
    "RESULTADO LÍQUIDO": true,
  });
  // --- Extrato da conta (abre ao clicar no cartão em Minhas Contas) ---
  const [extConta, setExtConta] = useState<FinanceAccount | null>(null);
  const [extTipo, setExtTipo] = useState<"dia" | "semana" | "mes" | "personalizado">("mes");
  const [extData, setExtData] = useState(() => new Date().toISOString().split("T")[0]);
  const [extInicio, setExtInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().split("T")[0];
  });
  const [extFim, setExtFim] = useState(() => new Date().toISOString().split("T")[0]);
  // --- Extrato de pagamentos da folha (equipe ou motoboys) ---
  const [pagExtGrupo, setPagExtGrupo] = useState<"equipe" | "motoboys" | null>(null);
  const [pagToDelete, setPagToDelete] = useState<{ id: string; collaboratorId: string | null; nome: string; valor: number; data: string } | null>(null);
  const [pagExtTipo, setPagExtTipo] = useState<"dia" | "semana" | "mes" | "personalizado">("mes");
  const [pagExtData, setPagExtData] = useState(() => new Date().toISOString().split("T")[0]);
  const [pagExtInicio, setPagExtInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().split("T")[0];
  });
  const [pagExtFim, setPagExtFim] = useState(() => new Date().toISOString().split("T")[0]);

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useRealtime(["finance_dre_entries", "finance_access", "collaborators", "purchase_orders", "anota_orders", "activity_logs"], ["finance-dre", "finance-access", "finance-pagamentos", "finance-pagamentos-todos", "collaborators", "purchase-orders", "anota-orders", "anota-orders-receita", "anota-orders-taxas-dialog", "finance-extrato"]);

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
    try {
      const { data, error } = await supabase.from("finance_access").select("id, password_hash").maybeSingle();
      if (error) {
        // Check if table doesn't exist (migration not applied)
        if (error.code === '42P01' || error.message?.includes('relation "finance_access" does not exist')) {
          setAccessError("Tabela finance_access não existe. Aplique a migration 20260824000000_finance_module.sql no Supabase.");
        } else {
          throw error;
        }
        return;
      }
      
      if (!data) {
        // No row exists - create one
        const { data: newRow, error: insertError } = await supabase
          .from("finance_access")
          .insert({ password_hash: "" })
          .select("id")
          .single();
        if (insertError) throw insertError;
        setIsFirstAccess(true);
      } else if (!data.password_hash) {
        // Row exists but no password set
        setIsFirstAccess(true);
      }
      // If password_hash exists, isFirstAccess stays false
    } catch (e) {
      console.error("Erro ao verificar acesso:", e);
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setAccessError(`Erro ao verificar acesso: ${msg}. Verifique se a migration foi aplicada.`);
    } finally {
      setCheckingAccess(false);
    }
  };

  const verifyPassword = useCallback(async (pwd: string) => {
    const { data } = await supabase.from("finance_access").select("password_hash").single();
    if (!data) return false;
    if (!data.password_hash) return true;
    return data.password_hash === btoa(pwd);
  }, []);

  const setPasswordHash = useMutation({
    mutationFn: async (pwd: string) => {
      const hash = btoa(pwd);
      const { error } = await supabase.from("finance_access").update({ password_hash: hash }).eq("id", (await supabase.from("finance_access").select("id").single()).data?.id);
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

  // Fetch DRE entries - filtra por vencimento (data exata da parcela) para refletir período selecionado
  const { data: manualEntries = [], refetch: refetchEntries } = useQuery({
    queryKey: ["finance-dre-entries", periodoInicio, periodoFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_dre_entries")
        .select("*")
        .gte("vencimento", periodoInicio)
        .lte("vencimento", periodoFim)
        .order("vencimento", { ascending: true })
        .order("tipo");
      if (error) {
        // Fallback para competencia se coluna vencimento ainda não existir
        if (error.message?.includes("vencimento") || (error as any)?.code === "42703") {
          const { data: fallback, error: err2 } = await supabase
            .from("finance_dre_entries")
            .select("*")
            .gte("competencia", periodoInicio)
            .lte("competencia", periodoFim)
            .order("competencia", { ascending: false })
            .order("tipo");
          if (err2) throw err2;
          return (fallback ?? []) as DreEntry[];
        }
        throw error;
      }
      return (data ?? []) as DreEntry[];
    },
    enabled: unlocked,
  });

  // Todos os lançamentos manuais já criados (SEM filtro de período) — alimenta a
  // lista da aba "Lançamentos Manuais", que deve exibir o histórico completo.
  // O DRE continua usando `manualEntries` (filtrado pelo período selecionado).
  const { data: manualEntriesAll = [], refetch: refetchEntriesAll } = useQuery({
    queryKey: ["finance-dre-entries-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_dre_entries")
        .select("*")
        .order("vencimento", { ascending: false })
        .order("tipo");
      if (error) {
        // Fallback para competencia se coluna vencimento ainda não existir
        if (error.message?.includes("vencimento") || (error as any)?.code === "42703") {
          const { data: fallback, error: err2 } = await supabase
            .from("finance_dre_entries")
            .select("*")
            .order("competencia", { ascending: false })
            .order("tipo");
          if (err2) throw err2;
          return (fallback ?? []) as DreEntry[];
        }
        throw error;
      }
      return (data ?? []) as DreEntry[];
    },
    enabled: unlocked,
  });

  // Pagamentos de folha registrados no período (via activity_logs, que carrega
  // data/hora de cada pagamento). O campo `pagamento` do colaborador é acumulado
  // geral — aqui somamos apenas o exercício selecionado.
  const { data: pagamentosPeriodo = [] } = useQuery({
    queryKey: ["finance-pagamentos-periodo", periodoInicio, periodoFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, registro_id, acao, detalhes, created_at")
        .eq("modulo", "financeiro")
        .in("acao", ["registrou pagamento colaborador", "estornou pagamento colaborador"])
        .gte("created_at", periodoInicio)
        .lte("created_at", periodoFim + "T23:59:59")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; registro_id: string | null; acao: string; detalhes: any; created_at: string }[];
    },
    enabled: unlocked,
  });

  // Todos os pagamentos de folha já registrados (SEM filtro de período) —
  // alimenta o extrato de pagamentos (estornos excluem o lançamento original).
  const { data: pagamentosTodos = [] } = useQuery({
    queryKey: ["finance-pagamentos-todos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, registro_id, acao, detalhes, created_at")
        .eq("modulo", "financeiro")
        .in("acao", ["registrou pagamento colaborador", "estornou pagamento colaborador"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; registro_id: string | null; acao: string; detalhes: any; created_at: string }[];
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

  // Fetch collaborators with salaries for Folha dos Colaboradores / Motoboys
  // NOTA: status é filtrado de forma case-insensitive no cliente (normalizado
  // com trim().toLowerCase()) porque o cadastro permite digitação livre
  // ("Ativo", "ATIVO", "ativo " etc. não podem sumir da folha).
  // is_motoboy / inclui_ponto_equilibrio vêm da migration 20261008; sem ela, fallback sem as colunas.
  const { data: collaborators = [] } = useQuery({
    queryKey: ["collaborators-salaries", periodoFim],
    queryFn: async () => {
      const COLS_FULL = "id, nome, cargo, salario, saldo_devedor, pagamento, status, data_admissao, is_motoboy, inclui_ponto_equilibrio";
      const COLS_LEGACY = "id, nome, cargo, salario, saldo_devedor, pagamento, status, data_admissao";
      let { data, error } = await supabase
        .from("collaborators")
        .select(COLS_FULL)
        .is("deleted_at", null)
        .or(`data_admissao.is.null,data_admissao.lte.${periodoFim}`)
        .order("nome");
      if (error && (error.code === "42703" || /is_motoboy|inclui_ponto_equilibrio/i.test(error.message))) {
        console.warn("[collaborators-salaries] sem colunas novas, migration pendente:", error.message);
        const retry = await supabase
          .from("collaborators")
          .select(COLS_LEGACY)
          .is("deleted_at", null)
          .or(`data_admissao.is.null,data_admissao.lte.${periodoFim}`)
          .order("nome");
        data = retry.data as any;
        error = retry.error as any;
      }
      if (error) throw error;
      return ((data ?? []) as any).filter(
        (c: any) => String(c.status ?? "ativo").trim().toLowerCase() === "ativo",
      );
    },
    enabled: unlocked,
  });

  // Fetch received purchase orders for Despesas com Insumos
  // Period filter uses updated_at (data de recebimento) em vez de created_at,
  // para ordens criadas em período anterior mas recebidas no período atual aparecerem.
  // Usa valor_total / quantidade_recebida quando disponível (migration 20261001)
  const { data: receivedPurchaseOrders = [] } = useQuery({
    queryKey: ["purchase-orders-received", periodoInicio, periodoFim],
    queryFn: async () => {
      let data: any[] | null = null;
      let error: any = null;
      try {
        const res = await (supabase as any)
          .from("purchase_orders")
          .select("id, numero, ingredient_id, quantidade_necessaria, quantidade_recebida, preco_medio, preco_recebido, valor_total, pago, data_pagamento, data_vencimento, created_at, updated_at, ingredients(nome, unidade, preco_medio, preco_ultima_compra)")
          .eq("status", "concluida")
          .is("deleted_at", null)
          .gte("updated_at", periodoInicio)
          .lte("updated_at", periodoFim + "T23:59:59")
          .order("updated_at", { ascending: false });
        data = res.data;
        error = res.error;
      } catch (e) {
        error = e;
      }
      if (error) {
        const msg = error?.message || "";
        const isMissingCol = msg.includes("quantidade_recebida") || msg.includes("preco_recebido") || msg.includes("valor_total") || msg.includes("pago") || error?.code === "42703";
        if (isMissingCol) {
          console.warn("[purchase-orders-received] fallback para colunas antigas, migration pendente:", msg);
          const { data: fallback, error: err2 } = await supabase
            .from("purchase_orders")
            .select("id, numero, ingredient_id, quantidade_necessaria, preco_medio, created_at, ingredients(nome, unidade, preco_medio, preco_ultima_compra)")
            .eq("status", "concluida")
            .is("deleted_at", null)
            .gte("created_at", periodoInicio)
            .lte("created_at", periodoFim + "T23:59:59")
            .order("created_at", { ascending: false });
          if (err2) throw err2;
          return (fallback ?? []) as any;
        }
        throw error;
      }
      return (data ?? []) as { id: string; numero: number; ingredient_id: string; quantidade_necessaria: number; quantidade_recebida: number | null; preco_medio: number; preco_recebido: number | null; valor_total: number | null; pago: boolean | null; data_pagamento: string | null; data_vencimento: string | null; created_at: string; updated_at: string; ingredients: { nome: string; unidade: string; preco_medio: number; preco_ultima_compra: number } | null }[];
    },
    enabled: unlocked,
  });

  // Fetch vencimentos pendentes (compras a prazo não pagas) - integra com ordens de compra
  const { data: vencimentosPendentes = [], refetch: refetchVencimentos } = useQuery({
    queryKey: ["finance-vencimentos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, numero, ingredient_id, supplier_id, quantidade_necessaria, quantidade_recebida, preco_medio, preco_recebido, valor_total, data_vencimento, data_pagamento, pago, created_at, updated_at")
        .eq("status", "concluida")
        .eq("pago", false)
        .not("data_vencimento", "is", null)
        .is("deleted_at", null)
        .order("data_vencimento", { ascending: true });
      if (error) {
        // Se migration ainda não foi aplicada, retorna vazio em vez de quebrar a página
        if (error.message?.includes("pago") || error.message?.includes("data_vencimento") || error.code === "42703") {
          console.warn("[finance-vencimentos] colunas ainda não existem, migration pendente:", error.message);
          return [];
        }
        throw error;
      }
      // Busca nomes de insumos e fornecedores separadamente para evitar join complexo
      const ingIds = [...new Set((data ?? []).map((r: any) => r.ingredient_id).filter(Boolean))];
      const supIds = [...new Set((data ?? []).map((r: any) => r.supplier_id).filter(Boolean))];
      let ingMap: Record<string, string> = {};
      let supMap: Record<string, string> = {};
      if (ingIds.length) {
        const { data: ings } = await supabase.from("ingredients").select("id, nome").in("id", ingIds);
        ingMap = Object.fromEntries((ings ?? []).map((i: any) => [i.id, i.nome]));
      }
      if (supIds.length) {
        const { data: sups } = await supabase.from("suppliers").select("id, nome").in("id", supIds);
        supMap = Object.fromEntries((sups ?? []).map((s: any) => [s.id, s.nome]));
      }
      return (data ?? []).map((r: any) => ({
        ...r,
        ingrediente_nome: ingMap[r.ingredient_id] || "—",
        fornecedor_nome: supMap[r.supplier_id] || "—",
      }));
    },
    enabled: unlocked,
  });

  // Lançamentos manuais pendentes (vencimentos futuros ainda não pagos)
  const { data: manualVencimentos = [], refetch: refetchManualVencimentos } = useQuery({
    queryKey: ["finance-manual-vencimentos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("finance_dre_entries")
        .select("*")
        .eq("pago", false)
        .not("vencimento", "is", null)
        .order("vencimento", { ascending: true });
      if (error) {
        if (error.message?.includes("pago") || error.message?.includes("vencimento") || error.code === "42703") {
          console.warn("[manual-vencimentos] colunas ainda não existem, migration pendente:", error.message);
          return [];
        }
        throw error;
      }
      return (data ?? []) as DreEntry[];
    },
    enabled: unlocked,
  });

  // --- Contas financeiras (Supabase finance_accounts com fallback localStorage) ---
  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: async (): Promise<FinanceAccount[]> => {
      try {
        const { data, error } = await (supabase as any)
          .from("finance_accounts")
          .select("id, nome, saldo, cor, created_at")
          .order("created_at", { ascending: true });
        if (error) throw error;
        const list = ((data ?? []) as any[]).map((a: any) => ({
          id: String(a.id),
          nome: String(a.nome),
          saldo: Number(a.saldo) || 0,
          cor: a.cor ?? null,
          created_at: a.created_at ?? undefined,
        }));
        persistAccountsLS(list);
        return list;
      } catch (e: any) {
        const msg = e?.message || "";
        if (e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST205" || /finance_accounts|does not exist|Could not find/i.test(msg)) {
          console.warn("[finance-accounts] tabela ausente, usando armazenamento local. Aplique a migration 20261009000000_finance_accounts.sql:", msg);
          return loadAccountsLS();
        }
        throw e;
      }
    },
    enabled: unlocked,
  });

  const toggleShowBalances = () => {
    setShowBalances((v) => {
      try { localStorage.setItem(SHOW_BALANCES_LS_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };

  const saveAccountMut = useMutation({
    mutationFn: async ({ nome, saldo, id }: { nome: string; saldo: number; id?: string }) => {
      const cleanNome = nome.trim();
      if (!cleanNome) throw new Error("Dê um nome para a conta (ex.: Bradesco)");
      const novoSaldo = Number(saldo) || 0;
      const saldoAnterior = id ? Number(accounts.find((x) => x.id === id)?.saldo) || 0 : 0;
      try {
        if (id) {
          const { error } = await (supabase as any).from("finance_accounts").update({ nome: cleanNome, saldo: novoSaldo }).eq("id", id);
          if (error) throw error;
          await logActivity("financeiro", "editou conta financeira", id, { nome: cleanNome, saldoAnterior, novoSaldo });
        } else {
          const { data, error } = await (supabase as any).from("finance_accounts").insert({ nome: cleanNome, saldo: novoSaldo }).select("id").single();
          if (error) throw error;
          await logActivity("financeiro", "criou conta financeira", (data as any)?.id ?? null, { nome: cleanNome, saldoInicial: novoSaldo });
        }
      } catch (e: any) {
        const msg = e?.message || "";
        if (e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST205" || /finance_accounts|does not exist|Could not find/i.test(msg)) {
          // Fallback local
          const current = loadAccountsLS();
          if (id) {
            const next = current.map((a) => (a.id === id ? { ...a, nome: cleanNome, saldo: Number(saldo) || 0 } : a));
            persistAccountsLS(next);
          } else {
            const nid = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            persistAccountsLS([...current, { id: nid, nome: cleanNome, saldo: Number(saldo) || 0, created_at: new Date().toISOString() }]);
          }
          return;
        }
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-extrato"] });
      refetchAccounts();
      setAccountDialogOpen(false);
      setEditingAccount(null);
      setAccountForm({ nome: "", saldo: 0 });
      toast.success("Conta salva!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustAccountMut = useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: number }) => {
      const target = accounts.find((a) => a.id === id);
      const novoSaldo = (Number(target?.saldo) || 0) + delta;
      try {
        const { error } = await (supabase as any).from("finance_accounts").update({ saldo: novoSaldo }).eq("id", id);
        if (error) throw error;
        await logActivity("financeiro", delta >= 0 ? "adicionou saldo à conta" : "retirou saldo da conta", id, { delta, novoSaldo });
      } catch (e: any) {
        const msg = e?.message || "";
        if (e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST205" || /finance_accounts|does not exist|Could not find/i.test(msg)) {
          const current = loadAccountsLS();
          persistAccountsLS(current.map((a) => (a.id === id ? { ...a, saldo: (Number(a.saldo) || 0) + delta } : a)));
          return;
        }
        throw e;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-extrato"] });
      refetchAccounts();
      setAdjustDialog(null);
      setAdjustValor(0);
      toast.success(vars.delta >= 0 ? "Saldo adicionado!" : "Saldo retirado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAccountMut = useMutation({
    mutationFn: async (id: string) => {
      try {
        const { error } = await (supabase as any).from("finance_accounts").delete().eq("id", id);
        if (error) throw error;
        await logActivity("financeiro", "excluiu conta financeira", id, {});
      } catch (e: any) {
        const msg = e?.message || "";
        if (e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST205" || /finance_accounts|does not exist|Could not find/i.test(msg)) {
          persistAccountsLS(loadAccountsLS().filter((a) => a.id !== id));
          return;
        }
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
      refetchAccounts();
      setAccountToDelete(null);
      toast.success("Conta excluída!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalContas = useMemo(() => accounts.reduce((s, a) => s + (Number(a.saldo) || 0), 0), [accounts]);

  const vencimentosTotal = useMemo(() => {
    const totalCompras = vencimentosPendentes.reduce((s: number, r: any) => s + (Number(r.valor_total) || Number(r.quantidade_recebida || r.quantidade_necessaria) * Number(r.preco_recebido || r.preco_medio) || 0), 0);
    const totalManual = manualVencimentos.reduce((s: number, r: any) => s + (Number(r.valor) || 0), 0);
    return totalCompras + totalManual;
  }, [vencimentosPendentes, manualVencimentos]);
  const vencimentosVencidos = useMemo(() => {
    const hoje = new Date().toISOString().split("T")[0];
    const comprasVencidas = vencimentosPendentes.filter((r: any) => r.data_vencimento && r.data_vencimento < hoje);
    const manualVencidas = manualVencimentos.filter((r: any) => r.vencimento && r.vencimento < hoje);
    return [...comprasVencidas, ...manualVencidas];
  }, [vencimentosPendentes, manualVencimentos]);
  const vencimentosPendentesTotal = useMemo(() => vencimentosPendentes.length + manualVencimentos.length, [vencimentosPendentes, manualVencimentos]);

  // Todos recorrentes (para ponto de equilíbrio - não diminui quando parcela paga, só quando grupo removido)
  // Inclui a flag inclui_ponto_equilibrio (migration 20261007); sem ela, assume true (fallback)
  const { data: manualRecorrentesAll = [] } = useQuery({
    queryKey: ["finance-recorrentes-all"],
    queryFn: async () => {
      const COLS_FULL = "id, valor, categoria, descricao, recorrencia_grupo_id, recorrente, recorrencia_tipo, recorrencia_quantidade, pago, vencimento, competencia, inclui_ponto_equilibrio";
      const COLS_LEGACY = "id, valor, categoria, descricao, recorrencia_grupo_id, recorrente, recorrencia_tipo, recorrencia_quantidade, pago, vencimento, competencia";
      let { data, error } = await (supabase as any)
        .from("finance_dre_entries")
        .select(COLS_FULL)
        .eq("recorrente", true);
      if (error && (error.code === "42703" || error.message?.includes("inclui_ponto_equilibrio"))) {
        console.warn("[finance-recorrentes-all] sem coluna inclui_ponto_equilibrio, migration pendente:", error.message);
        const retry = await (supabase as any)
          .from("finance_dre_entries")
          .select(COLS_LEGACY)
          .eq("recorrente", true);
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        if (error.message?.includes("recorrente") || error.code === "42703") return [];
        throw error;
      }
      return (data ?? []) as any[];
    },
    enabled: unlocked,
  });

  // Estatísticas por grupo recorrente para exibir progresso de parcelas (ex: 15/30x)
  // Corrige legado onde futuros foram gravados como pago=true: só conta como pago se vencimento <= hoje
  const grupoProgressMap = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const map = new Map<string, { total: number; pagos: number; pendentes: number; entries: any[] }>();
    for (const e of (manualRecorrentesAll as any[])) {
      const gid = (e as any).recorrencia_grupo_id as string | null;
      if (!gid) continue;
      if (!map.has(gid)) map.set(gid, { total: 0, pagos: 0, pendentes: 0, entries: [] });
      map.get(gid)!.entries.push(e);
    }
    for (const [gid, stat] of map) {
      stat.entries.sort((a: any, b: any) => ((a.vencimento || a.competencia || "") as string).localeCompare((b.vencimento || b.competencia || "") as string));
      const first = stat.entries[0] as any;
      const qtd = Number(first?.recorrencia_quantidade);
      const total = qtd > 0 ? qtd : stat.entries.length;
      // Só conta como "pago" o que já venceu ou foi efetivamente quitado com vencimento <= hoje; futuros com pago=true (bug legado) contam como pendente
      const pagos = stat.entries.filter((x: any) => x.pago === true && ((x.vencimento || x.competencia || "") as string) <= hoje).length;
      stat.total = total;
      stat.pagos = pagos;
      stat.pendentes = Math.max(0, total - pagos);
    }
    return map;
  }, [manualRecorrentesAll]);

  // Índice da parcela dentro do grupo (1-based) para exibir "parcela N/Total"
  const parcelIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const [, stat] of grupoProgressMap) {
      const sorted = [...stat.entries].sort((a: any, b: any) => ((a.vencimento || a.competencia || "") as string).localeCompare((b.vencimento || b.competencia || "") as string));
      sorted.forEach((e: any, idx: number) => m.set(e.id as string, idx + 1));
    }
    return m;
  }, [grupoProgressMap]);

  // Mapa de próximo vencimento por grupo recorrente (para exibir sempre o próximo)
  const nextVencimentoMap = useMemo(() => {
    const map = new Map<string, string>();
    const grupos = new Map<string, DreEntry[]>();
    for (const e of manualVencimentos) {
      const gid = (e as any).recorrencia_grupo_id as string | null;
      if (!gid) continue;
      if (!grupos.has(gid)) grupos.set(gid, []);
      grupos.get(gid)!.push(e);
    }
    const hoje = new Date().toISOString().split("T")[0];
    for (const [gid, list] of grupos) {
      const sorted = [...list].sort((a, b) => ((a as any).vencimento || a.competencia || "").localeCompare((b as any).vencimento || b.competencia || ""));
      const next = sorted.find(e => ((e as any).vencimento || e.competencia) && ((e as any).vencimento || e.competencia) >= hoje) || sorted[0];
      if (next) map.set(gid, (next as any).vencimento || next.competencia);
    }
    return map;
  }, [manualVencimentos]);

  // Agrupa as parcelas recorrentes em 1 linha por lançamento criado (aba Lançamentos Manuais).
  // Cada grupo mostra o demonstrativo do custo/despesa; as parcelas ficam expansíveis.
  const manualGrupos = useMemo((): ManualGroup[] => {
    const hoje = new Date().toISOString().split("T")[0];
    const porGrupo = new Map<string, DreEntry[]>();
    for (const e of manualEntriesAll) {
      const gid = (e as any).recorrencia_grupo_id as string | null;
      if (!gid) continue;
      if (!porGrupo.has(gid)) porGrupo.set(gid, []);
      porGrupo.get(gid)!.push(e);
    }
    const statusParcela = (p: DreEntry) => {
      const v = (((p as any).vencimento || p.competencia || "") as string);
      // Corrige legado onde futuros foram gravados como pago=true
      const pagoEfetivo = (p as any).pago === true && (!v || v <= hoje);
      const vencido = !pagoEfetivo && !!v && v < hoje;
      return { v, pagoEfetivo, vencido };
    };
    const items: ManualGroup[] = [];
    const vistos = new Set<string>();
    for (const e of manualEntriesAll) {
      const gid = (e as any).recorrencia_grupo_id as string | null;
      if (!gid) {
        const st = statusParcela(e);
        items.push({
          key: `single-${e.id}`, gid: null, entries: [e], rep: e,
          total: 1, pagos: st.pagoEfetivo ? 1 : 0,
          pendentes: st.pagoEfetivo ? 0 : 1, vencidos: st.vencido ? 1 : 0,
          proximoVenc: (((e as any).vencimento || e.competencia || null) as string | null),
          valorMensal: Number(e.valor) || 0,
        });
        continue;
      }
      if (vistos.has(gid)) continue;
      vistos.add(gid);
      const entries = [...(porGrupo.get(gid) ?? [])].sort((a, b) =>
        (((a as any).vencimento || a.competencia || "") as string).localeCompare((((b as any).vencimento || b.competencia || "") as string)));
      let pagos = 0, vencidos = 0;
      let proximo: string | null = null;
      for (const p of entries) {
        const st = statusParcela(p);
        if (st.pagoEfetivo) pagos++;
        else {
          if (st.vencido) vencidos++;
          if (st.v && (!proximo || st.v < proximo)) proximo = st.v;
        }
      }
      const rep = entries[entries.length - 1] ?? entries[0];
      items.push({
        key: `grupo-${gid}`, gid, entries, rep,
        total: entries.length, pagos,
        pendentes: entries.length - pagos, vencidos,
        proximoVenc: proximo ?? ((((rep as any)?.vencimento || (rep as any)?.competencia || null) as string | null)),
        valorMensal: Number(rep?.valor) || 0,
      });
    }
    return items;
  }, [manualEntriesAll]);



  const payVencimentoFinanceiro = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("pay_purchase_order", { p_order: id });
      if (error) {
        const msg = (error as any)?.message || "";
        const isMissing = msg.includes("does not exist") || msg.includes("42883") || msg.includes("pay_purchase_order");
        if (isMissing) {
          console.warn("[payVencimentoFinanceiro] fallback para update direto:", msg);
          const { error: err2 } = await (supabase as any).from("purchase_orders").update({ pago: true, data_pagamento: new Date().toISOString(), data_vencimento: null } as any).eq("id", id);
          if (err2) throw err2;
          return;
        }
      }
      if (error) throw error;
      await logActivity("financeiro", "quitou vencimento", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-received"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      toast.success("Vencimento quitado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payManualVencimento = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("pay_dre_entry", { p_entry: id });
      if (error) {
        const msg = (error as any)?.message || "";
        const isMissing = msg.includes("does not exist") || msg.includes("42883") || msg.includes("pay_dre_entry") || msg.includes("42703");
        if (isMissing) {
          console.warn("[payManualVencimento] fallback para update direto:", msg);
          const { error: err2 } = await (supabase as any).from("finance_dre_entries").update({ pago: true, data_pagamento: new Date().toISOString() } as any).eq("id", id);
          if (err2) throw err2;
          return;
        }
        throw error;
      }
      await logActivity("financeiro", "quitou vencimento manual", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
      toast.success("Lançamento quitado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Volta um lançamento pago para "há pagar" (usado ao clicar no selo no DRE)
  const markUnpaidMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("finance_dre_entries").update({ pago: false, data_pagamento: null } as any).eq("id", id);
      if (error) throw error;
      await logActivity("financeiro", "marcou lançamento como há pagar", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
      toast.success("Lançamento marcado como há pagar!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Liga/desliga a participação de lançamento(s) recorrente(s) no Ponto de Equilíbrio
  const togglePontoEquilibrio = useMutation({
    mutationFn: async ({ ids, incluir }: { ids: string[]; incluir: boolean }) => {
      const { error } = await (supabase as any).from("finance_dre_entries").update({ inclui_ponto_equilibrio: incluir } as any).in("id", ids);
      if (error) throw error;
      await logActivity("financeiro", incluir ? "incluiu lançamento no ponto de equilíbrio" : "removeu lançamento do ponto de equilíbrio", ids[0] ?? null, { ids: ids.length });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
      toast.success(vars.incluir ? "Lançamento incluído no ponto de equilíbrio!" : "Lançamento fora do ponto de equilíbrio!");
    },
    onError: (e: Error) => toast.error(/inclui_ponto_equilibrio|42703/.test(e.message) ? "Aplique a migration 20261007000000_ponto_equilibrio_optout.sql no Supabase para usar este controle." : e.message),
  });

  // Liga/desliga a participação de um colaborador no Ponto de Equilíbrio (folha)
  const toggleColabPonto = useMutation({
    mutationFn: async ({ id, incluir }: { id: string; incluir: boolean }) => {
      const { error } = await supabase.from("collaborators").update({ inclui_ponto_equilibrio: incluir } as any).eq("id", id);
      if (error) throw error;
      await logActivity("financeiro", incluir ? "incluiu colaborador no ponto de equilíbrio" : "removeu colaborador do ponto de equilíbrio", id, {});
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["collaborators-salaries"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      toast.success(vars.incluir ? "Colaborador incluído no ponto de equilíbrio!" : "Colaborador fora do ponto de equilíbrio!");
    },
    onError: (e: Error) => toast.error(/inclui_ponto_equilibrio|42703/.test(e.message) ? "Aplique a migration 20261008000000_motoboy_e_ponto_colaborador.sql no Supabase para usar este controle." : e.message),
  });

  // Fetch Anota AI orders for Receita Bruta breakdown - inclui payload para diferenciar iFood vs Anota direto
  const { data: anotaOrders = [] } = useQuery({
    queryKey: ["anota-orders-receita", periodoInicio, periodoFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_orders")
        .select("id, total, check_status, pedido_em, imported_at, payload, numero, motoboy_id, external_order_id")
        .in("check_status", [1, 2, 3]) // em produção, pronto, finalizado
        .gte("imported_at", periodoInicio)
        // imported_at é timestamptz: sem o horário final, pedidos do último dia após 00:00 seriam excluídos
        .lte("imported_at", periodoFim + "T23:59:59")
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; total: number; check_status: number; pedido_em: string | null; imported_at: string; payload: any; numero: string | null; motoboy_id: string | null; external_order_id: string }[];
    },
    enabled: unlocked,
  });

  // Helper para identificar vendas iFood (via Anota AI, mas originadas no iFood)
  const isIfoodOrder = useCallback((o: { payload: any }) => {
    const p = o.payload as any;
    if (!p) return false;
    const sc = (p.salesChannel || p.sales_channel || p.salesChannelName || '').toString().toLowerCase();
    const from = (p.from || '').toString().toLowerCase();
    const type = (p.type || '').toString().toLowerCase();
    return sc.includes('ifood') || from.includes('ifood') || type.includes('ifood');
  }, []);

  // --- Extrato da conta: movimentações registradas no activity_logs ---
  // Entradas/saídas de saldo (Adicionar/Retirar/Ajustes) vinculadas à conta.
  // Dia local no formato YYYY-MM-DD (evita deslocamento de fuso do toISOString).
  const diaLocalISO = useCallback((d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  const somaDiasISO = useCallback((iso: string, dias: number) => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + dias);
    return diaLocalISO(d);
  }, [diaLocalISO]);
  // Intervalo visível conforme o filtro (dia | semana seg-dom | mês | personalizado, máx. 62 dias)
  const extRange = useMemo(() => {
    const hoje = diaLocalISO(new Date());
    let ini: string, fim: string, limitado = false;
    if (extTipo === "dia") {
      ini = dataValida(extData) ? extData : hoje;
      fim = ini;
    } else if (extTipo === "semana") {
      const base = dataValida(extData) ? extData : hoje;
      const dow = new Date(base + "T12:00:00").getDay();
      ini = somaDiasISO(base, -((dow + 6) % 7));
      fim = somaDiasISO(ini, 6);
    } else if (extTipo === "mes") {
      const base = dataValida(extData) ? extData : hoje;
      const y = Number(base.slice(0, 4));
      const m = Number(base.slice(5, 7));
      ini = `${base.slice(0, 7)}-01`;
      fim = `${base.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    } else {
      const a = dataValida(extInicio) ? extInicio : hoje;
      const b = dataValida(extFim) ? extFim : hoje;
      ini = a <= b ? a : b;
      fim = a <= b ? b : a;
      if (somaDiasISO(ini, 62) <= fim) {
        fim = somaDiasISO(ini, 61);
        limitado = true;
      }
    }
    return { ini, fim, limitado };
  }, [extTipo, extData, extInicio, extFim, diaLocalISO, somaDiasISO, dataValida]);
  const { data: extLogs = [] } = useQuery({
    queryKey: ["finance-extrato", extConta?.id, extRange.ini, extRange.fim],
    queryFn: async () => {
      if (!extConta) return [];
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, acao, detalhes, created_at")
        .eq("modulo", "financeiro")
        .eq("registro_id", extConta.id)
        .gte("created_at", `${extRange.ini}T00:00:00`)
        .lte("created_at", `${extRange.fim}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; acao: string; detalhes: any; created_at: string }[];
    },
    enabled: unlocked && !!extConta,
  });
  type ExtMov = { id: string; data: string; descricao: string; entrada: number; saida: number; saldoApos: number | null };
  const extMovs = useMemo((): ExtMov[] => {
    const rows: ExtMov[] = [];
    for (const l of extLogs) {
      const det = (l.detalhes ?? {}) as any;
      const dia = diaLocalISO(new Date(l.created_at));
      if (dia < extRange.ini || dia > extRange.fim) continue;
      const numOrNull = (v: unknown) => {
        const n = Number(v);
        return isFinite(n) ? n : null;
      };
      if (l.acao === "adicionou saldo à conta") {
        rows.push({ id: l.id, data: l.created_at, descricao: "Entrada de saldo", entrada: Number(det.delta) || 0, saida: 0, saldoApos: numOrNull(det.novoSaldo) });
      } else if (l.acao === "retirou saldo da conta") {
        rows.push({ id: l.id, data: l.created_at, descricao: "Retirada de saldo", entrada: 0, saida: Math.abs(Number(det.delta) || 0), saldoApos: numOrNull(det.novoSaldo) });
      } else if (l.acao === "criou conta financeira") {
        const inicial = numOrNull(det.saldoInicial);
        rows.push({ id: l.id, data: l.created_at, descricao: `Conta criada${det.nome ? ` • ${det.nome}` : ""}`, entrada: inicial ?? 0, saida: 0, saldoApos: inicial });
      } else if (l.acao === "editou conta financeira") {
        const ant = numOrNull(det.saldoAnterior);
        const novo = numOrNull(det.novoSaldo);
        if (ant !== null && novo !== null && novo !== ant) {
          rows.push({ id: l.id, data: l.created_at, descricao: `Ajuste de saldo (${fmtMoney(ant)} → ${fmtMoney(novo)})`, entrada: novo > ant ? novo - ant : 0, saida: novo < ant ? ant - novo : 0, saldoApos: novo });
        } else {
          rows.push({ id: l.id, data: l.created_at, descricao: "Atualização de cadastro", entrada: 0, saida: 0, saldoApos: novo });
        }
      }
    }
    return rows.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
  }, [extLogs, extRange, diaLocalISO]);
  const extTotais = useMemo(() => extMovs.reduce(
    (s, m) => ({ entradas: s.entradas + m.entrada, saidas: s.saidas + m.saida, qtd: s.qtd + 1 }),
    { entradas: 0, saidas: 0, qtd: 0 },
  ), [extMovs]);
  // Saldo ao vivo (atualiza se o saldo mudar com o extrato aberto)
  const extContaViva = extConta ? accounts.find((a) => a.id === extConta.id) ?? extConta : null;

  // Calculate iFood weekly accumulation (Wednesdays)
  const getProximasQuartas = (inicio: string, fim: string): string[] => {
    const quartas: string[] = [];
    const start = new Date(inicio);
    const end = new Date(fim);
    const current = new Date(start);
    // Find first Wednesday
    while (current.getDay() !== 3) {
      current.setDate(current.getDate() + 1);
    }
    while (current <= end) {
      quartas.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 7);
    }
    return quartas;
  };

  const quartasFeiras = useMemo(() => getProximasQuartas(periodoInicio, periodoFim), [periodoInicio, periodoFim]);

  // Últimas 4 quartas-feiras anteriores ao dia atual (janela móvel: a cada nova quarta, a mais antiga sai)
  const ultimasQuartas = useMemo(() => {
    const today = new Date();
    const base = new Date(today);
    const day = base.getDay();
    const diff = (day - 3 + 7) % 7;
    base.setDate(base.getDate() - diff);
    base.setHours(0, 1, 0, 0);
    // Se hoje é quarta antes de 00:01, considera a quarta anterior
    if (base > today) base.setDate(base.getDate() - 7);
    const result: string[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i * 7);
      result.push(d.toISOString().split('T')[0]);
    }
    return result;
  }, []);

  // Helper: início da contagem da próxima quarta (última quarta 00:01 até agora)
  const getLastWednesdayStart = useCallback(() => {
    const now = new Date();
    const last = new Date(now);
    // Ajusta para última quarta
    const day = last.getDay();
    const diff = (day - 3 + 7) % 7; // dias desde última quarta
    last.setDate(last.getDate() - diff);
    last.setHours(0, 1, 0, 0); // 00:01
    return last;
  }, []);

  const getNextWednesday = useCallback((from: Date) => {
    const next = new Date(from);
    const day = next.getDay();
    const diff = (3 - day + 7) % 7;
    const add = diff === 0 ? 7 : diff;
    next.setDate(next.getDate() + add);
    next.setHours(0, 1, 0, 0);
    return next;
  }, []);

  // Computed values for KPIs (must come after queries that provide the data)
  // Saldo devedor = salário - pagamentos realizados (acumula se pagamento < salário)
  // Motoboys (is_motoboy) têm folha separada; a folha principal cobre os demais colaboradores.
  const staffCollabs = useMemo(() => collaborators.filter((c: any) => !(c as any).is_motoboy), [collaborators]);
  const motoboyCollabs = useMemo(() => collaborators.filter((c: any) => !!(c as any).is_motoboy), [collaborators]);
  // Pagamentos de folha somados apenas dentro do período selecionado (equipe x motoboys).
  // IDs desconhecidos (ex.: colaborador excluído) contam na equipe.
  const motoboyIdsSet = useMemo(() => new Set(motoboyCollabs.map((c: any) => String(c.id))), [motoboyCollabs]);
  // Pagamentos válidos = registros menos os estornados (exclusão vira estorno,
  // pois activity_logs não permite DELETE — a trilha de auditoria é preservada).
  const estornadosPeriodo = useMemo(() => new Set(
    pagamentosPeriodo.filter(p => p.acao === "estornou pagamento colaborador").map(p => String((p.detalhes as any)?.estorna_log_id ?? "")),
  ), [pagamentosPeriodo]);
  const pagamentosValidosPeriodo = useMemo(() => pagamentosPeriodo.filter(
    p => p.acao === "registrou pagamento colaborador" && !estornadosPeriodo.has(String(p.id)),
  ), [pagamentosPeriodo, estornadosPeriodo]);
  const folhaPagaPeriodoEquipe = useMemo(() => pagamentosValidosPeriodo
    .filter(p => !motoboyIdsSet.has(String(p.registro_id ?? "")))
    .reduce((s, p) => s + (Number((p.detalhes as any)?.valor) || 0), 0),
  [pagamentosValidosPeriodo, motoboyIdsSet]);
  const folhaPagaPeriodoMotoboys = useMemo(() => pagamentosValidosPeriodo
    .filter(p => motoboyIdsSet.has(String(p.registro_id ?? "")))
    .reduce((s, p) => s + (Number((p.detalhes as any)?.valor) || 0), 0),
  [pagamentosValidosPeriodo, motoboyIdsSet]);
  // Intervalo do extrato da folha (dia | semana seg-dom | mês | personalizado, máx. 62 dias)
  const pagExtRange = useMemo(() => {
    const hoje = diaLocalISO(new Date());
    let ini: string, fim: string, limitado = false;
    if (pagExtTipo === "dia") {
      ini = dataValida(pagExtData) ? pagExtData : hoje;
      fim = ini;
    } else if (pagExtTipo === "semana") {
      const base = dataValida(pagExtData) ? pagExtData : hoje;
      const dow = new Date(base + "T12:00:00").getDay();
      ini = somaDiasISO(base, -((dow + 6) % 7));
      fim = somaDiasISO(ini, 6);
    } else if (pagExtTipo === "mes") {
      const base = dataValida(pagExtData) ? pagExtData : hoje;
      const y = Number(base.slice(0, 4));
      const m = Number(base.slice(5, 7));
      ini = `${base.slice(0, 7)}-01`;
      fim = `${base.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    } else {
      const a = dataValida(pagExtInicio) ? pagExtInicio : hoje;
      const b = dataValida(pagExtFim) ? pagExtFim : hoje;
      ini = a <= b ? a : b;
      fim = a <= b ? b : a;
      if (somaDiasISO(ini, 62) <= fim) {
        fim = somaDiasISO(ini, 61);
        limitado = true;
      }
    }
    return { ini, fim, limitado };
  }, [pagExtTipo, pagExtData, pagExtInicio, pagExtFim, diaLocalISO, somaDiasISO, dataValida]);
  // Extrato de pagamentos do grupo aberto (equipe ou motoboys): lista individual
  // com data, colaborador e valor — estornados ficam de fora.
  const collabNomePorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of (collaborators as any[])) {
      if (c?.id) map.set(String(c.id), String(c.nome ?? "—"));
    }
    return map;
  }, [collaborators]);
  const pagExtratoLista = useMemo(() => {
    if (!pagExtGrupo) return [];
    const estornados = new Set(
      pagamentosTodos.filter(p => p.acao === "estornou pagamento colaborador").map(p => String((p.detalhes as any)?.estorna_log_id ?? "")),
    );
    return pagamentosTodos
      .filter(p => p.acao === "registrou pagamento colaborador" && !estornados.has(String(p.id)))
      .filter(p => {
        const dia = diaLocalISO(new Date(p.created_at));
        return dia >= pagExtRange.ini && dia <= pagExtRange.fim;
      })
      .filter(p => pagExtGrupo === "motoboys"
        ? motoboyIdsSet.has(String(p.registro_id ?? ""))
        : !motoboyIdsSet.has(String(p.registro_id ?? "")))
      .map(p => ({
        id: p.id,
        collaboratorId: p.registro_id,
        nome: collabNomePorId.get(String(p.registro_id ?? "")) ?? "Colaborador removido",
        valor: Number((p.detalhes as any)?.valor) || 0,
        data: p.created_at,
      }));
  }, [pagamentosTodos, pagExtGrupo, pagExtRange, motoboyIdsSet, collabNomePorId, diaLocalISO]);
  const pagExtratoTotal = useMemo(() => pagExtratoLista.reduce((s, p) => s + p.valor, 0), [pagExtratoLista]);
  const folhaTotal = useMemo(() => somaPagamentos(staffCollabs), [staffCollabs]);
  const totalPagamentos = folhaTotal;
  const totalSalarios = useMemo(() => somaSalarios(staffCollabs), [staffCollabs]);
  const totalSaldoDevedor = useMemo(() => somaSaldoDevedor(staffCollabs), [staffCollabs]);
  const totalSaldoDerivado = useMemo(() => somaSaldoDerivado(staffCollabs), [staffCollabs]);
  const folhaSaldoExibido = totalSaldoDevedor > 0 ? totalSaldoDevedor : totalSaldoDerivado;
  const motoboysPagamentos = useMemo(() => somaPagamentos(motoboyCollabs), [motoboyCollabs]);
  const motoboysSalarios = useMemo(() => somaSalarios(motoboyCollabs), [motoboyCollabs]);
  const motoboysSaldoDevedor = useMemo(() => somaSaldoDevedor(motoboyCollabs), [motoboyCollabs]);
  const motoboysSaldoDerivado = useMemo(() => somaSaldoDerivado(motoboyCollabs), [motoboyCollabs]);
  const motoboysSaldoExibido = motoboysSaldoDevedor > 0 ? motoboysSaldoDevedor : motoboysSaldoDerivado;
  // Folha acumulada no período selecionado (X a Y) por grupo (equipe e motoboys).
  // Usada nos hints/projeção — o valor oficial do DRE vem do RPC get_dre_data (soma toda a equipe).
  const folhaMeses = useMemo(() => {
    const ini = new Date(periodoInicio + "T12:00:00");
    const fim = new Date(periodoFim + "T12:00:00");
    if (isNaN(ini.getTime()) || isNaN(fim.getTime()) || fim < ini) return 0;
    return (fim.getFullYear() * 12 + fim.getMonth()) - (ini.getFullYear() * 12 + ini.getMonth()) + 1;
  }, [periodoInicio, periodoFim]);
  const folhaAcumulada = useMemo(() => calcFolhaAcumulada(staffCollabs, periodoInicio, periodoFim, folhaMeses), [staffCollabs, periodoInicio, periodoFim, folhaMeses]);
  const folhaAcumuladaMotoboys = useMemo(() => calcFolhaAcumulada(motoboyCollabs, periodoInicio, periodoFim, folhaMeses), [motoboyCollabs, periodoInicio, periodoFim, folhaMeses]);
  // Total considera valor_total quando disponível, senão quantidade_recebida * preco_recebido (valor efetivo pago)
  // Fallback mantém compatibilidade com ordens antigas
  const insumosTotal = useMemo(() => receivedPurchaseOrders.reduce((s: number, o: any) => {
    const valor = Number(o.valor_total) || (Number(o.quantidade_recebida ?? o.quantidade_necessaria) || 0) * (Number(o.preco_recebido ?? o.preco_medio) || Number(o.ingredients?.preco_ultima_compra) || Number(o.ingredients?.preco_medio) || 0);
    return s + valor;
  }, 0), [receivedPurchaseOrders]);
  const insumosAvgPrice = useMemo(() => {
    if (receivedPurchaseOrders.length === 0) return 0;
    const sumUnit = receivedPurchaseOrders.reduce((s: number, o: any) => {
      const precoUnit = Number(o.preco_recebido ?? o.preco_medio) || Number(o.ingredients?.preco_ultima_compra) || 0;
      return s + precoUnit;
    }, 0);
    return sumUnit / receivedPurchaseOrders.length;
  }, [receivedPurchaseOrders]);
  // Somente pagos — para DRE (realizado)
  const insumosPaidTotal = useMemo(() => receivedPurchaseOrders.filter((o: any) => o.pago).reduce((s: number, o: any) => {
    const valor = Number(o.valor_total) || (Number(o.quantidade_recebida ?? o.quantidade_necessaria) || 0) * (Number(o.preco_recebido ?? o.preco_medio) || Number(o.ingredients?.preco_ultima_compra) || Number(o.ingredients?.preco_medio) || 0);
    return s + valor;
  }, 0), [receivedPurchaseOrders]);
  const anotaTotal = useMemo(() => anotaOrders.reduce((s, o) => s + (Number(o.total) || 0), 0), [anotaOrders]);

  // Taxas de entrega + outras taxas por pedido (período selecionado, mesma base do anotaOrders).
  // Declarado aqui (antes do DRE) pois os totais alimentam as seções do DRE Completo.
  const taxasPorPedido = useMemo(() => anotaOrders.map(o => {
    const taxaEntrega = extractDeliveryFee(o.payload);
    const outras = extractOtherFees(o.payload);
    return {
      id: o.id,
      numero: o.numero ?? o.external_order_id?.slice(-6) ?? o.id.slice(0, 8),
      motoboyId: o.motoboy_id ?? null,
      imported_at: o.imported_at,
      total: Number(o.total) || 0,
      taxaEntrega,
      outrasTaxas: outras.total,
      outrasItens: outras.itens,
      totalTaxas: taxaEntrega + outras.total,
    };
  }), [anotaOrders]);
  const taxasEntregaTotal = useMemo(() => taxasPorPedido.reduce((s, t) => s + t.taxaEntrega, 0), [taxasPorPedido]);
  const outrasTaxasTotal = useMemo(() => taxasPorPedido.reduce((s, t) => s + t.outrasTaxas, 0), [taxasPorPedido]);
  const taxasTotalGeral = useMemo(() => taxasEntregaTotal + outrasTaxasTotal, [taxasEntregaTotal, outrasTaxasTotal]);
  const pedidosComTaxaEntrega = useMemo(() => taxasPorPedido.filter(t => t.taxaEntrega > 0).length, [taxasPorPedido]);
  const pedidosComOutrasTaxas = useMemo(() => taxasPorPedido.filter(t => t.outrasTaxas > 0).length, [taxasPorPedido]);
  const outrasTaxasPorNome = useMemo(() => {
    const map = new Map<string, { total: number; qtd: number }>();
    for (const t of taxasPorPedido) {
      for (const item of t.outrasItens) {
        const cur = map.get(item.nome) ?? { total: 0, qtd: 0 };
        cur.total += item.valor;
        cur.qtd += 1;
        map.set(item.nome, cur);
      }
    }
    return [...map.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [taxasPorPedido]);

  // Combine auto and manual entries - DRE Completo agora mostra também lançamentos futuros pendentes ("Há pagar") com data correta do vencimento
  // Despesas com insumos entra como seção própria no DRE (somente pagos)
  const allDreRows = useMemo(() => {
    // Exclui as linhas totalizadoras do RPC (LUCRO BRUTO / RESULTADO LÍQUIDO com a
    // fórmula antiga do banco): os totalizadores exibidos vêm do `kpis` (frontend),
    // mesma fonte dos cards — assim DRE e cards nunca divergem.
    const rows: DreRow[] = [...autoDre
      .filter(r => r.secao !== "LUCRO BRUTO" && r.secao !== "RESULTADO LÍQUIDO")
      .map(r => ({ ...r, vencimento: null, data_pagamento: null, pago: null })) as DreRow[]];
    // Lançamentos manuais: TODOS entram em OUTRAS DESPESAS (seção OUTROS), pagos e
    // pendentes ("Há pagar" quando o vencimento ainda não chegou) do período filtrado.
    for (const e of manualEntries) {
      const pago = (e as any).pago;
      rows.push({
        secao: "OUTROS",
        categoria: e.categoria,
        descricao: e.descricao ?? "",
        valor: Number(e.valor),
        fonte: "manual",
        vencimento: (e as any).vencimento || e.competencia || null,
        data_pagamento: (e as any).data_pagamento || null,
        pago: pago ?? null,
        id: e.id,
        editable: true,
        recorrencia_grupo_id: (e as any).recorrencia_grupo_id ?? null,
        recorrencia_tipo: (e as any).recorrencia_tipo ?? null,
        recorrencia_quantidade: (e as any).recorrencia_quantidade ?? null,
      });
    }
    // Despesas com insumos (somente pagas) - principal indicador agora no DRE
    if (insumosPaidTotal > 0) {
      rows.push({
        secao: "DESPESAS COM INSUMOS",
        categoria: "Insumos pagos",
        descricao: `${receivedPurchaseOrders.filter((o: any) => o.pago).length} ordens quitadas no período`,
        valor: insumosPaidTotal,
        fonte: "auto",
        vencimento: null,
        data_pagamento: null,
        pago: true,
        editable: false,
      });
    }
    // Taxas dos pedidos (entrega + extras) entram no DRE como custo variável do período, sempre com status "pago"
    if (taxasEntregaTotal > 0) {
      rows.push({
        secao: "TAXAS DE ENTREGA",
        categoria: "Taxas de entrega dos pedidos",
        descricao: `${pedidosComTaxaEntrega} pedido(s) com taxa no período`,
        valor: taxasEntregaTotal,
        fonte: "auto",
        vencimento: null,
        data_pagamento: null,
        pago: true,
        editable: false,
      });
    }
    if (outrasTaxasTotal > 0) {
      rows.push({
        secao: "OUTRAS TAXAS",
        categoria: "Taxas extras dos pedidos",
        descricao: `${pedidosComOutrasTaxas} pedido(s) com taxas extras no período`,
        valor: outrasTaxasTotal,
        fonte: "auto",
        vencimento: null,
        data_pagamento: null,
        pago: true,
        editable: false,
      });
    }
    // Folha da equipe: mostra APENAS o que foi pago DENTRO do período selecionado
    // (somado dos registros de pagamento), com status "pago".
    const folhaRow = rows.find(r => r.secao === "DESPESAS OPERACIONAIS" && r.fonte === "auto");
    if (folhaRow) {
      folhaRow.valor = folhaPagaPeriodoEquipe;
      folhaRow.categoria = "Folha da equipe (pago)";
      folhaRow.descricao = `${staffCollabs.length} colaborador(es) • pagos de ${fmtDate(periodoInicio)} a ${fmtDate(periodoFim)}`;
      folhaRow.pago = true;
    } else if (folhaPagaPeriodoEquipe > 0) {
      rows.push({
        secao: "DESPESAS OPERACIONAIS",
        categoria: "Folha da equipe (pago)",
        descricao: `${staffCollabs.length} colaborador(es) • pagos de ${fmtDate(periodoInicio)} a ${fmtDate(periodoFim)}`,
        valor: folhaPagaPeriodoEquipe,
        fonte: "auto",
        vencimento: null,
        data_pagamento: null,
        pago: true,
        editable: false,
      });
    }
    // Folha dos motoboys: mesma lógica — apenas pagamentos do período, status "pago".
    if (folhaPagaPeriodoMotoboys > 0) {
      rows.push({
        secao: "FOLHA DOS MOTOBOYS",
        categoria: "Pagamentos aos motoboys",
        descricao: `${motoboyCollabs.length} motoboy(s) • pagos de ${fmtDate(periodoInicio)} a ${fmtDate(periodoFim)}`,
        valor: folhaPagaPeriodoMotoboys,
        fonte: "auto",
        vencimento: null,
        data_pagamento: null,
        pago: true,
        editable: false,
      });
    }
    return rows;
  }, [autoDre, manualEntries, insumosPaidTotal, receivedPurchaseOrders, taxasEntregaTotal, pedidosComTaxaEntrega, outrasTaxasTotal, pedidosComOutrasTaxas, motoboyCollabs, folhaPagaPeriodoEquipe, folhaPagaPeriodoMotoboys, staffCollabs, periodoInicio, periodoFim]);

  // Calculate KPIs - DRE Completo: inclui pagos + "Há pagar" (forecast) dentro do período filtrado.
  // Taxas dos pedidos abatem o lucro bruto (custo variável); folha dos motoboys
  // abate após o lucro bruto (operacional), junto das demais despesas.
  const kpis = useMemo(() => {
    const receita = allDreRows.filter(r => r.secao === "RECEITA BRUTA").reduce((s, r) => s + r.valor, 0);
    const custoDireto = allDreRows.filter(r => r.secao === "CUSTO DIRETO (CMV)").reduce((s, r) => s + r.valor, 0);
    const custoVariavel = allDreRows.filter(r => r.secao === "CUSTO VARIAVEL").reduce((s, r) => s + r.valor, 0);
    const despesasInsumos = allDreRows.filter(r => r.secao === "DESPESAS COM INSUMOS").reduce((s, r) => s + r.valor, 0);
    const taxasEntrega = allDreRows.filter(r => r.secao === "TAXAS DE ENTREGA").reduce((s, r) => s + r.valor, 0);
    const outrasTaxas = allDreRows.filter(r => r.secao === "OUTRAS TAXAS").reduce((s, r) => s + r.valor, 0);
    const lucroBruto = receita - custoDireto - custoVariavel - despesasInsumos - taxasEntrega - outrasTaxas;
    const despesasOp = allDreRows.filter(r => r.secao === "DESPESAS OPERACIONAIS").reduce((s, r) => s + r.valor, 0);
    const folhaMotoboys = allDreRows.filter(r => r.secao === "FOLHA DOS MOTOBOYS").reduce((s, r) => s + r.valor, 0);
    const outrasDespesas = allDreRows
      .filter(r => ["DESPESA ADMINISTRATIVA", "DESPESA FINANCEIRA", "OUTROS"].includes(r.secao))
      .reduce((s, r) => s + r.valor, 0);
    const resultado = lucroBruto - despesasOp - folhaMotoboys - outrasDespesas;
    const margem = receita > 0 ? ((resultado / receita) * 100) : 0;

    return { receita, custoDireto, custoVariavel, despesasInsumos, taxasEntrega, outrasTaxas, lucroBruto, despesasOp, folhaMotoboys, outrasDespesas, resultado, margem };
  }, [allDreRows]);

  // Descritivo do que consome a margem líquida vs faturamento bruto (percentuais + estratégia)
  const margemBreakdown = useMemo(() => {
    const r = kpis.receita;
    const pct = (v: number) => (r > 0 ? (v / r) * 100 : 0);
    const itens = [
      { chave: "Custo Direto (CMV)", valor: kpis.custoDireto, pct: pct(kpis.custoDireto), dica: "Insumos/CMV sobre a receita. Se > 35%, revise fichas técnicas, desperdício e preço de compra." },
      { chave: "Custo Variável", valor: kpis.custoVariavel, pct: pct(kpis.custoVariavel), dica: "Embalagens e variáveis por pedido. Amarre ao ticket médio." },
      { chave: "Despesas com Insumos", valor: kpis.despesasInsumos, pct: pct(kpis.despesasInsumos), dica: "Ordens de compra quitadas no período. Compare com CMV para ver descasamento caixa x competência." },
      { chave: "Taxas de Entrega", valor: kpis.taxasEntrega, pct: pct(kpis.taxasEntrega), dica: "Taxas de entrega dos pedidos no período. Repasse parcial no preço ou taxa do cliente protege a margem." },
      { chave: "Outras Taxas", valor: kpis.outrasTaxas, pct: pct(kpis.outrasTaxas), dica: "Taxas extras (embalagem, serviço...). Mapeie por tipo na aba Vencimentos." },
      { chave: "Despesas Operacionais (equipe)", valor: kpis.despesasOp, pct: pct(kpis.despesasOp), dica: "Pagamentos à equipe dentro do período (sem motoboys) + operação. Idealmente < 30-35% da receita em food service." },
      { chave: "Folha dos Motoboys", valor: kpis.folhaMotoboys, pct: pct(kpis.folhaMotoboys), dica: "Pagamentos aos motoboys dentro do período. Avalie entregas próprias vs terceirizadas." },
      { chave: "Outras Despesas (Adm + Fin + Outros)", valor: kpis.outrasDespesas, pct: pct(kpis.outrasDespesas), dica: "Aluguel, energia, juros, taxas. Juros altos aqui corroem a margem rápido." },
    ];
    const totalConsumido = itens.reduce((s, i) => s + i.valor, 0);
    const ordenados = [...itens].sort((a, b) => b.valor - a.valor);
    const maiorVilao = ordenados[0];
    const margemContrib = r > 0 ? (kpis.lucroBruto / r) * 100 : 0;
    return { itens, ordenados, totalConsumido, pctTotal: pct(totalConsumido), maiorVilao, margemContrib };
  }, [kpis]);

  // Ponto de equilíbrio: soma de todas as despesas/custos recorrentes + folha + insumos
  // Não diminui quando parcela é paga, só quando quitada/removida (grupo pendente continua contando)
  // Folha e recorrentes respeitam o opt-out individual (inclui_ponto_equilibrio !== false integra)
  const pontoDeEquilibrio = useMemo(() => {
    const folhaItens = (collaborators as any[]).map((c: any) => ({
      id: String(c.id ?? ""),
      nome: c.nome ?? "—",
      cargo: c.cargo ?? null,
      salario: Number(c.salario) || 0,
      is_motoboy: !!(c as any).is_motoboy,
      incluido: (c as any).inclui_ponto_equilibrio !== false,
    }));
    const folha = folhaItens.filter(c => c.incluido).reduce((s, c) => s + c.salario, 0);
    // Manual recorrentes distintos (cada grupo conta uma vez)
    // Apenas lançamentos com inclui_ponto_equilibrio !== false integram o indicador (padrão: inclui)
    const montarRecorrentes = (list: any[]) => {
      const grupos = new Map<string, { valor: number; categoria: string; descricao: string; tipo: string | null; quantidade: number | null; ids: string[]; incluido: boolean }>();
      const avulsos: { id: string; categoria: string; descricao: string; valor: number; incluido: boolean }[] = [];
      for (const e of list) {
        const gid = (e as any).recorrencia_grupo_id as string | null;
        const val = Number((e as any).valor) || 0;
        const categoria = String((e as any).categoria ?? "—");
        const descricao = String((e as any).descricao ?? "");
        const incluido = (e as any).inclui_ponto_equilibrio !== false;
        const id = String((e as any).id ?? "");
        if (gid) {
          if (!grupos.has(gid)) {
            grupos.set(gid, { valor: val, categoria, descricao, tipo: (e as any).recorrencia_tipo ?? null, quantidade: (e as any).recorrencia_quantidade ?? null, ids: [], incluido: true });
          }
          const g = grupos.get(gid)!;
          if (id && !g.ids.includes(id)) g.ids.push(id);
          g.incluido = g.incluido && incluido;
        } else {
          avulsos.push({ id, categoria, descricao, valor: val, incluido });
        }
      }
      return { grupos, avulsos };
    };
    // Completa os ids de cada grupo com todas as listas (para o toggle afetar o grupo inteiro)
    const completarIdsGrupos = (rec: { grupos: Map<string, { ids: string[]; incluido: boolean }> }) => {
      for (const e of [...(manualRecorrentesAll as any[]), ...(manualVencimentos as any[])]) {
        const gid = (e as any).recorrencia_grupo_id as string | null;
        if (!gid) continue;
        const g = rec.grupos.get(gid);
        if (!g) continue;
        const id = String((e as any).id ?? "");
        if (id && !g.ids.includes(id)) g.ids.push(id);
        g.incluido = g.incluido && (e as any).inclui_ponto_equilibrio !== false;
      }
    };
    let rec = montarRecorrentes(manualRecorrentesAll as any[]);
    const somaRec = (r: { grupos: Map<string, { valor: number; incluido: boolean }>; avulsos: { valor: number; incluido: boolean }[] }) =>
      [...r.grupos.values()].filter(g => g.incluido).reduce((s, g) => s + g.valor, 0) + r.avulsos.filter(a => a.incluido).reduce((s, a) => s + a.valor, 0);
    let recorrenteTotal = somaRec(rec);
    let usouFallback = false;
    // Fallback: se ainda 0, usa manualVencimentos recorrentes (pendentes) para não ficar 0 enquanto carrega
    if (recorrenteTotal === 0 && manualVencimentos.length) {
      const fb = montarRecorrentes((manualVencimentos as any[]).filter((e: any) => (e as any).recorrente));
      const somaFb = somaRec(fb);
      if (somaFb > 0) {
        rec = fb;
        recorrenteTotal = somaFb;
        usouFallback = true;
      }
    }
    completarIdsGrupos(rec);
    // Insumos: usa total do período (todos recebidos) como proxy mensal recorrente, estável mesmo após quitar
    const insumosRecorrente = insumosTotal;
    const total = folha + recorrenteTotal + insumosRecorrente;
    return {
      total,
      folha,
      folhaItens,
      recorrenteTotal,
      recorrenteGrupos: [...rec.grupos.entries()].map(([gid, g]) => ({ gid, ...g })),
      recorrenteAvulsos: rec.avulsos,
      usouFallback,
      insumos: insumosRecorrente,
      insumosQtd: receivedPurchaseOrders.length,
    };
  }, [collaborators, manualRecorrentesAll, manualVencimentos, insumosTotal, receivedPurchaseOrders]);

  // Separa iFood vs Anota direto (iFood passa pelo Anota AI mas tem salesChannel/from com 'ifood')
  const ifoodOrders = useMemo(() => anotaOrders.filter(isIfoodOrder), [anotaOrders, isIfoodOrder]);
  const anotaDirectOrders = useMemo(() => anotaOrders.filter(o => !isIfoodOrder(o)), [anotaOrders, isIfoodOrder]);
  const ifoodTotal = useMemo(() => ifoodOrders.reduce((s, o) => s + (Number(o.total) || 0), 0), [ifoodOrders]);
  const anotaDirectTotal = useMemo(() => anotaDirectOrders.reduce((s, o) => s + (Number(o.total) || 0), 0), [anotaDirectOrders]);
  // Valores por quarta-feira para iFood (janela: quarta 00:01 até próxima quarta 00:01)
  const ifoodQuartasValores = useMemo(() => {
    return quartasFeiras.map(q => {
      const quarta = new Date(q);
      quarta.setHours(0, 1, 0, 0);
      const prev = new Date(quarta);
      prev.setDate(prev.getDate() - 7);
      const start = new Date(Math.max(prev.getTime(), new Date(periodoInicio).getTime()));
      const end = quarta;
      const sum = ifoodOrders.filter(o => {
        const d = new Date(o.imported_at);
        return d >= start && d < end;
      }).reduce((s, o) => s + (Number(o.total) || 0), 0);
      return { data: q, valor: sum, inicio: start.toISOString().split('T')[0] };
    });
  }, [quartasFeiras, ifoodOrders, periodoInicio]);
  const ultimasQuartasComValores = useMemo(() => {
    return ultimasQuartas.map(q => {
      const quarta = new Date(q);
      quarta.setHours(0, 1, 0, 0);
      const prev = new Date(quarta);
      prev.setDate(prev.getDate() - 7);
      const start = prev;
      const end = quarta;
      const sum = ifoodOrders.filter(o => {
        const d = new Date(o.imported_at);
        return d >= start && d < end;
      }).reduce((s, o) => s + (Number(o.total) || 0), 0);
      return { data: q, valor: sum, inicio: start.toISOString().split('T')[0] };
    });
  }, [ultimasQuartas, ifoodOrders]);
  // Próxima quarta: from última quarta 00:01 até agora (atualiza conforme pedidos entram)
  const ifoodProximaQuarta = useMemo(() => {
    const lastStart = getLastWednesdayStart();
    const nextWed = getNextWednesday(lastStart);
    const start = lastStart;
    const end = new Date(); // até agora
    // Se o período filtrado não inclui o intervalo atual, ainda mostra o valor atual (fora do período)
    // Para manter coerência com o período, filtra também por ifoodOrders já filtrados pelo período;
    // se quiser valor "ao vivo" fora do período, usaria todos os pedidos, mas aqui usamos os do período
    // e também um cálculo ao vivo com todos os pedidos recentes (até agora)
    const sumPeriodo = ifoodOrders.filter(o => {
      const d = new Date(o.imported_at);
      return d >= start && d <= end;
    }).reduce((s, o) => s + (Number(o.total) || 0), 0);
    return { valor: sumPeriodo, data: nextWed.toISOString().split('T')[0], inicio: start.toISOString().split('T')[0] };
  }, [ifoodOrders, getLastWednesdayStart, getNextWednesday]);
  // Mantido para compatibilidade (legado 30%)
  const ifoodFuture = ifoodTotal;

  // Nome do motoboy vinculado a cada pedido (para as tabelas de taxas)
  const motoboyNomePorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of (collaborators as any[])) {
      if (c?.id && c?.nome) map.set(String(c.id), String(c.nome));
    }
    return map;
  }, [collaborators]);
  // --- Detalhamento de taxas com busca própria (dia | semana | mês | personalizado) ---
  // Independe do período do DRE: busca os pedidos do intervalo selecionado no dialog.
  const taxRange = useMemo(() => {
    const hoje = diaLocalISO(new Date());
    let ini: string, fim: string, limitado = false;
    if (taxTipo === "dia") {
      ini = dataValida(taxData) ? taxData : hoje;
      fim = ini;
    } else if (taxTipo === "semana") {
      const base = dataValida(taxData) ? taxData : hoje;
      const dow = new Date(base + "T12:00:00").getDay();
      ini = somaDiasISO(base, -((dow + 6) % 7));
      fim = somaDiasISO(ini, 6);
    } else if (taxTipo === "mes") {
      const base = dataValida(taxData) ? taxData : hoje;
      const y = Number(base.slice(0, 4));
      const m = Number(base.slice(5, 7));
      ini = `${base.slice(0, 7)}-01`;
      fim = `${base.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    } else {
      const a = dataValida(taxInicio) ? taxInicio : hoje;
      const b = dataValida(taxFim) ? taxFim : hoje;
      ini = a <= b ? a : b;
      fim = a <= b ? b : a;
      if (somaDiasISO(ini, 62) <= fim) {
        fim = somaDiasISO(ini, 61);
        limitado = true;
      }
    }
    return { ini, fim, limitado };
  }, [taxTipo, taxData, taxInicio, taxFim, diaLocalISO, somaDiasISO, dataValida]);
  const { data: taxOrders = [] } = useQuery({
    queryKey: ["anota-orders-taxas-dialog", taxRange.ini, taxRange.fim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anota_orders")
        .select("id, total, check_status, pedido_em, imported_at, payload, numero, motoboy_id, external_order_id")
        .in("check_status", [1, 2, 3])
        .gte("imported_at", `${taxRange.ini}T00:00:00`)
        .lte("imported_at", `${taxRange.fim}T23:59:59`)
        .order("imported_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; total: number; check_status: number; pedido_em: string | null; imported_at: string; payload: any; numero: string | null; motoboy_id: string | null; external_order_id: string }[];
    },
    enabled: unlocked && showTaxasDetail,
  });
  const taxPorPedido = useMemo(() => taxOrders.map(o => {
    const taxaEntrega = extractDeliveryFee(o.payload);
    const outras = extractOtherFees(o.payload);
    return {
      id: o.id,
      numero: o.numero ?? o.external_order_id?.slice(-6) ?? o.id.slice(0, 8),
      motoboyId: o.motoboy_id ?? null,
      imported_at: o.imported_at,
      total: Number(o.total) || 0,
      taxaEntrega,
      outrasTaxas: outras.total,
      outrasItens: outras.itens,
      totalTaxas: taxaEntrega + outras.total,
    };
  }), [taxOrders]);
  // Opções de motoboy presentes no intervalo (para o filtro por nome)
  const taxMotoboysOpts = useMemo(() => {
    const ids = new Map<string, string>();
    for (const t of taxPorPedido) {
      if (!t.motoboyId || ids.has(t.motoboyId)) continue;
      ids.set(t.motoboyId, motoboyNomePorId.get(t.motoboyId) ?? `Motoboy ${t.motoboyId.slice(0, 8)}`);
    }
    return [...ids.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [taxPorPedido, motoboyNomePorId]);
  // Pedidos do intervalo com o filtro de motoboy aplicado (lista detalhada)
  const taxFiltrados = useMemo(() => taxPorPedido.filter(t =>
    taxMotoboy === "todos" ? true : taxMotoboy === "sem" ? !t.motoboyId : t.motoboyId === taxMotoboy,
  ), [taxPorPedido, taxMotoboy]);
  // Total de taxa de entrega por motoboy no intervalo (ignora o filtro de nome p/ comparar)
  const taxPorMotoboy = useMemo(() => {
    const map = new Map<string, { id: string | null; nome: string; qtd: number; total: number }>();
    for (const t of taxPorPedido) {
      if (t.taxaEntrega <= 0) continue;
      const key = t.motoboyId ?? "sem";
      const cur = map.get(key) ?? {
        id: t.motoboyId,
        nome: t.motoboyId ? (motoboyNomePorId.get(t.motoboyId) ?? `Motoboy ${t.motoboyId.slice(0, 8)}`) : "Sem motoboy",
        qtd: 0,
        total: 0,
      };
      cur.qtd += 1;
      cur.total += t.taxaEntrega;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [taxPorPedido, motoboyNomePorId]);
  const taxTotais = useMemo(() => taxFiltrados.reduce(
    (s, t) => ({
      entrega: s.entrega + t.taxaEntrega,
      outras: s.outras + t.outrasTaxas,
      geral: s.geral + t.totalTaxas,
      pedidos: s.pedidos + (t.totalTaxas > 0 ? 1 : 0),
    }),
    { entrega: 0, outras: 0, geral: 0, pedidos: 0 },
  ), [taxFiltrados]);
  const taxOutrasPorNome = useMemo(() => {
    const map = new Map<string, { total: number; qtd: number }>();
    for (const t of taxFiltrados) {
      for (const item of t.outrasItens) {
        const cur = map.get(item.nome) ?? { total: 0, qtd: 0 };
        cur.total += item.valor;
        cur.qtd += 1;
        map.set(item.nome, cur);
      }
    }
    return [...map.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [taxFiltrados]);
  // Insumos a pagar = compras a prazo pendentes (parcela de vencimentos ligada a estoque)
  const insumosAPagarTotal = useMemo(() =>
    vencimentosPendentes.reduce((s: number, r: any) =>
      s + (Number(r.valor_total) || Number(r.quantidade_recebida || r.quantidade_necessaria) * Number(r.preco_recebido || r.preco_medio) || 0), 0),
  [vencimentosPendentes]);
  const manualAPagarTotal = useMemo(() =>
    manualVencimentos.reduce((s: number, r: any) => s + (Number(r.valor) || 0), 0),
  [manualVencimentos]);

  const saveEntry = useMutation({
    mutationFn: async (entry: Partial<DreEntry> & { id?: string }) => {
      const vencimentoVal = (entry as any).vencimento || entry.competencia || VENCIMENTO_DEFAULT;
      const pagoVal = (entry as any).pago ?? true;
      // competencia sempre mês do vencimento para manter compatibilidade com DRE por competência
      const competenciaVal = vencimentoVal ? vencimentoVal.slice(0, 7) + "-01" : (entry.competencia || COMPETENCIA_DEFAULT);
      // Lançamentos futuros devem sempre nascer como "Há pagar" (pago=false), mesmo se switch "pago" estiver marcado
      const hojeISO = new Date().toISOString().split('T')[0];
      const isVencimentoFuturo = vencimentoVal > hojeISO;
      const pagoEfetivo = isVencimentoFuturo ? false : pagoVal;
      const basePayload: any = {
        tipo: entry.tipo!,
        categoria: entry.categoria!,
        descricao: entry.descricao || null,
        valor: Number(entry.valor) || 0,
        competencia: competenciaVal,
        vencimento: vencimentoVal,
        pago: pagoEfetivo,
        data_pagamento: pagoEfetivo ? new Date().toISOString() : null,
        recorrente: entry.recorrente ?? false,
        inclui_ponto_equilibrio: (entry as any).inclui_ponto_equilibrio ?? true,
      };
      // Tenta incluir novos campos se existirem na tabela (migration 20260831)
      const recorrenciaTipo = (entry as any).recorrencia_tipo as 'indefinida' | 'determinada' | null | undefined;
      const recorrenciaQtd = (entry as any).recorrencia_quantidade as number | null | undefined;
      if (recorrenciaTipo) basePayload.recorrencia_tipo = recorrenciaTipo;
      if (recorrenciaQtd) basePayload.recorrencia_quantidade = recorrenciaQtd;

      const addMonths = (isoDate: string, months: number) => {
        const d = new Date(isoDate);
        // Garante dia 01 para competência mensal
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + months);
        return d.toISOString().split('T')[0];
      };
      const addMonthsVencimento = (isoDate: string, months: number) => {
        const d = new Date(isoDate);
        d.setUTCMonth(d.getUTCMonth() + months);
        return d.toISOString().split('T')[0];
      };

      if (entry.id) {
        // Edição: atualiza apenas o registro selecionado (não replica recorrência)
        let payload: any = { ...basePayload };
        // Se for recorrente determinada/indefinida, mantém grupo_id original se existir
        if ((entry as any).recorrencia_grupo_id) payload.recorrencia_grupo_id = (entry as any).recorrencia_grupo_id;
        let { error } = await supabase.from("finance_dre_entries").update(payload).eq("id", entry.id);
        // Fallback se colunas novas ainda não existem (migration pendente)
        if (error && (/recorrencia/i.test(error.message) || /vencimento/i.test(error.message) || /pago/i.test(error.message) || /inclui_ponto_equilibrio/i.test(error.message))) {
          const { recorrencia_tipo, recorrencia_quantidade, recorrencia_grupo_id, vencimento, pago, data_pagamento, inclui_ponto_equilibrio, ...fallback } = payload;
          // tenta sem novas colunas, depois tenta apenas sem recorrencia
          if (/vencimento|pago/.test(error.message)) {
            const { error: err2 } = await supabase.from("finance_dre_entries").update(fallback).eq("id", entry.id);
            if (err2) {
              // tenta fallback parcial só sem recorrencia
              const { recorrencia_tipo: _rt, recorrencia_quantidade: _rq, recorrencia_grupo_id: _rg, ...fallback2 } = payload;
              const { error: err3 } = await supabase.from("finance_dre_entries").update(fallback2).eq("id", entry.id);
              if (err3) throw err3;
              await logActivity("financeiro", "editou lançamento DRE", entry.id, { categoria: entry.categoria });
              return;
            }
          } else {
            const { error: err2 } = await supabase.from("finance_dre_entries").update(fallback).eq("id", entry.id);
            if (err2) throw err2;
          }
        } else if (error) throw error;
        await logActivity("financeiro", "editou lançamento DRE", entry.id, { categoria: entry.categoria });
      } else {
        const isRecorrente = !!entry.recorrente;
        const tipo = recorrenciaTipo || (isRecorrente ? 'indefinida' : null);
        let quantidade: number | null = null;
        if (isRecorrente) {
          if (tipo === 'determinada') quantidade = Math.max(2, Math.min(60, Number(recorrenciaQtd) || 3));
          else if (tipo === 'indefinida') quantidade = 12; // gera 12 meses para indefinida
        }

        if (isRecorrente && quantidade && quantidade > 1) {
          const grupoId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const rows: any[] = [];
          for (let i = 0; i < quantidade; i++) {
            const venc = addMonthsVencimento(basePayload.vencimento, i);
            const comp = addMonths(basePayload.competencia, i);
            const isFuturo = venc > hojeISO;
            const pagoForThis = pagoVal && !isFuturo;
            rows.push({
              ...basePayload,
              competencia: comp,
              vencimento: venc,
              pago: pagoForThis,
              data_pagamento: pagoForThis ? new Date().toISOString() : null,
              recorrencia_grupo_id: grupoId,
              recorrencia_tipo: tipo,
              recorrencia_quantidade: tipo === 'determinada' ? quantidade : null,
            });
          }
          // Tenta inserir com novas colunas
          let { error, data } = await supabase.from("finance_dre_entries").insert(rows).select("id");
          if (error && (/recorrencia/i.test(error.message) || /vencimento/i.test(error.message) || /pago/i.test(error.message) || /inclui_ponto_equilibrio/i.test(error.message))) {
            // Fallback sem colunas novas
            const fallbackRows = rows.map(({ recorrencia_tipo, recorrencia_quantidade, recorrencia_grupo_id, vencimento, pago, data_pagamento, inclui_ponto_equilibrio, ...r }) => r);
            // se erro for só recorrencia, tenta com vencimento/pago mantidos
            if (/recorrencia/.test(error.message) && !/vencimento|pago/.test(error.message)) {
              const fallback2 = rows.map(({ recorrencia_tipo, recorrencia_quantidade, recorrencia_grupo_id, ...r }) => r);
              const { error: err2, data: data2 } = await supabase.from("finance_dre_entries").insert(fallback2).select("id");
              if (err2) throw err2;
              data = data2;
            } else {
              const { error: err2, data: data2 } = await supabase.from("finance_dre_entries").insert(fallbackRows).select("id");
              if (err2) throw err2;
              data = data2;
            }
          } else if (error) throw error;
          await logActivity("financeiro", "criou lançamentos DRE recorrentes", (data as any)?.[0]?.id ?? null, { categoria: entry.categoria, tipo, quantidade });
        } else {
          let { data, error } = await supabase.from("finance_dre_entries").insert(basePayload).select("id").single();
          if (error && (/recorrencia/i.test(error.message) || /vencimento/i.test(error.message) || /pago/i.test(error.message) || /inclui_ponto_equilibrio/i.test(error.message))) {
            const { recorrencia_tipo, recorrencia_quantidade, recorrencia_grupo_id, vencimento, pago, data_pagamento, inclui_ponto_equilibrio, ...fallback } = basePayload;
            if (/vencimento|pago/.test(error.message)) {
              const { error: err2, data: d2 } = await supabase.from("finance_dre_entries").insert(fallback).select("id").single();
              if (err2) {
                const { recorrencia_tipo: _rt, recorrencia_quantidade: _rq, recorrencia_grupo_id: _rg, ...fallback2 } = basePayload;
                const { error: err3, data: d3 } = await supabase.from("finance_dre_entries").insert(fallback2).select("id").single();
                if (err3) throw err3;
                data = d3 as any;
              } else {
                data = d2;
              }
            } else {
              const { error: err2, data: d2 } = await supabase.from("finance_dre_entries").insert(fallback).select("id").single();
              if (err2) throw err2;
              data = d2;
            }
          } else if (error) throw error;
          await logActivity("financeiro", "criou lançamento DRE", (data as any).id, { categoria: entry.categoria });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
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
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
      toast.success("Lançamento removido!");
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Exclui um lançamento recorrente inteiro (todas as parcelas do grupo)
  const deleteGroupMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase as any).from("finance_dre_entries").delete().in("id", ids);
      if (error) throw error;
      await logActivity("financeiro", "excluiu lançamento recorrente (grupo)", ids[0] ?? null, { parcelas: ids.length });
    },
    onSuccess: (_d, ids) => {
      qc.invalidateQueries({ queryKey: ["finance-dre-entries"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-entries-all"] });
      qc.invalidateQueries({ queryKey: ["finance-manual-vencimentos"] });
      qc.invalidateQueries({ queryKey: ["finance-dre-auto"] });
      qc.invalidateQueries({ queryKey: ["finance-recorrentes-all"] });
      toast.success(`Lançamento excluído (${ids.length} parcela(s))!`);
      setGroupToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adiantarPagamentoMutate = useMutation({
    mutationFn: async ({ collaboratorId, valor }: { collaboratorId: string; valor: number }) => {
      const collab = collaborators.find((c: any) => c.id === collaboratorId);
      if (!collab) throw new Error("Colaborador não encontrado");
      const salario = Number(collab.salario) || 0;
      const pagamentoAtual = Number(collab.pagamento) || 0;
      const saldoAtual = Number(collab.saldo_devedor) || 0;
      const novoPagamento = pagamentoAtual + valor;
      // Recalcula saldo com lógica de acúmulo (mesma regra do estorno)
      const novoSaldo = recalcSaldoFolha(salario, pagamentoAtual, saldoAtual, novoPagamento);
      // Se pagamento cobre tudo e ainda há saldo, abate proporcionalmente
      const { error } = await supabase
        .from("collaborators")
        .update({ pagamento: novoPagamento, saldo_devedor: novoSaldo } as any)
        .eq("id", collaboratorId);
      if (error) throw error;
      await logActivity("financeiro", "registrou pagamento colaborador", collaboratorId, { valor, novoPagamento, novoSaldo });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborators-salaries"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      qc.invalidateQueries({ queryKey: ["finance-pagamentos-periodo"] });
      qc.invalidateQueries({ queryKey: ["finance-pagamentos-todos"] });
      toast.success("Pagamento registrado!");
      setAdiantarPagamento({});
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Exclui um pagamento da folha: reverte o acumulado do colaborador e registra
  // um estorno (activity_logs só permite SELECT + INSERT — nada é apagado,
  // a auditoria é preservada e o lançamento some das listas e dos totais).
  const estornarPagamentoMut = useMutation({
    mutationFn: async ({ logId, collaboratorId, valor }: { logId: string; collaboratorId: string | null; valor: number }) => {
      let novoPagamento: number | null = null;
      let novoSaldo: number | null = null;
      if (collaboratorId) {
        const collab = collaborators.find((c: any) => String(c.id) === String(collaboratorId));
        if (!collab) throw new Error("Colaborador não encontrado");
        const salario = Number((collab as any).salario) || 0;
        const pagamentoAtual = Number((collab as any).pagamento) || 0;
        const saldoAtual = Number((collab as any).saldo_devedor) || 0;
        novoPagamento = Math.max(0, pagamentoAtual - valor);
        novoSaldo = recalcSaldoFolha(salario, pagamentoAtual, saldoAtual, novoPagamento);
        const { error } = await supabase
          .from("collaborators")
          .update({ pagamento: novoPagamento, saldo_devedor: novoSaldo } as any)
          .eq("id", collaboratorId);
        if (error) throw error;
      }
      await logActivity("financeiro", "estornou pagamento colaborador", collaboratorId, { estorna_log_id: logId, valor, novoPagamento, novoSaldo });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborators-salaries"] });
      qc.invalidateQueries({ queryKey: ["collaborators"] });
      qc.invalidateQueries({ queryKey: ["finance-pagamentos-periodo"] });
      qc.invalidateQueries({ queryKey: ["finance-pagamentos-todos"] });
      toast.success("Pagamento excluído e valores estornados!");
      setPagToDelete(null);
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
        { secao: "TOTAL", categoria: "Taxas de Entrega", descricao: "", valor: fmtMoney(kpis.taxasEntrega), fonte: "" },
        { secao: "TOTAL", categoria: "Outras Taxas", descricao: "", valor: fmtMoney(kpis.outrasTaxas), fonte: "" },
        { secao: "TOTAL", categoria: "Lucro Bruto", descricao: "", valor: fmtMoney(kpis.lucroBruto), fonte: "" },
        { secao: "TOTAL", categoria: "Despesas Operacionais", descricao: "", valor: fmtMoney(kpis.despesasOp), fonte: "" },
        { secao: "TOTAL", categoria: "Folha dos Motoboys", descricao: "", valor: fmtMoney(kpis.folhaMotoboys), fonte: "" },
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
            { categoria: "Taxas de Entrega", valor: fmtMoney(kpis.taxasEntrega) },
            { categoria: "Outras Taxas", valor: fmtMoney(kpis.outrasTaxas) },
            { categoria: "Lucro Bruto", valor: fmtMoney(kpis.lucroBruto) },
            { categoria: "Despesas Operacionais", valor: fmtMoney(kpis.despesasOp) },
            { categoria: "Folha dos Motoboys", valor: fmtMoney(kpis.folhaMotoboys) },
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
  if (checkingAccess) {
    return (
      <Dialog open={true} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Loader2 className="size-5 animate-spin" />
              </div>
              <DialogTitle className="text-center">Verificando acesso...</DialogTitle>
            </div>
            <p className="text-center text-sm text-muted-foreground">Aguarde um momento</p>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (accessError) {
    return (
      <Dialog open={true} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <DialogTitle className="text-center">Erro de Acesso</DialogTitle>
            </div>
            <p className="text-center text-sm text-destructive">{accessError}</p>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

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

  
      {/* renderDreSections function - must be inside component to access openSections/toggleSection/fmtMoney */}
      const NEGATIVE_DRE_SECTIONS = new Set([
        'CUSTO DIRETO (CMV)', 'CUSTO VARIAVEL', 'DESPESAS COM INSUMOS',
        'TAXAS DE ENTREGA', 'OUTRAS TAXAS', 'DESPESAS OPERACIONAIS',
        'FOLHA DOS MOTOBOYS', 'DESPESA ADMINISTRATIVA', 'DESPESA FINANCEIRA', 'OUTROS',
      ]);
      const renderDreSections = (rows: DreRow[], kpis: any) => {
        const sections = [
          { key: 'RECEITA BRUTA', title: 'RECEITA BRUTA', icon: TrendingUp, tone: 'success' },
          { key: 'CUSTO DIRETO (CMV)', title: 'CUSTO DIRETO (CMV)', icon: Package, tone: 'warning' },
          { key: 'CUSTO VARIAVEL', title: 'CUSTO VARIÁVEL', icon: TrendingDown, tone: 'warning' },
          { key: 'DESPESAS COM INSUMOS', title: 'DESPESAS COM INSUMOS', icon: ShoppingCart, tone: 'warning' },
          { key: 'TAXAS DE ENTREGA', title: 'TAXAS DE ENTREGA', icon: Truck, tone: 'warning' },
          { key: 'OUTRAS TAXAS', title: 'OUTRAS TAXAS', icon: ReceiptText, tone: 'warning' },
          { key: 'LUCRO BRUTO', title: 'LUCRO BRUTO', icon: PiggyBank, tone: 'info' },
          { key: 'DESPESAS OPERACIONAIS', title: 'DESPESAS OPERACIONAIS', icon: Users, tone: 'danger' },
          { key: 'FOLHA DOS MOTOBOYS', title: 'FOLHA DOS MOTOBOYS', icon: Bike, tone: 'danger' },
          { key: 'DESPESA ADMINISTRATIVA', title: 'DESPESAS ADMINISTRATIVAS', icon: Calculator, tone: 'danger' },
          { key: 'DESPESA FINANCEIRA', title: 'DESPESAS FINANCEIRAS', icon: DollarSign, tone: 'danger' },
          { key: 'OUTROS', title: 'OUTRAS DESPESAS', icon: AlertTriangle, tone: 'danger' },
          { key: 'RESULTADO LÍQUIDO', title: 'RESULTADO LÍQUIDO', icon: TrendingDown, tone: 'info' },
        ];

        return sections.flatMap((section) => {
          const sectionRows = rows.filter((r: DreRow) => r.secao === section.key);
          // Ordena por vencimento (data exata da parcela) para exibir 1/33 -> 2/33 ... até período final
          sectionRows.sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""));
          const total = sectionRows.reduce((s: number, r: DreRow) => s + r.valor, 0);
          const isTotalRow = ['LUCRO BRUTO', 'RESULTADO LÍQUIDO'].includes(section.key);
          // Totalizadores vêm do `kpis` (mesma fonte dos cards) — nunca divergem do painel.
          const displayTotal = section.key === 'LUCRO BRUTO' ? kpis.lucroBruto : section.key === 'RESULTADO LÍQUIDO' ? kpis.resultado : total;
          // Tudo que é custo/despesa exibe como negativo; só receita e resultados usam sinal natural.
          const fmtDreValor = (v: number) => (NEGATIVE_DRE_SECTIONS.has(section.key) && v > 0 ? `-${fmtMoney(v)}` : fmtMoney(v));
          const isOpen = openSections[section.key] ?? true;

          // Todas as categorias/seções são sempre exibidas, mesmo sem lançamentos (total R$ 0,00).

          const rowsToRender: React.ReactNode[] = [
            <TableRow
              key={section.key + '-header'}
              className='bg-muted/30 hover:bg-muted/50 cursor-pointer'
              onClick={() => toggleSection(section.key)}
            >
              <TableCell className='font-semibold flex items-center gap-2'>
                <section.icon className={'size-4 ' + (section.tone === 'success' ? 'text-success' : section.tone === 'warning' ? 'text-warning' : section.tone === 'danger' ? 'text-destructive' : 'text-info')} />
                {section.title}
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell className='text-right font-display text-lg font-semibold tabular'>{fmtDreValor(displayTotal)}</TableCell>
              <TableCell className='text-center text-xs text-muted-foreground'>{sectionRows.filter((r: DreRow) => r.vencimento).length ? `${sectionRows.filter((r: DreRow) => r.fonte === 'manual' && r.pago === false).length} Há pagar` : "—"}</TableCell>
              <TableCell className='text-center text-xs text-muted-foreground'>{sectionRows.filter((r: DreRow) => r.pago === true).length} pago / {sectionRows.filter((r: DreRow) => r.pago === false).length} Há pagar</TableCell>
              <TableCell className='text-center text-xs text-muted-foreground'>{sectionRows.filter((r: DreRow) => r.fonte === 'auto').length} auto / {sectionRows.filter((r: DreRow) => r.fonte === 'manual').length} manual</TableCell>
              <TableCell className='text-right'>
                <ChevronDown className={'size-4 mx-auto text-muted-foreground transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </TableCell>
            </TableRow>
          ];

          if (isOpen) {
            sectionRows.forEach((r: DreRow, i: number) => {
              const isVencido = r.vencimento && r.pago === false && new Date(r.vencimento + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
              const isHaPagar = r.fonte === 'manual' && r.pago === false && !isVencido;
              // Data do pagamento: sempre reflete o campo "vencimento" definido na edição (ex: 27/09/2026, 27/10/2026 ...). Para "Há pagar" e "Pago" a data exibida é o vencimento exato da parcela
              const dataPagamentoDisplay = r.fonte === 'manual' ? (r.vencimento ? fmtDate(r.vencimento) : r.data_pagamento ? fmtDate(r.data_pagamento) : "—") : r.secao === "DESPESAS COM INSUMOS" ? "—" : "—";
              // Progresso para recorrência determinada (ex: 15/30x) - exibe parcela atual e total pago
              const gid = (r as any).recorrencia_grupo_id as string | null | undefined;
              const isDeterminada = (r as any).recorrencia_tipo === 'determinada' && !!gid;
              let parcelaBadge: string | null = null;
              let progressoBadge: string | null = null;
              if (isDeterminada && gid && grupoProgressMap.has(gid)) {
                const stat = grupoProgressMap.get(gid)!;
                const idx = parcelIndexMap.get(r.id ?? "") ?? 0;
                if (idx) parcelaBadge = `${idx}/${stat.total}x`;
                progressoBadge = `${stat.pagos}/${stat.total} pagas`;
              }
              rowsToRender.push(
                <TableRow key={`${section.key}::${r.id ?? `auto-${i}`}`} className={(r.fonte === 'manual' ? 'bg-amber-50/30 ' : '') + (isVencido ? 'bg-destructive/5' : '') + (isHaPagar ? ' bg-warning/5' : '')}>
                  <TableCell className='text-xs text-muted-foreground'>{r.secao}</TableCell>
                  <TableCell className='font-medium'>
                    <div className="flex items-center gap-1.5">
                      <span>{r.categoria}</span>
                      {parcelaBadge && <Badge variant="outline" className="text-xs border-info/30 text-info" title={progressoBadge ?? undefined}>{parcelaBadge}</Badge>}
                    </div>
                    {progressoBadge && <div className="text-xs text-muted-foreground">{progressoBadge}</div>}
                  </TableCell>
                  <TableCell className='text-muted-foreground text-sm'>{r.descricao || '—'}</TableCell>
                  <TableCell className='text-right tabular font-medium'>{fmtDreValor(r.valor)}</TableCell>
                  <TableCell className={`text-center text-xs tabular ${r.fonte === 'manual' && r.pago ? "text-success font-medium" : isVencido ? "text-destructive font-medium" : isHaPagar ? "text-warning font-medium" : "text-muted-foreground"}`}>{dataPagamentoDisplay}</TableCell>
                  <TableCell className='text-center'>
                    {r.fonte === 'manual' ? (
                      r.editable && r.id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (r.pago) markUnpaidMut.mutate(r.id!); else payManualVencimento.mutate(r.id!); }}
                          disabled={markUnpaidMut.isPending || payManualVencimento.isPending}
                          title="Clique para alternar entre pago e há pagar"
                          className="cursor-pointer disabled:opacity-50"
                        >
                          {r.pago ? <Badge variant="default" className="bg-success text-success-foreground text-xs">Pago</Badge> : isVencido ? <Badge variant="destructive" className="text-xs">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning text-xs">Há pagar</Badge>}
                        </button>
                      ) : (
                        r.pago ? <Badge variant="default" className="bg-success text-success-foreground text-xs">Pago</Badge> : isVencido ? <Badge variant="destructive" className="text-xs">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning text-xs">Há pagar</Badge>
                      )
                    ) : r.pago === true ? <Badge variant="default" className="bg-success text-success-foreground text-xs">Pago</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className='text-center'>
                    <Badge variant={r.fonte === 'auto' ? 'default' : 'outline'} className='text-xs'>
                      {r.fonte === 'auto' ? 'Automático' : 'Manual'}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    {r.editable && r.id && (
                      <>
                        {r.pago === false && <Button variant='ghost' size="icon" onClick={(e) => { e.stopPropagation(); payManualVencimento.mutate(r.id!); }} title="Quitar"><CreditCard className="size-4" /></Button>}
                        <Button variant='ghost' size='icon' onClick={(e) => { e.stopPropagation(); setEditingEntry(manualEntriesAll.find(m => m.id === r.id) || manualEntries.find(m => m.id === r.id) || null); setNewEntryOpen(true); }}>
                          <Pencil className='size-4' />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            });

            if (isTotalRow) {
              rowsToRender.push(
                <TableRow key={section.key + '-total'} className='bg-muted/50 font-bold'>
                  <TableCell colSpan={3} className='text-right'>Total {section.title}</TableCell>
                  <TableCell className='text-right font-display text-lg'>{fmtDreValor(displayTotal)}</TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              );
            }
          }

          return rowsToRender;
        });
      };

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
          <Input
            type="date"
            value={periodoInicioInput}
            onChange={(e) => setPeriodoInicioInput(e.target.value)}
            onBlur={() => { if (dataValida(periodoInicioInput)) setPeriodoInicio(periodoInicioInput); else setPeriodoInicioInput(periodoInicio); }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Período final</Label>
          <Input
            type="date"
            value={periodoFimInput}
            onChange={(e) => setPeriodoFimInput(e.target.value)}
            onBlur={() => { if (dataValida(periodoFimInput)) setPeriodoFim(periodoFimInput); else setPeriodoFimInput(periodoFim); }}
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DollarSign className="size-4" />
          <span>Valores em BRL · Competência: {new Date(periodoInicio).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })} a {new Date(periodoFim).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
        </div>
      </div>

      {/* Contas financeiras */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Landmark className="size-4 text-primary" /> Minhas Contas
              <Badge variant="outline" className="text-xs">{accounts.length} conta(s)</Badge>
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Crie várias contas (Bradesco, Itaú, Santander, Caixa...), organize por nome e controle o saldo de cada uma.
              {" "}Total geral: <span className="font-semibold text-foreground">{showBalances ? fmtMoney(totalContas) : "••••••"}</span>
              {" "}• Clique em uma conta para ver o extrato.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleShowBalances} title={showBalances ? "Ocultar saldos" : "Mostrar saldos"}>
              {showBalances ? <EyeOff className="mr-1.5 size-4" /> : <Eye className="mr-1.5 size-4" />}
              {showBalances ? "Ocultar" : "Mostrar"}
            </Button>
            <Button size="sm" onClick={() => { setEditingAccount(null); setAccountForm({ nome: "", saldo: 0 }); setAccountDialogOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Criar conta
            </Button>
          </div>
        </div>
        {accounts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
            <Landmark className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Nenhuma conta criada</p>
            <p className="mt-1 text-xs text-muted-foreground">Ex.: Bradesco, Itaú, Santander, Caixa, Carteira... Depois adicione ou retire saldo quando quiser.</p>
            <Button className="mt-3" size="sm" onClick={() => { setEditingAccount(null); setAccountForm({ nome: "", saldo: 0 }); setAccountDialogOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Criar primeira conta
            </Button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-border bg-muted/20 p-4 cursor-pointer transition-colors hover:border-primary/60 hover:shadow-sm"
                onClick={() => setExtConta(a)}
                title="Clique para ver o extrato"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.nome}</p>
                    <p className="mt-1 font-display text-2xl font-bold tabular">
                      {showBalances ? fmtMoney(a.saldo) : "••••••"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); toggleShowBalances(); }} title={showBalances ? "Ocultar saldos" : "Mostrar saldos"}>
                    {showBalances ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setAdjustDialog({ account: a, tipo: "entrada" }); setAdjustValor(0); }} title="Adicionar saldo">
                    <ArrowUpCircle className="mr-1 size-4" /> Adicionar
                  </Button>
                  <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setAdjustDialog({ account: a, tipo: "saida" }); setAdjustValor(0); }} title="Retirar saldo">
                    <ArrowDownCircle className="mr-1 size-4" /> Retirar
                  </Button>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditingAccount(a); setAccountForm({ nome: a.nome, saldo: Number(a.saldo) || 0 }); setAccountDialogOpen(true); }} title="Editar conta / saldo">
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setAccountToDelete(a); }} title="Excluir conta">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard label="Receita Bruta" value={fmtMoney(kpis.receita)} icon={TrendingUp} tone="success" hint={`Anota direto: ${fmtMoney(anotaDirectTotal)} | iFood: ${fmtMoney(ifoodTotal)}`} onClick={() => setShowReceitaDetail(true)} />
        <KpiCard label="Vencimentos" value={fmtMoney(vencimentosTotal)} icon={CalendarDays} tone={vencimentosVencidos.length > 0 ? "danger" : vencimentosPendentesTotal > 0 ? "warning" : "success"} hint={`${vencimentosPendentesTotal} pendente(s)${vencimentosVencidos.length ? ` • ${vencimentosVencidos.length} vencido(s)` : ""} • ${vencimentosPendentes.length} compras + ${manualVencimentos.length} lançamentos`} onClick={() => setShowVencimentosDetail(true)} />
        <KpiCard label="Lucro Bruto" value={fmtMoney(kpis.lucroBruto)} icon={PiggyBank} tone={kpis.lucroBruto >= 0 ? "success" : "danger"} hint="Receita − CMV − variáveis − insumos − taxas de entrega/outras" />
        <KpiCard
          label="Folha dos colaboradores"
          value={fmtMoney(folhaSaldoExibido)}
          icon={Users}
          tone={folhaSaldoExibido > 0 ? "warning" : "success"}
          hint={`Saldo devedor · Pagos no período: ${fmtMoney(folhaPagaPeriodoEquipe)} · Acumulado: ${fmtMoney(totalPagamentos)} · Salários/mês: ${fmtMoney(totalSalarios)} — clique para detalhes`}
          onClick={() => setShowFolhaDetail(true)}
          action={
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPagExtGrupo("equipe"); }} title="Ver extrato de pagamentos">
              <ReceiptText className="mr-1 size-4" /> Extrato
            </Button>
          }
        />
        <KpiCard
          label="Folha dos motoboys"
          value={fmtMoney(folhaPagaPeriodoMotoboys)}
          icon={Bike}
          tone={folhaPagaPeriodoMotoboys > 0 ? "warning" : "success"}
          hint={motoboyCollabs.length > 0 ? `Pagos no período · ${motoboyCollabs.length} motoboy(s) · Acumulado: ${fmtMoney(motoboysPagamentos)} · Saldo devedor: ${fmtMoney(motoboysSaldoExibido)} — clique para detalhes` : "Nenhum motoboy marcado — marque na página Colaboradores"}
          onClick={() => setShowMotoboysDetail(true)}
          action={
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setPagExtGrupo("motoboys"); }} title="Ver extrato de pagamentos">
              <ReceiptText className="mr-1 size-4" /> Extrato
            </Button>
          }
        />
        <KpiCard label="Despesas com insumos" value={fmtMoney(insumosTotal)} icon={ShoppingCart} tone="warning" hint={`${receivedPurchaseOrders.length} ordens recebidas no período · Média: ${fmtMoney(insumosAvgPrice)} · Principal indicador de custo de insumos`} onClick={() => setShowInsumosDetail(true)} />
        <KpiCard label="Taxas de entrega" value={fmtMoney(taxasEntregaTotal)} icon={Truck} tone={taxasEntregaTotal > 0 ? "info" : "success"} hint={`${pedidosComTaxaEntrega} pedido(s) com taxa no período — clique para detalhes`} onClick={() => setShowTaxasDetail(true)} />
        <KpiCard label="Outras taxas" value={fmtMoney(outrasTaxasTotal)} icon={ReceiptText} tone={outrasTaxasTotal > 0 ? "info" : "success"} hint={outrasTaxasPorNome.length > 0 ? `${pedidosComOutrasTaxas} pedido(s) • ${outrasTaxasPorNome.slice(0, 2).map(t => `${t.nome}: ${fmtMoney(t.total)}`).join(" • ")}${outrasTaxasPorNome.length > 2 ? "…" : ""}` : "Taxas extras dos pedidos no período — clique para detalhes"} onClick={() => setShowTaxasDetail(true)} />
        <KpiCard label="Resultado Líquido" value={fmtMoney(kpis.resultado)} icon={TrendingDown} tone={kpis.resultado >= 0 ? "success" : "danger"} hint={kpis.resultado >= 0 ? "Lucro" : "Prejuízo"} />
        <KpiCard label="Margem Líquida" value={`${kpis.margem.toFixed(1)}%`} icon={Calculator} tone={kpis.margem >= 0 ? "success" : "danger"} hint="Resultado / Receita — clique para ver o que consome a margem" onClick={() => setShowMargemDetail(true)} />
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
            description="Pagamentos de folha sobre faturamento"
            tone={kpis.despesasOp / (kpis.receita || 1) > 0.4 ? "warning" : "success"}
          />
          <InsightCard
            title="Ponto de Equilíbrio"
            value={fmtMoney(pontoDeEquilibrio.total)}
            description="Folha + insumos + recorrentes — clique para ver o detalhamento"
            tone="info"
            onClick={() => setShowPontoEquilibrioDetail(true)}
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
          <TabsTrigger value="vencimentos">Vencimentos {vencimentosPendentesTotal ? `(${vencimentosPendentesTotal})` : ""}</TabsTrigger>
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
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="min-w-[180px]">Seção</TableHead>
                    <TableHead className="min-w-[200px]">Categoria</TableHead>
                    <TableHead className="min-w-[300px]">Descrição</TableHead>
                    <TableHead className="min-w-[160px] text-right">Valor</TableHead>
                    <TableHead className="min-w-[140px] text-center">Data do pagamento</TableHead>
                    <TableHead className="min-w-[110px] text-center">Pago</TableHead>
                    <TableHead className="min-w-[140px] text-center">Fonte</TableHead>
                    <TableHead className="min-w-[100px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderDreSections(allDreRows, kpis)}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="lancamentos" className="space-y-4 pt-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Novo lançamento manual</h3>
                <p className="text-xs text-muted-foreground">Preencha abaixo e clique em salvar. Todos os lançamentos criados aparecem na lista logo abaixo, com opções de editar e excluir.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setEditingEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, competencia: COMPETENCIA_DEFAULT, recorrente: false, recorrencia_tipo: null, recorrencia_quantidade: null, inclui_ponto_equilibrio: true } as any); setNewEntryOpen(true); }}>
                <Plus className="mr-1.5 size-4" /> Abertura avançada
              </Button>
            </div>
            <form
              className="mt-3 grid gap-3 md:grid-cols-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (!inlineEntry.categoria.trim()) { toast.error("Informe a categoria"); return; }
                if (!(Number(inlineEntry.valor) > 0)) { toast.error("Informe um valor maior que zero"); return; }
                const hoje = new Date().toISOString().split("T")[0];
                const isFut = inlineEntry.vencimento > hoje;
                saveEntry.mutate({
                  tipo: inlineEntry.tipo as DreEntry["tipo"],
                  categoria: inlineEntry.categoria.trim(),
                  descricao: inlineEntry.descricao.trim() || null,
                  valor: Number(inlineEntry.valor) || 0,
                  vencimento: inlineEntry.vencimento,
                  competencia: inlineEntry.vencimento.slice(0, 7) + "-01",
                  pago: isFut ? false : inlineEntry.pago,
                  recorrente: inlineEntry.recorrente,
                  recorrencia_tipo: inlineEntry.recorrente ? (inlineEntry.recorrencia_tipo === "determinada" ? "determinada" : "indefinida") : null,
                  recorrencia_quantidade: inlineEntry.recorrente && inlineEntry.recorrencia_tipo === "determinada" ? inlineEntry.recorrencia_quantidade : null,
                  inclui_ponto_equilibrio: true,
                } as any, {
                  onSuccess: () => setInlineEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, recorrente: false, recorrencia_tipo: "nao", recorrencia_quantidade: 3 }),
                });
              }}
            >
              <div className="space-y-1.5 md:col-span-1">
                <Label className="text-xs">Tipo</Label>
                <Select value={inlineEntry.tipo} onValueChange={(v) => setInlineEntry((p) => ({ ...p, tipo: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DRE_TIPOS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-1">
                <Label className="text-xs">Categoria *</Label>
                <Input value={inlineEntry.categoria} onChange={(e) => setInlineEntry((p) => ({ ...p, categoria: e.target.value }))} placeholder="Ex.: Aluguel" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Descrição</Label>
                <Input value={inlineEntry.descricao} onChange={(e) => setInlineEntry((p) => ({ ...p, descricao: e.target.value }))} placeholder="Detalhes..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor (R$) *</Label>
                <Input type="number" step="0.01" min={0} value={inlineEntry.valor || ""} onChange={(e) => setInlineEntry((p) => ({ ...p, valor: Number(e.target.value) || 0 }))} placeholder="0,00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Vencimento *</Label>
                <Input type="date" value={inlineEntry.vencimento} onChange={(e) => setInlineEntry((p) => ({ ...p, vencimento: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 md:col-span-3">
                <Switch checked={inlineEntry.pago} onCheckedChange={(v) => setInlineEntry((p) => ({ ...p, pago: v }))} />
                <span className="text-xs text-muted-foreground">Já foi pago? {inlineEntry.pago ? "Sim" : "Não (Há pagar)"}</span>
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Switch checked={inlineEntry.recorrente} onCheckedChange={(v) => setInlineEntry((p) => ({ ...p, recorrente: v, recorrencia_tipo: v ? "indefinida" : "nao" }))} />
                <span className="text-xs text-muted-foreground">Recorrente mensal?</span>
                {inlineEntry.recorrente && (
                  <Select value={inlineEntry.recorrencia_tipo} onValueChange={(v) => setInlineEntry((p) => ({ ...p, recorrencia_tipo: v }))}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indefinida">Indefinida</SelectItem>
                      <SelectItem value="determinada">Determinada</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="md:col-span-1 md:text-right">
                <Button type="submit" disabled={saveEntry.isPending} className="w-full md:w-auto">
                  {saveEntry.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  <Save className="mr-1.5 size-4" /> Salvar
                </Button>
              </div>
            </form>
          </div>

          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-semibold">Todos os lançamentos ({manualGrupos.length})</h3>
              <p className="text-xs text-muted-foreground">{manualEntriesAll.length} parcela(s) no total • recorrentes aparecem em 1 linha — expanda para ver e gerenciar as parcelas</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setEditingEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, competencia: COMPETENCIA_DEFAULT, recorrente: false, recorrencia_tipo: null, recorrencia_quantidade: null, inclui_ponto_equilibrio: true } as any); setNewEntryOpen(true); }}>
              <Plus className="mr-1.5 size-4" /> Novo lançamento
            </Button>
          </div>

          {manualEntriesAll.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhum lançamento manual"
              description="Adicione ajustes, provisões, impostos e outras despesas que não vêm do sistema."
              action={<Button onClick={() => { setEditingEntry({ tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, competencia: COMPETENCIA_DEFAULT, recorrente: false, recorrencia_tipo: null, recorrencia_quantidade: null, inclui_ponto_equilibrio: true } as any); setNewEntryOpen(true); }}><Plus className="mr-1.5 size-4" /> Criar primeiro lançamento</Button>}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-44 min-w-44">Tipo</TableHead>
                    <TableHead className="w-48 min-w-48">Categoria</TableHead>
                    <TableHead className="w-64 min-w-64">Descrição</TableHead>
                    <TableHead className="w-40 min-w-40 text-right">Valor</TableHead>
                    <TableHead className="w-36 min-w-36">Vencimento</TableHead>
                    <TableHead className="w-32 min-w-32 text-center">Pago</TableHead>
                    <TableHead className="w-40 min-w-40 text-center">Recorrente</TableHead>
                    <TableHead className="w-28 min-w-28 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualGrupos.map((g) => {
                    // Lançamento avulso (sem recorrência): 1 linha, como antes
                    if (g.gid === null) {
                      const e = g.rep;
                      const pago = (e as any).pago;
                      const venc = (e as any).vencimento || e.competencia;
                      const isVencido = venc && !pago && new Date(venc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                      const isHaPagar = !pago && !isVencido;
                      return (
                      <TableRow key={g.key} className={(isVencido ? "bg-destructive/5 " : "") + (isHaPagar ? "bg-warning/5 " : "")}>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{e.tipo.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{e.categoria}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{e.descricao || "—"}</TableCell>
                        <TableCell className="text-right tabular font-medium">{fmtMoney(e.valor)}</TableCell>
                        <TableCell className={isVencido ? "text-destructive font-medium" : isHaPagar ? "text-warning font-medium" : "text-muted-foreground"}>{venc ? fmtDate(venc) : "—"}</TableCell>
                        <TableCell className="text-center">
                          {pago ? <Badge variant="default" className="bg-success text-success-foreground">Pago</Badge> : isVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">Não</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {!pago && venc && <Button variant="ghost" size="sm" onClick={() => payManualVencimento.mutate(e.id)} disabled={payManualVencimento.isPending} title="Quitar"><CreditCard className="size-4" /></Button>}
                          <Button variant="ghost" size="icon" onClick={() => { setEditingEntry(e); setNewEntryOpen(true); }} title="Editar"><Pencil className="size-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => setToDelete(e)} title="Excluir"><Trash2 className="size-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                      );
                    }
                    // Lançamento recorrente: 1 linha demonstrativa + parcelas expansíveis
                    const rep = g.rep;
                    const gtipo = (rep as any).recorrencia_tipo as string | null;
                    const gqtd = (rep as any).recorrencia_quantidade as number | null;
                    const glabel = gtipo === 'determinada' ? `Determinada (${gqtd ?? g.total}x)` : gtipo === 'indefinida' ? 'Indefinida' : 'Sim';
                    const expanded = !!expandedGroups[g.key];
                    const gPago = g.pendentes === 0;
                    const gVencido = !gPago && g.vencidos > 0;
                    return (
                    <Fragment key={g.key}>
                      <TableRow className={"bg-muted/20 " + (gVencido ? "bg-destructive/5 " : !gPago ? "bg-warning/5 " : "")}>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{rep.tipo.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{rep.categoria}</div>
                          <div className="text-xs text-muted-foreground">{g.pagos}/{g.total} pagas</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{rep.descricao || "—"}</TableCell>
                        <TableCell className="text-right tabular font-medium">{fmtMoney(g.valorMensal)}<span className="text-xs text-muted-foreground font-normal">/mês</span></TableCell>
                        <TableCell className={gVencido ? "text-destructive font-medium" : !gPago ? "text-warning font-medium" : "text-muted-foreground"}>{g.proximoVenc ? fmtDate(g.proximoVenc) : "—"}</TableCell>
                        <TableCell className="text-center">
                          {gPago ? <Badge variant="default" className="bg-success text-success-foreground">Pago</Badge> : gVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-xs" title={`${g.pagos}/${g.total} pagas`}>
                            {glabel}
                          </Badge>
                          <div className="mt-1">
                            {(rep as any).inclui_ponto_equilibrio !== false ? (
                              <Badge variant="outline" className="text-xs border-info/30 text-info" title="Integra o Ponto de Equilíbrio">No ponto</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground" title="Fora do Ponto de Equilíbrio">Fora do ponto</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => setExpandedGroups(prev => ({ ...prev, [g.key]: !prev[g.key] }))} title={expanded ? "Ocultar parcelas" : "Ver parcelas"}>
                            <ChevronDown className={'size-4 transition-transform ' + (expanded ? 'rotate-180' : '')} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setGroupToDelete(g)} title={`Excluir lançamento (${g.total} parcelas)`}><Trash2 className="size-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                      {expanded && g.entries.map((p, pIdx) => {
                        const pvenc = (p as any).vencimento || p.competencia;
                        const ppago = (p as any).pago;
                        const pVencido = pvenc && !ppago && new Date(pvenc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                        const pHaPagar = !ppago && !pVencido;
                        return (
                        <TableRow key={p.id} className="bg-muted/10">
                          <TableCell className="pl-8">
                            <Badge variant="outline" className="text-xs">Parcela {pIdx + 1}/{g.total}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{p.categoria}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{p.descricao || "—"}</TableCell>
                          <TableCell className="text-right tabular">{fmtMoney(p.valor)}</TableCell>
                          <TableCell className={pVencido ? "text-destructive font-medium" : pHaPagar ? "text-warning font-medium" : "text-muted-foreground"}>{pvenc ? fmtDate(pvenc) : "—"}</TableCell>
                          <TableCell className="text-center">
                            {ppago ? <Badge variant="default" className="bg-success text-success-foreground">Pago</Badge> : pVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right">
                            {!ppago && pvenc && <Button variant="ghost" size="sm" onClick={() => payManualVencimento.mutate(p.id)} disabled={payManualVencimento.isPending} title="Quitar parcela"><CreditCard className="size-4" /></Button>}
                            <Button variant="ghost" size="icon" onClick={() => { setEditingEntry(p); setNewEntryOpen(true); }} title="Editar parcela"><Pencil className="size-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => setToDelete(p)} title="Excluir parcela"><Trash2 className="size-4 text-destructive" /></Button>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </TableBody>
                </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="vencimentos" className="pt-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><CalendarDays className="size-4" /> Vencimentos — Compras e lançamentos a prazo</h3>
              <p className="text-xs text-muted-foreground">{vencimentosPendentesTotal} pendente(s) • Total {fmtMoney(vencimentosTotal)}{vencimentosVencidos.length ? ` • ${vencimentosVencidos.length} vencido(s)` : ""} • {vencimentosPendentes.length} compras + {manualVencimentos.length} lançamentos</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { refetchVencimentos(); refetchManualVencimentos(); }}><RefreshCw className="mr-1.5 size-4" /> Atualizar</Button>
          </div>
          {/* Indicadores da aba — vencimentos, insumos a pagar e taxas dos pedidos, lado a lado */}
          <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
            <KpiCard label="Vencimentos" value={fmtMoney(vencimentosTotal)} icon={CalendarDays} tone={vencimentosVencidos.length > 0 ? "danger" : vencimentosPendentesTotal > 0 ? "warning" : "success"} hint={`${vencimentosPendentesTotal} pendente(s)${vencimentosVencidos.length ? ` • ${vencimentosVencidos.length} vencido(s)` : ""}`} />
            <KpiCard label="Despesas com insumos a pagar" value={fmtMoney(insumosAPagarTotal)} icon={ShoppingCart} tone={vencimentosPendentes.length > 0 ? "warning" : "success"} hint={`${vencimentosPendentes.length} compra(s) a prazo não paga(s)${manualAPagarTotal > 0 ? ` • ${fmtMoney(manualAPagarTotal)} em lançamentos` : ""}`} />
            <KpiCard label="Taxas de entrega" value={fmtMoney(taxasEntregaTotal)} icon={Truck} tone={taxasEntregaTotal > 0 ? "info" : "success"} hint={`${pedidosComTaxaEntrega} pedido(s) com taxa no período • ${fmtDate(periodoInicio)} a ${fmtDate(periodoFim)}`} />
            <KpiCard label="Outras taxas" value={fmtMoney(outrasTaxasTotal)} icon={ReceiptText} tone={outrasTaxasTotal > 0 ? "info" : "success"} hint={outrasTaxasPorNome.length > 0 ? `${pedidosComOutrasTaxas} pedido(s) • ${outrasTaxasPorNome.slice(0, 2).map(t => `${t.nome}: ${fmtMoney(t.total)}`).join(" • ")}${outrasTaxasPorNome.length > 2 ? "…" : ""}` : `${pedidosComOutrasTaxas} pedido(s) com taxas extras no período`} />
          </div>
          {vencimentosPendentesTotal === 0 ? (
            <EmptyState icon={CalendarDays} title="Nenhum vencimento pendente" description="Compras a prazo e lançamentos manuais com vencimento futuro aparecerão aqui até serem quitados." />
          ) : (
            <div className="space-y-6">
              {vencimentosPendentes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShoppingCart className="size-4" /> Compras a prazo — itens em estoque não pagos</h4>
                  <div className="rounded-xl border border-border bg-card overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Nº</TableHead>
                          <TableHead>Insumo</TableHead>
                          <TableHead>Fornecedor</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vencimentosPendentes.map((o: any) => {
                          const venc = o.data_vencimento;
                          const isVencido = venc && new Date(venc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                          const valor = Number(o.valor_total) || Number(o.quantidade_recebida || o.quantidade_necessaria) * Number(o.preco_recebido || o.preco_medio) || 0;
                          return (
                            <TableRow key={o.id} className={isVencido ? "bg-destructive/5" : ""}>
                              <TableCell className="tabular font-medium">#{o.numero}</TableCell>
                              <TableCell>{o.ingrediente_nome}</TableCell>
                              <TableCell className="text-muted-foreground">{o.fornecedor_nome}</TableCell>
                              <TableCell className="text-right tabular font-medium">{fmtMoney(valor)}</TableCell>
                              <TableCell className={isVencido ? "text-destructive font-medium" : ""}>{venc ? fmtDate(venc) : "—"}</TableCell>
                              <TableCell className="text-center">
                                {isVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" onClick={() => payVencimentoFinanceiro.mutate(o.id)} disabled={payVencimentoFinanceiro.isPending}>
                                  {payVencimentoFinanceiro.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <CreditCard className="mr-1.5 size-4" />} Quitar
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {manualVencimentos.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><FileSpreadsheet className="size-4" /> Lançamentos manuais pendentes</h4>
                  <div className="rounded-xl border border-border bg-card overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Categoria</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {manualVencimentos.map((e) => {
                          const venc = (e as any).vencimento || e.competencia;
                          const isVencido = venc && new Date(venc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                          const gid = (e as any).recorrencia_grupo_id as string | null;
                          const isDeterminada = (e as any).recorrencia_tipo === 'determinada' && !!gid;
                          let parcelaBadge: string | null = null;
                          let progressoBadge: string | null = null;
                          if (isDeterminada && gid && grupoProgressMap.has(gid)) {
                            const stat = grupoProgressMap.get(gid)!;
                            const idx = parcelIndexMap.get(e.id) ?? 0;
                            if (idx) parcelaBadge = `${idx}/${stat.total}x`;
                            progressoBadge = `${stat.pagos}/${stat.total} pagas`;
                          }
                          return (
                            <TableRow key={e.id} className={isVencido ? "bg-destructive/5" : "bg-warning/5"}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span>{e.categoria}</span>
                                  {parcelaBadge && <Badge variant="outline" className="text-xs border-info/30 text-info">{parcelaBadge}</Badge>}
                                </div>
                                {progressoBadge && <div className="text-xs text-muted-foreground">{progressoBadge}</div>}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{e.descricao || "—"}</TableCell>
                              <TableCell className="text-right tabular font-medium">{fmtMoney(e.valor)}</TableCell>
                              <TableCell className={isVencido ? "text-destructive font-medium" : "text-warning font-medium"}>{venc ? fmtDate(venc) : "—"}</TableCell>
                              <TableCell className="text-center">
                                {isVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" onClick={() => payManualVencimento.mutate(e.id)} disabled={payManualVencimento.isPending}>
                                  {payManualVencimento.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <CreditCard className="mr-1.5 size-4" />} Quitar
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Taxas dos pedidos no período — detalhamento separado, sempre visível */}
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Truck className="size-4" /> Taxas dos pedidos — {fmtDate(periodoInicio)} a {fmtDate(periodoFim)}</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Taxas de entrega {fmtMoney(taxasEntregaTotal)} ({pedidosComTaxaEntrega} pedido(s))
              {" • "}Outras taxas {fmtMoney(outrasTaxasTotal)} ({pedidosComOutrasTaxas} pedido(s))
              {" • "}Total em taxas {fmtMoney(taxasTotalGeral)} em {anotaOrders.length} pedido(s) no período
              {outrasTaxasPorNome.length > 0 && ` • ${outrasTaxasPorNome.map(t => `${t.nome} (${t.qtd}x): ${fmtMoney(t.total)}`).join(" • ")}`}
            </p>
            {taxasPorPedido.filter(t => t.totalTaxas > 0).length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
                <ReceiptText className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium">Nenhuma taxa de entrega ou taxa extra nos pedidos do período</p>
                <p className="mt-1 text-xs text-muted-foreground">Pedidos com taxa de entrega ou taxas adicionais (ex.: embalagem, serviço) aparecerão aqui detalhados por pedido.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Pedido</TableHead>
                      <TableHead>Motoboy</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Taxa de entrega</TableHead>
                      <TableHead className="text-right">Outras taxas</TableHead>
                      <TableHead>Detalhe outras taxas</TableHead>
                      <TableHead className="text-right">Total taxas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxasPorPedido.filter(t => t.totalTaxas > 0).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="tabular font-medium">#{t.numero}</TableCell>
                        <TableCell>{t.motoboyId && motoboyNomePorId.get(t.motoboyId) ? <Badge variant="outline" className="text-xs border-info/30 text-info">{motoboyNomePorId.get(t.motoboyId)}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(t.imported_at)}</TableCell>
                        <TableCell className="text-right tabular font-medium">{t.taxaEntrega > 0 ? fmtMoney(t.taxaEntrega) : "—"}</TableCell>
                        <TableCell className="text-right tabular font-medium">{t.outrasTaxas > 0 ? fmtMoney(t.outrasTaxas) : "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{t.outrasItens.length > 0 ? t.outrasItens.map(i => `${i.nome}: ${fmtMoney(i.valor)}`).join(" • ") : "—"}</TableCell>
                        <TableCell className="text-right tabular font-semibold">{fmtMoney(t.totalTaxas)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* New/Edit Entry Dialog */}
      <Dialog open={newEntryOpen || !!editingEntry} onOpenChange={(o) => { if (!o) { setNewEntryOpen(false); setEditingEntry(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEntry?.id ? "Editar lançamento" : "Novo lançamento manual"}</DialogTitle>
          </DialogHeader>
          {(editingEntry || newEntryOpen) && (
            <form onSubmit={(e) => { e.preventDefault(); saveEntry.mutate(editingEntry ?? { tipo: "despesa_operacional", categoria: "", descricao: "", valor: 0, vencimento: VENCIMENTO_DEFAULT, pago: true, competencia: COMPETENCIA_DEFAULT, recorrente: false, recorrencia_tipo: null, recorrencia_quantidade: null, inclui_ponto_equilibrio: true } as any); }} className="space-y-4">
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
                  <Label className="text-xs">Vencimento *</Label>
                  <Input type="date" value={(editingEntry as any)?.vencimento || editingEntry?.competencia || VENCIMENTO_DEFAULT} onChange={(e) => { const v = e.target.value; const hoje = new Date().toISOString().split('T')[0]; const isFut = v > hoje; setEditingEntry({ ...(editingEntry ?? {}), vencimento: v, ...(isFut ? { pago: false } : {}) } as any); }} />
                  <p className="text-xs text-muted-foreground">Quando deve ser pago — futuros ficam como "Há pagar" e aparecem no DRE com a data exata do vencimento</p>
                </div>
              </div>
              <div className="rounded-xl border border-border p-3 flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Já foi pago?</Label>
                  <p className="text-xs text-muted-foreground">{(editingEntry as any)?.pago ?? true ? "Quitado — não aparece em Vencimentos" : "Há pagar — aparecerá em Vencimentos e no DRE como Há pagar"}</p>
                </div>
                <Switch
                  checked={(editingEntry as any)?.pago ?? true}
                  onCheckedChange={(v) => {
                    const venc = (editingEntry as any)?.vencimento || (editingEntry as any)?.competencia || VENCIMENTO_DEFAULT;
                    const hoje = new Date().toISOString().split('T')[0];
                    if (venc > hoje && v === true) {
                      toast.info("Lançamentos futuros ficam como 'Há pagar' até o vencimento");
                      setEditingEntry({ ...(editingEntry ?? {}), pago: false } as any);
                      return;
                    }
                    setEditingEntry({ ...(editingEntry ?? {}), pago: v } as any);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <Input value={editingEntry?.categoria || ""} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), categoria: e.target.value })} placeholder="Ex.: Aluguel, Energia, Honorários contábeis..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea value={editingEntry?.descricao || ""} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), descricao: e.target.value })} placeholder="Detalhes do lançamento..." rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor (R$)</Label>
                <Input type="number" step="0.01" value={editingEntry?.valor || 0} onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), valor: Number(e.target.value) })} />
              </div>
              <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/30">
                <Label className="text-xs font-medium">Recorrência</Label>
                <Select
                  value={editingEntry?.recorrente ? (editingEntry?.recorrencia_tipo || 'indefinida') : 'nao'}
                  onValueChange={(v) => {
                    if (v === 'nao') {
                      setEditingEntry({ ...(editingEntry ?? {}), recorrente: false, recorrencia_tipo: null, recorrencia_quantidade: null } as any);
                    } else if (v === 'indefinida') {
                      setEditingEntry({ ...(editingEntry ?? {}), recorrente: true, recorrencia_tipo: 'indefinida', recorrencia_quantidade: null } as any);
                    } else {
                      setEditingEntry({ ...(editingEntry ?? {}), recorrente: true, recorrencia_tipo: 'determinada', recorrencia_quantidade: (editingEntry as any)?.recorrencia_quantidade || 3 } as any);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao">Não recorrente (apenas este mês)</SelectItem>
                    <SelectItem value="indefinida">Recorrência indefinida (repete todo mês)</SelectItem>
                    <SelectItem value="determinada">Recorrência determinada (quantidade de meses)</SelectItem>
                  </SelectContent>
                </Select>
                {editingEntry?.recorrente && (editingEntry as any)?.recorrencia_tipo === 'determinada' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Quantidade</Label>
                    <Input
                      type="number"
                      min={2}
                      max={60}
                      value={(editingEntry as any)?.recorrencia_quantidade || 3}
                      onChange={(e) => setEditingEntry({ ...(editingEntry ?? {}), recorrencia_quantidade: Math.max(2, Math.min(60, Number(e.target.value) || 2)) } as any)}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground">meses (incluindo este)</span>
                  </div>
                )}
                {editingEntry?.recorrente && (editingEntry as any)?.recorrencia_tipo === 'indefinida' && (
                  <p className="text-xs text-muted-foreground">Serão criados lançamentos para os próximos 12 meses a partir da competência.</p>
                )}
                {editingEntry?.recorrente && (editingEntry as any)?.recorrencia_tipo === 'determinada' && (
                  <p className="text-xs text-muted-foreground">Serão criados {(editingEntry as any)?.recorrencia_quantidade || 3} lançamentos mensais sequenciais.</p>
                )}
                {editingEntry?.recorrente && (
                  <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-card">
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">Integra o ponto de equilíbrio?</Label>
                      <p className="text-xs text-muted-foreground">{(editingEntry as any)?.inclui_ponto_equilibrio ?? true ? "Conta no Ponto de Equilíbrio" : "Fora do Ponto de Equilíbrio"}</p>
                    </div>
                    <Switch
                      checked={(editingEntry as any)?.inclui_ponto_equilibrio ?? true}
                      onCheckedChange={(v) => setEditingEntry({ ...(editingEntry ?? {}), inclui_ponto_equilibrio: v } as any)}
                    />
                  </div>
                )}
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

      {/* Delete recorrente inteiro (todas as parcelas do grupo) */}
      <AlertDialog open={!!groupToDelete} onOpenChange={(o) => !o && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento "{groupToDelete?.rep.categoria}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as {groupToDelete?.total} parcela(s) ({groupToDelete?.pagos} paga(s), {groupToDelete ? groupToDelete.total - groupToDelete.pagos : 0} pendente(s)) serão excluídas permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => groupToDelete && deleteGroupMut.mutate(groupToDelete.entries.map(e => e.id))}>Excluir tudo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Criar / Editar conta */}
      <Dialog open={accountDialogOpen} onOpenChange={(o) => { if (!o) { setAccountDialogOpen(false); setEditingAccount(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAccount ? "Editar conta" : "Criar conta"}</DialogTitle>
            <p className="text-sm text-muted-foreground">Nomeie como quiser: Bradesco, Itaú, Santander, Caixa, Carteira...</p>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveAccountMut.mutate({ nome: accountForm.nome, saldo: Number(accountForm.saldo) || 0, id: editingAccount?.id });
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da conta *</Label>
              <Input value={accountForm.nome} onChange={(e) => setAccountForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex.: Bradesco, Itaú, Santander..." autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Saldo inicial / atual (R$)</Label>
              <Input type="number" step="0.01" value={accountForm.saldo || ""} onChange={(e) => setAccountForm((p) => ({ ...p, saldo: Number(e.target.value) || 0 }))} placeholder="0,00" />
              <p className="text-xs text-muted-foreground">Você pode editar o saldo aqui a qualquer momento, ou usar Adicionar / Retirar no cartão da conta.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => { setAccountDialogOpen(false); setEditingAccount(null); }}>Cancelar</Button>
              <Button type="submit" disabled={saveAccountMut.isPending || !accountForm.nome.trim()}>
                {saveAccountMut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editingAccount ? "Salvar alterações" : "Criar conta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adicionar / Retirar saldo */}
      <Dialog open={!!adjustDialog} onOpenChange={(o) => { if (!o) { setAdjustDialog(null); setAdjustValor(0); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{adjustDialog?.tipo === "entrada" ? "Adicionar saldo" : "Retirar saldo"} — {adjustDialog?.account.nome}</DialogTitle>
            <p className="text-sm text-muted-foreground">Saldo atual: {adjustDialog ? fmtMoney(adjustDialog.account.saldo) : "—"}</p>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!adjustDialog || !(adjustValor > 0)) { toast.error("Informe um valor maior que zero"); return; }
              const delta = adjustDialog.tipo === "entrada" ? Math.abs(adjustValor) : -Math.abs(adjustValor);
              adjustAccountMut.mutate({ id: adjustDialog.account.id, delta });
            }}
          >
            <div className="space-y-1.5">
              <Label className="text-xs">Valor (R$) *</Label>
              <Input type="number" step="0.01" min={0} value={adjustValor || ""} onChange={(e) => setAdjustValor(Number(e.target.value) || 0)} placeholder="0,00" autoFocus />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => { setAdjustDialog(null); setAdjustValor(0); }}>Cancelar</Button>
              <Button type="submit" disabled={adjustAccountMut.isPending || !(adjustValor > 0)}>
                {adjustAccountMut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Excluir conta */}
      <AlertDialog open={!!accountToDelete} onOpenChange={(o) => !o && setAccountToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta "{accountToDelete?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>Saldo de {accountToDelete ? fmtMoney(accountToDelete.saldo) : "—"} será removido da soma. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => accountToDelete && deleteAccountMut.mutate(accountToDelete.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Extrato da conta */}
      <Dialog open={!!extConta} onOpenChange={(o) => { if (!o) setExtConta(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="size-4 text-primary" /> Extrato — {extContaViva?.nome}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Saldo atual: <span className="font-semibold text-foreground">{extContaViva ? fmtMoney(extContaViva.saldo) : "—"}</span>
              {" • "}Entradas e retiradas registradas no intervalo
              {extRange.limitado ? " • intervalo limitado a 62 dias" : ""}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border p-1">
                {([
                  { v: "dia", label: "Dia" },
                  { v: "semana", label: "Semana" },
                  { v: "mes", label: "Mês" },
                  { v: "personalizado", label: "Personalizado" },
                ] as const).map((t) => (
                  <button
                    key={t.v}
                    onClick={() => setExtTipo(t.v)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${extTipo === t.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {extTipo === "personalizado" ? (
                <>
                  <Input type="date" value={extInicio} onChange={(e) => setExtInicio(e.target.value)} className="w-auto" title="Início" />
                  <span className="text-xs text-muted-foreground">até</span>
                  <Input type="date" value={extFim} onChange={(e) => setExtFim(e.target.value)} className="w-auto" title="Fim" />
                </>
              ) : extTipo === "mes" ? (
                <Input type="month" value={extData.slice(0, 7)} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setExtData(`${e.target.value}-01`); }} className="w-auto" title="Mês" />
              ) : (
                <Input type="date" value={extData} onChange={(e) => setExtData(e.target.value)} className="w-auto" title={extTipo === "dia" ? "Dia" : "Qualquer dia da semana"} />
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {extTipo === "dia" && `Movimentações de ${fmtDate(extRange.ini)}`}
              {extTipo === "semana" && `Semana de ${fmtDate(extRange.ini)} a ${fmtDate(extRange.fim)}`}
              {extTipo === "mes" && `Mês de ${new Date(extRange.ini + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`}
              {extTipo === "personalizado" && `De ${fmtDate(extRange.ini)} a ${fmtDate(extRange.fim)}`}
              {` • ${extTotais.qtd} movimentação(ões)`}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-success/25 bg-success/10 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-success">Entradas</p>
                <p className="mt-0.5 font-display text-xl font-bold tabular text-success">{fmtMoney(extTotais.entradas)}</p>
              </div>
              <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-destructive">Saídas</p>
                <p className="mt-0.5 font-display text-xl font-bold tabular text-destructive">{fmtMoney(extTotais.saidas)}</p>
              </div>
            </div>

            {extMovs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
                <ReceiptText className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium">Sem movimentações neste intervalo</p>
                <p className="mt-1 text-xs text-muted-foreground">O extrato registra entradas (Adicionar), retiradas (Retirar) e ajustes de saldo feitos nos cartões da conta.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="min-w-[130px]">Data</TableHead>
                      <TableHead className="min-w-[220px]">Descrição</TableHead>
                      <TableHead className="min-w-[130px] text-right">Entrada</TableHead>
                      <TableHead className="min-w-[130px] text-right">Saída</TableHead>
                      <TableHead className="min-w-[130px] text-right">Saldo após</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extMovs.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDateTime(m.data)}</TableCell>
                        <TableCell className="font-medium">{m.descricao}</TableCell>
                        <TableCell className="text-right tabular text-success">{m.entrada > 0 ? `+${fmtMoney(m.entrada)}` : "—"}</TableCell>
                        <TableCell className="text-right tabular text-destructive">{m.saida > 0 ? `−${fmtMoney(m.saida)}` : "—"}</TableCell>
                        <TableCell className="text-right tabular font-medium">{m.saldoApos !== null ? fmtMoney(m.saldoApos) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setExtConta(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Margem Líquida — descritivo do que consome a margem */}
      <Dialog open={showMargemDetail} onOpenChange={setShowMargemDetail}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Margem Líquida — o que está consumindo o faturamento</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Faturamento bruto (100%): <span className="font-semibold text-foreground">{fmtMoney(kpis.receita)}</span>
              {" "}• Resultado líquido: <span className="font-semibold text-foreground">{fmtMoney(kpis.resultado)} ({kpis.margem.toFixed(1)}%)</span>
              {" "}• Período {fmtDate(periodoInicio)} a {fmtDate(periodoFim)}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Grupo de custo/despesa</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">% da receita</TableHead>
                    <TableHead className="min-w-[220px]">Participação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {margemBreakdown.ordenados.map((i) => (
                    <TableRow key={i.chave}>
                      <TableCell className="font-medium">{i.chave}</TableCell>
                      <TableCell className="text-right tabular">{fmtMoney(i.valor)}</TableCell>
                      <TableCell className="text-right tabular font-semibold">{i.pct.toFixed(1)}%</TableCell>
                      <TableCell>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, Math.max(0, i.pct))}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>Total consumido</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(margemBreakdown.totalConsumido)}</TableCell>
                    <TableCell className="text-right tabular">{margemBreakdown.pctTotal.toFixed(1)}%</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-success/10 font-bold">
                    <TableCell>Sobra (margem líquida)</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(kpis.resultado)}</TableCell>
                    <TableCell className="text-right tabular">{kpis.margem.toFixed(1)}%</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Margem de contribuição</p>
                <p className="mt-1 font-display text-2xl font-bold">{margemBreakdown.margemContrib.toFixed(1)}%</p>
                <p className="mt-1 text-xs text-muted-foreground">Lucro bruto / receita. Mostra quanto sobra após custos diretos + variáveis + insumos.</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Maior vilão</p>
                <p className="mt-1 font-semibold">{margemBreakdown.maiorVilao ? `${margemBreakdown.maiorVilao.chave}` : "—"}</p>
                <p className="mt-1 font-display text-2xl font-bold">{margemBreakdown.maiorVilao ? `${margemBreakdown.maiorVilao.pct.toFixed(1)}%` : "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{margemBreakdown.maiorVilao ? fmtMoney(margemBreakdown.maiorVilao.valor) : ""} da receita</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leitura estratégica</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {kpis.margem >= 15 ? "Margem saudável (≥15%). Proteja CMV e renegocie insumos em alta para manter." : kpis.margem >= 5 ? "Margem apertada (5-15%). Ataque o maior vilão acima e revise preço/ticket médio." : kpis.receita <= 0 ? "Sem receita no período — ajuste o filtro para analisar." : "Margem crítica (<5% ou negativa). Corte outras despesas, renegocie fixos e reprecifique urgentes."}
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold">Dicas por grupo</p>
              {margemBreakdown.itens.map((i) => (
                <p key={i.chave} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{i.chave} ({i.pct.toFixed(1)}%):</span> {i.dica}
                </p>
              ))}
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowMargemDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folha dos Colaboradores Detail Dialog */}
      <Dialog open={showFolhaDetail} onOpenChange={setShowFolhaDetail}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Folha dos Colaboradores</DialogTitle>
            <p className="text-sm text-muted-foreground">Saldo devedor = salário − pagamentos realizados. Se pagamento &lt; salário, o restante acumula para o próximo mês. Motoboys ficam na folha própria.</p>
            <p className="text-sm text-muted-foreground">Projeção acumulada da equipe no período {fmtDate(periodoInicio)} a {fmtDate(periodoFim)} ({folhaMeses} {folhaMeses === 1 ? "mês" : "meses"}): <span className="font-semibold text-foreground">{fmtMoney(folhaAcumulada)}</span>.</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead className="text-right">Salário</TableHead>
                    <TableHead className="text-right">Pagamentos realizados</TableHead>
                    <TableHead className="text-right">Saldo devedor</TableHead>
                    <TableHead className="text-right">Registrar pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffCollabs.map((c: any) => {
                    const saldo = Number(c.saldo_devedor) || Math.max(0, (Number(c.salario) || 0) - (Number(c.pagamento) || 0));
                    return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{c.cargo || "—"}</TableCell>
                      <TableCell className="text-right tabular">{fmtMoney(c.salario)}</TableCell>
                      <TableCell className="text-right tabular font-medium">{fmtMoney(c.pagamento)}</TableCell>
                      <TableCell className={`text-right tabular font-medium ${saldo > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(saldo)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Valor"
                            value={adiantarPagamento[c.id] || ""}
                            onChange={(e) => setAdiantarPagamento(prev => ({ ...prev, [c.id]: Number(e.target.value) || 0 }))}
                            className="w-32"
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              const valor = adiantarPagamento[c.id];
                              if (valor > 0) {
                                adiantarPagamentoMutate.mutate({ collaboratorId: c.id, valor });
                              }
                            }}
                            disabled={!adiantarPagamento[c.id] || adiantarPagamentoMutate.isPending}
                          >
                            {adiantarPagamentoMutate.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                            Confirmar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-muted/50 rounded-lg text-sm">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Colaboradores</p>
                <p className="font-display text-lg font-semibold">{staffCollabs.length}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total salários</p>
                <p className="font-display text-lg font-semibold">{fmtMoney(totalSalarios)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Pagamentos realizados</p>
                <p className="font-display text-lg font-semibold text-success">{fmtMoney(totalPagamentos)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Saldo devedor</p>
                <p className={`font-display text-lg font-semibold ${folhaSaldoExibido > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(folhaSaldoExibido)}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowFolhaDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folha dos Motoboys Detail Dialog - mesmo sistema da Folha dos Colaboradores */}
      <Dialog open={showMotoboysDetail} onOpenChange={setShowMotoboysDetail}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Folha dos Motoboys</DialogTitle>
            <p className="text-sm text-muted-foreground">Saldo devedor = salário − pagamentos realizados. Se pagamento &lt; salário, o restante acumula para o próximo mês. Marque quem é motoboy na página Colaboradores.</p>
            <p className="text-sm text-muted-foreground">Projeção acumulada dos motoboys no período {fmtDate(periodoInicio)} a {fmtDate(periodoFim)} ({folhaMeses} {folhaMeses === 1 ? "mês" : "meses"}): <span className="font-semibold text-foreground">{fmtMoney(folhaAcumuladaMotoboys)}</span>.</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            {motoboyCollabs.length === 0 ? (
              <div className="py-12 text-center">
                <Bike className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">Nenhum motoboy marcado</p>
                <p className="mt-1 text-xs text-muted-foreground">Ative "É motoboy" no cadastro do colaborador, na página Colaboradores.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Motoboy</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead className="text-right">Salário</TableHead>
                      <TableHead className="text-right">Pagamentos realizados</TableHead>
                      <TableHead className="text-right">Saldo devedor</TableHead>
                      <TableHead className="text-right">Registrar pagamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {motoboyCollabs.map((c: any) => {
                      const saldo = Number(c.saldo_devedor) || Math.max(0, (Number(c.salario) || 0) - (Number(c.pagamento) || 0));
                      return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{c.cargo || "—"}</TableCell>
                        <TableCell className="text-right tabular">{fmtMoney(c.salario)}</TableCell>
                        <TableCell className="text-right tabular font-medium">{fmtMoney(c.pagamento)}</TableCell>
                        <TableCell className={`text-right tabular font-medium ${saldo > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(saldo)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Valor"
                              value={adiantarPagamento[c.id] || ""}
                              onChange={(e) => setAdiantarPagamento(prev => ({ ...prev, [c.id]: Number(e.target.value) || 0 }))}
                              className="w-32"
                            />
                            <Button
                              size="sm"
                              onClick={() => {
                                const valor = adiantarPagamento[c.id];
                                if (valor > 0) {
                                  adiantarPagamentoMutate.mutate({ collaboratorId: c.id, valor });
                                }
                              }}
                              disabled={!adiantarPagamento[c.id] || adiantarPagamentoMutate.isPending}
                            >
                              {adiantarPagamentoMutate.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                              Confirmar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-muted/50 rounded-lg text-sm">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Motoboys</p>
                <p className="font-display text-lg font-semibold">{motoboyCollabs.length}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total salários</p>
                <p className="font-display text-lg font-semibold">{fmtMoney(motoboysSalarios)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Pagamentos realizados</p>
                <p className="font-display text-lg font-semibold text-success">{fmtMoney(motoboysPagamentos)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Saldo devedor</p>
                <p className={`font-display text-lg font-semibold ${motoboysSaldoExibido > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(motoboysSaldoExibido)}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowMotoboysDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extrato de pagamentos da folha — lista individual com data + excluir */}
      <Dialog open={!!pagExtGrupo} onOpenChange={(o) => { if (!o) setPagExtGrupo(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="size-4 text-primary" /> Extrato de pagamentos — {pagExtGrupo === "motoboys" ? "Motoboys" : "Equipe"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Pagamentos registrados individualmente • Total no intervalo: <span className="font-semibold text-foreground">{fmtMoney(pagExtratoTotal)}</span>
              {` • ${pagExtratoLista.length} pagamento(s)`}
              {pagExtRange.limitado ? " • intervalo limitado a 62 dias" : ""}
            </p>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <div className="flex rounded-lg border border-border p-1">
              {([
                { v: "dia", label: "Dia" },
                { v: "semana", label: "Semana" },
                { v: "mes", label: "Mês" },
                { v: "personalizado", label: "Personalizado" },
              ] as const).map((t) => (
                <button
                  key={t.v}
                  onClick={() => setPagExtTipo(t.v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${pagExtTipo === t.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {pagExtTipo === "personalizado" ? (
              <>
                <Input type="date" value={pagExtInicio} onChange={(e) => setPagExtInicio(e.target.value)} className="w-auto" title="Início" />
                <span className="text-xs text-muted-foreground">até</span>
                <Input type="date" value={pagExtFim} onChange={(e) => setPagExtFim(e.target.value)} className="w-auto" title="Fim" />
              </>
            ) : pagExtTipo === "mes" ? (
              <Input type="month" value={pagExtData.slice(0, 7)} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setPagExtData(`${e.target.value}-01`); }} className="w-auto" title="Mês" />
            ) : (
              <Input type="date" value={pagExtData} onChange={(e) => setPagExtData(e.target.value)} className="w-auto" title={pagExtTipo === "dia" ? "Dia" : "Qualquer dia da semana"} />
            )}
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            {pagExtTipo === "dia" && `Pagamentos de ${fmtDate(pagExtRange.ini)}`}
            {pagExtTipo === "semana" && `Semana de ${fmtDate(pagExtRange.ini)} a ${fmtDate(pagExtRange.fim)}`}
            {pagExtTipo === "mes" && `Mês de ${new Date(pagExtRange.ini + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`}
            {pagExtTipo === "personalizado" && `De ${fmtDate(pagExtRange.ini)} a ${fmtDate(pagExtRange.fim)}`}
          </p>
          <div className="flex-1 overflow-y-auto pr-1 -mr-1">
            {pagExtratoLista.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
                <ReceiptText className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm font-medium">Nenhum pagamento registrado</p>
                <p className="mt-1 text-xs text-muted-foreground">Use "Registrar pagamento" no detalhamento da folha para lançar pagamentos.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="min-w-[130px]">Data do pagamento</TableHead>
                      <TableHead className="min-w-[200px]">Colaborador</TableHead>
                      <TableHead className="min-w-[130px] text-right">Valor</TableHead>
                      <TableHead className="min-w-[100px] text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagExtratoLista.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDateTime(p.data)}</TableCell>
                        <TableCell className="font-medium">{p.nome}</TableCell>
                        <TableCell className="text-right tabular font-medium text-success">+{fmtMoney(p.valor)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPagToDelete({ id: p.id, collaboratorId: p.collaboratorId, nome: p.nome, valor: p.valor, data: p.data })}
                            title="Excluir pagamento (estorna os valores)"
                          >
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
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setPagExtGrupo(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão de pagamento da folha */}
      <AlertDialog open={!!pagToDelete} onOpenChange={(o) => !o && setPagToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {pagToDelete ? `${fmtMoney(pagToDelete.valor)} • ${pagToDelete.nome} • ${fmtDateTime(pagToDelete.data)}.` : ""}
              {" "}Os valores serão estornados do acumulado do colaborador e o lançamento sairá das listas e totais (registro de auditoria preservado). Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pagToDelete && estornarPagamentoMut.mutate({ logId: pagToDelete.id, collaboratorId: pagToDelete.collaboratorId, valor: pagToDelete.valor })}
              disabled={estornarPagamentoMut.isPending}
            >
              {estornarPagamentoMut.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Despesas com Insumos Detail Dialog */}
      <Dialog open={showInsumosDetail} onOpenChange={setShowInsumosDetail}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Despesas com Insumos (Ordens Recebidas)</DialogTitle>
            <p className="text-sm text-muted-foreground">Valor efetivo recebido (quantidade_recebida × preco_recebido) — principal indicador de custo de insumos. Preço médio = média histórica do insumo · % variação vs médio</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nº</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Preço Unit.</TableHead>
                    <TableHead className="text-right">Preço Médio</TableHead>
                    <TableHead className="text-right">% vs Médio</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-center">Pagamento</TableHead>
                    <TableHead className="text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivedPurchaseOrders.map((o: any) => {
                    const precoUnit = Number(o.preco_recebido ?? o.preco_medio) || Number(o.ingredients?.preco_ultima_compra) || 0;
                    const precoMedio = Number(o.ingredients?.preco_medio) || 0;
                    const qtd = Number(o.quantidade_recebida ?? o.quantidade_necessaria) || 0;
                    const total = Number(o.valor_total) || qtd * precoUnit;
                    const pct = precoMedio > 0 ? ((precoUnit - precoMedio) / precoMedio) * 100 : 0;
                    const pctFmt = precoMedio > 0 ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "—";
                    const pctTone = pct > 0.5 ? "text-destructive" : pct < -0.5 ? "text-success" : "text-muted-foreground";
                    const pagoLabel = o.pago ? "Pago" : o.data_vencimento ? `Venc. ${fmtDate(o.data_vencimento)}` : "—";
                    return (
                    <TableRow key={o.id}>
                      <TableCell>#{o.numero}</TableCell>
                      <TableCell className="font-medium">{o.ingredients?.nome || "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(qtd, 2)} {o.ingredients?.unidade || ""}</TableCell>
                      <TableCell className="text-right tabular">{precoUnit ? fmtMoney(precoUnit) : "—"}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{precoMedio ? fmtMoney(precoMedio) : "—"}</TableCell>
                      <TableCell className={`text-right tabular font-medium ${pctTone}`}>{pctFmt}</TableCell>
                      <TableCell className="text-right tabular font-medium">{total ? fmtMoney(total) : "—"}</TableCell>
                      <TableCell className="text-center"><Badge variant={o.pago ? "default" : "outline"} className="text-xs">{pagoLabel}</Badge></TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtDate(o.updated_at || o.created_at)}</TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </div>
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total de itens</p>
                <p className="font-display text-xl font-semibold">{receivedPurchaseOrders.length}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Valor total</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(insumosTotal)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Preço médio</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(insumosAvgPrice)}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowInsumosDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vencimentos Detail Dialog - itens em estoque e lançamentos ainda não pagos */}
      <Dialog open={showVencimentosDetail} onOpenChange={setShowVencimentosDetail}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Vencimentos — Itens em estoque e lançamentos a pagar</DialogTitle>
            <p className="text-sm text-muted-foreground">Ordens de compra já recebidas + lançamentos manuais com pagamento pendente • {vencimentosPendentesTotal} pendente(s) • Total {fmtMoney(vencimentosTotal)}{vencimentosVencidos.length ? ` • ${vencimentosVencidos.length} vencido(s)` : ""} • {vencimentosPendentes.length} compras + {manualVencimentos.length} lançamentos</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            {vencimentosPendentesTotal === 0 ? (
              <div className="py-12 text-center">
                <CalendarDays className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">Nenhum vencimento pendente</p>
                <p className="mt-1 text-xs text-muted-foreground">Compras a prazo e lançamentos com vencimento futuro aparecerão aqui até serem quitados.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {vencimentosPendentes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShoppingCart className="size-4" /> Compras — itens em estoque não pagos</h4>
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Nº</TableHead>
                            <TableHead>Insumo / Produto</TableHead>
                            <TableHead>Fornecedor</TableHead>
                            <TableHead className="text-right">Qtd. recebida</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vencimentosPendentes.map((o: any) => {
                            const venc = o.data_vencimento;
                            const isVencido = venc && new Date(venc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                            const valor = Number(o.valor_total) || Number(o.quantidade_recebida || o.quantidade_necessaria) * Number(o.preco_recebido || o.preco_medio) || 0;
                            const qtd = Number(o.quantidade_recebida ?? o.quantidade_necessaria) || 0;
                            const preco = Number(o.preco_recebido ?? o.preco_medio) || 0;
                            return (
                              <TableRow key={o.id} className={isVencido ? "bg-destructive/5" : ""}>
                                <TableCell className="tabular font-medium">#{o.numero}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{o.ingrediente_nome}</div>
                                  <div className="text-xs text-muted-foreground">{qtd ? `${fmtNum(qtd, 2)} × ${fmtMoney(preco)}` : ""}</div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{o.fornecedor_nome}</TableCell>
                                <TableCell className="text-right tabular">{qtd ? fmtNum(qtd, 2) : "—"}</TableCell>
                                <TableCell className="text-right tabular font-medium">{fmtMoney(valor)}</TableCell>
                                <TableCell className={isVencido ? "text-destructive font-medium" : "text-warning font-medium"}>{venc ? fmtDate(venc) : "—"}</TableCell>
                                <TableCell className="text-center">
                                  {isVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" onClick={() => payVencimentoFinanceiro.mutate(o.id)} disabled={payVencimentoFinanceiro.isPending}>
                                    {payVencimentoFinanceiro.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <CreditCard className="mr-1.5 size-4" />} Quitar
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
                {manualVencimentos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><FileSpreadsheet className="size-4" /> Lançamentos manuais pendentes</h4>
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Categoria</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {manualVencimentos.map((e) => {
                            const venc = (e as any).vencimento || e.competencia;
                            const isVencido = venc && new Date(venc + "T12:00:00") < new Date(new Date().toISOString().split("T")[0] + "T12:00:00");
                            const gid = (e as any).recorrencia_grupo_id as string | null;
                            const isDeterminada = (e as any).recorrencia_tipo === 'determinada' && !!gid;
                            let parcelaBadge: string | null = null;
                            let progressoBadge: string | null = null;
                            if (isDeterminada && gid && grupoProgressMap.has(gid)) {
                              const stat = grupoProgressMap.get(gid)!;
                              const idx = parcelIndexMap.get(e.id) ?? 0;
                              if (idx) parcelaBadge = `${idx}/${stat.total}x`;
                              progressoBadge = `${stat.pagos}/${stat.total} pagas`;
                            }
                            return (
                              <TableRow key={e.id} className={isVencido ? "bg-destructive/5" : "bg-warning/5"}>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-1.5">
                                    <span>{e.categoria}</span>
                                    {parcelaBadge && <Badge variant="outline" className="text-xs border-info/30 text-info">{parcelaBadge}</Badge>}
                                  </div>
                                  {progressoBadge && <div className="text-xs text-muted-foreground">{progressoBadge}</div>}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{e.descricao || "—"}</TableCell>
                                <TableCell className="text-right tabular font-medium">{fmtMoney(e.valor)}</TableCell>
                                <TableCell className={isVencido ? "text-destructive font-medium" : "text-warning font-medium"}>{venc ? fmtDate(venc) : "—"}</TableCell>
                                <TableCell className="text-center">
                                  {isVencido ? <Badge variant="destructive">Vencido</Badge> : <Badge variant="outline" className="border-warning/30 text-warning">Há pagar</Badge>}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" onClick={() => payManualVencimento.mutate(e.id)} disabled={payManualVencimento.isPending}>
                                    {payManualVencimento.isPending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <CreditCard className="mr-1.5 size-4" />} Quitar
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Pendentes</p>
                <p className="font-display text-xl font-semibold">{vencimentosPendentesTotal}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total a pagar</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(vencimentosTotal)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Vencidos</p>
                <p className={`font-display text-xl font-semibold ${vencimentosVencidos.length > 0 ? "text-destructive" : "text-success"}`}>{vencimentosVencidos.length}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowVencimentosDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Taxas de Entrega e Outras Taxas Detail Dialog */}
      <Dialog open={showTaxasDetail} onOpenChange={setShowTaxasDetail}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Taxas de Entrega e Outras Taxas — Detalhamento</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {taxTipo === "dia" && `Taxas de ${fmtDate(taxRange.ini)}`}
              {taxTipo === "semana" && `Semana de ${fmtDate(taxRange.ini)} a ${fmtDate(taxRange.fim)}`}
              {taxTipo === "mes" && `Mês de ${new Date(taxRange.ini + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`}
              {taxTipo === "personalizado" && `De ${fmtDate(taxRange.ini)} a ${fmtDate(taxRange.fim)}`}
              {` • Entrega ${fmtMoney(taxTotais.entrega)} • Outras ${fmtMoney(taxTotais.outras)} • Total ${fmtMoney(taxTotais.geral)}`}
              {taxRange.limitado ? " • intervalo limitado a 62 dias" : ""}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border p-1">
                {([
                  { v: "dia", label: "Dia" },
                  { v: "semana", label: "Semana" },
                  { v: "mes", label: "Mês" },
                  { v: "personalizado", label: "Personalizado" },
                ] as const).map((t) => (
                  <button
                    key={t.v}
                    onClick={() => setTaxTipo(t.v)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${taxTipo === t.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {taxTipo === "personalizado" ? (
                <>
                  <Input type="date" value={taxInicio} onChange={(e) => setTaxInicio(e.target.value)} className="w-auto" title="Início" />
                  <span className="text-xs text-muted-foreground">até</span>
                  <Input type="date" value={taxFim} onChange={(e) => setTaxFim(e.target.value)} className="w-auto" title="Fim" />
                </>
              ) : taxTipo === "mes" ? (
                <Input type="month" value={taxData.slice(0, 7)} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setTaxData(`${e.target.value}-01`); }} className="w-auto" title="Mês" />
              ) : (
                <Input type="date" value={taxData} onChange={(e) => setTaxData(e.target.value)} className="w-auto" title={taxTipo === "dia" ? "Dia" : "Qualquer dia da semana"} />
              )}
              <Select value={taxMotoboy} onValueChange={setTaxMotoboy}>
                <SelectTrigger className="w-48" title="Filtrar por motoboy"><SelectValue placeholder="Motoboy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os motoboys</SelectItem>
                  <SelectItem value="sem">Sem motoboy</SelectItem>
                  {taxMotoboysOpts.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="min-w-[200px]">Motoboy</TableHead>
                    <TableHead className="text-center">Pedidos com taxa</TableHead>
                    <TableHead className="text-right">Total taxa de entrega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxPorMotoboy.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">Sem taxas de entrega no intervalo.</TableCell>
                    </TableRow>
                  ) : (
                    taxPorMotoboy.map((m) => (
                      <TableRow key={m.id ?? "sem"} className={taxMotoboy !== "todos" && (taxMotoboy === m.id || (taxMotoboy === "sem" && m.id === null)) ? "bg-primary/5" : ""}>
                        <TableCell className="font-medium">
                          <Badge variant="outline" className="text-xs border-info/30 text-info">{m.nome}</Badge>
                        </TableCell>
                        <TableCell className="text-center tabular">{m.qtd}</TableCell>
                        <TableCell className="text-right tabular font-semibold">{fmtMoney(m.total)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {taxOutrasPorNome.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Tipo de taxa extra</TableHead>
                      <TableHead className="text-center">Pedidos</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxOutrasPorNome.map((t) => (
                      <TableRow key={t.nome}>
                        <TableCell className="font-medium">{t.nome}</TableCell>
                        <TableCell className="text-center tabular">{t.qtd}</TableCell>
                        <TableCell className="text-right tabular font-medium">{fmtMoney(t.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {taxFiltrados.filter(t => t.totalTaxas > 0).length === 0 ? (
              <div className="py-12 text-center">
                <ReceiptText className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">Nenhuma taxa no intervalo selecionado</p>
                <p className="mt-1 text-xs text-muted-foreground">Ajuste o período ou o filtro de motoboy. Pedidos com taxa de entrega ou taxas adicionais aparecerão aqui detalhados por pedido.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Pedido</TableHead>
                      <TableHead>Motoboy</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Taxa de entrega</TableHead>
                      <TableHead className="text-right">Outras taxas</TableHead>
                      <TableHead>Detalhe outras taxas</TableHead>
                      <TableHead className="text-right">Total taxas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxFiltrados.filter(t => t.totalTaxas > 0).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="tabular font-medium">#{t.numero}</TableCell>
                        <TableCell>{t.motoboyId && motoboyNomePorId.get(t.motoboyId) ? <Badge variant="outline" className="text-xs border-info/30 text-info">{motoboyNomePorId.get(t.motoboyId)}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(t.imported_at)}</TableCell>
                        <TableCell className="text-right tabular font-medium">{t.taxaEntrega > 0 ? fmtMoney(t.taxaEntrega) : "—"}</TableCell>
                        <TableCell className="text-right tabular font-medium">{t.outrasTaxas > 0 ? fmtMoney(t.outrasTaxas) : "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{t.outrasItens.length > 0 ? t.outrasItens.map(i => `${i.nome}: ${fmtMoney(i.valor)}`).join(" • ") : "—"}</TableCell>
                        <TableCell className="text-right tabular font-semibold">{fmtMoney(t.totalTaxas)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Taxas de entrega</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(taxTotais.entrega)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Outras taxas</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(taxTotais.outras)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total em taxas</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(taxTotais.geral)}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowTaxasDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ponto de Equilíbrio Detail Dialog */}
      <Dialog open={showPontoEquilibrioDetail} onOpenChange={setShowPontoEquilibrioDetail}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Ponto de Equilíbrio — O que está incluído</DialogTitle>
            <p className="text-sm text-muted-foreground">Folha mensal + despesas recorrentes + insumos do período • Total {fmtMoney(pontoDeEquilibrio.total)} • Não diminui com pagamento parcial, só quando a despesa é quitada/removida</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-6 pr-1 -mr-1">
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Users className="size-4" /> Folha dos colaboradores — {fmtMoney(pontoDeEquilibrio.folha)}/mês</h4>
              <p className="text-xs text-muted-foreground mb-2">Salários mensais dos colaboradores ativos (valor fixo, independente de pagamentos realizados) • Use o interruptor para tirar ou recolocar cada pessoa no indicador.</p>
              {pontoDeEquilibrio.folhaItens.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum colaborador ativo com salário.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Colaborador</TableHead>
                        <TableHead>Cargo</TableHead>
                        <TableHead className="text-right">Salário/mês</TableHead>
                        <TableHead className="text-center">No ponto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pontoDeEquilibrio.folhaItens.map((c) => (
                        <TableRow key={c.id || c.nome} className={c.incluido ? "" : "opacity-60"}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              <span>{c.nome}</span>
                              {c.is_motoboy && <Badge variant="outline" className="text-xs border-info/30 text-info">Motoboy</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{c.cargo || "—"}</TableCell>
                          <TableCell className="text-right tabular font-medium">{fmtMoney(c.salario)}</TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={c.incluido}
                              onCheckedChange={(v) => c.id && toggleColabPonto.mutate({ id: c.id, incluir: v })}
                              disabled={toggleColabPonto.isPending || !c.id}
                              title={c.incluido ? "Tirar do ponto de equilíbrio" : "Recolocar no ponto de equilíbrio"}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><RefreshCw className="size-4" /> Despesas recorrentes — {fmtMoney(pontoDeEquilibrio.recorrenteTotal)}/mês</h4>
              <p className="text-xs text-muted-foreground mb-2">Lançamentos manuais recorrentes (cada grupo conta uma única vez, mesmo com várias parcelas futuras){pontoDeEquilibrio.usouFallback ? " • Exibindo pendentes (carregamento parcial)" : ""} • Use o interruptor para tirar ou recolocar um item no indicador.</p>
              {(pontoDeEquilibrio.recorrenteGrupos.length === 0 && pontoDeEquilibrio.recorrenteAvulsos.length === 0) ? (
                <p className="text-xs text-muted-foreground">Nenhuma despesa recorrente cadastrada.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Categoria</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Valor/mês</TableHead>
                        <TableHead className="text-center">Parcelas</TableHead>
                        <TableHead className="text-center">No ponto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pontoDeEquilibrio.recorrenteGrupos.map((g) => {
                        const stat = grupoProgressMap.get(g.gid);
                        const progresso = stat ? `${stat.pagos}/${stat.total} pagas` : (g.tipo === "determinada" && g.quantidade ? `${g.quantidade}x` : g.tipo === "indefinida" ? "Indefinida" : "—");
                        return (
                          <TableRow key={g.gid} className={g.incluido ? "" : "opacity-60"}>
                            <TableCell className="font-medium">{g.categoria}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{g.descricao || "—"}</TableCell>
                            <TableCell className="text-right tabular font-medium">{fmtMoney(g.valor)}</TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground">{progresso}</TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={g.incluido}
                                onCheckedChange={(v) => togglePontoEquilibrio.mutate({ ids: g.ids, incluir: v })}
                                disabled={togglePontoEquilibrio.isPending || g.ids.length === 0}
                                title={g.incluido ? "Tirar do ponto de equilíbrio" : "Recolocar no ponto de equilíbrio"}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {pontoDeEquilibrio.recorrenteAvulsos.map((a, i) => (
                        <TableRow key={a.id || `avulso-${i}`} className={a.incluido ? "" : "opacity-60"}>
                          <TableCell className="font-medium">{a.categoria}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{a.descricao || "—"}</TableCell>
                          <TableCell className="text-right tabular font-medium">{fmtMoney(a.valor)}</TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">Avulso</TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={a.incluido}
                              onCheckedChange={(v) => a.id && togglePontoEquilibrio.mutate({ ids: [a.id], incluir: v })}
                              disabled={togglePontoEquilibrio.isPending || !a.id}
                              title={a.incluido ? "Tirar do ponto de equilíbrio" : "Recolocar no ponto de equilíbrio"}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShoppingCart className="size-4" /> Insumos — {fmtMoney(pontoDeEquilibrio.insumos)}</h4>
              <p className="text-xs text-muted-foreground mb-2">Total de insumos recebidos no período selecionado ({pontoDeEquilibrio.insumosQtd} ordem(ns)), usado como proxy do custo mensal recorrente de insumos. Estável mesmo após quitar as compras.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Folha/mês</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(pontoDeEquilibrio.folha)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Recorrentes/mês</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(pontoDeEquilibrio.recorrenteTotal)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Insumos</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(pontoDeEquilibrio.insumos)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Ponto de equilíbrio</p>
                <p className="font-display text-xl font-semibold">{fmtMoney(pontoDeEquilibrio.total)}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowPontoEquilibrioDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receita Bruta Breakdown Dialog */}
      <Dialog open={showReceitaDetail} onOpenChange={setShowReceitaDetail}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalhamento da Receita Bruta</DialogTitle>
            <p className="text-sm text-muted-foreground">Anota AI direto vs iFood (via Anota) • Período {new Date(periodoInicio).toLocaleDateString("pt-BR")} a {new Date(periodoFim).toLocaleDateString("pt-BR")}</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 -mr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <CreditCard className="size-4 text-success" /> Anota AI Direto
                </h4>
                <p className="mt-2 text-sm text-muted-foreground">Vendas diretas Anota AI (sem iFood) no período</p>
                <p className="mt-3 font-display text-2xl font-bold text-success">{fmtMoney(anotaDirectTotal)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <ArrowDownRight className="size-4 text-warning" /> iFood (Quartas-feiras)
                </h4>
                <p className="mt-2 text-sm text-muted-foreground">Total de vendas via iFood no período</p>
                <p className="mt-3 font-display text-2xl font-bold text-warning">{fmtMoney(ifoodTotal)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Pedidos iFood: {ifoodOrders.length} • Quartas no período: {quartasFeiras.length}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="font-semibold flex items-center gap-2">
                <ArrowUpRight className="size-4 text-info" /> Valores Futuros a Receber
              </h4>
              <div className="mt-3">
                <div>
                  <p className="text-xs text-muted-foreground">iFood (próxima quarta {fmtDate(ifoodProximaQuarta.data)})</p>
                  <p className="font-display text-xl font-bold text-warning">{fmtMoney(ifoodProximaQuarta.valor)}</p>
                  <p className="text-xs text-muted-foreground">De 00:01 de {fmtDate(ifoodProximaQuarta.inicio)} até agora</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-between">
                <span className="font-medium">Total a receber</span>
                <span className="font-display text-xl font-bold">{fmtMoney(ifoodProximaQuarta.valor)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <CalendarDays className="size-4 text-primary" /> Últimas quartas
              </h4>
              <p className="text-xs text-muted-foreground mb-3">4 últimas quartas-feiras anteriores a hoje • atualiza a cada quarta 00:01 (janela móvel)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {ultimasQuartasComValores.map((q) => (
                  <div key={q.data} className="rounded-lg border border-border p-3 text-center bg-muted/20">
                    <p className="text-xs text-muted-foreground">{fmtDate(q.data)}</p>
                    <p className="font-display text-lg font-bold mt-1">{fmtMoney(q.valor)}</p>
                    <p className="text-xs text-muted-foreground">de {fmtDate(q.inicio)} até {fmtDate(q.data)}</p>
                  </div>
                ))}
                {ultimasQuartasComValores.length === 0 && <span className="text-xs text-muted-foreground col-span-4">Nenhuma quarta no período</span>}
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowReceitaDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InsightCard({ title, value, description, tone, onClick }: { title: string; value: string; description: string; tone: "success" | "warning" | "danger" | "info"; onClick?: () => void }) {
  const tones = {
    success: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
    warning: "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    danger: "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400",
    info: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
  };
  return (
    <div
      className={`rounded-xl border p-4 ${tones[tone]}${onClick ? " cursor-pointer transition-colors hover:border-blue-500/50 hover:shadow-sm" : ""}`}
      onClick={onClick}
    >
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs opacity-70">{description}</p>
    </div>
  );
}
