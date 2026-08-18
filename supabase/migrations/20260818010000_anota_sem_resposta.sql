-- ===================================================================
-- MIGRATION: Marca pedidos que não existem mais no Anota (HTTP 410/404).
--
-- Pedidos que saem da listagem ativa são removidos da API (410 Gone) e o
-- detalhe deixa de responder. O sync passa a marcar esses pedidos
-- (sem_resposta_em) e, após uma carência, finalizá-los — parando de
-- consultá-los a cada sincronização e aliviando a carga na API do Anota.
-- ===================================================================

ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS sem_resposta_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_anota_orders_sem_resposta
  ON public.anota_orders (sem_resposta_em)
  WHERE sem_resposta_em IS NOT NULL;
