## Objetivo

Criar uma nova aba **Relatório de Produção** com filtro por período que consolida saídas, produção, consumo de insumos e de recheios, variação diária em %, com visualização na tela e impressão/PDF. Além disso, passar a registrar o consumo de recheio em histórico e implementar uma política de retenção de 3 anos com fluxo "aviso → exportar → limpar".

---

## 1. Registrar consumo de recheio (base de dados)

Hoje o saldo do recheio é alterado direto, sem histórico — por isso o relatório não conseguiria mostrar consumo de recheio com data/hora. Vou criar o histórico:

- Nova tabela `filling_movements` (espelha `ingredient_movements`): `filling_id`, `tipo`, `quantidade`, `saldo_anterior`, `saldo_novo`, `motivo`, `observacoes`, `user_id`, `ref_order_id`, `created_at`, com GRANTs, RLS e política igual às demais tabelas.
- Trigger `fn_filling_movement_apply` que atualiza `fillings.quantidade_atual` a cada movimento (igual ao padrão de insumos/produtos).
- Atualizar a função `start_production_order`: ao consumir recheio na produção de um produto, gravar `filling_movements` (saída) em vez de alterar o saldo direto.
- Atualizar `complete_production_order`: ao concluir uma ordem de recheio, gravar `filling_movements` (entrada) em vez de somar direto.

A partir da implementação, todo consumo/produção de recheio fica rastreável. Registros anteriores não têm histórico (esperado).

## 2. Aba "Relatório de Produção"

Nova rota `src/routes/_authenticated/relatorio-producao.tsx` e item no menu (grupo Gestão) em `src/lib/nav.ts`.

Filtro de período (data inicial / data final, com atalhos: hoje, 7 dias, 30 dias, mês atual). Todo o conteúdo abaixo respeita o período escolhido:

- **Resumo (cards):** total de salgados que saíram, total produzido, total de insumos consumidos, total de recheio consumido.
- **Salgados que saíram:** tabela por produto com quantidade saída, quantidade produzida no período e lista de horários das saídas (data/hora de cada movimento de saída).
- **Variação diária (%):** série dia a dia das saídas e da produção, com o percentual de variação em relação ao dia anterior, exibido em tabela e em gráfico de linha (Recharts).
- **Consumo de insumos:** por insumo, total consumido no período (de `ingredient_movements` tipo saída).
- **Consumo de recheio:** por recheio, total consumido no período (de `filling_movements` tipo saída).

Fontes de dados via `@/integrations/supabase/client` + TanStack Query, seguindo o padrão das telas atuais (`estoque.tsx`, `relatorios.tsx`).

## 3. Impressão / PDF

Reaproveitando o estilo dos documentos de ordem já existentes (cabeçalho **Neia Salgados**, cor âmbar, abre em nova aba para imprimir ou salvar como PDF):

- Nova função em `src/lib/export.ts` (`printProductionReport`) que monta o relatório completo — período, cards de resumo e todas as tabelas — no mesmo layout de marca, com botão "Imprimir / Salvar PDF".
- Botões na aba: **Imprimir/PDF**, além de exportar **Excel** e **CSV** reutilizando os helpers já existentes.

## 4. Retenção de 3 anos (aviso → exportar → limpar)

Fluxo escolhido: nada é apagado automaticamente sem sua confirmação.

- **Detecção:** uma server function calcula, para as tabelas de histórico (`product_movements`, `ingredient_movements`, `filling_movements`, `activity_logs`), quantos registros têm mais de 3 anos e o volume total de registros (indicador de espaço).
- **Aviso:** quando existirem registros com mais de 3 anos (ou o volume ultrapassar um limite configurado), aparece um banner de aviso na aba e o botão **"Exportar e liberar espaço"** fica habilitado.
- **Exportar:** ao clicar, o sistema gera uma planilha (Excel/CSV) com exatamente os registros que serão removidos (os mais antigos que 3 anos) e faz o download.
- **Limpar:** somente após o download, um diálogo de confirmação libera a remoção definitiva desses registros antigos, liberando espaço para novas inserções. A remoção é feita por uma server function protegida (apenas admin).

Sem apagamento silencioso: a limpeza sempre exige exportação + confirmação explícita.

---

## Detalhes técnicos

- **Migração** (`supabase--migration`): criar `filling_movements` (+ GRANTs, RLS, policy), trigger `fn_filling_movement_apply`, e atualizar `start_production_order` / `complete_production_order`.
- **Server functions** (`createServerFn`, arquivo `*.functions.ts` client-safe, com `requireSupabaseAuth`): `getRetentionStatus` (contagens/idade) e `purgeOldRecords` (remoção com verificação de papel admin via `has_role`). A exportação da planilha é feita no cliente com os dados retornados antes da limpeza.
- **Rota** nova sob `_authenticated/` (herda o gate de autenticação). Consultas de leitura direto pelo client Supabase com TanStack Query.
- **Nav:** adicionar item "Relatório de Produção" em `src/lib/nav.ts` (grupo Gestão, papéis admin/producao/estoque/financeiro).
- **PDF:** `printProductionReport` em `src/lib/export.ts`, no mesmo estilo de `printOrderDoc`.
- Sem alterações nas telas existentes além do menu; a lógica de negócio nova fica isolada nas novas funções/tabela.

## Observações

- O consumo de recheio no relatório só terá dados a partir da implementação (antes disso não havia histórico).
- A "variação %" será apresentada como variação diária (dia vs. dia anterior), conforme escolhido.
- O limite de "espaço da memória" será tratado por um limite de volume de registros configurável no código (o banco gerenciado não expõe um limite físico direto); o gatilho principal continua sendo a idade de 3 anos.
