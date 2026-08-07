import { createFileRoute } from "@tanstack/react-router";

import {
  loadKeywordRules,
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

/** Extrai o chatId do remetente (ex.: "5511999999999@c.us"). */
function extractFrom(root: Json): string {
  if (str(root.from)) return str(root.from);
  if (str(root.chatId)) return str(root.chatId);
  if (str(root.senderId)) return str(root.senderId);
  const sender = asRecord(root.sender);
  if (sender && str(sender.id)) return str(sender.id);
  return "";
}

/** Ignora mensagens de grupo, broadcast, newsletter e status. */
function isGroupChat(chatId: string): boolean {
  return (
    chatId.includes("@g.us") ||
    chatId.includes("@broadcast") ||
    chatId.includes("@newsletter") ||
    chatId.includes("@status") ||
    chatId.includes("@lid")
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

export const Route = createFileRoute("/api/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          if (!raw.trim()) return Response.json({ ok: false, error: "corpo vazio" });

          const body: unknown = JSON.parse(raw);
          const root = asRecord(body);
          if (!root) return Response.json({ ok: false, error: "payload inválido" });

          const event = str(root.event);
          // Processa apenas eventos de mensagem (texto) recebidos.
          if (!(event === "message" || event === "message.any" || event === "Message")) {
            return Response.json({ ok: true, ignored: "evento não é mensagem" });
          }

          const payload = asRecord(root.payload) ?? root;
          if (isFromMe(payload)) {
            return Response.json({ ok: true, ignored: "mensagem enviada por nós" });
          }

          const chatId = extractFrom(payload);
          if (!chatId || isGroupChat(chatId)) {
            return Response.json({ ok: true, ignored: "sem remetente ou grupo" });
          }

          const phone = normalizePhone(chatId.split("@")[0]);
          if (!phone) return Response.json({ ok: true, ignored: "telefone inválido" });

          const texto = extractText(payload);
          if (!texto.trim()) {
            return Response.json({ ok: true, ignored: "mensagem sem texto" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rules = (await loadKeywordRules(supabaseAdmin)).filter((r) => r.ativo);
          if (!rules.length) {
            return Response.json({ ok: true, ignored: "nenhuma regra ativa" });
          }

          const matched = matchKeywordRules(texto, rules);
          if (!matched.length) {
            return Response.json({ ok: true, ignored: "nenhuma palavra-chave bateu" });
          }

          cleanupCooldown();
          const now = Date.now();
          const last = lastReplyBy.get(phone) ?? 0;
          if (now - last < cooldownMs) {
            return Response.json({ ok: true, ignored: "cooldown do remetente" });
          }

          // Envia a mensagem da primeira regra que bateu.
          const rule = matched[0];
          const msg = renderTemplate(rule.mensagem, { numero: "", total: "", cliente: "" });
          const r = await sendReply(phone, rule, msg);
          if (r.ok) lastReplyBy.set(phone, now);

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
