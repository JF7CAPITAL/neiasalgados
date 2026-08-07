-- ===================================================================
-- NEIA SALGADOS – SCHEMA COMPLETO
-- Combina todas as migrations na ordem correta de criação
-- ===================================================================

-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('admin','producao','estoque','compras','financeiro','rh','operacional');
CREATE TYPE public.massa_tipo AS ENUM ('frito','assado');
CREATE TYPE public.order_status AS ENUM ('pendente','em_andamento','concluida','cancelada');
CREATE TYPE public.order_priority AS ENUM ('baixa','media','alta','urgente');
CREATE TYPE public.order_kind AS ENUM ('producao','recheio','compra');
CREATE TYPE public.movement_type AS ENUM ('entrada','saida','ajuste','perda','inventario');

-- ========== UPDATED_AT HELPER ==========
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- ========== PROFILES ==========
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '',
  email text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== USER ROLES ==========
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- !! has_role PRECISA vir ANTES das policies que a usam !!
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "roles_select_auth" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ========== NEW USER HANDLER (first user = admin) ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count int;
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);
  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count <= 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operacional');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== SUPPLIERS ==========
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  contato text, telefone text, email text, observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_all_auth" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== INGREDIENTS (almoxarifado) ==========
CREATE TABLE public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  codigo text,
  unidade text NOT NULL DEFAULT 'kg',
  quantidade_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  estoque_ideal numeric NOT NULL DEFAULT 0,
  estoque_maximo numeric NOT NULL DEFAULT 0,
  preco_medio numeric NOT NULL DEFAULT 0,
  preco_ultima_compra numeric NOT NULL DEFAULT 0,
  localizacao text, validade date, lote text, observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredients TO authenticated;
GRANT ALL ON public.ingredients TO service_role;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ingredients_all_auth" ON public.ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ingredients_updated BEFORE UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== PRODUCTS ==========
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  tipo massa_tipo NOT NULL DEFAULT 'frito',
  codigo text,
  unidade text NOT NULL DEFAULT 'un',
  peso numeric NOT NULL DEFAULT 0,
  peso_recheio numeric NOT NULL DEFAULT 0,
  peso_massa numeric NOT NULL DEFAULT 0,
  status boolean NOT NULL DEFAULT true,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  estoque_ideal numeric NOT NULL DEFAULT 0,
  estoque_maximo numeric NOT NULL DEFAULT 0,
  quantidade_atual numeric NOT NULL DEFAULT 0,
  quantidade_reservada numeric NOT NULL DEFAULT 0,
  foto_url text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_all_auth" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== FILLINGS (recheios) ==========
CREATE TABLE public.fillings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  codigo text,
  unidade text NOT NULL DEFAULT 'kg',
  quantidade_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL DEFAULT 0,
  estoque_ideal numeric NOT NULL DEFAULT 0,
  estoque_maximo numeric NOT NULL DEFAULT 0,
  observacoes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fillings TO authenticated;
GRANT ALL ON public.fillings TO service_role;
ALTER TABLE public.fillings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fillings_all_auth" ON public.fillings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_fillings_updated BEFORE UPDATE ON public.fillings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== RECIPE ITEMS (BOM) for products ==========
CREATE TABLE public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE CASCADE,
  filling_id uuid REFERENCES public.fillings(id) ON DELETE CASCADE,
  quantidade numeric NOT NULL DEFAULT 0,
  unidade text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_items TO authenticated;
