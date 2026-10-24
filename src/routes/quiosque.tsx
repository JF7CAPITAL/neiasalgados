import { useEffect, useRef, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CheckCircle2,
  Clock3,
  Expand,
  Loader2,
  LogOut,
  ScanFace,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, hasAccess } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { CameraView } from "@/components/ponto/CameraView";
import { Button } from "@/components/ui/button";
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
import {
  cropFaceBlob,
  detectLargestFace,
  findBestMatch,
  loadFaceModels,
  type DetectedFace,
  type FaceMatch,
} from "@/lib/face";
import {
  fetchPontoCollaborators,
  fetchTodayEntries,
  insertTimeEntry,
  loadFaceGallery,
  removePontoPhoto,
  updateCollaboratorPresence,
  uploadPontoPhoto,
} from "@/lib/ponto-db";
import {
  TIPO_LABELS,
  fmtTime,
  isPunchLocked,
  nextPunchType,
  normalizeJornada,
  todayKey,
  type PontoCollaborator,
  type TimeEntryTipo,
} from "@/lib/ponto";

export const Route = createFileRoute("/quiosque")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: QuiosquePage,
});

type KioskPhase = "loading" | "ready" | "recognizing" | "success" | "error";

interface PunchResult {
  name: string;
  tipoLabel: string;
  time: string;
  photoUrl: string | null;
  distance: number | null;
  completed?: boolean;
}

function playChime() {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const notes = [880, 1174.66];
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + index * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + index * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.16 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + index * 0.16);
      osc.stop(ctx.currentTime + index * 0.16 + 0.3);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // som é opcional
  }
}

