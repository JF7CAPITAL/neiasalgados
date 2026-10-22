import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { CameraOff, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  mirrored?: boolean;
  className?: string;
  overlay?: ReactNode;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function CameraView({
  videoRef,
  active,
  mirrored = true,
  className,
  overlay,
  onReady,
  onError,
}: CameraViewProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;

    async function start() {
      setStatus("loading");
      setMessage("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Este navegador não suporta acesso à câmera.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const videoEl = video;
        if (!videoEl) throw new Error("Elemento de vídeo indisponível.");
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => undefined);
        if (!cancelled) {
          setStatus("ready");
          onReady?.();
        }
      } catch (error) {
        if (cancelled) return;
        const msg =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Permissão de câmera negada. Libere o acesso nas configurações do navegador."
            : error instanceof Error
              ? error.message
              : "Não foi possível abrir a câmera.";
        setMessage(msg);
        setStatus("error");
        onError?.(msg);
      }
    }

    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempt, videoRef]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-black",
        className,
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn("h-full w-full object-cover", mirrored && "scale-x-[-1]")}
      />
      {overlay}

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm text-white">
          <Loader2 className="size-6 animate-spin" />
          Abrindo câmera...
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center text-white">
          <CameraOff className="size-8 text-destructive" />
          <p className="max-w-xs text-sm">{message}</p>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw className="mr-1.5 size-4" /> Tentar novamente
          </Button>
        </div>
      )}
    </div>
  );
}
