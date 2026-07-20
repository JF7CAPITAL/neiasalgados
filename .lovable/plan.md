# Por que a conexão está falhando

O erro **"Acesso negado pelo Anota AI"** que você recebeu é o retorno HTTP 401/403 da API. Combinando isso com as suas respostas, o problema **não é no código** — é o tipo de token.

- O token que você tem foi gerado no **painel do restaurante / app**. Esse token serve para o painel operar sua loja, mas **não autentica na API de Pedidos de parceiros** (`api-parceiros.anota.ai/partnerauth`), que é a única que expõe os pedidos para sistemas externos.
- A **API de Pedidos** precisa ser **habilitada pelo suporte do Anota AI** para a sua loja. Sem isso, qualquer chamada retorna acesso negado, mesmo com token válido em outro contexto.
- **ID da loja não resolve sozinho** — a autenticação é feita pelo token de parceiro, que já identifica a loja. Só o ID sem o token correto continuaria dando o mesmo erro.

Ou seja: **não falta nada no sistema** — falta liberar o acesso do lado do Anota AI.

# O que você precisa fazer no Anota AI

1. Abrir chamado no suporte do Anota AI (chat do painel ou e-mail comercial) pedindo:
   > "Solicito habilitar a **API de Pedidos (partnerauth)** para a minha loja e a emissão do **token de integração de parceiro** para uso em sistema externo de controle de estoque."
2. Informar o CNPJ/loja e confirmar que o uso é **somente leitura de pedidos** (polling).
3. O suporte devolve um **token novo** (diferente do que está salvo hoje) e confirma que a loja está ativa no portal de integração.

# O que eu faço quando você tiver o token novo

1. Você abre a aba **Anota AI** no sistema, clica em **"Atualizar token"** (o formulário seguro reabre) e cola o novo valor.
2. Clica em **Testar conexão** — deve responder "Conexão estabelecida" e mostrar a quantidade de pedidos disponíveis.
3. Clica em **Sincronizar pedidos** para importar o histórico inicial e fazer o mapeamento item → produto.

# Pequena melhoria opcional no sistema

Enquanto isso, posso deixar a aba Anota AI mais informativa para diagnóstico futuro:

- Mostrar no card de status uma **mensagem de ajuda** quando o erro for 401/403 explicando que provavelmente é o tipo do token / loja não ativada (evita confusão da próxima vez).
- Adicionar um campo **opcional** "ID da loja" na tela de configuração — não é usado pelo `partnerauth`, mas fica registrado para referência e para uma futura API do Anota AI que exija esse dado.
- Botão de **"Rotacionar token"** mais visível (hoje só é possível pelo fluxo padrão de segredos).

Se você quiser, incluo essas melhorias nesta rodada. Se preferir só destravar a conexão primeiro, você segue com o passo 1 (suporte Anota AI) e depois voltamos aqui para colar o token novo — nenhum código precisa mudar para isso.

## Detalhes técnicos

- Base atual: `https://api-parceiros.anota.ai/partnerauth` com header `Authorization: <token>` (sem "Bearer"), conforme documentação da API de Pedidos.
- Código relevante: `src/lib/anota.functions.ts` (`discoverListPath` já testa 4 caminhos e devolve 401/403 amigável) e `src/routes/_authenticated/anota.tsx` (UI de teste/sync).
- Segredo `ANOTA_AI_TOKEN` já está salvo — trocar valor via `update_secret` quando o novo token chegar.
- Sem alteração de banco: as tabelas `anota_orders`, `anota_order_items`, `anota_product_map` e a função `apply_anota_order_stock` continuam válidas.
