-- ===================================================================
-- MIGRATION: Opt-out do Ponto de Equilíbrio por lançamento
-- Adiciona a flag inclui_ponto_equilibrio em finance_dre_entries
-- (padrão true: todo lançamento participa do Ponto de Equilíbrio).
-- Lançamentos recorrentes com a flag falsa são ignorados no cálculo
-- do Ponto de Equilíbrio (feito no client, sem RPC).
-- Sem esta migration, o app assume true para todos (fallback).
-- ===================================================================

ALTER TABLE public.finance_dre_entries
  ADD COLUMN IF NOT EXISTS inclui_ponto_equilibrio boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.finance_dre_entries.inclui_ponto_equilibrio IS 'Se false, o lançamento recorrente é ignorado no Ponto de Equilíbrio do Financeiro.';
