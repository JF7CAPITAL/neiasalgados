-- ===================================================================
-- Baixa automática de estoque para pedidos Anota AI finalizados
-- ===================================================================
-- Objetivo:
--   1) Reaproveitar os mapeamentos já existentes em anota_product_map para
--      os itens históricos (importados pelo webhook com mapeado = false).
--   2) Aplicar a baixa dos pedidos finalizados (check_status = 3) que ainda
--      estão com estoque_aplicado = false (corrige os pendentes atuais).
--   3) Agendar a rotina no pg_cron para rodar mesmo sem o app aberto.
--
-- Idempotente: pode ser executada mais de uma vez sem duplicar baixas
-- (apply_anota_order_stock retorna cedo quando estoque_aplicado = true).

-- 1) Backfill imediato: itens sem mapeamento passam a usar o produto já
--    cadastrado em anota_product_map para a mesma referência.
UPDATE public.anota_order_items oi
SET product_id = pm.product_id,
    mapeado = true
FROM public.anota_product_map pm
WHERE pm.anota_item_ref = oi.anota_item_ref
  AND pm.product_id IS NOT NULL
  AND (oi.mapeado = false OR oi.product_id IS NULL);

-- 2) Rotina de manutenção: reconcilia mapeamentos + aplica baixas pendentes.
CREATE OR REPLACE FUNCTION public.apply_pending_anota_stock(p_user uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ord record;
  aplicadas integer := 0;
BEGIN
  -- Reaproveita mapeamentos existentes nos itens que ainda estão sem produto.
  UPDATE public.anota_order_items oi
  SET product_id = pm.product_id,
      mapeado = true
  FROM public.anota_product_map pm
  WHERE pm.anota_item_ref = oi.anota_item_ref
    AND pm.product_id IS NOT NULL
    AND (oi.mapeado = false OR oi.product_id IS NULL);

  FOR ord IN
    SELECT id FROM public.anota_orders
    WHERE check_status = 3 AND estoque_aplicado = false
  LOOP
    BEGIN
      PERFORM public.apply_anota_order_stock(ord.id, p_user);
      aplicadas := aplicadas + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Uma falha isolada não pode interromper os demais pedidos.
      RAISE WARNING 'Falha ao aplicar baixa no pedido %: %', ord.id, SQLERRM;
    END;
  END LOOP;

  RETURN aplicadas;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_pending_anota_stock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pending_anota_stock(uuid) TO service_role;

-- 3) Corrige os pendentes atuais imediatamente.
SELECT public.apply_pending_anota_stock(NULL);

-- 4) Agenda a rotina no pg_cron a cada 10 minutos (se a extensão estiver
--    disponível). Caso não esteja, o auto-sync do app continua cobrindo.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron não pôde ser habilitado: %', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anota-baixa-pendente') THEN
        PERFORM cron.unschedule('anota-baixa-pendente');
      END IF;
      PERFORM cron.schedule(
        'anota-baixa-pendente',
        '*/10 * * * *',
        $cron$SELECT public.apply_pending_anota_stock(NULL);$cron$
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Não foi possível agendar a rotina no pg_cron: %', SQLERRM;
    END;
  END IF;
END;
$do$;
