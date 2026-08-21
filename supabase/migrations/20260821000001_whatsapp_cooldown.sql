-- ===================================================================
-- MIGRATION: Tabela para cooldown persistente de respostas por palavra-chave
-- Substitui o Map em memória que perdia estado a cada deploy/restart
-- ===================================================================

CREATE TABLE public.whatsapp_reply_cooldown (
  phone text NOT NULL PRIMARY KEY,
  last_reply_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.whatsapp_reply_cooldown TO authenticated;
GRANT ALL ON public.whatsapp_reply_cooldown TO service_role;
ALTER TABLE public.whatsapp_reply_cooldown ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sistema gerencia cooldown WhatsApp" ON public.whatsapp_reply_cooldown
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_reply_cooldown_updated ON public.whatsapp_reply_cooldown(last_reply_at);

-- Função para verificar e atualizar cooldown atomicamente
CREATE OR REPLACE FUNCTION public.check_and_update_whatsapp_cooldown(
  p_phone text,
  p_cooldown_seconds int DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_can_reply boolean;
BEGIN
  -- Tenta inserir novo registro (primeira mensagem do contato)
  INSERT INTO public.whatsapp_reply_cooldown (phone, last_reply_at)
  VALUES (p_phone, v_now)
  ON CONFLICT (phone) DO UPDATE
  SET last_reply_at = v_now
  WHERE public.whatsapp_reply_cooldown.last_reply_at < v_now - (p_cooldown_seconds || ' seconds')::interval
  RETURNING (xmax = 0) INTO v_can_reply;

  -- Se não retornou nada (conflito mas cooldown ativo), v_can_reply será null/false
  IF v_can_reply IS NULL THEN
    v_can_reply := false;
  END IF;

  RETURN v_can_reply;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_update_whatsapp_cooldown(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_update_whatsapp_cooldown(text, int) TO service_role;