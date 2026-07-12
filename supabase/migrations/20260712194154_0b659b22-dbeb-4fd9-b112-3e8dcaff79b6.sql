-- 1. Histórico de movimentações de recheio
CREATE TABLE public.filling_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filling_id uuid NOT NULL REFERENCES public.fillings(id) ON DELETE CASCADE,
  tipo movement_type NOT NULL,
  quantidade numeric NOT NULL DEFAULT 0,
  saldo_anterior numeric,
  saldo_novo numeric,
  motivo text,
  observacoes text,
  user_id uuid,
  ref_order_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.filling_movements TO authenticated;
GRANT ALL ON public.filling_movements TO service_role;

ALTER TABLE public.filling_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read filling movements"
  ON public.filling_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert filling movements"
  ON public.filling_movements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admin can delete filling movements"
  ON public.filling_movements FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_filling_movements_created_at ON public.filling_movements(created_at);
CREATE INDEX idx_filling_movements_filling_id ON public.filling_movements(filling_id);

-- 2. Trigger que aplica o movimento ao saldo do recheio
CREATE OR REPLACE FUNCTION public.fn_filling_movement_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cur numeric; nv numeric;
BEGIN
  SELECT quantidade_atual INTO cur FROM public.fillings WHERE id = NEW.filling_id FOR UPDATE;
  cur := COALESCE(cur,0);
  IF NEW.tipo = 'entrada' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo IN ('saida','perda') THEN nv := cur - NEW.quantidade;
  ELSIF NEW.tipo = 'ajuste' THEN nv := cur + NEW.quantidade;
  ELSIF NEW.tipo = 'inventario' THEN nv := NEW.quantidade;
  ELSE nv := cur; END IF;
  NEW.saldo_anterior := cur;
  NEW.saldo_novo := nv;
  UPDATE public.fillings SET quantidade_atual = nv WHERE id = NEW.filling_id;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_filling_movement_apply
  BEFORE INSERT ON public.filling_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_filling_movement_apply();

-- 3. start_production_order agora grava consumo de recheio no histórico
CREATE OR REPLACE FUNCTION public.start_production_order(p_order uuid, p_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        INSERT INTO public.filling_movements (filling_id, tipo, quantidade, motivo, user_id, ref_order_id)
        VALUES (ri.filling_id, 'saida', ri.quantidade * o.quantidade_necessaria, 'Consumo produção', p_user, o.id);
      END IF;
    END LOOP;
  ELSIF o.kind = 'recheio' AND o.filling_id IS NOT NULL THEN
    FOR ri IN SELECT * FROM public.filling_recipe_items WHERE filling_id = o.filling_id LOOP
      INSERT INTO public.ingredient_movements (ingredient_id, tipo, quantidade, motivo, user_id, ref_order_id)
      VALUES (ri.ingredient_id, 'saida', ri.quantidade * o.quantidade_necessaria, 'Consumo recheio', p_user, o.id);
    END LOOP;
  END IF;

  UPDATE public.production_orders SET status='em_andamento', inicio=now() WHERE id = p_order;
END; $function$;

-- 4. complete_production_order grava produção de recheio no histórico
CREATE OR REPLACE FUNCTION public.complete_production_order(p_order uuid, p_produzida numeric, p_perdas numeric DEFAULT 0, p_obs text DEFAULT NULL::text, p_user uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o public.production_orders;
BEGIN
  SELECT * INTO o FROM public.production_orders WHERE id = p_order;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ordem não encontrada'; END IF;
  IF o.status = 'concluida' THEN RAISE EXCEPTION 'Ordem já concluída'; END IF;

  IF o.kind = 'producao' AND o.product_id IS NOT NULL THEN
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (o.product_id, 'entrada', p_produzida, 'Produção', 'Ordem #'||o.numero, p_user, o.id);
  ELSIF o.kind = 'recheio' AND o.filling_id IS NOT NULL THEN
    INSERT INTO public.filling_movements (filling_id, tipo, quantidade, motivo, user_id, ref_order_id)
    VALUES (o.filling_id, 'entrada', p_produzida, 'Produção recheio — Ordem #'||o.numero, p_user, o.id);
  END IF;

  UPDATE public.production_orders
  SET status='concluida', fim=now(), quantidade_produzida=p_produzida, perdas=COALESCE(p_perdas,0),
      observacoes = COALESCE(p_obs, observacoes)
  WHERE id = p_order;
END; $function$;