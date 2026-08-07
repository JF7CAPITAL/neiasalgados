
-- ===================================================================
-- MIGRATION 7: Notificações automáticas do WhatsApp (tabela própria)
-- Substitui o armazenamento em JSON (whatsapp_settings.status_messages)
-- por uma tabela dedicada, com suporte a imagem junto do texto.
-- ===================================================================

-- Garante a tabela de configurações do WhatsApp (caso a MIGRATION 5 não
-- tenha sido aplicada no banco, evitando o erro de schema cache).
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_settings'
  ) THEN
    ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Equipe pode gerenciar configurações WhatsApp" ON public.whatsapp_settings
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_whatsapp_settings_updated'
      AND tgrelid = 'public.whatsapp_settings'::regclass
  ) THEN
    CREATE TRIGGER trg_whatsapp_settings_updated BEFORE UPDATE ON public.whatsapp_settings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Configuração padrão (toggle liga/desliga)
INSERT INTO public.whatsapp_settings (key, value) VALUES ('whatsapp_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------
-- Tabela de notificações automáticas
--   regra: identificador do disparo
--     - 'pedido_recebido'  -> pedido entrou (cliente)
--     - 'pedido_pronto'    -> pedido pronto (cliente)
--     - 'motoboy'          -> pedido pronto (motoboy vinculado)
--     - 'status_<N>'       -> pedido mudou para o status N
--   imagem_url: URL pública da imagem enviada junto com o texto
-- -------------------------------------------------------------------
CREATE TABLE public.whatsapp_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  regra text NOT NULL UNIQUE,
  titulo text NOT NULL DEFAULT '',
  mensagem text NOT NULL DEFAULT '',
  status integer,
  imagem_url text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_notifications TO authenticated;
GRANT ALL ON public.whatsapp_notifications TO service_role;
ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar notificações WhatsApp" ON public.whatsapp_notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_notifications_updated BEFORE UPDATE ON public.whatsapp_notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notificações fixas (templates que antes ficavam em whatsapp_settings)
INSERT INTO public.whatsapp_notifications (regra, titulo, mensagem, ativo) VALUES
  ('pedido_recebido', 'Pedido recebido',
   'Neia Salgados: recebemos seu pedido #{{numero}} no valor de R$ {{total}}. Já estamos preparando!', true),
  ('pedido_pronto', 'Pedido pronto (cliente)',
   'Neia Salgados: seu pedido #{{numero}} está pronto!', true),
  ('motoboy', 'Pedido pronto para entrega (motoboy)',
   'Neia Salgados: pedido #{{numero}} ({{cliente}}) está pronto para entrega.', true)
ON CONFLICT (regra) DO NOTHING;

-- -------------------------------------------------------------------
-- Storage público para as imagens das notificações
-- -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-notifications', 'whatsapp-notifications', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read whatsapp notifications" ON storage.objects;
CREATE POLICY "Public read whatsapp notifications" ON storage.objects
  FOR SELECT USING (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth upload whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth upload whatsapp notifications" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth update whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth update whatsapp notifications" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth delete whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth delete whatsapp notifications" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'whatsapp-notifications');
