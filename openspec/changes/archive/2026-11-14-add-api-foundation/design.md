# Design

## Context

O `buildApp` da F1 já tinha os pontos de extensão (rate limit opcional, ordem do pipeline, error
handler RFC 9457). A F4 liga cada um deles sem mudar a ordem do pipeline de `backend.md`.

## Decisions

- **Guarda de `Origin` num hook `onRequest`,** antes do rate limit e do Better Auth, só em
  `/api/v1/*`. Vale também para rota inexistente (403 antes do 404): a resposta não revela quais
  mutações existem. `Origin: null` e origem com barra final são recusadas (comparação exata).
- **Query string proibida nas mutações em geral,** não só em `POST /questions`: nenhuma mutação lê
  parâmetros da URL, e um parâmetro ali vai para logs de proxy e histórico.
- **Janela do rate limit pelo relógio do banco** (`clock_timestamp()`), num único
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`: as instâncias concordam sobre a janela sem relógio
  sincronizado, e o incremento é atômico. Sem retry (o incremento não é idempotente).
- **Chave do rate limit:** o IP da porta `ClientIp` nesta mudança; o `user_id` entra com a sessão
  (`add-auth-oauth-passkey`).
- **`CoverageSource` compartilhado** entre `CheckCoverage` e `GetCoverage`: a rota pública não
  acorda o Neon mais que as perguntas. O repositório devolve também `max(corpus_versions.id)`.
- **Paleta em dois caminhos numa instrução:** `ILIKE` na chave e no rótulo (com os curingas do
  `LIKE` escapados) e o `tsv` dos chunks (`websearch_to_tsquery`, índice GIN parcial). Casamento
  por chave ou rótulo vem antes; empate pela nota do FTS e pelo `sort_path`. Rótulo histórico da
  data (`provision_labels`) quando existe.
- **Diff por palavra pelo algoritmo de Myers** no domínio (`word-diff.ts`), com corte de prefixo e
  sufixo comuns e teto de 1.500 edições (acima disso, apaga e insere o miolo). Os campos dos
  registros (`structured`) são comparados um a um.
- **Rotas de eval num plugin separado,** registrado só com `APP_ENV=ci`; um teste de integração
  prova o 404 em staging e produção.

## Risks / Trade-offs

- A paleta por texto lê o índice GIN parcial dos chunks; com o rate limit de 60/min por chave, o
  custo de CU-h fica limitado.
- A guarda depende de `WEB_ORIGIN` exato; o env já exige origem sem caminho nem barra final.

## Context7

| Biblioteca            | ID                            | Consulta                                                            |
| --------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `@fastify/rate-limit` | `/fastify/fastify-rate-limit` | store customizado (`incr`, `child`) e `config.rateLimit` por rota   |
| Fastify               | `/fastify/fastify`            | hooks `onRequest` em rota inexistente e `inject({ remoteAddress })` |
