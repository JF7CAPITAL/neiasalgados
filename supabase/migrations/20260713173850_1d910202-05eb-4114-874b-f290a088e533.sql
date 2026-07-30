
-- Mapeamento item do cardápio Anota AI -> produto do sistema
CREATE TABLE public.anota_product_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  anota_item_ref text NOT NULL UNIQUE,
  nome text,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anota_product_map TO authenticated;
GRANT ALL ON public.anota_product_map TO service_role;
ALTER TABLE public.anota_product_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar mapeamento Anota" ON public.anota_product_map
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

-- Pedidos importados do Anota AI
CREATE TABLE public.anota_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_order_id text NOT NULL UNIQUE,
  numero text,
  check_status int NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  cliente text,
  pedido_em timestamptz,
  payload jsonb,
  estoque_aplicado boolean NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anota_orders TO authenticated;
GRANT ALL ON public.anota_orders TO service_role;
ALTER TABLE public.anota_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar pedidos Anota" ON public.anota_orders
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

-- Itens de cada pedido importado
CREATE TABLE public.anota_order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.anota_orders(id) ON DELETE CASCADE,
  anota_item_ref text,
  nome text,
  quantidade numeric NOT NULL DEFAULT 0,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  mapeado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anota_order_items TO authenticated;
GRANT ALL ON public.anota_order_items TO service_role;
ALTER TABLE public.anota_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar itens Anota" ON public.anota_order_items
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

CREATE INDEX idx_anota_order_items_order ON public.anota_order_items(order_id);
CREATE INDEX idx_anota_order_items_product ON public.anota_order_items(product_id);

-- Triggers de updated_at
CREATE TRIGGER trg_anota_product_map_updated BEFORE UPDATE ON public.anota_product_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_anota_orders_updated BEFORE UPDATE ON public.anota_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Aplica a baixa de estoque de um pedido finalizado (idempotente)
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
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id)
    VALUES (it.product_id, 'saida', it.quantidade, 'Anota AI', 'Venda Anota AI — Pedido '||COALESCE(o.numero, o.external_order_id), p_user);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = true WHERE id = p_order;
END; $function$;
