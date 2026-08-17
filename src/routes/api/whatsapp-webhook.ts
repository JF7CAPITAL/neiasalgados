import { createFileRoute } from "@tanstack/react-router";

import {
  isContactPaused,
  loadKeywordRules,
  logWhatsAppMessage,
  matchKeywordRules,
  normalizePhone,
  renderTemplate,
  sendWahaImage,
  sendWahaText,
  type WhatsAppKeywordRule,
} from "@/lib/whatsapp.functions";

// ---------------------------------------------------------------------------
// Webhook de mensagens recebidas do WhatsApp (Waha)
//
// O Waha faz um POST neste endpoint sempre que um evento acontece no número
// conectado. Aqui processamos apenas mensagens TEXTO recebidas de clientes
// (não as enviadas por nós, nem de grupos) e, se o conteúdo bater com alguma
// regra de palavras-chave ativa, respondemos automaticamente.
//
// Configuração no Waha:
//   WHATSAPP_HOOK_URL=https://<seu-dominio>/api/whatsapp-webhook
//   WHATSAPP_HOOK_EVENTS=message
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Extrai o texto da mensagem recebida, tolerando variações de payload. */
function extractText(root: Json): string {
  const message = asRecord(root.message);
  if (message) {
    const text = asRecord(message.text);
    if (text && str(text.body)) return str(text.body);
    if (str(message.text)) return str(message.text);
    const caption = asRecord(message.caption);
    if (caption && str(caption.text)) return str(caption.text);
  }
  if (str(root.text)) return str(root.text);
  if (str(root.body)) return str(root.body);
  return "";
}

/**
 * Extrai o id único da mensagem recebida (ex.: "false_5511...@c.us_<hash>").
 * O Waha entrega o MESMO id quando repete o mesmo evento (bug GOWS),
 * então ele serve como chave de deduplicação.
 */
function extractMessageId(root: Json): string {
  const payload = asRecord(root.payload);
  const message = asRecord(payload?.message) ?? asRecord(root.message);
  const candidates = [
    str(message?.id),
    str(message?.messageId),
    str(payload?.id),
    str(root.messageId),
  ];
  return candidates.find((c) => c.length > 0) ?? "";
}

/** Extrai o chatId do remetente (ex.: "5511999999999@c.us"). */
function extractFrom(root: Json): string {
  if (str(root.from)) return str(root.from);
  if (str(root.chatId)) return str(root.chatId);
  if (str(root.senderId)) return str(root.senderId);
  const sender = asRecord(root.sender);
  if (sender && str(sender.id)) return str(sender.id);
  return "";
}

/**
 * Ignora mensagens de grupo, broadcast, newsletter e status.
 * Obs.: "@lid" NÃO é grupo — é o ID de usuário 1:1 usado pelo WhatsApp no
 * modo de privacidade (GOWS entrega DMs com o remetente em @lid).
 */
function isGroupChat(chatId: string): boolean {
  return (
    chatId.includes("@g.us") ||
    chatId.includes("@broadcast") ||
    chatId.includes("@newsletter") ||
    chatId.includes("@status")
  );
}

/** Detecta se a mensagem foi enviada por nós (própria resposta). */
function isFromMe(root: Json): boolean {
  if (root.fromMe === true || root.from_me === true) return true;
  const direction = str(root.direction).toLowerCase();
  if (direction === "outgoing" || direction === "sent") return true;
  const message = asRecord(root.message);
  if (message && (message.fromMe === true || message.from_me === true)) return true;
  return false;
}

// Cooldown simples por remetente para evitar respostas repetidas em loop.
const cooldownMs = 30_000;
const lastReplyBy = new Map<string, number>();

function cleanupCooldown() {
  const now = Date.now();
  for (const [key, ts] of lastReplyBy) {
    if (now - ts > cooldownMs * 2) lastReplyBy.delete(key);
  }
}

async function sendReply(to: string, rule: WhatsAppKeywordRule, text: string) {
  if (rule.imagem_url && rule.imagem_url.trim()) {
    return sendWahaImage(to, rule.imagem_url.trim(), text);
  }
  return sendWahaText(to, text);
}

/** Grava um evento recebido no log de atividade (best-effort, nunca quebra o fluxo). */
async function logWebhookEvent(
  detalhes: Record<string, unknown>,
  wahaRequestId = "",
  wahaTimestamp = "",
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("activity_logs").insert({
      modulo: "whatsapp_webhook",
      acao: "recebeu_evento",
      registro_id: null,
      user_id: null,
      detalhes: {
        ...detalhes,
        ...(wahaRequestId ? { waha_request_id: wahaRequestId } : {}),
        ...(wahaTimestamp ? { waha_timestamp: wahaTimestamp } : {}),
      } as never,
    });
  } catch (e) {
    console.error("[whatsapp-webhook] falha ao logar:", e);
  }
}

