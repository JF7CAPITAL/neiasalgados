import type { AppRole } from "./auth";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ArrowUpFromLine,
  ArrowDownToLine,
  Warehouse,
  UtensilsCrossed,
  ClipboardList,
  Users,
  Truck,
  Wallet,
  BarChart3,
  History,
  LineChart,
  type LucideIcon,
} from "lucide-react";


export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: AppRole[];
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Painel", to: "/painel", icon: LayoutDashboard, roles: ["admin", "producao", "estoque", "compras", "financeiro", "rh", "operacional"], group: "Visão geral" },

  { label: "Produtos", to: "/produtos", icon: Package, roles: ["admin", "producao", "estoque"], group: "Produção" },
  { label: "Recheios", to: "/recheios", icon: UtensilsCrossed, roles: ["admin", "producao"], group: "Produção" },
  { label: "Ordens de Serviço", to: "/ordens", icon: ClipboardList, roles: ["admin", "producao", "compras", "estoque"], group: "Produção" },

  { label: "Estoque de Acabados", to: "/estoque", icon: Boxes, roles: ["admin", "estoque", "producao"], group: "Estoque" },
  { label: "Lançar Entradas", to: "/entradas", icon: ArrowDownToLine, roles: ["admin", "estoque", "compras", "producao"], group: "Estoque" },
  { label: "Lançar Saídas", to: "/saidas", icon: ArrowUpFromLine, roles: ["admin", "estoque", "operacional", "producao"], group: "Estoque" },

  { label: "Almoxarifado", to: "/almoxarifado", icon: Warehouse, roles: ["admin", "estoque", "compras"], group: "Estoque" },
  { label: "Fornecedores", to: "/fornecedores", icon: Truck, roles: ["admin", "compras"], group: "Estoque" },

  { label: "Anota AI", to: "/anota", icon: ShoppingBag, roles: ["admin", "estoque", "compras", "producao", "operacional"], group: "Integrações" },

  { label: "Colaboradores", to: "/colaboradores", icon: Users, roles: ["admin", "rh"], group: "Gestão" },
  { label: "Relatório de Produção", to: "/relatorio-producao", icon: LineChart, roles: ["admin", "producao", "estoque", "financeiro"], group: "Gestão" },
  { label: "Relatórios", to: "/relatorios", icon: BarChart3, roles: ["admin", "producao", "estoque", "compras", "financeiro", "rh"], group: "Gestão" },
  { label: "Histórico", to: "/historico", icon: History, roles: ["admin"], group: "Gestão" },
  { label: "Financeiro", to: "/financeiro", icon: Wallet, roles: ["admin", "financeiro"], group: "Gestão" },
];
