-- ===================================================================
-- MIGRATION: Folha de pagamento acumulada no período (X a Y)
-- Problema: get_dre_data usava calc_folha_pagamento(p_fim) que retornava um
-- snapshot único (SUM de pagamento, sem vínculo com o período). Ao projetar
-- datas futuras, o indicador "Folha de Pagamento" não crescia.
-- Solução: a folha do DRE passa a ser o custo incorrido no período:
--   SUM(salario_mensal × meses_no_período) por colaborador ativo,
-- respeitando data_admissao (só conta meses a partir da admissão).
-- Regime de competência: admissão no meio do mês conta o mês cheio.
-- Pagamentos efetuados continuam visíveis no card "Folha dos
-- colaboradores" (saldo devedor / pagamentos realizados) — fluxo de caixa.
-- ===================================================================

-- Remove a versão antiga de 1 argumento (snapshot), substituída pela de 2 args
DROP FUNCTION IF EXISTS public.calc_folha_pagamento(date);

CREATE OR REPLACE FUNCTION public.calc_folha_pagamento(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ini date := COALESCE(p_inicio, date_trunc('month', COALESCE(p_fim, now()))::date);
  v_fim date := COALESCE(p_fim, now()::date);
  v_total numeric := 0;
BEGIN
  -- Sem período válido, não há custo a incorrer
  IF v_fim < v_ini THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(c.salario * m.meses), 0) INTO v_total
  FROM public.collaborators c
  CROSS JOIN LATERAL (
    -- Primeiro mês válido do colaborador no período (admissão ou início)
    SELECT GREATEST(
      date_trunc('month', v_ini)::date,
      date_trunc('month', COALESCE(c.data_admissao, v_ini))::date
    ) AS eff_ini
  ) e
  CROSS JOIN LATERAL (
    -- Meses corridos (inclusive) do primeiro mês válido até o mês final
    SELECT (
      (EXTRACT(YEAR FROM v_fim)::int * 12 + EXTRACT(MONTH FROM v_fim)::int)
      - (EXTRACT(YEAR FROM e.eff_ini)::int * 12 + EXTRACT(MONTH FROM e.eff_ini)::int)
      + 1
    ) AS meses
  ) m
  WHERE lower(trim(c.status)) = 'ativo'
    AND c.deleted_at IS NULL
    AND (c.data_admissao IS NULL OR c.data_admissao <= v_fim)
    AND c.salario IS NOT NULL
    AND c.salario > 0
    AND e.eff_ini <= v_fim
    AND m.meses > 0;

  RETURN v_total;
END; $function$;

GRANT EXECUTE ON FUNCTION public.calc_folha_pagamento(date, date) TO authenticated;

-- get_dre_data passa o período completo para a folha acumulada
CREATE OR REPLACE FUNCTION public.get_dre_data(p_inicio date, p_fim date)
RETURNS TABLE (
  secao text,
  categoria text,
  descricao text,
  valor numeric,
  fonte text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_receita_bruta numeric;
  v_folha numeric;
  v_meses int;
BEGIN
  v_receita_bruta := public.calc_receita_bruta(p_inicio, p_fim);
  v_folha := public.calc_folha_pagamento(p_inicio, p_fim);
  v_meses := GREATEST(0,
    (EXTRACT(YEAR FROM p_fim)::int * 12 + EXTRACT(MONTH FROM p_fim)::int)
    - (EXTRACT(YEAR FROM p_inicio)::int * 12 + EXTRACT(MONTH FROM p_inicio)::int)
    + 1
  );

  -- Receita Bruta (automático)
  RETURN QUERY SELECT 'RECEITA BRUTA'::text, 'Vendas Anota AI'::text, 'Pedidos finalizados no período'::text, v_receita_bruta, 'auto'::text;

  -- Custo Direto (CMV) - temporariamente zerado
  -- Insumos NÃO entram mais aqui; são exibidos no KPI/card "Despesas com insumos"
  -- Futuros custos diretos serão lançados manualmente (tipo custo_direto) ou via nova lógica
  RETURN QUERY SELECT 'CUSTO DIRETO (CMV)'::text, 'Outros custos diretos'::text, 'Aguardando definição — insumos agora em Despesas com insumos'::text, 0::numeric, 'auto'::text;

  -- Lucro Bruto - sem CMV de insumos por enquanto (receita - 0)
  -- Quando novos custos diretos forem adicionados, entram via manual e são somados ao KPI, mas o cálculo central permanece aqui
  RETURN QUERY SELECT 'LUCRO BRUTO'::text, ''::text, 'Receita Bruta - CMV'::text, v_receita_bruta, 'auto'::text;

  -- Despesas Operacionais (folha acumulada no período)
  RETURN QUERY SELECT 'DESPESAS OPERACIONAIS'::text, 'Folha de Pagamento'::text,
    ('Salários acumulados no período (' || v_meses || CASE WHEN v_meses = 1 THEN ' mês)' ELSE ' meses)' END)::text,
    v_folha, 'auto'::text;

  -- Lançamentos manuais do contador (inclui custo_direto, custo_variavel, etc.)
  RETURN QUERY
  SELECT f.tipo::text, f.categoria, f.descricao, f.valor, 'manual'::text
  FROM public.finance_dre_entries f
  WHERE f.competencia >= p_inicio AND f.competencia <= p_fim
  ORDER BY f.tipo, f.categoria;

  -- Resultado Líquido
  RETURN QUERY
  SELECT 'RESULTADO LÍQUIDO'::text, ''::text, 'Lucro Bruto - Despesas'::text,
    (v_receita_bruta) - v_folha - COALESCE((
      SELECT SUM(fd.valor) FROM public.finance_dre_entries fd
      WHERE fd.competencia >= p_inicio AND fd.competencia <= p_fim
        AND fd.tipo IN ('despesa_operacional', 'despesa_administrativa', 'despesa_financeira', 'outros', 'custo_direto', 'custo_variavel')
    ), 0), 'auto'::text;
END; $function$;

GRANT EXECUTE ON FUNCTION public.get_dre_data(date, date) TO authenticated;

COMMENT ON FUNCTION public.calc_folha_pagamento(date, date) IS 'Folha acumulada no período: SUM(salario × meses) por colaborador ativo, respeitando data_admissao. Regime de competência.';
COMMENT ON FUNCTION public.get_dre_data(date, date) IS 'DRE ajustado: CMV automático zerado, insumos via card Despesas com insumos, folha acumulada no período X-Y.';
