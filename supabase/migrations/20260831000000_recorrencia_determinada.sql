-- ===================================================================
-- MIGRATION: Lançamentos recorrentes com quantidade determinada/indefinida
-- ===================================================================

-- Adiciona campos para especificar recorrência
ALTER TABLE public.finance_dre_entries
ADD COLUMN IF NOT EXISTS recorrencia_tipo text CHECK (recorrencia_tipo IN ('indefinida', 'determinada')),
ADD COLUMN IF NOT EXISTS recorrencia_quantidade integer CHECK (recorrencia_quantidade IS NULL OR recorrencia_quantidade > 0),
ADD COLUMN IF NOT EXISTS recorrencia_grupo_id uuid;

COMMENT ON COLUMN public.finance_dre_entries.recorrencia_tipo IS 'Tipo de recorrência: indefinida (repete todo mês sem fim) ou determinada (repete N meses)';
COMMENT ON COLUMN public.finance_dre_entries.recorrencia_quantidade IS 'Quantidade de meses para recorrência determinada (incluindo o mês inicial)';
COMMENT ON COLUMN public.finance_dre_entries.recorrencia_grupo_id IS 'UUID para agrupar lançamentos gerados por uma mesma recorrência determinada';

CREATE INDEX IF NOT EXISTS idx_finance_dre_entries_recorrencia_grupo ON public.finance_dre_entries(recorrencia_grupo_id);
