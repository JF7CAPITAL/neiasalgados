-- ===================================================================
-- BACKFILL: Recorrentes legados sem grupo (ex.: AGUA, ENERGIA)
-- Lançamentos criados antes do parcelamento por grupo têm recorrente=true
-- mas recorrencia_grupo_id NULL e uma única parcela — por isso, após pagar
-- o mês 09, nenhum "há pagar" do mês 10 aparecia.
-- Esta migration converte cada legado em grupo e gera 12 parcelas mensais
-- futuras (mesma regra de "recorrência indefinida" do app).
-- Idempotente: só toca linhas ainda sem grupo.
-- ===================================================================

DO $$
DECLARE
  r RECORD;
  v_gid uuid;
  i int;
  v_base date;
  v_venc date;
  v_comp date;
BEGIN
  FOR r IN
    SELECT * FROM public.finance_dre_entries
    WHERE recorrente = true
      AND recorrencia_grupo_id IS NULL
  LOOP
    v_gid := gen_random_uuid();

    UPDATE public.finance_dre_entries
      SET recorrencia_grupo_id = v_gid,
          recorrencia_tipo = COALESCE(recorrencia_tipo, 'indefinida')
      WHERE id = r.id;

    v_base := COALESCE(r.vencimento, r.competencia, CURRENT_DATE);

    FOR i IN 1..12 LOOP
      v_venc := (v_base + (i * interval '1 month'))::date;
      v_comp := date_trunc('month', v_venc)::date;
      INSERT INTO public.finance_dre_entries
        (tipo, categoria, descricao, valor, competencia, vencimento,
         pago, data_pagamento, recorrente, recorrencia_tipo,
         recorrencia_quantidade, recorrencia_grupo_id,
         inclui_ponto_equilibrio, created_by)
      VALUES
        (r.tipo, r.categoria, r.descricao, r.valor, v_comp, v_venc,
         false, NULL, true, COALESCE(r.recorrencia_tipo, 'indefinida'),
         NULL, v_gid,
         COALESCE(r.inclui_ponto_equilibrio, true), r.created_by);
    END LOOP;
  END LOOP;
END $$;
