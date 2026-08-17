-- ===================================================================
-- MIGRATION 13: Grupos de produtos (organização da lista de produtos)
-- ===================================================================
-- Permite criar grupos (ex.: "Fritos", "Assados") e associar produtos a
-- eles, mantendo a lista de produtos organizada por seções.

CREATE TABLE public.product_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_product_groups_updated BEFORE UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products ADD COLUMN group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_products_group_id ON public.products(group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_groups TO authenticated;
GRANT ALL ON public.product_groups TO service_role;
ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_groups_all_auth" ON public.product_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);