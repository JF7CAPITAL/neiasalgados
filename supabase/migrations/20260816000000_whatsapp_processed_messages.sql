-- ===================================================================
-- MIGRATION 9: Deduplicação de mensagens recebidas do WhatsApp (Waha)
--
-- O Waha (engine GOWS) pode entregar o mesmo evento de mensagem duas
-- vezes ao webhook (bug conhecido: issues #1564 e #1627). Esta tabela
-- registra o id único da mensagem já processada para que a segunda
-- entrega do mesmo evento seja ignorada, evitando resposta duplicada.
-- A deduplicação é exclusivamente por message_id: um cliente que pedir
-- a mesma palavra-chave em outro momento (novo id) recebe resposta
-- normalmente.
-- ===================================================================

CREATE TABLE public.whatsapp_processed_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  phone text,
  regra text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.whatsapp_processed_messages TO authenticated;
GRANT ALL ON public.whatsapp_processed_messages TO service_role;
ALTER TABLE public.whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode consultar mensagens processadas" ON public.whatsapp_processed_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_processed_messages_created ON public.whatsapp_processed_messages(created_at DESC);