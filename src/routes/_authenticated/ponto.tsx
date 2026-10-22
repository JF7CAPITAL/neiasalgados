import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Clock3,
  Download,
  ExternalLink,
  History,
  Loader2,
  Plus,
  Printer,
  ScanFace,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, KpiCard, EmptyState } from "@/components/erp/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SignedPhoto } from "@/components/ponto/SignedPhoto";
import { BiometriaPanel } from "@/components/ponto/BiometriaPanel";
import { useAuth, hasAccess } from "@/lib/auth";
import { useRealtime } from "@/hooks/useRealtime";
import { logActivity } from "@/lib/db";
import { downloadXLSX, printReport } from "@/lib/export";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  aggregateByCollaborator,
  buildDaySummaries,
  dayKey,
  dayStatus,
  fmtDay,
  fmtMinutes,
  fmtSignedMinutes,
  fmtTime,
  TIPO_LABELS,
  ORIGEM_LABELS,
  todayKey,
  type TimeEntry,
  type TimeEntryTipo,
} from "@/lib/ponto";
import {
  closePontoPeriod,
  deleteTimeEntry,
  fetchEnrolledCollaboratorIds,
  fetchPontoCollaborators,
  fetchPontoFechamentos,
  fetchTimeEntries,
  insertTimeEntry,
} from "@/lib/ponto-db";

export const Route = createFileRoute("/_authenticated/ponto")({
  component: PontoPage,
});

const TIPO_OPTIONS: TimeEntryTipo[] = ["entrada", "saida_intervalo", "retorno_intervalo", "saida"];

