import { useState, useEffect, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare,
  MessagesSquare,
  Loader2,
  Pause,
  Play,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import {
  getWhatsAppConversations,
  getWhatsAppConversation,
  pauseWhatsAppContact,
  unpauseWhatsAppContact,
  type WhatsAppConversation,
  type WhatsAppMessageRow,
} from "@/lib/whatsapp.functions";
import { fmtDateTime } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/erp/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/mensagens")({
  validateSearch: (search: Record<string, unknown>): { phone?: string } => ({
    phone: typeof search.phone === "string" && search.phone ? search.phone : undefined,
  }),
  component: MensagensPage,
});

function formatRemaining(pausedUntil: string): string {
  const diff = new Date(pausedUntil).getTime() - Date.now();
  if (diff <= 0) return "reativado";
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function useCountdown(pausedUntil: string | null): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!pausedUntil) return;
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [pausedUntil]);
  if (!pausedUntil) return null;
  return formatRemaining(pausedUntil);
}

function MensagensPage() {
  const qc = useQueryClient();
  const { phone: phoneParam } = Route.useSearch();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(phoneParam ?? null);
  const [pauseMinutes, setPauseMinutes] = useState("60");
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // Seleciona a conversa vinda da URL (ex.: clique no popup de alerta)
  useEffect(() => {
    if (phoneParam) setSelectedPhone(phoneParam);
  }, [phoneParam]);

  const conversationsFn = useServerFn(getWhatsAppConversations);
  const conversationFn = useServerFn(getWhatsAppConversation);
  const pauseFn = useServerFn(pauseWhatsAppContact);
  const unpauseFn = useServerFn(unpauseWhatsAppContact);

  const { data: conversations = [], isFetching } = useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => {
      const r = await conversationsFn();
      return r.ok ? r.conversations : [];
    },
    refetchInterval: 30_000,
  });

  const selected = useMemo(
    () => conversations.find((c) => c.phone === selectedPhone) ?? null,
    [conversations, selectedPhone],
  );

  const { data: thread = { messages: [], nome: "" } } = useQuery({
    queryKey: ["whatsapp-conversation", selectedPhone],
    queryFn: async () => {
      if (!selectedPhone) return { messages: [], nome: "" };
      const r = await conversationFn({ data: { phone: selectedPhone } });
      return r.ok ? { messages: r.messages, nome: r.nome } : { messages: [], nome: selectedPhone };
    },
    enabled: !!selectedPhone,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages.length, selectedPhone]);

  const pause = useMutation({
    mutationFn: () =>
      pauseFn({
        data: {
          phone: selectedPhone ?? "",
          minutes: Number(pauseMinutes),
        },
      }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      qc.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unpause = useMutation({
    mutationFn: () => unpauseFn({ data: { phone: selectedPhone ?? "" } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      qc.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pausedUntil = selected?.paused_until ?? null;
  const remaining = useCountdown(pausedUntil);
  const isPaused = !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mensagens"
        subtitle="Conversas do robô com os clientes iniciadas hoje (retidas por até 2 dias)"
        icon={MessageSquare}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
              if (selectedPhone)
                qc.invalidateQueries({ queryKey: ["whatsapp-conversation", selectedPhone] });
            }}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* Lista de conversas */}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-muted/40 px-4 py-3">
            <h3 className="text-sm font-semibold">Conversas de hoje</h3>
            <p className="text-xs text-muted-foreground">
              {conversations.length} conversa(s) ativa(s)
            </p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhuma conversa iniciada hoje.
              </p>
            ) : (
              conversations.map((c) => (
                <ConversationItem
                  key={c.phone}
                  conv={c}
                  active={c.phone === selectedPhone}
                  onClick={() => setSelectedPhone(c.phone)}
                />
              ))
            )}
          </div>
        </div>

        {/* Conversa aberta */}
        {selectedPhone ? (
          <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">
                  {(thread.nome || selectedPhone).slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold">{thread.nome || selectedPhone}</p>
                  <p className="text-xs text-muted-foreground">{selectedPhone}</p>
                </div>
                {isPaused ? (
                  <Badge variant="destructive" className="gap-1">
                    <Pause className="size-3" /> Pausado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <Play className="size-3" /> Ativo
                  </Badge>
                )}
              </div>
            </div>

            <div ref={threadScrollRef} className="flex-1 space-y-3 overflow-y-auto bg-card/40 p-4">
              {thread.messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma mensagem nos últimos 2 dias.
                </p>
              ) : (
                thread.messages.map((m) => <MessageBubble key={m.id} msg={m} />)
              )}
            </div>

            <div className="border-t border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isPaused ? (
                    <>
                      <Clock className="size-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Envio pausado — reativa em {remaining}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => unpause.mutate()}
                        disabled={unpause.isPending}
                      >
                        <Play className="mr-1 size-3" /> Reativar agora
                      </Button>
                    </>
                  ) : (
                    <>
                      <Input
                        type="number"
                        min="1"
                        max="1440"
                        className="w-24"
                        value={pauseMinutes}
                        onChange={(e) => setPauseMinutes(e.target.value)}
                        title="Tempo em minutos"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pause.mutate()}
                        disabled={
                          pause.isPending || !Number(pauseMinutes) || Number(pauseMinutes) <= 0
                        }
                      >
                        {pause.isPending ? (
                          <Loader2 className="mr-1 size-3 animate-spin" />
                        ) : (
                          <Pause className="mr-1 size-3" />
                        )}
                        Pausar envio
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Enquanto pausado, o robô não responde a palavras-chave deste contato. As
                  notificações de pedido (pronto, agendado, finalizado etc.) continuam sendo
                  enviadas.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Selecione uma conversa"
            description="Clique em um número ou nome do cliente na lista para visualizar toda a interação."
            icon={MessagesSquare}
          />
        )}
      </div>
    </div>
  );
}

function ConversationItem({
  conv,
  active,
  onClick,
}: {
  conv: WhatsAppConversation;
  active: boolean;
  onClick: () => void;
}) {
  const paused = !!conv.paused_until && new Date(conv.paused_until).getTime() > Date.now();
  const preview = conv.lastMessage || "—";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/40",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
        {conv.nome.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{conv.nome}</p>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {fmtDateTime(conv.lastMessageAt)}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{preview}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{conv.phone}</span>
          {conv.unread > 0 && (
            <Badge variant="default" className="px-1.5 py-0 text-[10px]">
              {conv.unread} nova{conv.unread > 1 ? "s" : ""}
            </Badge>
          )}
          {paused && (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              <Pause className="mr-0.5 size-2.5" /> Pausado
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg }: { msg: WhatsAppMessageRow }) {
  const isOut = msg.direction === "out";
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          isOut
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{msg.texto || "—"}</p>
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1.5 text-[10px]",
            isOut ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <span>{fmtDateTime(msg.created_at)}</span>
          {msg.tipo && <span className="opacity-70">{msg.tipo}</span>}
          {isOut && msg.status && (
            <span className={cn(msg.status === "erro" && "font-semibold text-red-300")}>
              {msg.status === "erro" ? "falhou" : "enviada"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
