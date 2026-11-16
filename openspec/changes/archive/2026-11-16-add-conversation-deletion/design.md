# Design

## Context

Uma conversa não tem tabela própria: é o `conversation_id` das linhas de `app.questions`, e a lista
(`GET /api/v1/conversations`) agrega as perguntas. O que pende de uma pergunta está nela mesma
(resposta, citações, `retrieval`, tokens, custo, `langfuse_trace_id`) ou em `app.feedback`, com FK
`ON DELETE CASCADE` desde a primeira migração. O uso do dia fica em `app.usage_daily`, por escopo
(`global` e `user:<id>`), sem referência à pergunta. O cache exato (`app.answer_cache`) tem chave
própria (pergunta normalizada, data e corpus) e nenhum dono.

Documentação consultada (Context7): Base UI `/mui/base-ui/v1.9.0` (Alert Dialog controlado aberto a
partir de um item de `Menu`, `finalFocus` e `onOpenChangeComplete`) e TanStack Query
`/tanstack/query/v5.90.3` (`setQueryData` numa consulta infinita para tirar um item,
`removeQueries` com predicado e invalidação no `onSuccess` da mutação).

## Decisions

- **Uma transação, com trava antes de apagar.** `SELECT … FOR UPDATE` nas perguntas do usuário na
  conversa e, se nenhuma estiver em stream ativo, `DELETE` de todas. Nenhuma linha é o 404: a mesma
  resposta para a conversa que não existe e para a de outro usuário, sem revelar nada. Sem migração.
- **Stream em andamento: 409 `stream_busy`, não espera.** Esperar seguraria a requisição (e a
  conexão do pooler) até 90 s; apagar no meio deixaria o stream gastando o LLM numa pergunta que já não
  existe, sem acertar a reserva. O código já existe (409, repetível) e o cliente o explica. A janela é a
  mesma do "1 stream ativo por usuário" (claim há menos de 110 s): um stream que morreu sem gravar o fim
  não segura a conversa. Um `claim` concorrente espera a trava e, depois do `DELETE`, acha a pergunta
  apagada (404). Uma pergunta `pending` é apagada: o stream dela também dá 404.
- **A cota não volta.** `usage_daily` não é tocado. O contador é por escopo e por dia, não por
  pergunta, então não há o que "descontar"; a pergunta já consumiu o provedor. O teste de integração
  compara as linhas de uso antes e depois.
- **O cache fica.** A resposta em cache não é dado pessoal (é a resposta a uma pergunta normalizada e
  sem PII, a mesma para qualquer usuário) e serve aos outros; apagá-la quebraria o cache de quem
  perguntou a mesma coisa. O teste prova que outro usuário continua recebendo a resposta do cache.
- **Observabilidade e evals.** Os logs não guardam a pergunta (redação do Pino) e saem da hospedagem
  em 1 h; `langfuse_trace_id` está na própria linha e some com ela. O Langfuse e o PostHog entram na
  F6: o `ErasurePort` hoje só apaga por usuário, e o apagamento por conversa nos terceiros entra com
  eles. As evals (`/_eval/*`) não gravam nada.
- **Sessão lida do banco** (`requireSession(…, { fresh: true })`), como em `DELETE /me`: uma sessão
  revogada não apaga nada. A rota passa pelo rate limit da aplicação, como as outras leituras e o
  feedback, e pela guarda de `Origin` (método de escrita).
- **No web, 404 é sucesso.** A conversa já não existe (outra aba a excluiu); o resultado para quem
  pediu é o mesmo, e o cache esquece a conversa.
- **O cache do web esquece a conversa na hora.** `forgetConversation` tira o item das páginas da lista
  (sem esperar a releitura), apaga o histórico e as perguntas dela (pela resposta gravada ou pelo id
  que o histórico listou) e invalida a lista, para a paginação seguir certa. A cota não é invalidada.
- **A ação fica no item.** Um menu "⋯" (o `DropdownMenu` de `src/components/ui`) em cada conversa, no
  painel e na página: aparece no hover e no foco da linha e fica sempre visível no toque
  (`pointer-coarse`). Abre um `AlertDialog` novo em `src/components/ui` (Base UI Alert Dialog, mesma
  aparência do `Dialog`): clicar fora não fecha, e o botão destrutivo só some depois da resposta.
  Cancelar devolve o foco ao "⋯"; excluir leva o foco à conversa vizinha (ou à lista, se ficou vazia).
- **Depois de excluir.** Se era a conversa aberta (`?c=`), `router.replace` para o
  `newConversationHref` com a mesma data, para o "voltar" do navegador não abrir uma conversa que não
  existe. O aviso é uma região `aria-live` no topo da lista, que some em 6 s: o Tekó não tem toasts, e
  uma dependência só para isso não se paga. A ação no cabeçalho da conversa aberta fica de fora (a
  tela do chat está em redesenho em paralelo).
