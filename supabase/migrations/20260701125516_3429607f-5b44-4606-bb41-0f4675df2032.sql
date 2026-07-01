
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
