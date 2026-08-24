-- ===================================================================
-- MIGRATION: Finance Module - DRE Custom Entries & Access Password
-- ===================================================================

-- Enum for DRE entry types
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dre_entry_type') THEN
    CREATE TYPE public.dre_entry_type AS ENUM ('receita', 'custo_direto', 'despesa_operacional', 'despesa_administrativa', 'despesa_financeira', 'outros');
  END IF;
END $$;

-- Custom DRE entries table (manual entries for accountant adjustments)
CREATE TABLE IF NOT EXISTS public.finance_dre_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo dre_entry_type NOT NULL,
  categoria text NOT NULL,
  descricao text,
  valor numeric NOT NULL DEFAULT 0,
  competencia date NOT NULL DEFAULT (date_trunc('month', now())::date),
  recorrente boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_dre_entries TO authenticated;
GRANT ALL ON public.finance_dre_entries TO service_role;

ALTER TABLE public.finance_dre_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_dre_entries_select_auth" ON public.finance_dre_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "finance_dre_entries_insert_auth" ON public.finance_dre_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "finance_dre_entries_update_auth" ON public.finance_dre_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "finance_dre_entries_delete_auth" ON public.finance_dre_entries FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'financeiro'));

CREATE TRIGGER trg_finance_dre_entries_updated BEFORE UPDATE ON public.finance_dre_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_finance_dre_entries_competencia ON public.finance_dre_entries(competencia);
CREATE INDEX idx_finance_dre_entries_tipo ON public.finance_dre_entries(tipo);

-- Finance access password table (single row for the module password)
CREATE TABLE IF NOT EXISTS public.finance_access (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, UPDATE ON public.finance_access TO authenticated;
GRANT ALL ON public.finance_access TO service_role;

ALTER TABLE public.finance_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_access_select_auth" ON public.finance_access FOR SELECT TO authenticated USING (true);
CREATE POLICY "finance_access_update_auth" ON public.finance_access FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'financeiro')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'financeiro'));

CREATE TRIGGER trg_finance_access_updated BEFORE UPDATE ON public.finance_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial empty row for finance_access (password will be set on first access)
INSERT INTO public.finance_access (password_hash) VALUES ('') ON CONFLICT DO NOTHING;

-- Function to calculate gross revenue from Anota AI orders
CREATE OR REPLACE FUNCTION public.calc_receita_bruta(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total numeric := 0;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM public.anota_orders
  WHERE check_status IN (1, 2, 3) -- em análise, em produção, finalizados
    AND (p_inicio IS NULL OR imported_at::date >= p_inicio)
    AND (p_fim IS NULL OR imported_at::date <= p_fim);
  RETURN v_total;
END; $function$;

-- Function to calculate input costs (insumos) from ingredient movements
CREATE OR REPLACE FUNCTION public.calc_custo_insumos(p_inicio date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_total numeric := 0;
BEGIN
  SELECT COALESCE(SUM(quantidade * preco_medio), 0) INTO v_total
  FROM public.ingredient_movements im
  JOIN public.ingredients i ON i.id = im.ingredient_id
  WHERE im.tipo IN ('entrada', 'ajuste') -- only entries that increase stock value
    AND (p_inicio IS NULL OR im.created_at::date >= p_inicio)
    AND (p_fim IS NULL OR im.created_at::date <= p_fim);
  RETURN v_total;
END; $function$;

-- Function to calculate payroll costs from collaborators
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
  -- This would typically come from a payroll table
  -- For now, we'll use a placeholder calculation based on active collaborators
  -- In a real scenario, you'd have a payroll table with salaries, benefits, etc.
  SELECT COALESCE(SUM(
    CASE
      WHEN cargo ILIKE '%gerent%' THEN 5000
      WHEN cargo ILIKE '%supervisor%' THEN 3500
      WHEN cargo ILIKE '%cozinheir%' THEN 3000
      WHEN cargo ILIKE '%auxiliar%' THEN 1800
      WHEN cargo ILIKE '%entregador%' THEN 1800
      WHEN cargo ILIKE '%atendente%' THEN 1600
      ELSE 1500
    END
  ), 0) INTO v_total
  FROM public.collaborators
  WHERE status = 'ativo'
    AND deleted_at IS NULL
    AND (data_admissao IS NULL OR data_admissao <= v_comp);

  RETURN v_total;
END; $function$;

-- Function to get DRE data for a period
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
  v_custo_insumos numeric;
  v_folha numeric;
BEGIN
  v_receita_bruta := public.calc_receita_bruta(p_inicio, p_fim);
  v_custo_insumos := public.calc_custo_insumos(p_inicio, p_fim);
  v_folha := public.calc_folha_pagamento(p_fim);

  -- Receita Bruta
  RETURN QUERY SELECT 'RECEITA BRUTA'::text, 'Vendas Anota AI'::text, 'Pedidos finalizados no período'::text, v_receita_bruta, 'auto'::text;

  -- Custos Diretos (CMV)
  RETURN QUERY SELECT 'CUSTO DIRETO (CMV)'::text, 'Insumos consumidos'::text, 'Movimentações de entrada/ajuste de insumos'::text, v_custo_insumos, 'auto'::text;

  -- Lucro Bruto
  RETURN QUERY SELECT 'LUCRO BRUTO'::text, ''::text, 'Receita Bruta - CMV'::text, v_receita_bruta - v_custo_insumos, 'auto'::text;

  -- Despesas Operacionais
  RETURN QUERY SELECT 'DESPESAS OPERACIONAIS'::text, 'Folha de Pagamento'::text, 'Colaboradores ativos (estimado por cargo)'::text, v_folha, 'auto'::text;

  -- Custom entries from finance_dre_entries
  RETURN QUERY
  SELECT f.tipo::text, f.categoria, f.descricao, f.valor, 'manual'::text
  FROM public.finance_dre_entries f
  WHERE f.competencia >= p_inicio AND f.competencia <= p_fim
  ORDER BY f.tipo, f.categoria;

  -- Resultado
  RETURN QUERY
  SELECT 'RESULTADO LÍQUIDO'::text, ''::text, 'Lucro Bruto - Despesas'::text,
    (v_receita_bruta - v_custo_insumos) - v_folha - COALESCE((
      SELECT SUM(fd.valor) FROM public.finance_dre_entries fd
      WHERE fd.competencia >= p_inicio AND fd.competencia <= p_fim
        AND fd.tipo IN ('despesa_operacional', 'despesa_administrativa', 'despesa_financeira', 'outros')
    ), 0), 'auto'::text;
END; $function$;

GRANT EXECUTE ON FUNCTION public.calc_receita_bruta(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_custo_insumos(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_folha_pagamento(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dre_data(date, date) TO authenticated;