-- ===================================================================
-- MIGRATION: Fechamento de competência do ponto (banco de horas)
-- Evita dobrar o saldo ao fechar o mesmo período duas vezes.
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.ponto_fechamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  saldo_minutos integer NOT NULL,
  fechado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ponto_fechamentos_periodo_check CHECK (periodo_fim >= periodo_inicio),
  CONSTRAINT ponto_fechamentos_unico UNIQUE (collaborator_id, periodo_inicio, periodo_fim)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ponto_fechamentos TO authenticated;
GRANT ALL ON public.ponto_fechamentos TO service_role;

ALTER TABLE public.ponto_fechamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ponto_fechamentos_rh_select" ON public.ponto_fechamentos;
CREATE POLICY "ponto_fechamentos_rh_select" ON public.ponto_fechamentos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "ponto_fechamentos_rh_insert" ON public.ponto_fechamentos;
CREATE POLICY "ponto_fechamentos_rh_insert" ON public.ponto_fechamentos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

CREATE INDEX IF NOT EXISTS idx_ponto_fechamentos_periodo
  ON public.ponto_fechamentos(periodo_inicio DESC, periodo_fim DESC);

COMMENT ON TABLE public.ponto_fechamentos IS 'Histórico de fechamentos de competência do ponto. Impede duplicidade por colaborador/período.';

CREATE OR REPLACE FUNCTION public.fechar_ponto_periodo(
  _collaborator_id uuid,
  _inicio date,
  _fim date,
  _saldo_minutos integer,
  _user_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _novo_saldo numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh')) THEN
    RAISE EXCEPTION 'Sem permissão para fechar o ponto.';
  END IF;

  IF _fim < _inicio THEN
    RAISE EXCEPTION 'Período inválido.';
  END IF;

  INSERT INTO public.ponto_fechamentos (collaborator_id, periodo_inicio, periodo_fim, saldo_minutos, fechado_por)
  VALUES (_collaborator_id, _inicio, _fim, _saldo_minutos, _user_id);

  UPDATE public.collaborators
  SET banco_horas = COALESCE(banco_horas, 0) + _saldo_minutos
  WHERE id = _collaborator_id
  RETURNING banco_horas INTO _novo_saldo;

  RETURN _novo_saldo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fechar_ponto_periodo(uuid, date, date, integer, uuid) TO authenticated;
