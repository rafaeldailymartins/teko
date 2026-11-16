# Proposal

## Why

Hoje o usuário só apaga dados excluindo a conta inteira. O mantenedor pediu uma opção para excluir
uma conversa: quem perguntou algo por engano, ou quer limpar o histórico, não precisa perder a conta
nem esperar os 90 dias da retenção.

## What Changes

- `DELETE /api/v1/conversations/:id`, autenticado e lendo a sessão do banco: só o dono exclui, a
  conversa inexistente ou de outro usuário dá o mesmo 404, e o sucesso é 204. Numa transação, as
  perguntas da conversa são travadas e apagadas, e o feedback sai pelo `ON DELETE CASCADE`. Com uma
  resposta da conversa ainda em stream, 409 `stream_busy`. O uso do dia e o cache de respostas não
  mudam: excluir não devolve perguntas à cota.
- Contrato `conversationIdParamsSchema`, OpenAPI e cliente do web regenerados.
- Web: `removeConversation`, `forgetConversation` e o hook `useDeleteConversation`; no histórico (o
  painel do chat e a página `/history`), o menu "⋯" de cada conversa com "Excluir conversa", a
  confirmação num diálogo de alerta e o aviso discreto depois. Excluir a conversa aberta volta ao chat
  vazio.
- Política de privacidade e Termos (mesma versão, 2026-11-16, ainda não publicada): a exclusão de uma
  conversa nos direitos do titular e na retenção, e que excluir não devolve a cota.

## Capabilities

### Modified Capabilities

- `http-api`: exclusão de uma conversa do usuário.
- `web-data`: exclusão de conversa no cliente e no cache.
- `web-history`: ação de excluir uma conversa no histórico.

## Impact

- `packages/shared`: `contracts/conversations.ts`.
- `apps/api`: porta `QuestionRepository.deleteConversation`, `pg-question-repository.ts`, caso de uso
  `QuestionHistory.deleteConversation`, rota em `routes/questions.ts`, testes de unidade e de
  integração. Sem migração: as FKs e o `ON DELETE CASCADE` do feedback já existiam.
- `apps/web`: `openapi.json`, cliente gerado, `src/lib/api/{mutations,queries,hooks}.ts`,
  `components/history/*`, `components/ui/alert-dialog.tsx`, catálogos (`history` e `legal`) e os e2e
  `history.spec.ts` e `a11y.spec.ts`.
- Docs: `backend.md`, `frontend.md`, `ropa.md` e `status.md`.
