# Design

## Context

Desenho em `docs/architecture/backend.md` (Superfície HTTP) e `docs/architecture/frontend.md` (UX,
Dados e streaming). As perguntas ficam em `app.questions` com `conversation_id` e o índice
`questions_user_created (user_id, created_at desc)`; não há tabela de conversas. O web é export
estático, com o estado na query string (nuqs) e os dados pelo cliente gerado do OpenAPI. Esta é a
parte "histórico, dispositivos e comparação" da onda 2 da F5; o chat preenche o painel central e a
onda 3 encaixa a linha do tempo e o diff no painel de citação.

## Decisions

- **Conversa agregada, sem tabela nova.** `GET /api/v1/conversations` agrupa `app.questions` do
  usuário por `conversation_id`: `count(*)`, `max(created_at)`, a primeira pergunta
  (`array_agg … ORDER BY created_at, id`, cortada em 400 caracteres no SQL) e a data de referência da
  última. O volume por usuário é pequeno (30 perguntas por dia, expurgo em 90 dias) e a consulta usa o
  índice por usuário; uma tabela de conversas exigiria escrita extra no caminho da pergunta e no
  expurgo. Sem migração.
- **Ordem e cursor.** Da última pergunta mais recente para a mais antiga, empate pelo id da conversa
  (decrescente). O cursor é opaco (`base64url("<instante>|<conversa>")`) e leva o instante em texto
  UTC com microssegundos (`to_char(… 'US')`): um `Date` do JavaScript perderia os microssegundos, e a
  comparação de linha `(last_asked_at, conversation_id) < (…)` repetiria ou pularia conversas na
  fronteira da página. Cursor que a API não emitiria dá 400 `validation_error`. A ordem é pela
  pergunta, não pelo `updated_at`: o fim de um stream não reordena a lista no meio da paginação.
- **Título derivado no caso de uso.** A primeira pergunta já redigida (sem PII), em uma linha e
  cortada na última palavra que cabe em 80 caracteres, com reticências. Fica no caso de uso (testado
  em unidade), não no SQL.
- **Página de 20, sem `limit`.** `CONVERSATIONS_PAGE_SIZE = 20`; a query só aceita `cursor`
  (`strictObject`), então o hey-api gera as options infinitas (`cursor` é palavra de paginação) e não
  há coerção de número na querystring.
- **Sessão sem onboarding, rate limit da aplicação, `no-store`.** O mesmo das outras leituras do
  histórico (`GET /questions`). O `Cache-Control: private, no-store` vem do hook de `/api/*`. O
  `DELETE /me` já apaga as perguntas em cascata (FK de `app.questions`); o teste confere a lista antes
  e o 401 depois.
- **Infinite query sobre o gerado.** `conversationsQuery()` usa a key e a função de
  `listConversationsInfiniteOptions` com `initialPageParam: {}` (nenhum parâmetro a mais: um cursor
  vazio iria na URL e daria 400) e `getNextPageParam: nextCursor ?? undefined`. O painel mostra só a
  primeira página e um link para `/history/`; a página tem "Carregar mais". Sem virtualização: 20 por
  página e 90 dias de retenção não pedem.
- **Sheet fecha ao abrir conversa.** A navegação para `?c=` não troca de página, então o Sheet do
  histórico ficaria aberto. O `Workspace` expõe `useCloseHistoryPanel()` (contexto, no-op fora dele),
  que a lista chama no clique.
- **URL como estado.** `k` (chave estável pelo `stableKeySchema`), `ref`, `from` e `to` (período ou
  data, os parsers do chat) em `src/lib/url-state.ts`, com `createSerializer` para os links
  (`chatConversationHref`, `provisionHref`, `compareHref`). Os componentes com `useQueryStates` trazem
  o próprio `<Suspense>`.
- **Redação mostrada numa data.** A vigente (`[from, to)`); sem nenhuma, a última que começou antes
  ou, se a data é anterior a todas, a primeira, com o aviso "não tinha redação vigente". Escolher uma
  redação na linha do tempo grava em `ref` o primeiro dia dela (`dateWithin`). As datas de calendário
  são formatadas em UTC (`calendarDate`): no fuso do app, `2008-05-01` viraria 30/04.
- **Badge de vigência.** Estado em relação a hoje (São Paulo): vigente, encerrada ou futura, nas cores
  `--validity-*`; o fim mostrado é o último dia incluído (`lastIncludedDay`), como se lê na
  legislação.
- **Diff sob demanda.** `ProvisionDiff` só consulta quando é montado; na página de dispositivo, ele
  monta no clique de "O que mudou" (botão com `aria-expanded`), comparando a redação anterior com a
  mostrada. Inserções em `<ins>`, remoções em `<del>`, com marcadores `sr-only` para leitor de tela, e
  a tabela de campos alterados.
- **Busca na página de dispositivo, não na paleta.** A paleta é do shell e filtra comandos locais;
  a busca de dispositivos (`GET /provisions?q=&at=`) entra na página `/provision/` sem `k`, com
  `useDeferredValue` (sem dependência nova de debounce).
- **Componentes copiados do registry.** `skeleton` e `input` do `base-nova` (o `Input` do Base UI).
- **Helper de CSP dos e2e.** O registro de `securitypolicyviolation` sai do `platform.spec.ts` para
  `e2e/support/csp.ts`, usado também pelo `history.spec.ts` (sem duplicar código no jscpd).

## Context7

- `/hey-api/hey-api`: options infinitas do plugin do TanStack Query e palavras de paginação.
- `/tanstack/query`: `useInfiniteQuery`, `initialPageParam` e `getNextPageParam`.
- `/47ng/nuqs`: `createSerializer` para os links.
- `/amannn/next-intl`: `useFormatter` (`dateTime`) e plural ICU.
- `/colinhacks/zod/v4.3.6`: coerção e `toJSONSchema` (motivo de não ter `limit` numérico na query).
- `/microsoft/playwright`: `browserContext.addCookies` para a sessão nos e2e.
