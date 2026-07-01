
-- ===== MOVEMENT APPLY: PRODUCTS =====
CREATE OR REPLACE FUNCTION public.fn_product_movement_apply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur numeric; nv numeric;
BEGIN
  SELECT quantidade_atual INTO cur FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  cur := COALESCE(cur,0);
  IF NEW.tipo = 'entrada' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo IN ('saida','perda') THEN nv := cur - NEW.quantidade;
  ELSIF NEW.tipo = 'ajuste' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo = 'inventario' THEN nv := NEW.quantidade;
  ELSE nv := cur; END IF;
  NEW.saldo_anterior := cur;
  NEW.saldo_novo := nv;
  UPDATE public.products SET quantidade_atual = nv WHERE id = NEW.product_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_product_movement_apply BEFORE INSERT ON public.product_movements
FOR EACH ROW EXECUTE FUNCTION public.fn_product_movement_apply();

-- ===== MOVEMENT APPLY: INGREDIENTS =====
CREATE OR REPLACE FUNCTION public.fn_ingredient_movement_apply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur numeric; nv numeric;
BEGIN
  SELECT quantidade_atual INTO cur FROM public.ingredients WHERE id = NEW.ingredient_id FOR UPDATE;
  cur := COALESCE(cur,0);
  IF NEW.tipo = 'entrada' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo IN ('saida','perda') THEN nv := cur - NEW.quantidade;
  ELSIF NEW.tipo = 'ajuste' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo = 'inventario' THEN nv := NEW.quantidade;
  ELSE nv := cur; END IF;
  NEW.saldo_anterior := cur;
  NEW.saldo_novo := nv;
  UPDATE public.ingredients SET quantidade_atual = nv WHERE id = NEW.ingredient_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_ingredient_movement_apply BEFORE INSERT ON public.ingredient_movements
FOR EACH ROW EXECUTE FUNCTION public.fn_ingredient_movement_apply();

-- ===== AUTO PRODUCTION ORDER (products) =====
CREATE OR REPLACE FUNCTION public.fn_product_autoorder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE necessaria numeric; rend numeric; open_exists boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.status = false THEN RETURN NEW; END IF;
  IF NEW.estoque_minimo <= 0 OR NEW.quantidade_atual > NEW.estoque_minimo THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM public.production_orders
    WHERE product_id = NEW.id AND kind='producao' AND status IN ('pendente','em_andamento') AND deleted_at IS NULL)
  INTO open_exists;
  IF open_exists THEN RETURN NEW; END IF;
  necessaria := GREATEST(NEW.estoque_ideal - NEW.quantidade_atual, 0);
  IF necessaria <= 0 THEN necessaria := NEW.estoque_minimo; END IF;
  rend := CASE WHEN NEW.tipo='frito' THEN 916 ELSE 350 END;
  INSERT INTO public.production_orders
    (kind, product_id, quantidade_necessaria, quantidade_atual, quantidade_ideal, tipo_massa, massadas, quantidade_estimada, auto_gerada, prioridade)
  VALUES ('producao', NEW.id, necessaria, NEW.quantidade_atual, NEW.estoque_ideal, NEW.tipo,
    ceil(necessaria/rend), ceil(necessaria/rend)*rend, true,
    CASE WHEN NEW.quantidade_atual <= 0 THEN 'alta'::order_priority ELSE 'media'::order_priority END);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_product_autoorder_ins AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_product_autoorder();
CREATE TRIGGER trg_product_autoorder_upd AFTER UPDATE OF quantidade_atual, estoque_minimo, estoque_ideal, status ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_product_autoorder();

-- ===== AUTO PRODUCTION ORDER (fillings) =====
CREATE OR REPLACE FUNCTION public.fn_filling_autoorder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE necessaria numeric; open_exists boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.estoque_minimo <= 0 OR NEW.quantidade_atual > NEW.estoque_minimo THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM public.production_orders
    WHERE filling_id = NEW.id AND kind='recheio' AND status IN ('pendente','em_andamento') AND deleted_at IS NULL)
  INTO open_exists;
  IF open_exists THEN RETURN NEW; END IF;
  necessaria := GREATEST(NEW.estoque_ideal - NEW.quantidade_atual, 0);
  IF necessaria <= 0 THEN necessaria := NEW.estoque_minimo; END IF;
  INSERT INTO public.production_orders
    (kind, filling_id, quantidade_necessaria, quantidade_atual, quantidade_ideal, auto_gerada, prioridade)
  VALUES ('recheio', NEW.id, necessaria, NEW.quantidade_atual, NEW.estoque_ideal, true,
    CASE WHEN NEW.quantidade_atual <= 0 THEN 'alta'::order_priority ELSE 'media'::order_priority END);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_filling_autoorder_ins AFTER INSERT ON public.fillings
FOR EACH ROW EXECUTE FUNCTION public.fn_filling_autoorder();
CREATE TRIGGER trg_filling_autoorder_upd AFTER UPDATE OF quantidade_atual, estoque_minimo, estoque_ideal ON public.fillings
FOR EACH ROW EXECUTE FUNCTION public.fn_filling_autoorder();

