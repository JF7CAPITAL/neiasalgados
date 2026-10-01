-- ===================================================================
-- MIGRATION: Motoboys + opt-out do Ponto de Equilíbrio por colaborador
-- - is_motoboy: marca o colaborador como motoboy (folha separada no Financeiro)
-- - inclui_ponto_equilibrio: se false, o salário do colaborador é ignorado
--   no cálculo do Ponto de Equilíbrio (feito no client, sem RPC).
-- Sem esta migration, o app assume is_motoboy=false e inclui=true (fallback).
-- ===================================================================

ALTER TABLE public.collaborators
  ADD COLUMN IF NOT EXISTS is_motoboy boolean NOT NULL DEFAULT false;

ALTER TABLE public.collaborators
  ADD COLUMN IF NOT EXISTS inclui_ponto_equilibrio boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.collaborators.is_motoboy IS 'Se true, o colaborador aparece na Folha dos motoboys no Financeiro.';
COMMENT ON COLUMN public.collaborators.inclui_ponto_equilibrio IS 'Se false, o salário do colaborador é ignorado no Ponto de Equilíbrio do Financeiro.';
