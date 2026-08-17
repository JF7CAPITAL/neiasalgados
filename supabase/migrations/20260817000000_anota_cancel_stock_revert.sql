-- ===================================================================
-- MIGRATION 9: Devolve ao estoque os itens de pedidos Anota cancelados
-- ===================================================================

-- Garante que a baixa de estoque registre ref_order_id, permitindo
-- identificar/reverter as movimentações de cada pedido.
CREATE OR REPLACE FUNCTION public.apply_anota_order_stock(p_order uuid, p_user uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE o public.anota_orders; it record;
BEGIN
  SELECT * INTO o FROM public.anota_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF o.estoque_aplicado THEN RETURN; END IF;
  IF o.check_status NOT IN (1, 3) THEN RETURN; END IF;

  FOR it IN
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND mapeado = true AND product_id IS NOT NULL AND quantidade > 0
  LOOP
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (it.product_id, 'saida', it.quantidade, 'Anota AI', 'Venda Anota AI – Pedido '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = true WHERE id = p_order;
END; $function$;

-- Credita de volta ao estoque os itens debitados de um pedido cancelado (4)
-- ou negado (5). Idempotente: só age enquanto estoque_aplicado = true.
CREATE OR REPLACE FUNCTION public.revert_anota_order_stock(p_order uuid, p_user uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE o public.anota_orders; it record;
BEGIN
  SELECT * INTO o FROM public.anota_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF NOT o.estoque_aplicado THEN RETURN; END IF;
  IF o.check_status NOT IN (4, 5) THEN RETURN; END IF;

  FOR it IN
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND mapeado = true AND product_id IS NOT NULL AND quantidade > 0
  LOOP
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (it.product_id, 'entrada', it.quantidade, 'Anota AI', 'Cancelamento Anota AI – Pedido '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = false WHERE id = p_order;
END; $function$;

GRANT EXECUTE ON FUNCTION public.revert_anota_order_stock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_anota_order_stock(uuid, uuid) TO service_role;