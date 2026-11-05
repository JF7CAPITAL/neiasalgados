-- Motivo do cancelamento informado pelo Anota AI (evento `canceled: true`
-- com campo `justification`). Guardado no pedido para exibição no detalhe.
ALTER TABLE public.anota_orders
ADD COLUMN IF NOT EXISTS cancelamento_motivo TEXT;

COMMENT ON COLUMN public.anota_orders.cancelamento_motivo IS
  'Motivo (justification) enviado pelo Anota AI no evento de cancelamento';
