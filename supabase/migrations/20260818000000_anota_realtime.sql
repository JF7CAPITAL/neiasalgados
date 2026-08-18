-- ===================================================================
-- MIGRATION: Habilita Supabase Realtime nas tabelas de integração Anota AI.
--
-- Sem isso, o hook useRealtime (e a subscrição do useAutoSync) não recebe
-- eventos de INSERT/UPDATE dessas tabelas, e as telas não atualizam quando
-- um pedido é importado ou atualizado por outro cliente / pelo próprio sync.
-- ===================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.anota_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.anota_order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.anota_product_map;
ALTER PUBLICATION supabase_realtime ADD TABLE public.anota_combo_item_map;
