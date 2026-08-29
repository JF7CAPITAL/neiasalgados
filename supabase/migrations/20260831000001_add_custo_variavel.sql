-- ===================================================================
-- MIGRATION: Adiciona tipo 'custo_variavel' ao DRE
-- ===================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'custo_variavel'
      AND enumtypid = 'public.dre_entry_type'::regtype
  ) THEN
    ALTER TYPE public.dre_entry_type ADD VALUE 'custo_variavel';
  END IF;
END $$;
