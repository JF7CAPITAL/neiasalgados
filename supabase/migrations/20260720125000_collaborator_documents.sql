CREATE TABLE public.collaborator_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  nome text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.collaborator_documents TO authenticated;
GRANT ALL ON public.collaborator_documents TO service_role;
ALTER TABLE public.collaborator_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_all_auth" ON public.collaborator_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public) VALUES ('colaborador_documentos', 'colaborador_documentos', true)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "documentos_public_read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'colaborador_documentos');
CREATE POLICY "documentos_public_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'colaborador_documentos');
CREATE POLICY "documentos_public_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'colaborador_documentos');
