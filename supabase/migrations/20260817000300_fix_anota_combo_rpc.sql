-- ===================================================================
-- MIGRATION 12: Correção dos RPCs de baixa/reversão de combos
-- ===================================================================
-- As queries dos loops FOR referenciam a variável de loop `it` dentro
-- da própria consulta (EXISTS ... cm.combo_ref = it.anota_item_ref), o
-- que é inválido em PL/pgSQL ("record it is not assigned yet"). Usa-se
-- um alias (oi) para a tabela externa nas subconsultas correlacionadas.

CREATE OR REPLACE FUNCTION public.apply_anota_order_stock(p_order uuid, p_user uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE o public.anota_orders; it record; r record;
BEGIN
  SELECT * INTO o FROM public.anota_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF o.estoque_aplicado THEN RETURN; END IF;
  IF o.check_status NOT IN (1, 2, 3) THEN RETURN; END IF;

  FOR it IN
    SELECT oi.* FROM public.anota_order_items oi
    WHERE oi.order_id = p_order AND oi.quantidade > 0 AND oi.combo_ref IS NULL
      AND EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.anota_item_ref
      )
  LOOP
    FOR r IN
      SELECT cm.product_id, cm.quantidade FROM public.anota_combo_item_map cm
      WHERE cm.combo_ref = it.anota_item_ref AND cm.quantidade > 0
    LOOP
      INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
      VALUES (r.product_id, 'saida', r.quantidade * it.quantidade, 'Anota AI',
        'Venda Anota AI – Combo '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
    END LOOP;
  END LOOP;

  FOR it IN
    SELECT oi.* FROM public.anota_order_items oi
    WHERE oi.order_id = p_order AND oi.mapeado = true AND oi.product_id IS NOT NULL AND oi.quantidade > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.anota_item_ref
      )
      AND (oi.combo_ref IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.combo_ref
      ))
  LOOP
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (it.product_id, 'saida', it.quantidade, 'Anota AI',
      'Venda Anota AI – Pedido '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = true WHERE id = p_order;
END; $function$;

GRANT EXECUTE ON FUNCTION public.apply_anota_order_stock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_anota_order_stock(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revert_anota_order_stock(p_order uuid, p_user uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE o public.anota_orders; it record; r record;
BEGIN
  SELECT * INTO o FROM public.anota_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF NOT o.estoque_aplicado THEN RETURN; END IF;
  IF o.check_status NOT IN (4, 5) THEN RETURN; END IF;

  FOR it IN
    SELECT oi.* FROM public.anota_order_items oi
    WHERE oi.order_id = p_order AND oi.quantidade > 0 AND oi.combo_ref IS NULL
      AND EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.anota_item_ref
      )
  LOOP
    FOR r IN
      SELECT cm.product_id, cm.quantidade FROM public.anota_combo_item_map cm
      WHERE cm.combo_ref = it.anota_item_ref AND cm.quantidade > 0
    LOOP
      INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
      VALUES (r.product_id, 'entrada', r.quantidade * it.quantidade, 'Anota AI',
        'Cancelamento Anota AI – Combo '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
    END LOOP;
  END LOOP;

  FOR it IN
    SELECT oi.* FROM public.anota_order_items oi
    WHERE oi.order_id = p_order AND oi.mapeado = true AND oi.product_id IS NOT NULL AND oi.quantidade > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.anota_item_ref
      )
      AND (oi.combo_ref IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = oi.combo_ref
      ))
  LOOP
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (it.product_id, 'entrada', it.quantidade, 'Anota AI',
      'Cancelamento Anota AI – Pedido '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = false WHERE id = p_order;
END; $function$;

GRANT EXECUTE ON FUNCTION public.revert_anota_order_stock(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_anota_order_stock(uuid, uuid) TO service_role;
