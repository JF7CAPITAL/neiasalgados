
-- ===================================================================
-- MIGRATION 5: Integração WhatsApp (Waha) — notificações de pedidos
-- ===================================================================

-- Colunas de controle de notificação e vínculo de motoboy nos pedidos Anota
ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS motoboy_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_ready_notified_at timestamptz;

-- Configurações do WhatsApp (chave/valor): templates de mensagem e toggle
CREATE TABLE public.whatsapp_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar configurações WhatsApp" ON public.whatsapp_settings
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_settings_updated BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Templates padrão (usados se o usuário não personalizar)
INSERT INTO public.whatsapp_settings (key, value) VALUES
  ('whatsapp_enabled', 'true'),
  ('template_pedido_recebido', 'Neia Salgados: recebemos seu pedido #{{numero}} no valor de R$ {{total}}. Já estamos preparando!'),
  ('template_pedido_pronto', 'Neia Salgados: seu pedido #{{numero}} está pronto!'),
  ('template_motoboy_pronto', 'Neia Salgados: pedido #{{numero}} ({{cliente}}) está pronto para entrega.')
ON CONFLICT (key) DO NOTHING;

-- Log de envios do WhatsApp
CREATE TABLE public.whatsapp_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  ref_type text,
  ref_id text,
  destino text,
  tipo text,
  mensagem text,
  status text NOT NULL,
  error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar logs WhatsApp" ON public.whatsapp_logs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_whatsapp_logs_created ON public.whatsapp_logs(created_at DESC);
