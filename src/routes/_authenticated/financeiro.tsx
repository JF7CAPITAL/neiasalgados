import { createFileRoute } from "@tanstack/react-router";
import { Wallet, TrendingUp, TrendingDown, PiggyBank } from "lucide-react";
import { PageHeader, KpiCard, EmptyState } from "@/components/erp/PageHeader";

export const Route = createFileRoute("/_authenticated/financeiro")({
  component: FinanceiroPage,
});

function FinanceiroPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Financeiro" subtitle="Módulo em estruturação — pronto para expansão" icon={Wallet} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Receitas" value="—" icon={TrendingUp} tone="success" />
        <KpiCard label="Despesas" value="—" icon={TrendingDown} tone="danger" />
        <KpiCard label="Resultado" value="—" icon={PiggyBank} tone="info" />
        <KpiCard label="Custo de compras" value="—" icon={Wallet} />
      </div>
      <EmptyState
        icon={Wallet}
        title="Estrutura preparada para o Financeiro"
        description="A base de dados já registra preços médios, últimas compras e ordens. Este módulo será conectado a contas a pagar/receber, fluxo de caixa e integrações fiscais em uma próxima etapa."
      />
    </div>
  );
}
