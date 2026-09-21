-- ===================================================================
-- MIGRATION: Adiciona controle de vencimento/pagamento em finance_dre_entries
-- Substitui "competencia" por "vencimento" no fluxo de lançamentos manuais.
-- Mantém competencia para compatibilidade, mas vencimento passa a ser o
-- campo principal exibido e usado para card Vencimentos.
-- ===================================================================

-- Adiciona colunas de controle financeiro
ALTER TABLE public.finance_dre_entries
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS pago boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS data_pagamento timestamptz;

-- Índice para buscar vencimentos pendentes
CREATE INDEX IF NOT EXISTS idx_finance_dre_entries_vencimento
  ON public.finance_dre_entries (vencimento) WHERE pago = false AND vencimento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_dre_entries_pago
  ON public.finance_dre_entries (pago);

-- Para registros existentes: vencimento = competencia, marca como pago
-- (lançamentos antigos já foram considerados quitados)
UPDATE public.finance_dre_entries
SET vencimento = competencia,
    pago = true,
    data_pagamento = created_at
WHERE vencimento IS NULL;

-- Comentários
COMMENT ON COLUMN public.finance_dre_entries.vencimento IS 'Data de vencimento do lançamento (substitui competencia para controle de vencimentos)';
COMMENT ON COLUMN public.finance_dre_entries.pago IS 'Se o lançamento foi pago/quitado (true) ou está pendente como vencimento (false)';
COMMENT ON COLUMN public.finance_dre_entries.data_pagamento IS 'Data em que o pagamento foi efetivado';

-- Função auxiliar para quitar lançamento manual
CREATE OR REPLACE FUNCTION public.pay_dre_entry(
  p_entry uuid,
  p_user uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.finance_dre_entries;
BEGIN
  SELECT * INTO r FROM public.finance_dre_entries WHERE id = p_entry;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  IF r.pago = true THEN RAISE EXCEPTION 'Lançamento já está pago'; END IF;
  UPDATE public.finance_dre_entries
  SET pago = true,
      data_pagamento = now()
  WHERE id = p_entry;
END; $$;

GRANT EXECUTE ON FUNCTION public.pay_dre_entry(uuid, uuid) TO authenticated;
