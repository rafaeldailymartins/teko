# Tasks

## 1. API

- [x] 1.1 `conversationIdParamsSchema` em `@teko/shared/contracts`
- [x] 1.2 `QuestionRepository.deleteConversation` (trava, stream ativo, `DELETE`) no adapter do `pg`
- [x] 1.3 `QuestionHistory.deleteConversation` (404 e 409) e `DELETE /api/v1/conversations/:id`
- [x] 1.4 Testes de unidade e de integração (dono, outro usuário, o que pende, cota, lista, stream e
  cache compartilhado)

## 2. Web

- [x] 2.1 OpenAPI e cliente regenerados
- [x] 2.2 `removeConversation`, `forgetConversation` e `useDeleteConversation`
- [x] 2.3 Menu "⋯", `AlertDialog`, foco e aviso no painel e na página do histórico
- [x] 2.4 Textos em pt-BR e en; testes de componente e e2e (`history.spec.ts`, `a11y.spec.ts`)

## 3. Privacidade e docs

- [x] 3.1 Política de privacidade e Termos (versão 2026-11-16 mantida)
- [x] 3.2 `backend.md`, `frontend.md`, `ropa.md` e `status.md`
