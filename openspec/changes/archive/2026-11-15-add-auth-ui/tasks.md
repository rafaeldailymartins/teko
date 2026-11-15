# Tasks

## 1. Base

- [x] 1.1 Retorno seguro, erros da entrada e aviso de região (`src/lib/auth/return-path.ts`)
- [x] 1.2 Estado da sessão, variante do onboarding e iniciais (`src/lib/auth/session.ts`)
- [x] 1.3 Chamadas ao Better Auth (`src/lib/api/auth.ts`) e à conta (`src/lib/api/account.ts`), com `@simplewebauthn/browser` sob demanda
- [x] 1.4 Queries e hooks: cota, passkeys, onboarding, sair, exportar, excluir, cadastrar e remover passkey
- [x] 1.5 Imports `.ts` no cliente gerado (`openapi-ts.config.ts`) e regeneração

## 2. Telas

- [x] 2.1 Entrada com GitHub, Google e passkey, erros do callback e aviso de `region_restricted`
- [x] 2.2 Sessão no cabeçalho e na paleta, e guarda do grupo `(app)`
- [x] 2.3 Onboarding bloqueante (primeiro uso e Termos novos) e `useSession().composerBlocked`
- [x] 2.4 Configurações: conta, cota, passkeys, exportação, exclusão e preferências
- [x] 2.5 Densidade (`data-density`) no script de bootstrap e no `globals.css`

## 3. Fechamento

- [x] 3.1 Testes unitários da lógica e dos componentes, sem rede
- [x] 3.2 E2E `auth.spec.ts` e sessão de teste nas jornadas do shell
- [x] 3.3 `frontend.md` e `status.md`