-- ===== AUTO PURCHASE ORDER (ingredients) =====
CREATE OR REPLACE FUNCTION public.fn_ingredient_autoorder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE necessaria numeric; open_exists boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.ativo = false THEN RETURN NEW; END IF;
  IF NEW.estoque_minimo <= 0 OR NEW.quantidade_atual > NEW.estoque_minimo THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM public.purchase_orders
    WHERE ingredient_id = NEW.id AND status IN ('pendente','em_andamento') AND deleted_at IS NULL)
  INTO open_exists;
  IF open_exists THEN RETURN NEW; END IF;
  necessaria := GREATEST(NEW.estoque_ideal - NEW.quantidade_atual, 0);
  IF necessaria <= 0 THEN necessaria := NEW.estoque_minimo; END IF;
  INSERT INTO public.purchase_orders
    (ingredient_id, supplier_id, quantidade_necessaria, preco_medio, auto_gerada, prioridade)
  VALUES (NEW.id, NEW.supplier_id, necessaria, NEW.preco_medio, true,
    CASE WHEN NEW.quantidade_atual <= 0 THEN 'alta'::order_priority ELSE 'media'::order_priority END);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_ingredient_autoorder_ins AFTER INSERT ON public.ingredients
FOR EACH ROW EXECUTE FUNCTION public.fn_ingredient_autoorder();
CREATE TRIGGER trg_ingredient_autoorder_upd AFTER UPDATE OF quantidade_atual, estoque_minimo, estoque_ideal, ativo ON public.ingredients
FOR EACH ROW EXECUTE FUNCTION public.fn_ingredient_autoorder();

-- ===== START PRODUCTION ORDER (consume inputs) =====
CREATE OR REPLACE FUNCTION public.start_production_order(p_order uuid, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.production_orders; ri record;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status <> 'pendente' THEN RAISE EXCEPTION 'Ordem já iniciada ou finalizada'; END IF;

  IF o.kind = 'producao' AND o.product_id IS NOT NULL THEN
    FOR ri IN SELECT * FROM public.recipe_items WHERE product_id = o.product_id LOOP
      IF ri.ingredient_id IS NOT NULL THEN
        INSERT INTO public.ingredient_movements (ingredient_id, tipo, quantidade, motivo, user_id, ref_order_id)
        VALUES (ri.ingredient_id, 'saida', ri.quantidade * o.quantidade_necessaria, 'Consumo produção', p_user, o.id);
      ELSIF ri.filling_id IS NOT NULL THEN
        UPDATE public.fillings SET quantidade_atual = quantidade_atual - (ri.quantidade * o.quantidade_necessaria)
        WHERE id = ri.filling_id;
      END IF;
    END LOOP;
  ELSIF o.kind = 'recheio' AND o.filling_id IS NOT NULL THEN
    FOR ri IN SELECT * FROM public.filling_recipe_items WHERE filling_id = o.filling_id LOOP
      INSERT INTO public.ingredient_movements (ingredient_id, tipo, quantidade, motivo, user_id, ref_order_id)
      VALUES (ri.ingredient_id, 'saida', ri.quantidade * o.quantidade_necessaria, 'Consumo recheio', p_user, o.id);
    END LOOP;
  END IF;

  UPDATE public.production_orders SET status='em_andamento', inicio=now() WHERE id = p_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_production_order(uuid, uuid) TO authenticated;

-- ===== COMPLETE PRODUCTION ORDER (add output to stock) =====
CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order uuid, p_produzida numeric, p_perdas numeric DEFAULT 0, p_obs text DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.production_orders;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status = 'concluida' THEN RAISE EXCEPTION 'Ordem já concluída'; END IF;

  IF o.kind = 'producao' AND o.product_id IS NOT NULL THEN
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (o.product_id, 'entrada', p_produzida, 'Produção', 'Ordem #'||o.numero, p_user, o.id);
  ELSIF o.kind = 'recheio' AND o.filling_id IS NOT NULL THEN
    UPDATE public.fillings SET quantidade_atual = quantidade_atual + p_produzida WHERE id = o.filling_id;
  END IF;

  UPDATE public.production_orders
  SET status='concluida', fim=now(), quantidade_produzida=p_produzida, perdas=COALESCE(p_perdas,0),
      observacoes = COALESCE(p_obs, observacoes)
  WHERE id = p_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_production_order(uuid, numeric, numeric, text, uuid) TO authenticated;

-- ===== RECEIVE PURCHASE ORDER (add ingredient stock) =====
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

  IF p_preco IS NOT NULL AND p_preco > 0 THEN
    UPDATE public.ingredients SET preco_ultima_compra = p_preco,
      preco_medio = CASE WHEN preco_medio > 0 THEN (preco_medio + p_preco)/2 ELSE p_preco END
    WHERE id = o.ingredient_id;
  END IF;

  UPDATE public.purchase_orders SET status='concluida' WHERE id = p_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, numeric, numeric, uuid) TO authenticated;

-- ===== REALTIME =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingredients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fillings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.production_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingredient_movements;
