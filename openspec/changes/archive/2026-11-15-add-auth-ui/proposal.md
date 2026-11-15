# Proposal

## Why

A API da F4 já autentica (Better Auth com OAuth do GitHub e do Google, passkey e sessão por cookie),
exige o onboarding (18+, versão vigente dos Termos e país) e atende os direitos do titular
(`/me/export`, `DELETE /me`). O web ainda não tem nenhuma tela para isso: a página de entrada é um
esqueleto, o cabeçalho não sabe se há sessão e as configurações não existem. Sem essas telas a F5
não fecha, e a conversa não tem como bloquear o composer até o onboarding.

## What Changes

- Página de entrada (`/[locale]/sign-in/`): GitHub, Google e passkey, retorno à página de origem só
  por caminhos da própria origem, mensagens para o `?error=` do callback e a página de aviso de
  `region_restricted`.
- Sessão no app shell: o cabeçalho e a paleta mostram entrar ou o menu da conta (iniciais, nome,
  e-mail, configurações e sair); páginas do grupo `(app)` sem sessão mandam para a entrada com o
  retorno (guarda só de experiência).
- Onboarding do primeiro uso, e de novo a cada versão dos Termos: aviso de treino do provedor
  gratuito, 18+, aceite da versão, país de residência e links para `/terms` e `/privacy`, num diálogo
  bloqueante. `useSession().composerBlocked` é o ponto de encaixe do composer.
- Configurações (`/[locale]/settings/`): conta, cota do dia, passkeys (cadastrar e remover),
  exportar os dados em JSON, excluir a conta com confirmação digitada, tema, idioma e densidade
  (`data-density`, guardada como o tema).
- Chamadas ao Better Auth pelo `src/lib/api` (o cliente gerado), com `@simplewebauthn/browser`
  carregado sob demanda para a cerimônia da passkey.

## Capabilities

### New Capabilities

- `web-auth`: telas de autenticação, onboarding e conta do web.

## Impact

- `apps/web`: `src/components/auth/**`, `src/components/settings/**`, páginas de entrada e
  configurações, cabeçalho e paleta do shell, `src/lib/auth/**`, `src/lib/api/{auth,account}.ts`,
  hooks e queries, `src/lib/{density,countries,download,browser}.ts`, script de bootstrap do tema
  (agora com a densidade), `globals.css`, catálogos (`auth`, `onboarding`, `settings`) e e2e.
- Cliente gerado: imports com extensão `.ts` (`openapi-ts.config.ts`), porque o Turbopack do
  `next build` não resolve o `.js` que o gerador punha e esta é a primeira tela a importá-lo.
- Dependência: `@simplewebauthn/browser` 13.3.0 (MIT, com proveniência).
- Sem mudança na API nem no OpenAPI.
