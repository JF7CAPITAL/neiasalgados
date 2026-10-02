-- ===================================================================
-- MIGRATION: Finance Accounts (contas bancárias / caixas)
-- Permite criar várias contas (Bradesco, Itaú, Santander...), com saldo
-- editável, entradas e saídas. Saldo exibido com olho p/ ocultar.
-- ===================================================================

CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  saldo numeric NOT NULL DEFAULT 0,
  cor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_accounts TO authenticated;
GRANT ALL ON public.finance_accounts TO service_role;

ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_accounts_select_auth" ON public.finance_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "finance_accounts_insert_auth" ON public.finance_accounts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "finance_accounts_update_auth" ON public.finance_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "finance_accounts_delete_auth" ON public.finance_accounts FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_finance_accounts_updated ON public.finance_accounts;
CREATE TRIGGER trg_finance_accounts_updated BEFORE UPDATE ON public.finance_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_finance_accounts_nome ON public.finance_accounts(nome);
