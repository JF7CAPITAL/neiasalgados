-- ===================================================================
-- MIGRATION: Conversas do WhatsApp (mensagens robo <-> cliente) e
-- pausa temporária de envio por contato.
--
-- whatsapp_messages: histórico de texto trocado entre o robô e o
-- cliente. Tanto as mensagens RECEBIDAS (webhook) quanto as ENVIADAS
-- (notificações/respostas automáticas) são gravadas aqui. A aba
-- "Mensagens" da sidebar exibe apenas conversas iniciadas no dia
-- atual e mantém os dados visíveis por apenas 2 dias.
--
-- whatsapp_contact_pauses: permite desativar temporariamente o envio
-- de mensagens para um contato específico (por um período definido).
-- ===================================================================

CREATE TABLE public.whatsapp_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  chat_id text,
  direction text NOT NULL DEFAULT 'in', -- 'in' = cliente -> robô | 'out' = robô -> cliente
  texto text NOT NULL DEFAULT '',
  tipo text,                            -- contexto (regra, notificação, etc.)
  status text,
  error text,
  ref_order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode consultar mensagens WhatsApp" ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Sistema grava mensagens WhatsApp" ON public.whatsapp_messages
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_whatsapp_messages_phone_created ON public.whatsapp_messages(phone, created_at DESC);
CREATE INDEX idx_whatsapp_messages_created ON public.whatsapp_messages(created_at DESC);

-- Limpa mensagens mais antigas que 2 dias (retendo apenas o período visível)
CREATE OR REPLACE FUNCTION public.cleanup_whatsapp_messages()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.whatsapp_messages
  WHERE created_at < now() - interval '2 days';
$function$;

GRANT EXECUTE ON FUNCTION public.cleanup_whatsapp_messages() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_whatsapp_messages() TO service_role;

CREATE TABLE public.whatsapp_contact_pauses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  chat_id text,
  paused_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contact_pauses TO authenticated;
GRANT ALL ON public.whatsapp_contact_pauses TO service_role;
ALTER TABLE public.whatsapp_contact_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar pausas WhatsApp" ON public.whatsapp_contact_pauses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_contact_pauses_phone ON public.whatsapp_contact_pauses(phone);
CREATE INDEX idx_whatsapp_contact_pauses_until ON public.whatsapp_contact_pauses(paused_until);

-- Verifica se o envio de mensagens está pausado para um contato.
CREATE OR REPLACE FUNCTION public.is_whatsapp_paused(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_contact_pauses
    WHERE phone = p_phone AND paused_until > now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_whatsapp_paused(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_whatsapp_paused(text) TO service_role;