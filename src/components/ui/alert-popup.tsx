"use client";

import { useEffect, useRef, useState } from "react";
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    // Initialize Web Audio API for alert sound
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
        gainNodeRef.current.gain.value = 0.3;
      }
    };

    // Initialize on first user interaction
    const handleUserInteraction = () => {
      initAudio();
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);
    };
    document.addEventListener("click", handleUserInteraction);
    document.addEventListener("keydown", handleUserInteraction);

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
          playSound();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopSound();
    };
  }, []);

  const playSound = () => {
    if (!isPlayingRef.current && audioContextRef.current) {
      isPlayingRef.current = true;
      // Resume audio context if suspended (browser policy)
      if (audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume();
      }
      
      oscillatorRef.current = audioContextRef.current.createOscillator();
      oscillatorRef.current.type = "square";
      oscillatorRef.current.frequency.setValueAtTime(800, audioContextRef.current.currentTime);
      oscillatorRef.current.frequency.exponentialRampToValueAtTime(600, audioContextRef.current.currentTime + 0.1);
      oscillatorRef.current.frequency.exponentialRampToValueAtTime(800, audioContextRef.current.currentTime + 0.2);
      
      oscillatorRef.current.connect(gainNodeRef.current!);
      oscillatorRef.current.start();
      
      // Loop the sound
      oscillatorRef.current.onended = () => {
        if (isPlayingRef.current) {
          playSound();
        }
      };
    }
  };

  const stopSound = () => {
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.onended = null;
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch {
        // Already stopped
      }
      oscillatorRef.current = null;
    }
    isPlayingRef.current = false;
  };

  const dismissAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    if (alerts.length === 1) {
      stopSound();
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-[380px]">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-destructive/95 border border-destructive/50 rounded-xl shadow-xl p-4 animate-slide-in"
          role="alert"
          aria-live="assertive"
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
                  onClick={() => dismissAlert(alert.id)}
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
      <style jsx>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
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