function PontoPage() {
  const qc = useQueryClient();
  const { roles, userId, isLoading: authLoading } = useAuth();
  const allowed = hasAccess(roles, ["admin", "rh"]);

  const [start, setStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("espelho");

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [form, setForm] = useState({
    collaboratorId: "",
    tipo: "entrada" as TimeEntryTipo,
    registradoEm: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    motivo: "",
  });

  const [entryToDelete, setEntryToDelete] = useState<TimeEntry | null>(null);
  const [photoEntry, setPhotoEntry] = useState<TimeEntry | null>(null);
  const [biometriaOpen, setBiometriaOpen] = useState(false);
  const [biometriaCollaboratorId, setBiometriaCollaboratorId] = useState("");
  const [closeTarget, setCloseTarget] = useState<{
    id: string;
    nome: string;
    saldoMinutes: number;
    openDays: number;
    incompleteDays: number;
  } | null>(null);

  useRealtime(
    ["time_entries", "collaborators", "collaborator_faces"],
    ["time-entries", "ponto-collaborators", "ponto-enrolled", "ponto-fechamentos"],
  );

  const { data: collaborators = [], isLoading: loadingCollaborators } = useQuery({
    queryKey: ["ponto-collaborators"],
    queryFn: fetchPontoCollaborators,
  });

  const { data: entries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["time-entries", start, end],
    queryFn: () => fetchTimeEntries(start, end),
  });

  const { data: enrolledIds = new Set<string>() } = useQuery({
    queryKey: ["ponto-enrolled"],
    queryFn: fetchEnrolledCollaboratorIds,
  });

  const { data: closings = [] } = useQuery({
    queryKey: ["ponto-fechamentos", start, end],
    queryFn: () => fetchPontoFechamentos(start, end),
  });

  const collaboratorMap = useMemo(
    () => new Map(collaborators.map((c) => [c.id, c])),
    [collaborators],
  );
  const biometriaCandidates = useMemo(
    () => collaborators.filter((c) => c.status === "ativo" && c.ponto_habilitado),
    [collaborators],
  );
  const biometriaCollaborator = biometriaCollaboratorId
    ? collaboratorMap.get(biometriaCollaboratorId)
    : undefined;
  const searchLower = search.trim().toLowerCase();

  const filteredEntries = useMemo(() => {
    if (!searchLower) return entries;
    return entries.filter((entry) => {
      const collaborator = collaboratorMap.get(entry.collaborator_id);
      return (collaborator?.nome ?? "").toLowerCase().includes(searchLower);
    });
  }, [entries, collaboratorMap, searchLower]);

  const filteredCollaborators = useMemo(() => {
    if (!searchLower) return collaborators;
    return collaborators.filter((c) => c.nome.toLowerCase().includes(searchLower));
  }, [collaborators, searchLower]);

  const daySummaries = useMemo(
    () => buildDaySummaries(filteredEntries, filteredCollaborators, start, end),
    [filteredEntries, filteredCollaborators, start, end],
  );

  const collaboratorSummaries = useMemo(
    () => aggregateByCollaborator(daySummaries),
    [daySummaries],
  );

  const kpis = useMemo(() => {
    const present = collaborators.filter((c) => c.em_turno).length;
    const punchesToday = entries.filter(
      (entry) => dayKey(entry.registrado_em) === todayKey(),
    ).length;
    const worked = daySummaries.reduce((sum, day) => sum + day.workedMinutes, 0);
    const saldo = daySummaries.reduce((sum, day) => sum + day.saldoMinutes, 0);
    const atrasos = daySummaries.reduce((sum, day) => sum + day.atrasoMinutes, 0);
    const semBiometria = collaborators.filter(
      (c) => c.status === "ativo" && c.ponto_habilitado && !enrolledIds.has(c.id),
    ).length;
    return { present, punchesToday, worked, saldo, atrasos, semBiometria };
  }, [collaborators, entries, daySummaries, enrolledIds]);

  const adjust = useMutation({
    mutationFn: async () => {
      if (!form.collaboratorId) throw new Error("Selecione o colaborador.");
      if (!form.motivo.trim()) throw new Error("Informe o motivo do ajuste.");
      if (!form.registradoEm) throw new Error("Informe a data e hora do ajuste.");
      const collaborator = collaboratorMap.get(form.collaboratorId);
      await insertTimeEntry({
        collaboratorId: form.collaboratorId,
        tipo: form.tipo,
        registradoEm: new Date(form.registradoEm).toISOString(),
        origem: "ajuste",
        observacoes: form.motivo.trim(),
        ajusteMotivo: form.motivo.trim(),
        createdBy: userId,
        ajustadoPor: userId,
      });
      await logActivity("ponto", `ajustou ${TIPO_LABELS[form.tipo]}`, form.collaboratorId, {
        colaborador: collaborator?.nome,
        motivo: form.motivo.trim(),
        registrado_em: form.registradoEm,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      toast.success("Batida ajustada e registrada.");
      setAdjustOpen(false);
      setForm({
        collaboratorId: "",
        tipo: "entrada",
        registradoEm: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        motivo: "",
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeEntry = useMutation({
    mutationFn: async (entry: TimeEntry) => {
      const collaborator = collaboratorMap.get(entry.collaborator_id);
      await deleteTimeEntry(entry);
      await logActivity("ponto", "excluiu batida de ponto", entry.collaborator_id, {
        colaborador: collaborator?.nome,
        tipo: entry.tipo,
        registrado_em: entry.registrado_em,
        origem: entry.origem,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      toast.success("Batida excluída.");
      setEntryToDelete(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeCompetence = useMutation({
    mutationFn: async (target: { id: string; nome: string; saldoMinutes: number }) => {
      const novoSaldo = await closePontoPeriod(target.id, start, end, target.saldoMinutes, userId);
      await logActivity("ponto", "fechou competência do ponto", target.id, {
        colaborador: target.nome,
        periodo_inicio: start,
        periodo_fim: end,
        saldo_minutos: target.saldoMinutes,
        novo_banco_horas: novoSaldo,
      });
      return novoSaldo;
    },
    onSuccess: (novoSaldo, target) => {
      qc.invalidateQueries({ queryKey: ["ponto-collaborators"] });
      qc.invalidateQueries({ queryKey: ["ponto-fechamentos"] });
      toast.success(
        `Competência fechada. Banco de horas de ${target.nome}: ${fmtMinutes(novoSaldo)}.`,
      );
      setCloseTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const registryRows = filteredEntries.map((entry) => {
    const collaborator = collaboratorMap.get(entry.collaborator_id);
    return {
      id: entry.id,
      dataHora: fmtDateTime(entry.registrado_em),
      colaborador: collaborator?.nome ?? "—",
      tipo: TIPO_LABELS[entry.tipo as TimeEntryTipo] ?? entry.tipo,
      origem: ORIGEM_LABELS[entry.origem] ?? entry.origem,
      confianca:
        entry.confianca !== null ? `${(100 - Number(entry.confianca) * 100).toFixed(1)}%` : "—",
    };
  });

  const espelhoRows = daySummaries.map((day) => {
    const status = dayStatus(day);
    return {
      dia: fmtDay(day.day),
      colaborador: day.collaboratorNome,
      entrada: fmtTime(day.pair.entrada?.registrado_em),
      saidaIntervalo: fmtTime(day.pair.saidaIntervalo?.registrado_em),
      retorno: fmtTime(day.pair.retornoIntervalo?.registrado_em),
      saida: fmtTime(day.pair.saida?.registrado_em),
      intervalo: fmtMinutes(day.intervalMinutes),
      trabalhado: fmtMinutes(day.workedMinutes),
      saldo: fmtSignedMinutes(day.saldoMinutes),
      status: status === "completo" ? "Completo" : status === "aberto" ? "Em aberto" : "Incompleto",
      statusKey: status,
    };
  });

  const bancoRows = collaboratorSummaries.map((summary) => {
    const collaborator = collaboratorMap.get(summary.collaboratorId);
    return {
      ...summary,
      bancoAtual: Number(collaborator?.banco_horas) || 0,
    };
  });

  function handleExport() {
    downloadXLSX(`ponto-${start}-a-${end}`, [
      {
        name: "Registros",
        headers: [
          { key: "dataHora", label: "Data/Hora" },
          { key: "colaborador", label: "Colaborador" },
          { key: "tipo", label: "Tipo" },
          { key: "origem", label: "Origem" },
          { key: "confianca", label: "Confiança" },
        ],
        rows: registryRows,
      },
      {
        name: "Espelho de ponto",
        headers: [
          { key: "dia", label: "Dia" },
          { key: "colaborador", label: "Colaborador" },
          { key: "entrada", label: "Entrada" },
          { key: "saidaIntervalo", label: "Saída intervalo" },
          { key: "retorno", label: "Retorno" },
          { key: "saida", label: "Saída" },
          { key: "intervalo", label: "Intervalo" },
          { key: "trabalhado", label: "Trabalhado" },
          { key: "saldo", label: "Saldo" },
          { key: "status", label: "Status" },
        ],
        rows: espelhoRows,
      },
      {
        name: "Banco de horas",
        headers: [
          { key: "colaborador", label: "Colaborador" },
          { key: "dias", label: "Dias" },
          { key: "trabalhado", label: "Trabalhado" },
          { key: "esperado", label: "Esperado" },
          { key: "saldo", label: "Saldo período" },
          { key: "atrasos", label: "Atrasos" },
          { key: "extras", label: "Extras" },
          { key: "banco", label: "Banco atual" },
        ],
        rows: bancoRows.map((row) => ({
          colaborador: row.collaboratorNome,
          dias: String(row.daysWorked),
          trabalhado: fmtMinutes(row.workedMinutes),
          esperado: fmtMinutes(row.expectedMinutes),
          saldo: fmtSignedMinutes(row.saldoMinutes),
          atrasos: fmtMinutes(row.atrasoMinutes),
          extras: fmtMinutes(row.extraMinutes),
          banco: fmtMinutes(row.bancoAtual),
        })),
      },
    ]);
  }

  function handlePrint() {
    printReport(`Espelho de Ponto · ${fmtDate(start)} a ${fmtDate(end)}`, espelhoRows, [
      { key: "dia", label: "Dia" },
      { key: "colaborador", label: "Colaborador" },
      { key: "entrada", label: "Entrada" },
      { key: "saidaIntervalo", label: "Saída int." },
      { key: "retorno", label: "Retorno" },
      { key: "saida", label: "Saída" },
      { key: "intervalo", label: "Intervalo" },
      { key: "trabalhado", label: "Trabalhado" },
      { key: "saldo", label: "Saldo" },
      { key: "status", label: "Status" },
    ]);
  }

  if (authLoading) {
    return <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />;
  }

  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Acesso restrito"
        description="O controle de ponto está disponível para administradores e RH."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de Ponto"
        subtitle="Registros faciais, espelho de ponto e banco de horas"
        icon={ScanFace}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/quiosque" target="_blank">
                <Camera className="mr-1.5 size-4" /> Registrar ponto{" "}
                <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-1.5 size-4" /> Imprimir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!daySummaries.length}
            >
              <Download className="mr-1.5 size-4" /> Exportar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBiometriaCollaboratorId("");
                setBiometriaOpen(true);
              }}
            >
              <ScanFace className="mr-1.5 size-4" /> Biometria
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setForm({
                  collaboratorId: "",
                  tipo: "entrada",
                  registradoEm: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
                  motivo: "",
                });
                setAdjustOpen(true);
              }}
            >
              <Plus className="mr-1.5 size-4" /> Ajuste manual
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Presentes agora"
          value={kpis.present}
          icon={Users}
          tone="success"
          hint="Colaboradores em turno"
        />
        <KpiCard
          label="Batidas hoje"
          value={kpis.punchesToday}
          icon={Clock3}
          tone="info"
          hint="Registros do dia"
        />
        <KpiCard
          label="Horas no período"
          value={fmtMinutes(kpis.worked)}
          icon={CalendarDays}
          hint={`${fmtDate(start)} a ${fmtDate(end)}`}
        />
        <KpiCard
          label="Saldo do período"
          value={fmtSignedMinutes(kpis.saldo)}
          icon={History}
          tone={kpis.saldo < 0 ? "warning" : "success"}
          hint="Trabalhado − carga horária"
        />
        <KpiCard
          label="Atrasos"
          value={fmtMinutes(kpis.atrasos)}
          icon={AlertTriangle}
          tone={kpis.atrasos > 0 ? "danger" : "default"}
          hint="Acima da tolerância"
        />
      </div>

      {kpis.semBiometria > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <span>
              <strong>{kpis.semBiometria}</strong> colaborador(es) ativo(s) sem biometria facial
              cadastrada.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBiometriaCollaboratorId("");
              setBiometriaOpen(true);
            }}
          >
            <ScanFace className="mr-1.5 size-4" /> Cadastrar biometria
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar colaborador..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="espelho">Espelho de ponto</TabsTrigger>
          <TabsTrigger value="registros">Registros ({filteredEntries.length})</TabsTrigger>
          <TabsTrigger value="banco">Banco de horas</TabsTrigger>
          <TabsTrigger value="fechamentos">Fechamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="espelho" className="mt-4">
          {loadingCollaborators || loadingEntries ? (
            <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
          ) : espelhoRows.length === 0 ? (
            <EmptyState
              icon={ScanFace}
              title="Nenhum ponto no período"
              description="Ajuste o período ou registre uma batida no quiosque."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Saída int.</TableHead>
                    <TableHead>Retorno</TableHead>
                    <TableHead>Saída</TableHead>
                    <TableHead>Intervalo</TableHead>
                    <TableHead>Trabalhado</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {espelhoRows.map((row, index) => (
                    <TableRow key={`${row.dia}-${row.colaborador}-${index}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.dia}
                      </TableCell>
                      <TableCell className="font-medium">{row.colaborador}</TableCell>
                      <TableCell className="tabular-nums">{row.entrada}</TableCell>
                      <TableCell className="tabular-nums">{row.saidaIntervalo}</TableCell>
                      <TableCell className="tabular-nums">{row.retorno}</TableCell>
                      <TableCell className="tabular-nums">{row.saida}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.intervalo}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium">{row.trabalhado}</TableCell>
                      <TableCell
                        className={
                          "tabular-nums font-medium " +
                          (row.saldo.startsWith("-") ? "text-destructive" : "text-success")
                        }
                      >
                        {row.saldo}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.statusKey === "completo"
                              ? "border-success/30 text-success"
                              : row.statusKey === "aberto"
                                ? "border-info/30 text-info"
                                : "border-warning/30 text-warning"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="registros" className="mt-4">
          {loadingEntries ? (
            <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
          ) : filteredEntries.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title="Nenhuma batida registrada"
              description="As batidas do quiosque aparecem aqui em tempo real."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Confiança</TableHead>
                    <TableHead>Foto</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtDateTime(entry.registrado_em)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {collaboratorMap.get(entry.collaborator_id)?.nome ?? "—"}
                      </TableCell>
                      <TableCell>
                        {TIPO_LABELS[entry.tipo as TimeEntryTipo] ?? entry.tipo}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {ORIGEM_LABELS[entry.origem] ?? entry.origem}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {entry.confianca !== null
                          ? `${(100 - Number(entry.confianca) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setPhotoEntry(entry)}
                          className="block transition-opacity hover:opacity-80"
                          title="Ver foto da batida"
                        >
                          <SignedPhoto
                            path={entry.foto_path}
                            alt="Foto da batida"
                            className="size-10"
                          />
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setEntryToDelete(entry)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="banco" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            O saldo do período é calculado em minutos (horas trabalhadas − carga horária diária nos
            dias com registro). Fechar a competência soma esse saldo ao banco de horas do
            colaborador e grava um histórico, sem alterar a folha.
          </p>
          {bancoRows.length === 0 ? (
            <EmptyState
              icon={History}
              title="Sem saldo no período"
              description="Nenhum dia com registros para calcular o banco de horas."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Dias</TableHead>
                    <TableHead>Trabalhado</TableHead>
                    <TableHead>Esperado</TableHead>
                    <TableHead>Saldo período</TableHead>
                    <TableHead>Atrasos</TableHead>
                    <TableHead>Extras</TableHead>
                    <TableHead>Banco atual</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bancoRows.map((row) => (
                    <TableRow key={row.collaboratorId}>
                      <TableCell className="font-medium">{row.collaboratorNome}</TableCell>
                      <TableCell className="tabular-nums">{row.daysWorked}</TableCell>
                      <TableCell className="tabular-nums">
                        {fmtMinutes(row.workedMinutes)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {fmtMinutes(row.expectedMinutes)}
                      </TableCell>
                      <TableCell
                        className={
                          "tabular-nums font-medium " +
                          (row.saldoMinutes < 0 ? "text-destructive" : "text-success")
                        }
                      >
                        {fmtSignedMinutes(row.saldoMinutes)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {fmtMinutes(row.atrasoMinutes)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {fmtMinutes(row.extraMinutes)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fmtMinutes(row.bancoAtual)}
                        {closings.some((c) => c.collaborator_id === row.collaboratorId) && (
                          <ShieldCheck className="ml-1 inline size-3 text-success" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={closeCompetence.isPending}
                          onClick={() =>
                            setCloseTarget({
                              id: row.collaboratorId,
                              nome: row.collaboratorNome,
                              saldoMinutes: row.saldoMinutes,
                              openDays: row.openDays,
                              incompleteDays: row.incompleteDays,
                            })
                          }
                        >
                          Fechar competência
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="fechamentos" className="mt-4">
          {closings.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nenhum fechamento no período"
              description="Feche uma competência na aba Banco de horas."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fechado em</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Saldo aplicado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closings.map((closing) => (
                    <TableRow key={closing.id}>
                      <TableCell className="text-muted-foreground">
                        {fmtDateTime(closing.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {collaboratorMap.get(closing.collaborator_id)?.nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtDay(closing.periodo_inicio)} a {fmtDay(closing.periodo_fim)}
                      </TableCell>
                      <TableCell
                        className={
                          "tabular-nums font-medium " +
                          (closing.saldo_minutos < 0 ? "text-destructive" : "text-success")
                        }
                      >
                        {fmtSignedMinutes(closing.saldo_minutos)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={biometriaOpen}
        onOpenChange={(open) => {
          setBiometriaOpen(open);
          if (!open) setBiometriaCollaboratorId("");
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastrar biometria facial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Colaborador</Label>
              <Select value={biometriaCollaboratorId} onValueChange={setBiometriaCollaboratorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o colaborador..." />
                </SelectTrigger>
                <SelectContent>
                  {biometriaCandidates.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      Nenhum colaborador ativo com ponto habilitado
                    </SelectItem>
                  ) : (
                    biometriaCandidates.map((collaborator) => (
                      <SelectItem key={collaborator.id} value={collaborator.id}>
                        {collaborator.nome}
                        {enrolledIds.has(collaborator.id)
                          ? " — biometria ativa"
                          : " — sem biometria"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {biometriaCollaborator ? (
              <BiometriaPanel
                key={biometriaCollaborator.id}
                collaboratorId={biometriaCollaborator.id}
                collaboratorNome={biometriaCollaborator.nome}
                consentAt={biometriaCollaborator.biometria_consentimento_em}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["ponto-enrolled"] });
                  qc.invalidateQueries({ queryKey: ["ponto-collaborators"] });
                }}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <ScanFace className="mx-auto mb-2 size-10 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">
                  Selecione um colaborador para cadastrar ou atualizar a biometria facial.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajuste manual de ponto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Colaborador</Label>
              <Select
                value={form.collaboratorId}
                onValueChange={(value) => setForm({ ...form, collaboratorId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {collaborators.map((collaborator) => (
                    <SelectItem key={collaborator.id} value={collaborator.id}>
                      {collaborator.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(value) => setForm({ ...form, tipo: value as TimeEntryTipo })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPO_OPTIONS.map((tipo) => (
                      <SelectItem key={tipo} value={tipo}>
                        {TIPO_LABELS[tipo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data e hora</Label>
                <Input
                  type="datetime-local"
                  value={form.registradoEm}
                  onChange={(e) => setForm({ ...form, registradoEm: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo do ajuste (obrigatório)</Label>
              <Textarea
                value={form.motivo}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Ex.: esqueceu de bater o ponto na saída"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => adjust.mutate()} disabled={adjust.isPending}>
              {adjust.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Registrar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(photoEntry)} onOpenChange={(open) => !open && setPhotoEntry(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto da batida</DialogTitle>
          </DialogHeader>
          {photoEntry && (
            <div className="space-y-2">
              <SignedPhoto
                path={photoEntry.foto_path}
                alt="Foto da batida"
                className="aspect-square w-full"
              />
              <p className="text-xs text-muted-foreground">
                {collaboratorMap.get(photoEntry.collaborator_id)?.nome ?? "—"} ·{" "}
                {fmtDateTime(photoEntry.registrado_em)}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(entryToDelete)}
        onOpenChange={(open) => !open && setEntryToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta batida?</AlertDialogTitle>
            <AlertDialogDescription>
              A exclusão é registrada no histórico de atividades e remove também a foto vinculada.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => entryToDelete && removeEntry.mutate(entryToDelete)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(closeTarget)}
        onOpenChange={(open) => !open && setCloseTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar competência?</AlertDialogTitle>
            <AlertDialogDescription>
              O saldo de{" "}
              <strong>{closeTarget ? fmtSignedMinutes(closeTarget.saldoMinutes) : ""}</strong> será
              somado ao banco de horas de <strong>{closeTarget?.nome}</strong> no período de{" "}
              {fmtDate(start)} a {fmtDate(end)}. Não será possível fechar o mesmo período duas
              vezes.
              {closeTarget && closeTarget.openDays + closeTarget.incompleteDays > 0 && (
                <span className="mt-2 block rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  Atenção: há {closeTarget.openDays} dia(s) em aberto e {closeTarget.incompleteDays}{" "}
                  dia(s) incompleto(s) neste período. Revise o espelho de ponto antes de fechar,
                  pois esses dias entram no saldo.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeTarget && closeCompetence.mutate(closeTarget)}
              disabled={closeCompetence.isPending}
            >
              Confirmar fechamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
