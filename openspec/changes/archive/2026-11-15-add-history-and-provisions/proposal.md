# Proposal

## Why

A F5 pede o histórico das conversas, a página de dispositivo com a linha do tempo e "O que mudou" e a
comparação entre datas (o exemplo do roteiro: RCTE, art. 76, § 6º, em 05/2008 contra 01/2010). A API
só lista as perguntas de uma conversa já conhecida (`GET /api/v1/questions?conversationId=`): sem uma
lista de conversas, o painel de histórico do chat e a página `/history/` não têm o que mostrar. As
rotas de dispositivo (`/provisions*`) já existem desde a F4, mas não têm tela.

## What Changes

- Rota `GET /api/v1/conversations` (sessão obrigatória, `no-store`, rate limit da aplicação,
  paginação por cursor opaco): cada conversa com `conversationId`, título derivado da primeira
  pergunta (redigida), contagem de perguntas, instante e data de referência da última. Porta
  `listConversations` no `QuestionRepository`, caso de uso em `QuestionHistory`, SQL no adapter
  Drizzle e schemas em `@teko/shared/contracts`. OpenAPI e cliente gerado regenerados.
- Histórico no web: lista no painel esquerdo do chat (Sheet abaixo de 768 px, fechado ao abrir uma
  conversa) e a página `/[locale]/history/` com "Carregar mais" (TanStack Query infinito), skeleton,
  vazio e erro. Abrir uma conversa navega para `/[locale]/chat/?c=<id>`.
- Página `/[locale]/provision/?k=<stableKey>&ref=<data>`: a redação vigente na data (`lang="pt-BR"`),
  badge de vigência (tokens `--validity-*`), a linha do tempo e "O que mudou" carregado sob demanda;
  sem `k`, a busca de dispositivos (`GET /provisions`). `ProvisionTimeline` e `ProvisionDiff` ficam
  em `src/components/provision/`, reutilizáveis no painel de citação.
- Página `/[locale]/compare/?k=<stableKey>&from=<data>&to=<data>` com o diff entre duas datas e o
  exemplo do roteiro.
- E2E `apps/web/e2e/history.spec.ts` na stack de CI, sem violação de CSP aplicada.

## Capabilities

### New Capabilities

- `web-history`: histórico de conversas, página de dispositivo, comparação e busca no web.

### Modified Capabilities

- `http-api`: lista de conversas do usuário.

## Impact

- `packages/shared`: `contracts/conversations.ts`.
- `apps/api`: porta e adapter de perguntas, `question-history.ts`, rota em `routes/questions.ts`,
  testes unitários e de integração (inclusive o `DELETE /me`).
- `apps/web`: `openapi.json` e `__generated__`, `queries.ts`, `hooks.ts`, `url-state.ts`,
  `validity.ts`, `components/history`, `components/provision`, `components/compare`, páginas e
  rotas de history, provision e compare, o slot de histórico do `chat-page.tsx`, `useCloseHistoryPanel`
  no `workspace.tsx`, `ui/skeleton` e `ui/input`, mensagens (`history`, `provision`, `compare`) e o
  helper de CSP dos e2e (`e2e/support/csp.ts`).
- Docs: `backend.md`, `frontend.md` e `status.md`.
