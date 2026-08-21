-- ===================================================================
-- MIGRATION: Adiciona campo alerta_sonoro nas regras de palavra-chave
-- Default TRUE = todas alertam por padrão, usuário desliga as que não quer
-- ===================================================================

ALTER TABLE public.whatsapp_keyword_rules
ADD COLUMN IF NOT EXISTS alerta_sonoro boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.whatsapp_keyword_rules.alerta_sonoro
IS 'Se true, dispara popup com som quando a regra for atendida';