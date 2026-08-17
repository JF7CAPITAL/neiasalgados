-- ===================================================================
-- MIGRATION 11: Composição de combos Anota AI (receita por item)
-- ===================================================================
-- Combos como "Combo 1 mini salgados fritos" chegam com quantidade mista/
-- aleatória de salgados. O usuário define uma composição (produtos do sistema
-- + quantidade de cada um) por item/combo. A baixa de estoque passa a debitar
-- a composição configurada em vez do item único.

-- Receita de um combo: combo_ref -> (product_id, quantidade)
CREATE TABLE public.anota_combo_item_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combo_ref text NOT NULL,
  nome text,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantidade numeric NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_anota_combo_item_map_ref_product ON public.anota_combo_item_map(combo_ref, product_id);
CREATE INDEX idx_anota_combo_item_map_ref ON public.anota_combo_item_map(combo_ref);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anota_combo_item_map TO authenticated;
GRANT ALL ON public.anota_combo_item_map TO service_role;
ALTER TABLE public.anota_combo_item_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar composicao de combos Anota" ON public.anota_combo_item_map
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'estoque')
    OR public.has_role(auth.uid(),'compras') OR public.has_role(auth.uid(),'producao')
    OR public.has_role(auth.uid(),'operacional')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'estoque')
    OR public.has_role(auth.uid(),'compras') OR public.has_role(auth.uid(),'producao')
    OR public.has_role(auth.uid(),'operacional')
  );
CREATE TRIGGER trg_anota_combo_item_map_updated BEFORE UPDATE ON public.anota_combo_item_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marca itens que são combos (contêineres) e registra o combo pai de cada filho.
ALTER TABLE public.anota_order_items ADD COLUMN is_combo boolean NOT NULL DEFAULT false;
ALTER TABLE public.anota_order_items ADD COLUMN combo_ref text;
CREATE INDEX idx_anota_order_items_combo_ref ON public.anota_order_items(combo_ref);

-- Baixa de estoque ciente de composição de combos.
-- 1) Itens (combos ou avulsos) com composição configurada: debita cada produto
--    da composição na quantidade da composicao x quantidade do item no pedido.
-- 2) Demais itens mapeados (inclusive filhos de combos SEM composição): debita
--    como antes. Filhos de combos COM composição são ignorados.
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
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND quantidade > 0 AND combo_ref IS NULL
      AND EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.anota_item_ref
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
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND mapeado = true AND product_id IS NOT NULL AND quantidade > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.anota_item_ref
      )
      AND (combo_ref IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.combo_ref
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

-- Reversão (cancelamento) ciente de composição de combos.
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
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND quantidade > 0 AND combo_ref IS NULL
      AND EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.anota_item_ref
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
    SELECT * FROM public.anota_order_items
    WHERE order_id = p_order AND mapeado = true AND product_id IS NOT NULL AND quantidade > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.anota_item_ref
      )
      AND (combo_ref IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.anota_combo_item_map cm WHERE cm.combo_ref = it.combo_ref
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