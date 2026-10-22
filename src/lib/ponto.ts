import { differenceInMinutes, format, parseISO } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

export type TimeEntry = Database["public"]["Tables"]["time_entries"]["Row"];
export type TimeEntryTipo = "entrada" | "saida_intervalo" | "retorno_intervalo" | "saida";
export type JornadaTipo = "2_batidas" | "4_batidas";

export interface PontoCollaborator {
  id: string;
  nome: string;
  cargo: string | null;
  status: string;
  horario: string | null;
  foto_url: string | null;
  em_turno: boolean;
  ponto_habilitado: boolean;
  ponto_tipo_jornada: JornadaTipo;
  carga_horaria_minutos: number;
  tolerancia_minutos: number;
  banco_horas: number | null;
  biometria_consentimento_em: string | null;
}

export interface DayPair {
  entrada: TimeEntry | null;
  saidaIntervalo: TimeEntry | null;
  retornoIntervalo: TimeEntry | null;
  saida: TimeEntry | null;
}

export interface DaySummary {
  collaboratorId: string;
  collaboratorNome: string;
  day: string;
  pair: DayPair;
  workedMinutes: number;
  intervalMinutes: number;
  expectedMinutes: number;
  saldoMinutes: number;
  atrasoMinutes: number;
  extraMinutes: number;
  open: boolean;
  complete: boolean;
}

export interface CollaboratorSummary {
  collaboratorId: string;
  collaboratorNome: string;
  workedMinutes: number;
  expectedMinutes: number;
  saldoMinutes: number;
  atrasoMinutes: number;
  extraMinutes: number;
  daysWorked: number;
  openDays: number;
  incompleteDays: number;
  bancoHorasAtual: number;
}

export const TIPO_LABELS: Record<TimeEntryTipo, string> = {
  entrada: "Entrada",
  saida_intervalo: "Saída p/ intervalo",
  retorno_intervalo: "Retorno do intervalo",
  saida: "Saída",
};

export const ORIGEM_LABELS: Record<string, string> = {
  facial: "Facial",
  manual: "Manual",
  pin: "PIN",
  ajuste: "Ajuste RH",
};

export function normalizeJornada(value: string | null | undefined): JornadaTipo {
  return value === "2_batidas" ? "2_batidas" : "4_batidas";
}

export function dayKey(iso: string | Date): string {
  return format(typeof iso === "string" ? parseISO(iso) : iso, "yyyy-MM-dd");
}

export function todayKey(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(parseISO(iso), "HH:mm");
}

export function fmtDay(key: string): string {
  if (!key) return "—";
  return format(parseISO(key), "dd/MM/yyyy");
}

export function fmtMinutes(minutes: number | null | undefined): string {
  const total = Math.round(Number(minutes) || 0);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

export function fmtSignedMinutes(minutes: number | null | undefined): string {
  const n = Math.round(Number(minutes) || 0);
  if (n === 0) return "0h00";
  return (n > 0 ? "+" : "") + fmtMinutes(n);
}

export function parseStartMinutes(horario: string | null | undefined): number | null {
  if (!horario) return null;
  const match = horario.match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function entriesForDay(entries: TimeEntry[], key: string): TimeEntry[] {
  return entries
    .filter((e) => dayKey(e.registrado_em) === key)
    .sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
}

export function nextPunchType(entries: TimeEntry[], jornada: JornadaTipo): TimeEntryTipo | null {
  const sorted = [...entries].sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
  const last = sorted[sorted.length - 1];
  if (!last) return "entrada";

  if (jornada === "2_batidas") {
    return last.tipo === "entrada" ? "saida" : null;
  }

  switch (last.tipo as TimeEntryTipo) {
    case "entrada":
      return "saida_intervalo";
    case "saida_intervalo":
      return "retorno_intervalo";
    case "retorno_intervalo":
      return "saida";
    default:
      return null;
  }
}

export function pairDay(entries: TimeEntry[]): DayPair {
  const sorted = [...entries].sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
  const pair: DayPair = {
    entrada: null,
    saidaIntervalo: null,
    retornoIntervalo: null,
    saida: null,
  };
  for (const entry of sorted) {
    if (entry.tipo === "entrada" && !pair.entrada) pair.entrada = entry;
    else if (entry.tipo === "saida_intervalo" && !pair.saidaIntervalo) pair.saidaIntervalo = entry;
    else if (entry.tipo === "retorno_intervalo" && !pair.retornoIntervalo)
      pair.retornoIntervalo = entry;
    else if (entry.tipo === "saida" && !pair.saida) pair.saida = entry;
  }
  return pair;
}

function minutesBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const diff = differenceInMinutes(parseISO(end), parseISO(start));
  return diff > 0 ? diff : 0;
}

export function summarizeDay(
  collaborator: PontoCollaborator,
  entries: TimeEntry[],
  now = new Date(),
): DaySummary | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
  const pair = pairDay(sorted);
  const jornada = normalizeJornada(collaborator.ponto_tipo_jornada);
  const expectedMinutes = Math.max(0, Number(collaborator.carga_horaria_minutos) || 480);
  const tolerance = Math.max(0, Number(collaborator.tolerancia_minutos) || 0);

  const last = sorted[sorted.length - 1];
  const open = last.tipo !== "saida";
  const openEnd =
    open && dayKey(last.registrado_em) === dayKey(now) && now > parseISO(last.registrado_em)
      ? now.toISOString()
      : null;

  let workedMinutes = 0;
  let intervalMinutes = 0;

  if (pair.entrada && pair.saidaIntervalo) {
    workedMinutes += minutesBetween(pair.entrada.registrado_em, pair.saidaIntervalo.registrado_em);
    if (pair.retornoIntervalo) {
      intervalMinutes = minutesBetween(
        pair.saidaIntervalo.registrado_em,
        pair.retornoIntervalo.registrado_em,
      );
    }
  }

  if (pair.retornoIntervalo && pair.saida) {
    workedMinutes += minutesBetween(pair.retornoIntervalo.registrado_em, pair.saida.registrado_em);
  } else if (pair.entrada && pair.saida && !pair.saidaIntervalo) {
    workedMinutes = minutesBetween(pair.entrada.registrado_em, pair.saida.registrado_em);
  } else if (open && openEnd) {
    if (pair.retornoIntervalo) {
      workedMinutes += minutesBetween(pair.retornoIntervalo.registrado_em, openEnd);
    } else if (pair.entrada && !pair.saidaIntervalo) {
      workedMinutes = minutesBetween(pair.entrada.registrado_em, openEnd);
    }
  }

  const saldoMinutes = workedMinutes - expectedMinutes;
  const extraMinutes = Math.max(0, saldoMinutes - tolerance);

  let atrasoMinutes = 0;
  const expectedStart = parseStartMinutes(collaborator.horario);
  if (pair.entrada && expectedStart !== null) {
    const entradaDate = parseISO(pair.entrada.registrado_em);
    const entradaMinutes = entradaDate.getHours() * 60 + entradaDate.getMinutes();
    atrasoMinutes = Math.max(0, entradaMinutes - expectedStart - tolerance);
  }

  const complete =
    jornada === "2_batidas"
      ? Boolean(pair.entrada && pair.saida)
      : Boolean(pair.entrada && pair.saidaIntervalo && pair.retornoIntervalo && pair.saida);

  return {
    collaboratorId: collaborator.id,
    collaboratorNome: collaborator.nome,
    day: dayKey(sorted[0].registrado_em),
    pair,
    workedMinutes,
    intervalMinutes,
    expectedMinutes,
    saldoMinutes,
    atrasoMinutes,
    extraMinutes,
    open,
    complete,
  };
}

