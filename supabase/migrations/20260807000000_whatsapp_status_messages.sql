
-- ===================================================================
-- MIGRATION 6: Mensagens configuráveis por status do pedido (Anota)
-- ===================================================================

-- Controle de anti-duplicação por status (quais status já notificados)
ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS whatsapp_statuses_notified text[] NOT NULL DEFAULT '{}';

-- Configuração dos templates por status (JSON): [{"status": 1, "message": "..."}]
INSERT INTO public.whatsapp_settings (key, value) VALUES
  ('status_messages', '[]')
ON CONFLICT (key) DO NOTHING;
