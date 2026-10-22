-- ===================================================================
-- MIGRATION: Controle de ponto com reconhecimento facial
-- - collaborators: configuração de jornada e consentimento LGPD
-- - collaborator_faces: descritores faciais (128 floats) + thumbnail
-- - time_entries: batidas de ponto (facial/manual/ajuste)
-- - bucket privado ponto-fotos (JPEG compactado)
-- ===================================================================

ALTER TABLE public.collaborators
  ADD COLUMN IF NOT EXISTS ponto_habilitado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ponto_tipo_jornada text NOT NULL DEFAULT '4_batidas',
  ADD COLUMN IF NOT EXISTS carga_horaria_minutos integer NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS tolerancia_minutos integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS biometria_consentimento_em timestamptz,
  ADD COLUMN IF NOT EXISTS biometria_consentimento_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.collaborators
    ADD CONSTRAINT collaborators_ponto_tipo_jornada_check
    CHECK (ponto_tipo_jornada IN ('2_batidas', '4_batidas'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.collaborators.ponto_habilitado IS 'Se false, o colaborador não pode registrar ponto.';
COMMENT ON COLUMN public.collaborators.ponto_tipo_jornada IS '2_batidas (entrada/saída) ou 4_batidas (com intervalo).';
COMMENT ON COLUMN public.collaborators.carga_horaria_minutos IS 'Jornada diária esperada em minutos (padrão 480 = 8h).';
COMMENT ON COLUMN public.collaborators.tolerancia_minutos IS 'Tolerância de atraso em minutos.';
COMMENT ON COLUMN public.collaborators.biometria_consentimento_em IS 'Data/hora do consentimento LGPD para biometria facial.';
COMMENT ON COLUMN public.collaborators.biometria_consentimento_por IS 'Usuário que registrou o consentimento.';

-- -------------------------------------------------------------------
-- Descritores faciais (dados pessoais sensíveis: acesso restrito RH)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collaborator_faces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  descriptor jsonb NOT NULL,
  modelo text NOT NULL DEFAULT 'face-api-ssd-v1',
  foto_path text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_faces TO authenticated;
GRANT ALL ON public.collaborator_faces TO service_role;

ALTER TABLE public.collaborator_faces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collaborator_faces_rh_select" ON public.collaborator_faces;
CREATE POLICY "collaborator_faces_rh_select" ON public.collaborator_faces
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "collaborator_faces_rh_insert" ON public.collaborator_faces;
CREATE POLICY "collaborator_faces_rh_insert" ON public.collaborator_faces
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "collaborator_faces_rh_update" ON public.collaborator_faces;
CREATE POLICY "collaborator_faces_rh_update" ON public.collaborator_faces
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "collaborator_faces_rh_delete" ON public.collaborator_faces;
CREATE POLICY "collaborator_faces_rh_delete" ON public.collaborator_faces
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP TRIGGER IF EXISTS trg_collaborator_faces_updated ON public.collaborator_faces;
CREATE TRIGGER trg_collaborator_faces_updated
  BEFORE UPDATE ON public.collaborator_faces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_collaborator_faces_collaborator
  ON public.collaborator_faces(collaborator_id)
  WHERE ativo;

COMMENT ON TABLE public.collaborator_faces IS 'Descritores faciais (128 floats) para identificação no ponto. Dado sensível LGPD.';

-- -------------------------------------------------------------------
-- Batidas de ponto
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE RESTRICT,
  tipo text NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'facial',
  confianca numeric,
  dispositivo text,
  foto_path text,
  observacoes text,
  ajuste_motivo text,
  ajustado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_tipo_check
    CHECK (tipo IN ('entrada', 'saida_intervalo', 'retorno_intervalo', 'saida')),
  CONSTRAINT time_entries_origem_check
    CHECK (origem IN ('facial', 'manual', 'pin', 'ajuste'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_entries_rh_select" ON public.time_entries;
CREATE POLICY "time_entries_rh_select" ON public.time_entries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "time_entries_rh_insert" ON public.time_entries;
CREATE POLICY "time_entries_rh_insert" ON public.time_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "time_entries_rh_update" ON public.time_entries;
CREATE POLICY "time_entries_rh_update" ON public.time_entries
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP POLICY IF EXISTS "time_entries_rh_delete" ON public.time_entries;
CREATE POLICY "time_entries_rh_delete" ON public.time_entries
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'));

DROP TRIGGER IF EXISTS trg_time_entries_updated ON public.time_entries;
CREATE TRIGGER trg_time_entries_updated
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_time_entries_collaborator_date
  ON public.time_entries(collaborator_id, registrado_em DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_registrado_em
  ON public.time_entries(registrado_em DESC);

-- Rejeita batidas repetidas em menos de 60s (proteção contra duplo toque/eco)
CREATE OR REPLACE FUNCTION public.time_entries_prevent_duplicate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origem IN ('facial', 'pin') AND EXISTS (
    SELECT 1
    FROM public.time_entries t
    WHERE t.collaborator_id = NEW.collaborator_id
      AND t.registrado_em BETWEEN NEW.registrado_em - interval '60 seconds'
                              AND NEW.registrado_em + interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Batida duplicada: já existe um registro para este colaborador há menos de 60 segundos.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_entries_prevent_duplicate ON public.time_entries;
CREATE TRIGGER trg_time_entries_prevent_duplicate
  BEFORE INSERT ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.time_entries_prevent_duplicate();

COMMENT ON TABLE public.time_entries IS 'Batidas de ponto registradas por reconhecimento facial, PIN ou ajuste do RH.';
COMMENT ON COLUMN public.time_entries.foto_path IS 'Caminho da foto compactada no bucket ponto-fotos.';
COMMENT ON COLUMN public.time_entries.confianca IS 'Distância euclidiana do match facial (menor = mais confiável).';

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------------------------------------------------
-- Storage: fotos compactadas das batidas (bucket privado)
-- -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ponto-fotos',
  'ponto-fotos',
  false,
  524288,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/jpeg'];

DROP POLICY IF EXISTS "Ponto fotos rh read" ON storage.objects;
CREATE POLICY "Ponto fotos rh read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ponto-fotos' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

DROP POLICY IF EXISTS "Ponto fotos rh upload" ON storage.objects;
CREATE POLICY "Ponto fotos rh upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ponto-fotos' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

DROP POLICY IF EXISTS "Ponto fotos rh update" ON storage.objects;
CREATE POLICY "Ponto fotos rh update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ponto-fotos' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  )
  WITH CHECK (
    bucket_id = 'ponto-fotos' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

DROP POLICY IF EXISTS "Ponto fotos rh delete" ON storage.objects;
CREATE POLICY "Ponto fotos rh delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ponto-fotos' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );
