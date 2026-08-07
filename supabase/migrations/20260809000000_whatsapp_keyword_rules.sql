-- ===================================================================
-- MIGRATION 8: Colunas de notificação em anota_orders + regras por
-- palavras-chave (disparo customizável do WhatsApp)
-- ===================================================================

-- Garante as colunas de controle de notificação e vínculo de motoboy nos
-- pedidos Anota (as MIGRATIONS 5 e 6 podem não ter sido aplicadas no banco).
ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS motoboy_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_ready_notified_at timestamptz;

ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS whatsapp_statuses_notified text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS whatsapp_keywords_notified text[] NOT NULL DEFAULT '{}';

-- Garante a função de updated_at (usada pelos triggers abaixo)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------
-- Tabela de regras de disparo por palavras-chave
--   regra: identificador único da regra (slug)
--   nome: nome amigável exibido na tela
--   palavras_chave: lista separada por vírgula de palavras-chave que,
--     se presentes no texto do pedido, disparam a mensagem
--   mensagem: texto enviado (suporta {{numero}}, {{total}}, {{cliente}})
--   imagem_url: URL pública da imagem enviada junto com o texto
-- -------------------------------------------------------------------
CREATE TABLE public.whatsapp_keyword_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  regra text NOT NULL UNIQUE,
  nome text NOT NULL DEFAULT '',
  palavras_chave text NOT NULL DEFAULT '',
  mensagem text NOT NULL DEFAULT '',
  imagem_url text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_keyword_rules TO authenticated;
GRANT ALL ON public.whatsapp_keyword_rules TO service_role;
ALTER TABLE public.whatsapp_keyword_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar regras por palavras-chave" ON public.whatsapp_keyword_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_keyword_rules_updated BEFORE UPDATE ON public.whatsapp_keyword_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
