"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, AlertTriangle, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface KeywordAlert {
  id: string;
  phone: string;
  nome: string;
  ruleName: string;
  message: string;
  timestamp: string;
}

export function AlertPopup() {
  const [alerts, setAlerts] = useState<KeywordAlert[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const pendingSoundRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    const audio = new Audio("/sounds/service-bell.mp3");
    audio.loop = true;
    audio.volume = 0.5;
    audioRef.current = audio;

    // Se o navegador bloquear o autoplay (política de mídia), toca assim
    // que o operador interagir com a página.
    if (pendingSoundRef.current) tryPlay(audio);

    const handleInteraction = () => {
      if (pendingSoundRef.current && audioRef.current) {
        tryPlay(audioRef.current);
        pendingSoundRef.current = false;
      }
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
    };
    document.addEventListener("click", handleInteraction);
    document.addEventListener("keydown", handleInteraction);

    const channel = supabase
      .channel("keyword-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: "tipo=like.keyword_alerta:%",
        },
        (payload) => {
          const newMsg = payload.new as {
            phone: string;
            chat_id: string | null;
            texto: string;
            tipo: string;
            created_at: string;
          };

          const ruleName = newMsg.tipo?.replace("keyword_alerta:", "") || "desconhecida";

          const alert: KeywordAlert = {
            id: `${newMsg.phone}-${Date.now()}`,
            phone: newMsg.phone,
            nome: formatPhoneBR(newMsg.phone),
            ruleName,
            message: newMsg.texto,
            timestamp: newMsg.created_at,
          };

          setAlerts((prev) => [...prev, alert]);
          startAlertSound();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopSound();
      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
    };
  }, []);

  function tryPlay(audio: HTMLAudioElement) {
    const p = audio.play();
    if (p) {
      p.then(() => {
        isPlayingRef.current = true;
      }).catch(() => {
        // Autoplay bloqueado: aguarda interação do usuário
        isPlayingRef.current = false;
        pendingSoundRef.current = true;
      });
    }
  }

  function startAlertSound() {
    pendingSoundRef.current = false;
    if (!isPlayingRef.current && audioRef.current) {
      tryPlay(audioRef.current);
    }
  }

  function stopSound() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    isPlayingRef.current = false;
    pendingSoundRef.current = false;
  }

  const dismissAlert = (id: string) => {
    setAlerts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      // Para o som somente quando o último alerta for fechado
      if (next.length === 0) stopSound();
      return next;
    });
  };

  const openConversation = (alert: KeywordAlert) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    stopSound();
    navigate({ to: "/mensagens", search: { phone: alert.phone } });
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-[380px]">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-destructive/95 border border-destructive/50 rounded-xl shadow-xl p-4 alert-popup-slide-in cursor-pointer transition-transform hover:scale-[1.02]"
          role="alert"
          aria-live="assertive"
          onClick={() => openConversation(alert)}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 size-10 rounded-full bg-destructive/20 flex items-center justify-center">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-destructive-foreground text-sm">
                  Palavra-chave detectada
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissAlert(alert.id);
                  }}
                  className="flex-shrink-0 p-1 rounded hover:bg-destructive/20 text-destructive-foreground/70 transition-colors"
                  aria-label="Dispensar alerta"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-sm text-destructive-foreground/90">
                <span className="font-medium">{alert.nome}</span> precisa de atenção
              </p>
              <p className="mt-1 text-xs text-destructive-foreground/70">
                Regra: <span className="font-mono">{alert.ruleName}</span>
              </p>
              <p className="mt-2 text-xs text-destructive-foreground/60 truncate">
                {alert.message}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-destructive-foreground/60">
                <MessageSquare className="size-3.5" />
                <span>Clique para abrir a conversa e silenciar o alerta</span>
              </div>
            </div>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes alert-popup-slide-in-kf {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        .alert-popup-slide-in {
          animation: alert-popup-slide-in-kf 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}
