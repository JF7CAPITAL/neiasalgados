-- ===================================================================
-- MIGRATION: Configuração do tratamento da taxa de entrega por motoboy
-- Permite definir, por motoboy (ou pedidos sem motoboy), se a taxa de
-- entrega é repassada (despesa) ou fica com a loja como receita líquida.
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.finance_delivery_fee_settings (
  motoboy_key text NOT NULL PRIMARY KEY,
  receita_liquida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_delivery_fee_settings TO authenticated;
GRANT ALL ON public.finance_delivery_fee_settings TO service_role;

ALTER TABLE public.finance_delivery_fee_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_delivery_fee_settings_select_auth" ON public.finance_delivery_fee_settings;
CREATE POLICY "finance_delivery_fee_settings_select_auth" ON public.finance_delivery_fee_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "finance_delivery_fee_settings_insert_auth" ON public.finance_delivery_fee_settings;
CREATE POLICY "finance_delivery_fee_settings_insert_auth" ON public.finance_delivery_fee_settings
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "finance_delivery_fee_settings_update_auth" ON public.finance_delivery_fee_settings;
CREATE POLICY "finance_delivery_fee_settings_update_auth" ON public.finance_delivery_fee_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "finance_delivery_fee_settings_delete_auth" ON public.finance_delivery_fee_settings;
CREATE POLICY "finance_delivery_fee_settings_delete_auth" ON public.finance_delivery_fee_settings
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_finance_delivery_fee_settings_updated ON public.finance_delivery_fee_settings;
CREATE TRIGGER trg_finance_delivery_fee_settings_updated BEFORE UPDATE ON public.finance_delivery_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