GRANT ALL ON public.recipe_items TO service_role;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipe_items_all_auth" ON public.recipe_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== FILLING RECIPE ITEMS ==========
CREATE TABLE public.filling_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filling_id uuid NOT NULL REFERENCES public.fillings(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantidade numeric NOT NULL DEFAULT 0,
  unidade text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.filling_recipe_items TO authenticated;
GRANT ALL ON public.filling_recipe_items TO service_role;
ALTER TABLE public.filling_recipe_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "filling_recipe_items_all_auth" ON public.filling_recipe_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== PRODUCT MOVEMENTS ==========
CREATE TABLE public.product_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tipo movement_type NOT NULL,
  quantidade numeric NOT NULL,
  saldo_anterior numeric,
  saldo_novo numeric,
  destino text,
  observacoes text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ref_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_movements TO authenticated;
GRANT ALL ON public.product_movements TO service_role;
ALTER TABLE public.product_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_movements_all_auth" ON public.product_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== INGREDIENT MOVEMENTS ==========
CREATE TABLE public.ingredient_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  tipo movement_type NOT NULL,
  quantidade numeric NOT NULL,
  saldo_anterior numeric,
  saldo_novo numeric,
  motivo text,
  observacoes text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ref_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_movements TO authenticated;
GRANT ALL ON public.ingredient_movements TO service_role;
ALTER TABLE public.ingredient_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ingredient_movements_all_auth" ON public.ingredient_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========== PRODUCTION ORDERS ==========
CREATE TABLE public.production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY,
  kind order_kind NOT NULL DEFAULT 'producao',
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  filling_id uuid REFERENCES public.fillings(id) ON DELETE CASCADE,
  quantidade_necessaria numeric NOT NULL DEFAULT 0,
  quantidade_atual numeric NOT NULL DEFAULT 0,
  quantidade_ideal numeric NOT NULL DEFAULT 0,
  massadas numeric NOT NULL DEFAULT 0,
  tipo_massa massa_tipo,
  quantidade_estimada numeric NOT NULL DEFAULT 0,
  prioridade order_priority NOT NULL DEFAULT 'media',
  status order_status NOT NULL DEFAULT 'pendente',
  responsavel text,
  previsao date,
  inicio timestamptz,
  fim timestamptz,
  quantidade_produzida numeric,
  perdas numeric DEFAULT 0,
  observacoes text,
  auto_gerada boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
GRANT ALL ON public.production_orders TO service_role;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_orders_all_auth" ON public.production_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_production_orders_updated BEFORE UPDATE ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== PURCHASE ORDERS ==========
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  quantidade_necessaria numeric NOT NULL DEFAULT 0,
  preco_medio numeric NOT NULL DEFAULT 0,
  prioridade order_priority NOT NULL DEFAULT 'media',
  status order_status NOT NULL DEFAULT 'pendente',
  responsavel text,
  observacoes text,
  auto_gerada boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_orders_all_auth" ON public.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_purchase_orders_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== COLLABORATORS ==========
CREATE TABLE public.collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cpf text, rg text, telefone text, celular text, email text, endereco text,
  cargo text,
  data_admissao date,
  status text NOT NULL DEFAULT 'ativo',
  turno text, horario text, escala text,
  banco_horas numeric DEFAULT 0,
  observacoes text,
  foto_url text,
  em_turno boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborators TO authenticated;
GRANT ALL ON public.collaborators TO service_role;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collaborators_all_auth" ON public.collaborators FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_collaborators_updated BEFORE UPDATE ON public.collaborators FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== ACTIVITY LOGS ==========
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acao text NOT NULL,
  modulo text NOT NULL,
  registro_id text,
  detalhes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_logs_select_auth" ON public.activity_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_logs_insert_auth" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ===================================================================
-- MIGRATION 2: triggers de movimentação, auto-order, start/complete/receive
-- ===================================================================

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

-- ===== START PRODUCTION ORDER (v1 – will be replaced by migração 3) =====
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

-- ===== COMPLETE PRODUCTION ORDER (v1 – will be replaced by migração 3) =====
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

-- ===== RECEIVE PURCHASE ORDER =====
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

-- ===================================================================
-- MIGRATION 3: filling_movements, movimento de recheio no histórico
-- ===================================================================

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

-- Trigger que aplica o movimento ao saldo do recheio
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

-- start_production_order v2: grava consumo de recheio no histórico
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

-- complete_production_order v2: grava produção de recheio no histórico
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
    VALUES (o.filling_id, 'entrada', p_produzida, 'Produção recheio – Ordem #'||o.numero, p_user, o.id);
  END IF;

  UPDATE public.production_orders
  SET status='concluida', fim=now(), quantidade_produzida=p_produzida, perdas=COALESCE(p_perdas,0),
      observacoes = COALESCE(p_obs, observacoes)
  WHERE id = p_order;
END; $function$;

-- ===================================================================
-- MIGRATION 4: Anota AI tables + apply_anota_order_stock
-- ===================================================================

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
CREATE INDEX idx_anota_order_items_ref ON public.anota_order_items(anota_item_ref);
-- Evita duplicatas de itens (causa de estoque divergente)
ALTER TABLE public.anota_order_items ADD CONSTRAINT uq_anota_order_items UNIQUE (order_id, anota_item_ref);

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
    INSERT INTO public.product_movements (product_id, tipo, quantidade, destino, observacoes, user_id, ref_order_id)
    VALUES (it.product_id, 'saida', it.quantidade, 'Anota AI', 'Venda Anota AI – Pedido '||COALESCE(o.numero, o.external_order_id), p_user, p_order);
  END LOOP;

  UPDATE public.anota_orders SET estoque_aplicado = true WHERE id = p_order;
END; $function$;

-- ===================================================================
-- MIGRATION 5: Integração WhatsApp (Waha) — notificações de pedidos
-- ===================================================================

-- Colunas de controle de notificação e vínculo de motoboy nos pedidos Anota
ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS motoboy_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_ready_notified_at timestamptz;

-- Configurações do WhatsApp (chave/valor): templates de mensagem e toggle
CREATE TABLE public.whatsapp_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar configurações WhatsApp" ON public.whatsapp_settings
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_settings_updated BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Templates padrão (usados se o usuário não personalizar)
INSERT INTO public.whatsapp_settings (key, value) VALUES
  ('whatsapp_enabled', 'true'),
  ('template_pedido_recebido', 'Neia Salgados: recebemos seu pedido #{{numero}} no valor de R$ {{total}}. Já estamos preparando!'),
  ('template_pedido_pronto', 'Neia Salgados: seu pedido #{{numero}} está pronto!'),
  ('template_motoboy_pronto', 'Neia Salgados: pedido #{{numero}} ({{cliente}}) está pronto para entrega.')
ON CONFLICT (key) DO NOTHING;

-- Log de envios do WhatsApp
CREATE TABLE public.whatsapp_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  ref_type text,
  ref_id text,
  destino text,
  tipo text,
  mensagem text,
  status text NOT NULL,
  error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar logs WhatsApp" ON public.whatsapp_logs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_whatsapp_logs_created ON public.whatsapp_logs(created_at DESC);

-- ===================================================================
-- MIGRATION 6: Mensagens configuráveis por status do pedido (Anota)
-- ===================================================================

-- Controle de anti-duplicação por status (quais status já notificados)
ALTER TABLE public.anota_orders
  ADD COLUMN IF NOT EXISTS whatsapp_statuses_notified text[] NOT NULL DEFAULT '{}';

-- Configuração dos templates por status (JSON): [{"status": 1, "message": "..."}]
INSERT INTO public.whatsapp_settings (key, value) VALUES
  ('status_messages', '[]')
ON CONFLICT (key) DO NOTHING;

-- ===================================================================

-- ===================================================================
-- MIGRATION 7: Notificações automáticas do WhatsApp (tabela própria)
-- Substitui o armazenamento em JSON (whatsapp_settings.status_messages)
-- por uma tabela dedicada, com suporte a imagem junto do texto.
-- ===================================================================

-- Garante a tabela de configurações do WhatsApp (caso a MIGRATION 5 não
-- tenha sido aplicada no banco, evitando o erro de schema cache).
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_settings'
  ) THEN
    ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Equipe pode gerenciar configurações WhatsApp" ON public.whatsapp_settings
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_whatsapp_settings_updated'
      AND tgrelid = 'public.whatsapp_settings'::regclass
  ) THEN
    CREATE TRIGGER trg_whatsapp_settings_updated BEFORE UPDATE ON public.whatsapp_settings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Configuração padrão (toggle liga/desliga)
