-- ===================================================================
-- MIGRATION: Adiciona ordenação customizada para produtos dentro de grupos
-- Permite arrastar/reordenar produtos na aba Produtos
-- ===================================================================

-- Coluna ordem em products (similar a product_groups.ordem)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;

-- Índice para ordenar eficientemente por grupo + ordem
CREATE INDEX IF NOT EXISTS idx_products_group_ordem ON public.products (group_id, ordem, nome);

-- Inicializa ordem alfabética existente para grupos já cadastrados
-- Atribui ordem sequencial por nome dentro de cada grupo (inclui "sem grupo")
DO $$
DECLARE
  g RECORD;
  r RECORD;
  i INT;
BEGIN
  -- Grupos existentes: garante ordem sequencial se estiver tudo 0
  FOR g IN SELECT id FROM public.product_groups ORDER BY ordem, nome LOOP
    -- nada, apenas garante que grupos já têm ordem
    CONTINUE;
  END LOOP;

  -- Produtos: preenche ordem baseado na ordem alfabética atual dentro de cada grupo
  FOR g IN SELECT DISTINCT group_id FROM public.products LOOP
    i := 0;
    FOR r IN
      SELECT id FROM public.products
      WHERE (group_id IS NOT DISTINCT FROM g.group_id) AND deleted_at IS NULL
      ORDER BY nome
    LOOP
      UPDATE public.products SET ordem = i WHERE id = r.id;
      i := i + 1;
    END LOOP;
  END LOOP;
END $$;
