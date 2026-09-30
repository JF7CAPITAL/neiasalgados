-- ===================================================================
-- MIGRATION: Fix Folha de pagamento - colaborador "Daniel" oculto
-- Causa raiz: financeiro.tsx filtrava status com .eq("status", "ativo")
-- (case-sensitive), mas o cadastro de colaboradores permitia digitação
-- livre ("Ativo", "ATIVO", "ativo " etc.), então esses registros sumiam
-- da Folha embora aparecessem na lista de Colaboradores.
-- ===================================================================

-- 1. Normaliza todos os status existentes (trim + minúsculas)
UPDATE public.collaborators
SET status = lower(trim(status))
WHERE status IS NOT NULL
  AND status <> lower(trim(status));

-- 2. Status vazio/nulo vira 'ativo' (preserva comportamento do default)
UPDATE public.collaborators
SET status = 'ativo'
WHERE trim(coalesce(status, '')) = '';

-- 3. Garante que o "Daniel" (variação de caixa de "ativo") fique 'ativo'.
--    Cobre "Daniel", "DANIEL", "daniel silva" etc. com status "Ativo"/"ATIVO".
UPDATE public.collaborators
SET status = 'ativo'
WHERE nome ILIKE '%daniel%'
  AND lower(trim(status)) = 'ativo'
  AND status <> 'ativo';

-- 3b. Caso o Daniel tenha sido cadastrado com status fora do padrão
--     (ex.: "inativo" por engano) e esteja sem deleted_at, descomente abaixo
--     após conferir o SELECT de diagnóstico:
--     SELECT id, nome, status, data_admissao, deleted_at
--     FROM public.collaborators WHERE nome ILIKE '%daniel%';
-- UPDATE public.collaborators SET status = 'ativo'
-- WHERE nome ILIKE '%daniel%' AND deleted_at IS NULL;

-- 4. Trigger preventivo: normaliza status em INSERT/UPDATE futuros
CREATE OR REPLACE FUNCTION public.normalize_collaborator_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.status := lower(trim(coalesce(NEW.status, 'ativo')));
  IF NEW.status = '' THEN
    NEW.status := 'ativo';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_normalize_collaborator_status ON public.collaborators;
CREATE TRIGGER trg_normalize_collaborator_status
  BEFORE INSERT OR UPDATE OF status ON public.collaborators
  FOR EACH ROW EXECUTE FUNCTION public.normalize_collaborator_status();

-- 5. calc_folha_pagamento passa a comparar status de forma tolerante
--    (lower(trim(status))), para o DRE não divergir da lista da Folha.
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
  SELECT COALESCE(SUM(pagamento), 0) INTO v_total
  FROM public.collaborators
  WHERE lower(trim(status)) = 'ativo'
    AND deleted_at IS NULL
    AND (data_admissao IS NULL OR data_admissao <= v_comp)
    AND pagamento IS NOT NULL
    AND pagamento > 0;

  RETURN v_total;
END; $function$;

GRANT EXECUTE ON FUNCTION public.calc_folha_pagamento(date) TO authenticated;
