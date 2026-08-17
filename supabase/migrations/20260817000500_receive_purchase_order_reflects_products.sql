-- ===== RECEIVE PURCHASE ORDER: reflete no estoque dos produtos vinculados =====
-- Ao receber uma compra de insumo, a quantidade recebida é somada ao estoque
-- dos produtos (salgados) vinculados a ele via recipe_items.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order uuid, p_quantidade numeric, p_preco numeric DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.purchase_orders;
BEGIN
  SELECT * INTO o FROM public.purchase_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status = 'concluida' THEN RAISE EXCEPTION 'Ordem já concluída'; END IF;

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

  UPDATE public.purchase_orders SET status='concluida' WHERE id = p_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, numeric, numeric, uuid) TO authenticated;