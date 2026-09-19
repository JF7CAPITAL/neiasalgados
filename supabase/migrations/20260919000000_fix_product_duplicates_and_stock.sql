-- ===================================================================
-- MIGRATION: Corrige duplicatas de produtos (Crokete/croquete) e garante
-- que ordens de produção concluídas sempre atualizem o estoque visível.
-- ===================================================================
-- Problema:
-- 1) Dropdown "Nova ordem de produção" em ordens.tsx listava produtos
--    com deleted_at not null, gerando duplicatas tipo "Crokete"/"croquete"
--    e ordens 274-281 apontando para produtos deletados (invisíveis no estoque).
-- 2) Nomes com espaços à direita ("esfiha de brocolis ") geravam duplicata.
-- 3) Sem constraint case-insensitive, novas duplicatas poderiam ser criadas.
--
-- Esta migration é idempotente e reflete o fix já aplicado via API em 19/09/2026.

-- 1. Normaliza nomes com trim (produtos e recheios)
UPDATE public.products SET nome = trim(nome) WHERE nome <> trim(nome);
UPDATE public.fillings SET nome = trim(nome) WHERE nome <> trim(nome);

-- 2. Garante índice único case-insensitive apenas para produtos ativos
--    Evita recriar "Crokete" quando "croquete" já existe como ativo.
--    Usa lower(trim(nome)) para cobrir variações de caixa e espaços.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_nome_active
  ON public.products (lower(trim(nome)))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fillings_nome_active
  ON public.fillings (lower(trim(nome)))
  WHERE deleted_at IS NULL;

-- 3. Trigger opcional para auto-trim em inserts/updates futuros (idempotente)
CREATE OR REPLACE FUNCTION public.fn_products_trim_nome()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.nome := trim(NEW.nome);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_products_trim_nome ON public.products;
CREATE TRIGGER trg_products_trim_nome
  BEFORE INSERT OR UPDATE OF nome ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_products_trim_nome();

CREATE OR REPLACE FUNCTION public.fn_fillings_trim_nome()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.nome := trim(NEW.nome);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_fillings_trim_nome ON public.fillings;
CREATE TRIGGER trg_fillings_trim_nome
  BEFORE INSERT OR UPDATE OF nome ON public.fillings
  FOR EACH ROW EXECUTE FUNCTION public.fn_fillings_trim_nome();

-- 4. Reativa produtos deletados que não possuem par ativo (caso ainda existam)
--    Ex: Doguinho, Bolinho de Calabresa, Bolinho de Milho — possuem ordens
--    mas nenhum ativo com mesmo nome. Sem reativar, ordens pendentes
--    ficariam órfãs.
UPDATE public.products
SET deleted_at = NULL
WHERE id IN (
  'f459bde2-4af0-4cd7-808e-337e718a9eee', -- Doguinho
  'a162b905-0d41-45c5-a149-4dcdbd99282c', -- Bolinho de Calabresa
  '4d7d7158-3937-4dca-94b6-5a3539e9dfce'  -- Bolinho de Milho
) AND deleted_at IS NOT NULL;

-- 5. Remapeia ordens pendentes/em_andamento que ainda apontam para produtos
--    deletados com par ativo (idempotente — só afeta ordens ainda não corrigidas)
--    Mapeamentos exatos lower(trim):
--      Empada de Frango (773c...) -> empada de frango (7fa6...)
--      Empada de Palmito (e9ff...) -> empada de palmito (94be...)
--      Esfiha de Carne (b905...) -> esfiha de carne (add1...)
--      Esfiha de Frango (9921...) -> esfiha de frango (bc38...)
--      Esfiha de Brocolis (3f3d...) -> esfiha de brocolis (1f5c... trim)
--      Enroladinho... (1f55...) -> enroladinho... (3742...)
--      Bolinho de Azeitona (c7e9...) -> bolinho de azeitona (f7b1...)
--      Bolinho de Queijo (bc9b...) -> bolinho de queijo (e489...)
--      Kibe (46b5...) -> kibe (26fb...)
--      Hamburguinho (d91c...) -> hamburguinho (fb6b...)
--      Crokete (f306...) -> croquete (47ff...) — typo k/qu
DO $$
DECLARE
  mapping RECORD;
BEGIN
  FOR mapping IN
    SELECT * FROM (VALUES
      ('773c94e7-83ee-4025-af59-019c095f67d6'::uuid, '7fa6349a-c8c7-4c03-a441-d7475310f702'::uuid),
      ('e9fff149-78bd-4b70-8e3d-ce53f862f5c8'::uuid, '94be0ce6-2208-4791-b480-31a45d9b6427'::uuid),
      ('b9052e9f-9539-433b-b065-8b5a66b0dd9b'::uuid, 'add179ce-ad08-4aa2-af12-4234f7192bf8'::uuid),
      ('99216b0b-d4b1-4dc2-a1a8-d552e090f3c1'::uuid, 'bc38a391-7ff5-4f0d-958b-80eb734256b3'::uuid),
      ('3f3d33d7-2890-4142-85e2-3f1302487ea9'::uuid, '1f5c099f-a3d1-43a4-88a8-7623e9d85293'::uuid),
      ('1f55d780-7fe4-4f0b-a7a5-7b920a2f629e'::uuid, '37425f04-2f91-4178-9f14-c63cedb10444'::uuid),
      ('c7e98933-7540-4c0c-93ef-931cd6abdb54'::uuid, 'f7b1e717-4d9f-4ee0-96f4-5d23467a3ee1'::uuid),
      ('bc9b7fdf-f07d-414d-8aef-588626eba6ae'::uuid, 'e489b229-091e-43db-a2ab-9277750b24be'::uuid),
      ('46b52a0f-b48e-4877-9ea5-e5e822a61bc5'::uuid, '26fb4991-358c-4558-911a-c4bbbb689080'::uuid),
      ('d91c18e7-bb10-4037-8a3c-847dab0c5147'::uuid, 'fb6b04a4-88ce-418c-b754-c009bde797c1'::uuid),
      ('f3063535-0e10-47d3-a867-f7303405ce8b'::uuid, '47ff1e30-d1dd-41bb-bb82-a3c0d3a3c667'::uuid)
    ) AS t(deleted_id, active_id)
  LOOP
    UPDATE public.production_orders
    SET product_id = mapping.active_id
    WHERE product_id = mapping.deleted_id
      AND status IN ('pendente','em_andamento');
  END LOOP;
END $$;

-- 6. Nota: Correção de estoque para ordens já concluídas (274-281 etc)
--    já foi aplicada via API em 19/09/2026 com movimentos corretivos
--    (saida no deletado + entrada no ativo). Não reaplicar aqui para evitar
--    duplicidade. Caso precise replay, descomente o bloco abaixo e ajuste
--    ref_order_id para idempotência (verificar product_movements existente).

-- Exemplo idempotente (comentado):
-- INSERT INTO public.product_movements (product_id, tipo, quantidade, observacoes, destino, ref_order_id)
-- SELECT ... WHERE NOT EXISTS (SELECT 1 FROM public.product_movements WHERE ref_order_id = ... AND observacoes LIKE 'Correção duplicata%');
