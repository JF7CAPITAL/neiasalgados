import { cn } from "@/lib/utils";
import { STATUS_LABELS, PRIORITY_LABELS, MOVEMENT_LABELS } from "@/lib/format";

const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border";

const statusStyles: Record<string, string> = {
  pendente: "bg-warning/15 text-warning border-warning/30",
  em_andamento: "bg-info/15 text-info border-info/30",
  concluida: "bg-success/15 text-success border-success/30",
  cancelada: "bg-destructive/15 text-destructive border-destructive/30",
};

const priorityStyles: Record<string, string> = {
  baixa: "bg-muted text-muted-foreground border-border",
  media: "bg-info/15 text-info border-info/30",
  alta: "bg-warning/15 text-warning border-warning/30",
  urgente: "bg-destructive/15 text-destructive border-destructive/30",
};

const movementStyles: Record<string, string> = {
  entrada: "bg-success/15 text-success border-success/30",
  saida: "bg-destructive/15 text-destructive border-destructive/30",
  ajuste: "bg-info/15 text-info border-info/30",
  perda: "bg-destructive/15 text-destructive border-destructive/30",
  inventario: "bg-warning/15 text-warning border-warning/30",
};

const stockStyles: Record<string, string> = {
  critico: "bg-destructive/15 text-destructive border-destructive/30",
  baixo: "bg-warning/15 text-warning border-warning/30",
  ok: "bg-success/15 text-success border-success/30",
};

const stockLabels: Record<string, string> = { critico: "Crítico", baixo: "Baixo", ok: "OK" };

export function StatusBadge({ status }: { status: string }) {
  return <span className={cn(base, statusStyles[status] ?? statusStyles.pendente)}>{STATUS_LABELS[status] ?? status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={cn(base, priorityStyles[priority] ?? priorityStyles.media)}>{PRIORITY_LABELS[priority] ?? priority}</span>;
}

export function MovementBadge({ tipo }: { tipo: string }) {
  return <span className={cn(base, movementStyles[tipo] ?? movementStyles.ajuste)}>{MOVEMENT_LABELS[tipo] ?? tipo}</span>;
}

export function StockBadge({ level }: { level: "critico" | "baixo" | "ok" }) {
  return <span className={cn(base, stockStyles[level])}>{stockLabels[level]}</span>;
}
