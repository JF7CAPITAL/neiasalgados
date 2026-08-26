-- ===================================================================
-- MIGRATION: Update calc_folha_pagamento to use actual salary field
-- ===================================================================

-- Function to calculate payroll costs from collaborators (using actual salary field)
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
  -- Calculate total payroll based on actual salary field
  SELECT COALESCE(SUM(salario), 0) INTO v_total
  FROM public.collaborators
  WHERE status = 'ativo'
    AND deleted_at IS NULL
    AND (data_admissao IS NULL OR data_admissao <= v_comp)
    AND salario IS NOT NULL
    AND salario > 0;

  RETURN v_total;
END; $function$;

GRANT EXECUTE ON FUNCTION public.calc_folha_pagamento(date) TO authenticated;