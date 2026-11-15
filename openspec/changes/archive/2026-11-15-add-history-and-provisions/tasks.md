# Tasks

## 1. API

- [x] 1.1 Schemas `conversationListQuerySchema` e `conversationListResponseSchema` no shared
- [x] 1.2 Porta `listConversations` e SQL no adapter Drizzle (cursor com microssegundos)
- [x] 1.3 `QuestionHistory.conversations` (título, cursor opaco, página de 20) e rota `GET /api/v1/conversations`
- [x] 1.4 Testes unitários, de integração (paginação, dono, cursor inválido, `DELETE /me`) e do documento OpenAPI
- [x] 1.5 OpenAPI e cliente gerado regenerados

## 2. Web

- [x] 2.1 `conversationsQuery` (infinita) e `useConversations`; parsers e links em `url-state.ts`
- [x] 2.2 `ConversationList` no painel do chat e na página `/history/`, com `useCloseHistoryPanel`
- [x] 2.3 `ValidityBadge`, `ProvisionText`, `ProvisionTimeline`, `ProvisionDiff` e a página `/provision/`
- [x] 2.4 Busca de dispositivos na página `/provision/` sem `k`
- [x] 2.5 Página `/compare/` com o exemplo do roteiro
- [x] 2.6 Mensagens `history`, `provision` e `compare` em pt-BR e en

## 3. Fechamento

- [x] 3.1 Testes de componente (happy-dom) e de `validity.ts`
- [x] 3.2 E2E `history.spec.ts` e helper de CSP compartilhado
- [x] 3.3 `backend.md`, `frontend.md` e `status.md`
