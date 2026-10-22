import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CheckCircle2,
  Loader2,
  ScanFace,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CameraView } from "@/components/ponto/CameraView";
import { SignedPhoto } from "@/components/ponto/SignedPhoto";
import { useAuth } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { cropFaceBlob, detectLargestFace, loadFaceModels } from "@/lib/face";
import {
  deleteAllFaceSamples,
  deleteFaceSample,
  fetchFaceSamples,
  invalidateFaceGallery,
  registerBiometricConsent,
  saveFaceEnrollment,
  type FaceSample,
} from "@/lib/ponto-db";

const REQUIRED_SAMPLES = 3;
const PROMPTS = [
  "Olhe de frente para a câmera",
  "Vire levemente para a esquerda",
  "Vire levemente para a direita",
];

interface PendingSample {
  descriptor: number[];
  fotoBlob: Blob;
  url: string;
}

export function BiometriaPanel({
  collaboratorId,
  collaboratorNome,
  consentAt,
  onSaved,
}: {
  collaboratorId: string;
  collaboratorNome: string;
  consentAt: string | null | undefined;
  onSaved?: () => void;
}) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [detected, setDetected] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [consentChecked, setConsentChecked] = useState(Boolean(consentAt));
  const [pending, setPending] = useState<PendingSample[]>([]);
  const pendingUrls = useRef<string[]>([]);

  const {
    data: samples = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["collaborator-faces", collaboratorId],
    queryFn: () => fetchFaceSamples(collaboratorId),
    enabled: !!collaboratorId,
  });

  const removeSample = useMutation({
    mutationFn: (sample: FaceSample) => deleteFaceSample(sample),
    onSuccess: async () => {
      await refetch();
      invalidateFaceGallery();
      void logActivity("ponto", "removeu amostra de biometria", collaboratorId, {
        colaborador: collaboratorNome,
      });
      toast.success("Amostra removida.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeAll = useMutation({
    mutationFn: () => deleteAllFaceSamples(collaboratorId),
    onSuccess: async () => {
      await refetch();
      invalidateFaceGallery();
      void logActivity("ponto", "removeu toda a biometria facial", collaboratorId, {
        colaborador: collaboratorNome,
      });
      toast.success("Biometria removida. O colaborador não poderá mais bater ponto facial.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!consentChecked)
        throw new Error("É necessário registrar o consentimento para salvar a biometria.");
      if (pending.length < REQUIRED_SAMPLES)
        throw new Error(`Capture as ${REQUIRED_SAMPLES} amostras antes de salvar.`);
      if (!consentAt) await registerBiometricConsent(collaboratorId, userId);
      await saveFaceEnrollment(collaboratorId, pending, userId);
    },
    onSuccess: async () => {
      void logActivity("ponto", "cadastrou biometria facial", collaboratorId, {
        colaborador: collaboratorNome,
        amostras: pending.length,
      });
      pendingUrls.current.forEach((url) => URL.revokeObjectURL(url));
      pendingUrls.current = [];
      setPending([]);
      setCameraActive(false);
      await refetch();
      await qc.invalidateQueries({ queryKey: ["collaborators"] });
      onSaved?.();
      toast.success("Biometria cadastrada com sucesso!");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    return () => {
      pendingUrls.current.forEach((url) => URL.revokeObjectURL(url));
      pendingUrls.current = [];
    };
  }, []);

  useEffect(() => {
    if (!cameraActive) return;
    let stopped = false;
    setModelsReady(false);

    void loadFaceModels("ssd")
      .then(() => {
        if (!stopped) setModelsReady(true);
      })
      .catch((error: Error) => {
        if (!stopped) toast.error(`Falha ao carregar modelos faciais: ${error.message}`);
      });

    const interval = window.setInterval(async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        const face = await detectLargestFace(video, "tiny");
        if (!stopped) setDetected(Boolean(face));
      } catch {
        if (!stopped) setDetected(false);
      }
    }, 900);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      setDetected(false);
      setCameraReady(false);
    };
  }, [cameraActive]);

  async function captureSample() {
    const video = videoRef.current;
    if (!video || !modelsReady) {
      toast.error("Aguarde o carregamento dos modelos faciais.");
      return;
    }
    if (pending.length >= REQUIRED_SAMPLES) return;

    setCapturing(true);
    try {
      const face = await detectLargestFace(video, "ssd");
      if (!face) {
        toast.error("Não encontrei um rosto nítido. Melhore a iluminação e tente novamente.");
        return;
      }
      if (face.score < 0.6) {
        toast.error("Rosto com baixa confiança. Aproxime-se da câmera e tente novamente.");
        return;
      }
      const blob = await cropFaceBlob(video, face.box, 320, 0.65);
      const url = URL.createObjectURL(blob);
      pendingUrls.current.push(url);
      setPending((current) => [...current, { descriptor: face.descriptor, fotoBlob: blob, url }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao capturar a biometria.");
    } finally {
      setCapturing(false);
    }
  }

  function removePending(index: number) {
    setPending((current) => {
      const target = current[index];
      if (target) {
        URL.revokeObjectURL(target.url);
        pendingUrls.current = pendingUrls.current.filter((url) => url !== target.url);
      }
      return current.filter((_, i) => i !== index);
    });
  }

  const hasSaved = samples.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ScanFace className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Reconhecimento facial</p>
            <p className="text-xs text-muted-foreground">
              Capture 3 amostras do rosto de {collaboratorNome || "colaborador"}. A imagem é
              recortada e compactada (JPEG 320×320, ~20 KB). O descritor facial fica vinculado ao
              cadastro e é usado apenas para registrar o ponto.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {hasSaved ? (
                <Badge variant="outline" className="border-success/30 text-success">
                  <UserRoundCheck className="mr-1 size-3" /> Biometria ativa ({samples.length}{" "}
                  amostra(s))
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Sem biometria cadastrada
                </Badge>
              )}
              {consentAt && (
                <Badge variant="outline" className="border-info/30 text-info">
                  <ShieldCheck className="mr-1 size-3" /> Consentimento em{" "}
                  {format(new Date(consentAt), "dd/MM/yyyy")}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
          <label className="flex items-start gap-3 text-xs">
            <Checkbox
              checked={consentChecked}
              onCheckedChange={(checked) => setConsentChecked(checked === true)}
              className="mt-0.5"
            />
            <span>
              Declaro que o colaborador foi informado e <strong>consentiu</strong> com a coleta e o
              uso da biometria facial exclusivamente para controle de ponto, conforme a LGPD (Lei
              13.709/2018). O consentimento pode ser revogado a qualquer momento, mediante exclusão
              da biometria e uso de registro manual pelo RH.
            </span>
          </label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3">
          {!cameraActive ? (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 text-center">
              <Camera className="size-10 text-muted-foreground" />
              <p className="max-w-xs text-xs text-muted-foreground">
                A câmera só abre durante a captura. Posicione o colaborador em local bem iluminado,
                de frente.
              </p>
              <Button variant="outline" size="sm" onClick={() => setCameraActive(true)}>
                <Camera className="mr-1.5 size-4" /> Abrir câmera
              </Button>
            </div>
          ) : (
            <CameraView
              videoRef={videoRef}
              active={cameraActive}
              onReady={() => setCameraReady(true)}
              onError={(message) => toast.error(message)}
              className="aspect-[4/3]"
              overlay={
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={
                      "h-[62%] w-[46%] rounded-[50%] border-2 transition-colors " +
                      (detected
                        ? "border-success/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                        : "border-white/50")
                    }
                  />
                </div>
              }
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={captureSample}
              disabled={
                !cameraActive ||
                !cameraReady ||
                !modelsReady ||
                capturing ||
                pending.length >= REQUIRED_SAMPLES
              }
            >
              {capturing || !modelsReady ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <ScanFace className="mr-1.5 size-4" />
              )}
              Capturar amostra ({pending.length}/{REQUIRED_SAMPLES})
            </Button>
            {cameraActive && (
              <Button size="sm" variant="ghost" onClick={() => setCameraActive(false)}>
                Fechar câmera
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {modelsReady
              ? pending.length < REQUIRED_SAMPLES
                ? PROMPTS[pending.length]
                : "Amostras suficientes. Salve a biometria."
              : "Carregando modelos de reconhecimento..."}
          </p>

          {pending.length > 0 && (
            <div className="flex gap-2">
              {pending.map((sample, index) => (
                <div key={sample.url} className="relative">
                  <img
                    src={sample.url}
                    alt={`Amostra ${index + 1}`}
                    className="size-16 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePending(index)}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-white"
                    aria-label="Remover amostra"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 size-4" />
                )}
                Salvar biometria
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Amostras cadastradas</Label>
            {hasSaved && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (window.confirm("Remover toda a biometria deste colaborador?"))
                    removeAll.mutate();
                }}
                disabled={removeAll.isPending}
              >
                Remover tudo
              </Button>
            )}
          </div>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : samples.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhuma amostra salva ainda.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {samples.map((sample) => (
                <div key={sample.id} className="relative">
                  <SignedPhoto
                    path={sample.foto_path}
                    alt="Amostra facial"
                    className="aspect-square w-full"
                  />
                  <button
                    type="button"
                    onClick={() => removeSample.mutate(sample)}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-white"
                    aria-label="Remover amostra"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
