-- ===================================================================
-- MIGRATION: Collaborator Documents - Attach images/documents to collaborators
-- ===================================================================

-- Create collaborator_documents table
CREATE TABLE IF NOT EXISTS public.collaborator_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL, -- 'documento', 'foto', 'comprovante', etc
  arquivo_url text NOT NULL,
  tamanho_bytes integer,
  mime_type text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_documents TO authenticated;
GRANT ALL ON public.collaborator_documents TO service_role;

ALTER TABLE public.collaborator_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collaborator_documents_select_auth" ON public.collaborator_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "collaborator_documents_insert_auth" ON public.collaborator_documents
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "collaborator_documents_update_auth" ON public.collaborator_documents
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "collaborator_documents_delete_auth" ON public.collaborator_documents
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'rh')
  );

CREATE TRIGGER trg_collaborator_documents_updated
  BEFORE UPDATE ON public.collaborator_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_collaborator_documents_collaborator_id ON public.collaborator_documents(collaborator_id);
CREATE INDEX idx_collaborator_documents_tipo ON public.collaborator_documents(tipo);

-- Create storage bucket for collaborator documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'collaborator-documents',
  'collaborator-documents',
  true,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/gif'];

-- Storage policies for collaborator-documents bucket
CREATE POLICY "Collaborator documents public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'collaborator-documents');

CREATE POLICY "Collaborator documents authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'collaborator-documents');

CREATE POLICY "Collaborator documents authenticated update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'collaborator-documents')
  WITH CHECK (bucket_id = 'collaborator-documents');

CREATE POLICY "Collaborator documents admin/rh delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'collaborator-documents' AND
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'rh'))
  );

-- Grant execute on has_role for storage policies
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;