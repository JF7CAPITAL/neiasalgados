-- ===================================================================
-- MIGRATION: Habilita Supabase Realtime na tabela whatsapp_messages
-- para permitir alertas em tempo real quando palavras-chave são detectadas
-- ===================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;