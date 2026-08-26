-- ===================================================================
-- MIGRATION: Add pagamento field to collaborators
-- ===================================================================

-- Add pagamento column to collaborators table
ALTER TABLE public.collaborators
ADD COLUMN IF NOT EXISTS pagamento numeric DEFAULT 0;

-- Add index for pagamento queries
CREATE INDEX IF NOT EXISTS idx_collaborators_pagamento ON public.collaborators(pagamento);

COMMENT ON COLUMN public.collaborators.pagamento IS 'Valor de pagamento do colaborador (usado para cálculo de folha no financeiro)';

-- Update calc_folha_pagamento to use pagamento field instead of salario
CREATE OR REPLACE FUNCTION public.calc_folha_pagamento(p_competencia date DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total numeric := 0;
  v_comp date := COALESCE(p_competencia, date_trunc('month', now())::date);
BEGIN
  -- Calculate total payroll based on pagamento field
  SELECT COALESCE(SUM(pagamento), 0) INTO v_total
  FROM public.collaborators
  WHERE status = 'ativo'
    AND deleted_at IS NULL
    AND (data_admissao IS NULL OR data_admissao <= v_comp)
    AND pagamento IS NOT NULL
    AND pagamento > 0;

  RETURN v_total;
END; $function$;

GRANT EXECUTE ON FUNCTION public.calc_folha_pagamento(date) TO authenticated;