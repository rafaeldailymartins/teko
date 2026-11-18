## ADDED Requirements

### Requirement: Página de aviso do lockdown

O export MUST ter `/aviso/`, destino do redirect do lockdown do WAF, e `build-vercel-output.ts`
MUST falhar sem ela. A página SHALL explicar a pausa por cota nos dois idiomas lado a lado, cada um
com o próprio `lang`, com título bilíngue e `noindex`, e MUST NOT depender de sessão, da API, de
script próprio ou de recurso fora de `/_next/static/*`.

#### Scenario: Visitante durante o lockdown

- **WHEN** o lockdown está ativo e alguém abre `/pt-BR/`
- **THEN** a borda responde 307 para `/aviso/`, e a página aparece legível nos dois idiomas, com o CSS e as fontes de `/_next/static/`

#### Scenario: Export sem a página

- **WHEN** `apps/web/out` não tem `aviso/index.html`
- **THEN** `node scripts/build-vercel-output.ts` termina com 1 nomeando `aviso/index.html`

#### Scenario: Página fora dos buscadores

- **WHEN** um robô lê `/aviso/`
- **THEN** o documento traz `noindex` e o título "O Tekó está pausado / Tekó is paused"