function QuiosquePage() {
  const navigate = useNavigate();
  const { roles, isLoading: authLoading } = useAuth();
  const allowed = hasAccess(roles, ["admin", "rh"]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const phaseRef = useRef<KioskPhase>("loading");
  const galleryRef = useRef<GalleryFace[]>([]);
  const collaboratorsRef = useRef<Map<string, PontoCollaborator>>(new Map());
  const resetTimerRef = useRef<number | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  const [phase, setPhaseState] = useState<KioskPhase>("loading");
  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [galleryCount, setGalleryCount] = useState(0);
  const [statusText, setStatusText] = useState("Inicializando quiosque...");
  const [clock, setClock] = useState(new Date());
  const [result, setResult] = useState<PunchResult | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function setPhase(next: KioskPhase) {
    phaseRef.current = next;
    setPhaseState(next);
  }

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setStatusText("Carregando biometrias...");
        const [gallery, collaborators] = await Promise.all([
          loadFaceGallery(true),
          fetchPontoCollaborators(),
        ]);
        if (cancelled) return;
        galleryRef.current = gallery;
        collaboratorsRef.current = new Map(collaborators.map((c) => [c.id, c]));
        setGalleryCount(gallery.length);

        setStatusText("Carregando modelos faciais...");
        await loadFaceModels("tiny");
        if (cancelled) return;
        setModelsReady(true);
        setPhase("ready");
        setStatusText(
          gallery.length
            ? "Posicione seu rosto no centro do círculo"
            : "Nenhuma biometria cadastrada. Procure o RH para cadastrar.",
        );
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        setStatusText(error instanceof Error ? error.message : "Falha ao inicializar o quiosque.");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!modelsReady) return;
    let cancelled = false;

    async function refresh() {
      try {
        const [gallery, collaborators] = await Promise.all([
          loadFaceGallery(true),
          fetchPontoCollaborators(),
        ]);
        if (cancelled) return;
        galleryRef.current = gallery;
        collaboratorsRef.current = new Map(collaborators.map((c) => [c.id, c]));
        setGalleryCount(gallery.length);
      } catch {
        // mantém a galeria anterior
      }
    }

    const interval = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [modelsReady]);

  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    async function requestWakeLock() {
      try {
        const wakeLock = (
          navigator as unknown as {
            wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        if (!wakeLock) return;
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          await lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
      } catch {
        // wake lock é opcional
      }
    }

    void requestWakeLock();
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  function resetKiosk() {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setResult(null);
    setPhase("ready");
    setStatusText("Posicione seu rosto no centro do círculo");
  }

  function showResult(data: PunchResult) {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = data.photoUrl;
    setResult(data);
    setPhase("success");
    setStatusText("Ponto registrado!");
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(resetKiosk, 9000);
  }

  async function registerPunch(match: FaceMatch, face: DetectedFace, video: HTMLVideoElement) {
    setPhase("recognizing");
    setStatusText(`Reconhecendo ${match.face.collaboratorName}...`);
    let uploadedPath: string | null = null;

    try {
      const collaborator = collaboratorsRef.current.get(match.face.collaboratorId);
      if (!collaborator) throw new Error("Colaborador não encontrado.");
      if (!collaborator.ponto_habilitado)
        throw new Error("Colaborador desabilitado para registro de ponto.");

      const today = await fetchTodayEntries(collaborator.id);
      const sorted = [...today].sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
      const lastEntry = sorted[sorted.length - 1];

      if (isPunchLocked(lastEntry, 90)) {
        setPhase("ready");
        setStatusText("Batida recente detectada. Aguarde alguns segundos.");
        return;
      }

      const tipo = nextPunchType(today, normalizeJornada(collaborator.ponto_tipo_jornada));
      if (!tipo) {
        showResult({
          name: collaborator.nome,
          tipoLabel: "Jornada já concluída hoje",
          time: fmtTime(lastEntry?.registrado_em ?? new Date().toISOString()),
          photoUrl: null,
          distance: null,
          completed: true,
        });
        return;
      }

      const blob = await cropFaceBlob(video, face.box, 320, 0.65);
      const fotoPath = await uploadPontoPhoto(collaborator.id, blob, "batida");
      uploadedPath = fotoPath;

      await insertTimeEntry({
        collaboratorId: collaborator.id,
        tipo,
        origem: "facial",
        confianca: Number(match.distance.toFixed(3)),
        dispositivo: `${navigator.platform || "web"} · ${navigator.userAgent.slice(0, 140)}`,
        fotoPath,
      });

      await updateCollaboratorPresence(collaborator.id, tipo !== "saida");
      await logActivity(
        "ponto",
        `registrou ${TIPO_LABELS[tipo as TimeEntryTipo]}`,
        collaborator.id,
        {
          origem: "facial",
          confianca: Number(match.distance.toFixed(3)),
          dia: todayKey(),
        },
      );

      playChime();
      showResult({
        name: collaborator.nome,
        tipoLabel: TIPO_LABELS[tipo as TimeEntryTipo],
        time: fmtTime(new Date().toISOString()),
        photoUrl: URL.createObjectURL(blob),
        distance: match.distance,
      });
    } catch (error) {
      if (uploadedPath) void removePontoPhoto(uploadedPath);
      setPhase("error");
      setStatusText(
        error instanceof Error ? error.message : "Falha ao registrar o ponto. Procure o RH.",
      );
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(resetKiosk, 7000);
    }
  }

  useEffect(() => {
    if (!cameraReady || !modelsReady || phase !== "ready") return;

    let stopped = false;
    let busy = false;
    let lastCollaborator: string | null = null;
    let consecutive = 0;

    const interval = window.setInterval(async () => {
      if (stopped || busy || phaseRef.current !== "ready") return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      if (!galleryRef.current.length) return;

      busy = true;
      try {
        const face = await detectLargestFace(video, "tiny");
        if (stopped || phaseRef.current !== "ready") return;

        if (!face) {
          lastCollaborator = null;
          consecutive = 0;
          setStatusText("Posicione seu rosto no centro do círculo");
          return;
        }

        const match = findBestMatch(face.descriptor, galleryRef.current);
        if (!match) {
          lastCollaborator = null;
          consecutive = 0;
          setStatusText("Não reconhecido. Tente novamente ou procure o RH.");
          return;
        }

        if (match.face.collaboratorId === lastCollaborator) {
          consecutive += 1;
        } else {
          lastCollaborator = match.face.collaboratorId;
          consecutive = 1;
        }

        if (consecutive < 3) {
          setStatusText(`Reconhecendo ${match.face.collaboratorName}...`);
          return;
        }

        consecutive = 0;
        lastCollaborator = null;
        await registerPunch(match, face, video);
      } catch {
        if (!stopped) setStatusText("Não foi possível analisar a imagem. Tente novamente.");
      } finally {
        busy = false;
      }
    }, 420);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, modelsReady, phase]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // alguns navegadores bloqueiam
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#08080c] text-white">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#08080c] px-6 text-center text-white">
        <ShieldAlert className="size-12 text-destructive" />
        <h1 className="font-display text-2xl font-semibold">Acesso restrito</h1>
        <p className="max-w-sm text-sm text-white/60">
          O quiosque de ponto deve ser aberto por um usuário com perfil de Administrador ou RH.
        </p>
        <Button variant="secondary" onClick={() => navigate({ to: "/painel" })}>
          Voltar ao sistema
        </Button>
      </div>
    );
  }

  const statusTone =
    phase === "success"
      ? "text-success"
      : phase === "error"
        ? "text-destructive"
        : phase === "recognizing"
          ? "text-info"
          : "text-white/60";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#08080c] text-white">
      <div className="pointer-events-none absolute -left-32 top-0 size-[420px] rounded-full bg-primary/20 blur-[140px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 size-[380px] rounded-full bg-info/10 blur-[120px]" />

      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <img src="/neia-logo.png" alt="Neia Salgados" className="h-11 w-auto object-contain" />
          <div className="hidden sm:block">
            <p className="text-sm font-semibold tracking-wide">Controle de Ponto</p>
            <p className="text-[11px] text-white/50">Reconhecimento facial</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-display text-3xl font-semibold tabular-nums leading-none sm:text-4xl">
              {format(clock, "HH:mm:ss")}
            </p>
            <p className="text-[11px] capitalize text-white/50">
              {format(clock, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/50 hover:bg-white/10 hover:text-white"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            <Expand className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/50 hover:bg-white/10 hover:text-white"
            onClick={() => setExitOpen(true)}
          >
            <LogOut className="mr-1.5 size-4" /> Sair
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-6 px-5 pb-8 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
        <div className="relative">
          <CameraView
            videoRef={videoRef}
            active
            onReady={() => {
              setCameraReady(true);
              if (phaseRef.current === "error") {
                setPhase("ready");
                setStatusText("Posicione seu rosto no centro do círculo");
              }
            }}
            onError={(message) => {
              setPhase("error");
              setStatusText(message);
            }}
            className="aspect-[4/3] w-full shadow-2xl shadow-black/60"
            overlay={
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={
                    "h-[64%] w-[46%] rounded-[50%] border-2 transition-all duration-300 " +
                    (phase === "success"
                      ? "border-success shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                      : phase === "recognizing"
                        ? "animate-pulse border-info shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                        : "border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]")
                  }
                />
              </div>
            }
          />
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/70 backdrop-blur">
            <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-success" />
            câmera ao vivo
          </div>
        </div>

        <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
          {result ? (
            <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center gap-4">
                {result.photoUrl ? (
                  <img
                    src={result.photoUrl}
                    alt={result.name}
                    className="size-20 rounded-2xl border border-white/10 object-cover"
                  />
                ) : (
                  <div className="flex size-20 items-center justify-center rounded-2xl bg-success/15 text-success">
                    <CheckCircle2 className="size-9" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-2xl font-semibold">{result.name}</p>
                  <p className="text-sm text-white/60">
                    {result.tipoLabel} · {result.time}
                  </p>
                  {result.distance !== null && (
                    <p className="mt-1 text-[11px] text-white/40">
                      Confiança do match: {(100 - result.distance * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {result.completed ? "Jornada concluída por hoje." : "Ponto registrado com sucesso."}
              </div>
            </div>
          ) : (
            <div className="w-full space-y-5">
              <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary lg:mx-0">
                {phase === "loading" || (phase === "ready" && !modelsReady) ? (
                  <Loader2 className="size-8 animate-spin" />
                ) : phase === "recognizing" ? (
                  <ScanFace className="size-8 animate-pulse" />
                ) : phase === "error" ? (
                  <XCircle className="size-8 text-destructive" />
                ) : (
                  <ScanFace className="size-8" />
                )}
              </div>

              <div>
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  Bata seu ponto
                </h1>
                <p className="mt-2 text-base text-white/55">
                  Olhe para a câmera e aguarde a confirmação. Não é necessário tocar em nada.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm lg:justify-start">
                <Clock3 className="size-4 text-white/40" />
                <span className={statusTone}>{statusText}</span>
              </div>

              <div className="grid gap-2 text-left text-xs text-white/45 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <span className="mr-2 font-semibold text-white/70">1.</span> Retire bonés,
                  máscaras e óculos escuros.
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <span className="mr-2 font-semibold text-white/70">2.</span> Mantenha o rosto
                  centralizado e bem iluminado.
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <span className="mr-2 font-semibold text-white/70">3.</span> Se não for
                  reconhecido, procure o RH.
                </div>
              </div>

              <p className="text-[11px] text-white/30">
                {galleryCount} biometria(s) ativa(s) · registros de hoje:{" "}
                {format(clock, "dd/MM/yyyy")}
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 flex items-center justify-between border-t border-white/5 px-5 py-3 text-[11px] text-white/25 sm:px-8">
        <span>Neia Salgados · Controle de Ponto</span>
        <span>Uso exclusivo no quiosque da empresa</span>
      </footer>

      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do modo quiosque?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro de ponto será interrompido nesta tela. Confirme apenas se for autorizado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar no quiosque</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate({ to: "/ponto" })}>Sair</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
