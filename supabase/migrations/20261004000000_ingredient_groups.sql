-- ===================================================================
-- MIGRATION: Grupos de insumos (organizacao da lista do almoxarifado)
-- Espelha o mecanismo de product_groups usado na pagina de produtos:
-- permite criar grupos (ex.: "Farinhas", "Recheios") e associar insumos
-- a eles, com ordenacao customizada por arrastar/reordenar.
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.ingredient_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL UNIQUE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_ingredient_groups_updated ON public.ingredient_groups;
CREATE TRIGGER trg_ingredient_groups_updated BEFORE UPDATE ON public.ingredient_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.ingredient_groups(id) ON DELETE SET NULL;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ingredients_group_id ON public.ingredients(group_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_group_ordem ON public.ingredients (group_id, ordem, nome);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_groups TO authenticated;
GRANT ALL ON public.ingredient_groups TO service_role;
ALTER TABLE public.ingredient_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ingredient_groups_all_auth" ON public.ingredient_groups;
CREATE POLICY "ingredient_groups_all_auth" ON public.ingredient_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Inicializa ordem alfabetica existente dentro de cada grupo (inclui "sem grupo")
DO $$
DECLARE
  g RECORD;
  r RECORD;
  i INT;
BEGIN
  FOR g IN SELECT DISTINCT group_id FROM public.ingredients LOOP
    i := 0;
    FOR r IN
      SELECT id FROM public.ingredients
      WHERE (group_id IS NOT DISTINCT FROM g.group_id) AND deleted_at IS NULL
      ORDER BY nome
    LOOP
      UPDATE public.ingredients SET ordem = i WHERE id = r.id;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;
