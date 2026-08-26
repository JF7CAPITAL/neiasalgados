-- ===================================================================
-- MIGRATION: Add salary and advance payment fields to collaborators
-- ===================================================================

-- Add salario column to collaborators table
ALTER TABLE public.collaborators
ADD COLUMN IF NOT EXISTS salario numeric DEFAULT 0;

-- Add saldo_devedor column to track advance payments
ALTER TABLE public.collaborators
ADD COLUMN IF NOT EXISTS saldo_devedor numeric DEFAULT 0;

-- Add index for salary queries
CREATE INDEX IF NOT EXISTS idx_collaborators_salario ON public.collaborators(salario);

COMMENT ON COLUMN public.collaborators.salario IS 'Salário mensal do colaborador';
COMMENT ON COLUMN public.collaborators.saldo_devedor IS 'Saldo a pagar ao colaborador (descontado de adiantamentos)';