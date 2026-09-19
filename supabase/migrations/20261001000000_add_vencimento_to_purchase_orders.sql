-- ===================================================================
-- MIGRATION: Adiciona controle de pagamento em ordens de compra
-- Permite marcar se compra foi paga à vista ou lançada como vencimento
-- ===================================================================

-- Adiciona colunas de controle financeiro em purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS pago boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_vencimento date,
  ADD COLUMN IF NOT EXISTS data_pagamento timestamptz,
  ADD COLUMN IF NOT EXISTS quantidade_recebida numeric,
  ADD COLUMN IF NOT EXISTS preco_recebido numeric,
  ADD COLUMN IF NOT EXISTS valor_total numeric;

-- Índice para buscar vencimentos pendentes no financeiro
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vencimento
  ON public.purchase_orders (data_vencimento) WHERE pago = false AND data_vencimento IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_pago_status
  ON public.purchase_orders (pago, status) WHERE deleted_at IS NULL;

-- Atualiza registros já concluídos como pagos (compatibilidade retroativa)
UPDATE public.purchase_orders
SET pago = true,
    data_pagamento = updated_at,
    quantidade_recebida = quantidade_necessaria,
    preco_recebido = preco_medio,
    valor_total = quantidade_necessaria * preco_medio
WHERE status = 'concluida' AND pago = false;

COMMENT ON COLUMN public.purchase_orders.pago IS 'Se a compra foi paga à vista (true) ou lançada como vencimento a prazo (false)';
COMMENT ON COLUMN public.purchase_orders.data_vencimento IS 'Data de vencimento quando a compra é a prazo (pago=false)';
COMMENT ON COLUMN public.purchase_orders.data_pagamento IS 'Data em que o pagamento foi efetivado';
COMMENT ON COLUMN public.purchase_orders.quantidade_recebida IS 'Quantidade efetivamente recebida';
COMMENT ON COLUMN public.purchase_orders.preco_recebido IS 'Preço unitário efetivamente pago';
COMMENT ON COLUMN public.purchase_orders.valor_total IS 'Valor total da compra (quantidade_recebida * preco_recebido)';

-- Atualiza função receive_purchase_order para aceitar controle de pagamento
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order uuid,
  p_quantidade numeric,
  p_preco numeric DEFAULT NULL,
  p_pago boolean DEFAULT true,
  p_vencimento date DEFAULT NULL,
  p_user uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.purchase_orders; pid uuid;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status = 'concluida' THEN RAISE EXCEPTION 'Ordem já concluída'; END IF;

  -- Validação de vencimento
  IF p_pago = false AND p_vencimento IS NULL THEN
    RAISE EXCEPTION 'Informe a data de vencimento para compras a prazo';
  END IF;

  INSERT INTO public.ingredient_movements (ingredient_id, tipo, quantidade, motivo, user_id, ref_order_id)
  VALUES (o.ingredient_id, 'entrada', p_quantidade, 'Compra recebida', p_user, o.id);

  -- Reflete a quantidade recebida no estoque dos produtos vinculados ao insumo.
  FOR pid IN SELECT DISTINCT product_id FROM public.recipe_items
    WHERE ingredient_id = o.ingredient_id AND product_id IS NOT NULL LOOP
    INSERT INTO public.product_movements (product_id, tipo, quantidade, observacoes, user_id, ref_order_id)
    VALUES (pid, 'entrada', p_quantidade, 'Compra recebida (insumo vinculado)', p_user, o.id);
  END LOOP;

  IF p_preco IS NOT NULL AND p_preco > 0 THEN
    UPDATE public.ingredients SET preco_ultima_compra = p_preco,
      preco_medio = CASE WHEN preco_medio > 0 THEN (preco_medio + p_preco)/2 ELSE p_preco END
    WHERE id = o.ingredient_id;
  END IF;

  -- Atualiza ordem com dados de recebimento e pagamento
  UPDATE public.purchase_orders
  SET status = 'concluida',
      quantidade_recebida = p_quantidade,
      preco_recebido = COALESCE(p_preco, o.preco_medio),
      valor_total = p_quantidade * COALESCE(p_preco, o.preco_medio, 0),
      pago = COALESCE(p_pago, true),
      data_vencimento = CASE WHEN COALESCE(p_pago, true) = false THEN p_vencimento ELSE NULL END,
      data_pagamento = CASE WHEN COALESCE(p_pago, true) = true THEN now() ELSE NULL END
  WHERE id = p_order;
END; $$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, numeric, numeric, boolean, date, uuid) TO authenticated;

-- Função auxiliar para quitar um vencimento (marcar como pago)
CREATE OR REPLACE FUNCTION public.pay_purchase_order(
  p_order uuid,
  p_user uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.purchase_orders;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status != 'concluida' THEN RAISE EXCEPTION 'Ordem ainda não foi recebida'; END IF;
  IF o.pago = true THEN RAISE EXCEPTION 'Ordem já está paga'; END IF;

  UPDATE public.purchase_orders
  SET pago = true,
      data_pagamento = now(),
      data_vencimento = NULL
  WHERE id = p_order;
END; $$;

GRANT EXECUTE ON FUNCTION public.pay_purchase_order(uuid, uuid) TO authenticated;
