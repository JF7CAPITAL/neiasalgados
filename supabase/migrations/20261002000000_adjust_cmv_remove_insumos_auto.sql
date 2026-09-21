-- ===================================================================
-- MIGRATION: Ajusta DRE - custo direto CMV não contabiliza mais insumos automaticamente
-- Insumos passam a ser controlados exclusivamente pelo card "Despesas com insumos"
-- (purchase_orders recebidas no período). CMV fica reservado para outros custos
-- diretos que serão definidos posteriormente (manual via finance_dre_entries).
-- ===================================================================

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
BEGIN
  v_receita_bruta := public.calc_receita_bruta(p_inicio, p_fim);
  v_folha := public.calc_folha_pagamento(p_fim);

  -- Receita Bruta (automático)
  RETURN QUERY SELECT 'RECEITA BRUTA'::text, 'Vendas Anota AI'::text, 'Pedidos finalizados no período'::text, v_receita_bruta, 'auto'::text;

  -- Custo Direto (CMV) - temporariamente zerado
  -- Insumos NÃO entram mais aqui; são exibidos no KPI/card "Despesas com insumos"
  -- Futuros custos diretos serão lançados manualmente (tipo custo_direto) ou via nova lógica
  RETURN QUERY SELECT 'CUSTO DIRETO (CMV)'::text, 'Outros custos diretos'::text, 'Aguardando definição — insumos agora em Despesas com insumos'::text, 0::numeric, 'auto'::text;

  -- Lucro Bruto - sem CMV de insumos por enquanto (receita - 0)
  -- Quando novos custos diretos forem adicionados, entram via manual e são somados ao KPI, mas o cálculo central permanece aqui
  RETURN QUERY SELECT 'LUCRO BRUTO'::text, ''::text, 'Receita Bruta - CMV'::text, v_receita_bruta, 'auto'::text;

  -- Despesas Operacionais (folha)
  RETURN QUERY SELECT 'DESPESAS OPERACIONAIS'::text, 'Folha de Pagamento'::text, 'Colaboradores ativos (estimado por cargo)'::text, v_folha, 'auto'::text;

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

-- Mantém calc_custo_insumos para histórico/compatibilidade, mas não é mais usado no DRE
COMMENT ON FUNCTION public.calc_custo_insumos(date, date) IS 'Legado: calculava insumos via ingredient_movements. Mantido para compatibilidade, mas DRE agora usa Despesas com insumos (purchase_orders).';
COMMENT ON FUNCTION public.get_dre_data(date, date) IS 'DRE ajustado: CMV automático zerado, insumos via card Despesas com insumos. Aguardando definição de novos custos diretos.';