INSERT INTO public.whatsapp_settings (key, value) VALUES ('whatsapp_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------
-- Tabela de notificações automáticas
--   regra: identificador do disparo
--     - 'pedido_recebido'  -> pedido entrou (cliente)
--     - 'pedido_pronto'    -> pedido pronto (cliente)
--     - 'motoboy'          -> pedido pronto (motoboy vinculado)
--     - 'status_<N>'       -> pedido mudou para o status N
--   imagem_url: URL pública da imagem enviada junto com o texto
-- -------------------------------------------------------------------
CREATE TABLE public.whatsapp_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  regra text NOT NULL UNIQUE,
  titulo text NOT NULL DEFAULT '',
  mensagem text NOT NULL DEFAULT '',
  status integer,
  imagem_url text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_notifications TO authenticated;
GRANT ALL ON public.whatsapp_notifications TO service_role;
ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe pode gerenciar notificações WhatsApp" ON public.whatsapp_notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_whatsapp_notifications_updated BEFORE UPDATE ON public.whatsapp_notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Notificações fixas (templates que antes ficavam em whatsapp_settings)
INSERT INTO public.whatsapp_notifications (regra, titulo, mensagem, ativo) VALUES
  ('pedido_recebido', 'Pedido recebido',
   'Neia Salgados: recebemos seu pedido #{{numero}} no valor de R$ {{total}}. Já estamos preparando!', true),
  ('pedido_pronto', 'Pedido pronto (cliente)',
   'Neia Salgados: seu pedido #{{numero}} está pronto!', true),
  ('motoboy', 'Pedido pronto para entrega (motoboy)',
   'Neia Salgados: pedido #{{numero}} ({{cliente}}) está pronto para entrega.', true)
ON CONFLICT (regra) DO NOTHING;

-- -------------------------------------------------------------------
-- Storage público para as imagens das notificações
-- -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-notifications', 'whatsapp-notifications', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read whatsapp notifications" ON storage.objects;
CREATE POLICY "Public read whatsapp notifications" ON storage.objects
  FOR SELECT USING (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth upload whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth upload whatsapp notifications" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth update whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth update whatsapp notifications" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'whatsapp-notifications');

DROP POLICY IF EXISTS "Auth delete whatsapp notifications" ON storage.objects;
CREATE POLICY "Auth delete whatsapp notifications" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'whatsapp-notifications');