export const Route = createFileRoute("/api/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          if (!raw.trim()) return Response.json({ ok: false, error: "corpo vazio" });

          // Headers de diagnóstico do Waha: id único por entrega do webhook.
          const wahaRequestId = request.headers.get("x-webhook-request-id") ?? "";
          const wahaTimestamp = request.headers.get("x-webhook-timestamp") ?? "";
          const log = (detalhes: Record<string, unknown>) =>
            logWebhookEvent(detalhes, wahaRequestId, wahaTimestamp);

          const body: unknown = JSON.parse(raw);
          const root = asRecord(body);
          if (!root) return Response.json({ ok: false, error: "payload inválido" });

          const event = str(root.event);
          // Processa apenas eventos de mensagem (texto) recebidos.
          if (!(event === "message" || event === "message.any" || event === "Message")) {
            await log({ event, motivo: "nao_eh_mensagem" });
            return Response.json({ ok: true, ignored: "evento não é mensagem" });
          }

          const payload = asRecord(root.payload) ?? root;
          const chatId = extractFrom(payload);
          if (isFromMe(payload)) {
            await log({ event, chatId, motivo: "from_me" });
            return Response.json({ ok: true, ignored: "mensagem enviada por nós" });
          }

          if (!chatId || isGroupChat(chatId)) {
            await log({ event, chatId, motivo: "grupo" });
            return Response.json({ ok: true, ignored: "sem remetente ou grupo" });
          }

          const phone = normalizePhone(chatId.split("@")[0]);
          if (!phone) {
            await log({ event, chatId, motivo: "telefone_invalido" });
            return Response.json({ ok: true, ignored: "telefone inválido" });
          }

          const texto = extractText(payload);
          if (!texto.trim()) {
            await log({ event, chatId, phone, motivo: "sem_texto" });
            return Response.json({ ok: true, ignored: "mensagem sem texto" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Grava a mensagem recebida na conversa (aba Mensagens).
          await logWhatsAppMessage(supabaseAdmin, {
            phone,
            chatId: chatId,
            direction: "in",
            texto,
            tipo: "recebida",
            status: "recebida",
          });

          // Contato em pausa temporária: não responde automaticamente.
          if (await isContactPaused(supabaseAdmin, phone)) {
            await log({ event, chatId, phone, texto, motivo: "pausado" });
            return Response.json({ ok: true, ignored: "envio pausado para o contato" });
          }

          const rules = (await loadKeywordRules(supabaseAdmin)).filter((r) => r.ativo);
          if (!rules.length) {
            await log({ event, chatId, phone, texto, motivo: "sem_regra" });
            return Response.json({ ok: true, ignored: "nenhuma regra ativa" });
          }

          const matched = matchKeywordRules(texto, rules);
          if (!matched.length) {
            await log({ event, chatId, phone, texto, motivo: "sem_match" });
            return Response.json({ ok: true, ignored: "nenhuma palavra-chave bateu" });
          }

          // Deduplicação por id único da mensagem: o Waha (engine GOWS) entrega
          // o MESMO evento 2x (bug conhecido). Reivindica o id atomicamente;
          // se já existir, a segunda entrega é ignorada sem enviar resposta.
          const messageId = extractMessageId(root);
          if (messageId) {
            const { data: inserted, error: dedupErr } = await supabaseAdmin
              .from("whatsapp_processed_messages")
              .insert({
                message_id: messageId,
                phone,
                regra: matched[0].regra,
              })
              .select("message_id")
              .single();
            if (dedupErr || !inserted) {
              await log({
                event,
                chatId,
                phone,
                texto,
                motivo: "duplicada",
                message_id: messageId,
              });
              return Response.json({ ok: true, ignored: "mensagem já processada" });
            }
          }

          cleanupCooldown();
          const now = Date.now();
          const last = lastReplyBy.get(phone) ?? 0;
          if (now - last < cooldownMs) {
            await log({ event, chatId, phone, texto, motivo: "cooldown" });
            return Response.json({ ok: true, ignored: "cooldown do remetente" });
          }

          // Envia a mensagem da primeira regra que bateu.
          // Usa o chatId completo (pode ser @c.us ou @lid) para responder no
          // mesmo chat de onde a mensagem veio.
          const rule = matched[0];
          const msg = renderTemplate(rule.mensagem, { numero: "", total: "", cliente: "" });
          const r = await sendReply(chatId, rule, msg);
          if (r.ok) lastReplyBy.set(phone, now);

          // Grava a resposta na conversa (aba Mensagens).
          await logWhatsAppMessage(supabaseAdmin, {
            phone,
            chatId: chatId,
            direction: "out",
            texto: msg,
            tipo: `keyword:${rule.regra}`,
            status: r.ok ? "enviado" : "erro",
            error: r.ok ? null : r.message,
          });

          // Se o envio falhou, libera a reivindicação para que um retry do
          // Waha possa reprocessar (sem isso a mensagem ficaria bloqueada).
          if (!r.ok && messageId) {
            await supabaseAdmin
              .from("whatsapp_processed_messages")
              .delete()
              .eq("message_id", messageId);
          }

          await log({
            event,
            chatId,
            phone,
            texto,
            motivo: "enviou",
            regra: rule.regra,
            enviado: r.ok,
            mensagem: r.message,
            ...(messageId ? { message_id: messageId } : {}),
          });

          return Response.json({ ok: true, enviado: r.ok, mensagem: r.message });
        } catch (e) {
          console.error("[whatsapp-webhook] erro:", e);
          // Responde 200 mesmo em erro para o Waha não reenviar em loop.
          return Response.json({ ok: false, error: "erro interno" });
        }
      },
    },
  },
});