export function buildDaySummaries(
  entries: TimeEntry[],
  collaborators: PontoCollaborator[],
  rangeStart?: string,
  rangeEnd?: string,
  now = new Date(),
): DaySummary[] {
  const byId = new Map(collaborators.map((c) => [c.id, c]));
  const groups = new Map<string, TimeEntry[]>();

  for (const entry of entries) {
    if (!byId.has(entry.collaborator_id)) continue;
    const key = `${entry.collaborator_id}|${dayKey(entry.registrado_em)}`;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const summaries: DaySummary[] = [];
  for (const list of groups.values()) {
    const collaborator = byId.get(list[0].collaborator_id);
    if (!collaborator) continue;
    const summary = summarizeDay(collaborator, list, now);
    if (!summary) continue;
    if (rangeStart && summary.day < rangeStart) continue;
    if (rangeEnd && summary.day > rangeEnd) continue;
    summaries.push(summary);
  }

  return summaries.sort((a, b) => {
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    return a.collaboratorNome.localeCompare(b.collaboratorNome);
  });
}

export function aggregateByCollaborator(days: DaySummary[]): CollaboratorSummary[] {
  const map = new Map<string, CollaboratorSummary>();
  for (const day of days) {
    const current = map.get(day.collaboratorId);
    if (current) {
      current.workedMinutes += day.workedMinutes;
      current.expectedMinutes += day.expectedMinutes;
      current.saldoMinutes += day.saldoMinutes;
      current.atrasoMinutes += day.atrasoMinutes;
      current.extraMinutes += day.extraMinutes;
      current.daysWorked += 1;
      if (day.open) current.openDays += 1;
      else if (!day.complete) current.incompleteDays += 1;
    } else {
      map.set(day.collaboratorId, {
        collaboratorId: day.collaboratorId,
        collaboratorNome: day.collaboratorNome,
        workedMinutes: day.workedMinutes,
        expectedMinutes: day.expectedMinutes,
        saldoMinutes: day.saldoMinutes,
        atrasoMinutes: day.atrasoMinutes,
        extraMinutes: day.extraMinutes,
        daysWorked: 1,
        openDays: day.open ? 1 : 0,
        incompleteDays: day.complete || day.open ? 0 : 1,
        bancoHorasAtual: 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.collaboratorNome.localeCompare(b.collaboratorNome),
  );
}

/** Status visual do dia: completo, em aberto (sem saída) ou incompleto. */
export function dayStatus(day: DaySummary): "completo" | "aberto" | "incompleto" {
  if (day.complete) return "completo";
  if (day.open) return "aberto";
  return "incompleto";
}

export function isPunchLocked(lastEntry: TimeEntry | undefined, cooldownSeconds = 90): boolean {
  if (!lastEntry) return false;
  const diff = (Date.now() - parseISO(lastEntry.registrado_em).getTime()) / 1000;
  return diff >= 0 && diff < cooldownSeconds;
}
