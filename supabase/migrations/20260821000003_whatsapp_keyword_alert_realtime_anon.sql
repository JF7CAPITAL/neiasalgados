-- ===================================================================
-- MIGRATION: Permite que o Realtime entregue eventos de alerta sonoro
-- para clientes anônimos (chave publishable).
--
-- O popup de alerta (AlertPopup) escuta INSERTs na whatsapp_messages
-- com tipo = 'keyword_alerta:*'. Como o frontend usa a chave pública
-- (anon) e o RLS da tabela só liberava SELECT para authenticated,
-- o Realtime filtrava todos os eventos e o popup nunca abria.
--
-- Esta política libera leitura APENAS das linhas de alerta.
-- ===================================================================

CREATE POLICY "Realtime alertas de palavra-chave (anon)"
  ON public.whatsapp_messages
  FOR SELECT
  TO anon
  USING (tipo LIKE 'keyword_alerta:%');
