# Integração Anota AI → Neia Salgados

Conectar o Anota AI ao seu sistema para **puxar os pedidos/vendas** e **dar baixa no estoque** de produtos acabados, acionado por um **botão "Sincronizar"** (sem webhook). Fluxo somente de entrada (Anota AI → seu sistema).

## Como vai funcionar

```text
[Botão Sincronizar]
   → busca lista de pedidos no Anota AI (polling)
   → para cada pedido novo/atualizado, busca o detalhe completo
   → grava o pedido no seu banco (sem duplicar)
   → quando o pedido está FINALIZADO, gera "saída" de estoque
      de cada produto acabado vendido (baixa automática)
```

- O **token fica guardado como segredo** no backend (nunca no navegador, nunca no código). Toda chamada ao Anota AI acontece no servidor.
- A baixa de estoque só ocorre para pedidos **finalizados** (status 3). Pedidos **cancelados/negados** (4/5) não dão baixa. Isso evita descontar venda que não aconteceu.
- Reprocessar/sincronizar de novo **não duplica** baixa: cada pedido é registrado uma única vez.

## Mapeamento item ↔ produto

Para dar baixa certa, cada item do cardápio do Anota AI precisa apontar para um **produto** do seu sistema. Duas formas, usadas em conjunto:
1. **Automático** pelo `external_id` do cardápio (quando o item do Anota AI já traz o id do produto).
2. **Manual** por uma tela de mapeamento no sistema, onde você liga "nome do item no Anota AI" → "produto".

Itens sem mapeamento entram numa lista de **pendências** (o pedido é gravado, mas o item fica marcado como "não mapeado" até você resolver — nenhuma baixa é feita às cegas).

## O que aparece no sistema

Nova aba **"Anota AI"** (menu, grupo de integrações/estoque) com:
- **Status da conexão** + botão "Testar conexão".
- **Botão "Sincronizar pedidos"** (com filtro de status: análise / produção / finalizados).
- **Lista de pedidos importados**: número, data/hora, valor, status, itens e se a baixa de estoque foi aplicada.
- **Tela de mapeamento** item Anota AI → produto, com destaque para pendências.

## Observação importante sobre insumos/recheio

A baixa será de **produto acabado** (a venda consome o salgado pronto). O consumo de **insumos e recheio** já é registrado no momento da **produção** (ordens de produção), então não é descontado de novo na venda — senão contaria o consumo duas vezes. O impacto das vendas no seu planejamento de produção continua visível pelo saldo dos produtos e pelo Relatório de Produção.

---

## Detalhes técnicos

**Segredo**
- `ANOTA_AI_TOKEN` guardado via formulário seguro (add_secret) no início da construção.

**Banco de dados (migração)**
- `anota_orders`: pedidos importados — `external_order_id` (único), `numero`, `check_status`, `total`, `cliente`, `payload` (jsonb), `estoque_aplicado` (bool), timestamps. Idempotência pelo `external_order_id`.
- `anota_order_items`: itens de cada pedido — referência ao pedido, nome/idexterno do item, quantidade, `product_id` mapeado (nullable), `mapeado` (bool).
- `anota_product_map`: `anota_item_ref` (id externo ou nome) → `product_id`. Fonte do mapeamento manual.
- GRANTs para `authenticated` + `service_role`, RLS habilitado, políticas para usuários autenticados com papéis admin/estoque/compras/operacional (via `has_role`).
- Função `apply_anota_order_stock(order_id)` (SECURITY DEFINER): insere `product_movements` tipo `saida` para cada item mapeado do pedido finalizado e marca `estoque_aplicado=true`. Reaproveita o trigger `fn_product_movement_apply` existente (que já atualiza saldo).

**Servidor (TanStack server functions, `src/lib/anota.functions.ts`)**
- `testAnotaConnection` — valida o token contra o endpoint de listagem.
- `syncAnotaOrders` — chama `GET https://api-parceiros.anota.ai/partnerauth` (list orders, paginado), busca detalhes dos novos, grava `anota_orders`/`anota_order_items`, resolve mapeamento por `external_id`, e chama `apply_anota_order_stock` para os finalizados mapeados.
- `saveAnotaMapping` — salva mapeamentos manuais e re-tenta aplicar baixa em pedidos pendentes.
- Todas com `requireSupabaseAuth` + verificação de papel; token lido de `process.env.ANOTA_AI_TOKEN` dentro do handler. Erros do provedor são tratados e retornados de forma amigável.

**Frontend**
- Rota `src/routes/_authenticated/anota.tsx` com a aba, tabela de pedidos, botão sincronizar e tela de mapeamento (TanStack Query + `useServerFn`).
- Novo item em `src/lib/nav.ts`.

**Fora de escopo (não faremos agora)**
- Enviar dados de volta ao Anota AI (cardápio, disponibilidade).
- Webhook automático (fica como evolução futura; hoje é botão).
- Aceitar/recusar/mudar status do pedido dentro do seu sistema.

## Ação de segurança recomendada
Como o token passou pelo chat, recomendo **rotacioná-lo no portal do Anota AI** depois que a integração estiver funcionando, e colar o novo valor no formulário seguro.