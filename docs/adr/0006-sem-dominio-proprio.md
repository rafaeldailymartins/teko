---

status: accepted
date: 2026-11-14
decision-makers: Rafael Daily Santos Martins
---

# 0006 — Sem domínio próprio: os hosts `*.vercel.app` de cada projeto

## Contexto e problema

O Tekó tem custo zero absoluto: nenhum serviço pago nem domínio próprio. O plano de 2026-11-10
previa, sem domínio, um proxy assinado da Netlify e um ticket HMAC para o stream. A ADR 0029 trocou
esse desenho por web e API na mesma origem, num projeto Vercel por ambiente. Falta registrar o que
"sem domínio" impõe ao resto: sessão, login, passkeys, e-mail e identidade pública do serviço.

## Decisão

1. **O host canônico de cada ambiente é o `*.vercel.app` do projeto:** `tekoia.vercel.app`
   (produção) e `tekoia-staging.vercel.app`. Os domínios antigos (`teko-api*.vercel.app`) respondem
   308 para o canônico (ADR 0029). `WEB_ORIGIN` é essa origem exata, e dela saem a base URL do
   Better Auth, a origem confiável, a guarda de `Origin` e o `rpID` das passkeys.
2. **Sem proxy, sem ticket e sem CORS** (ADR 0029): a sessão é um cookie first-party do próprio
   host.
3. **Cookie só do host.** O `vercel.app` está na Public Suffix List: um cookie não pode valer para
   `*.vercel.app`, e outro projeto da Vercel não lê nem grava o nosso. Os cookies saem sem
   `Domain`, com `HttpOnly`, `SameSite=Lax` e o prefixo `__Secure-` em https, com nomes distintos
   por ambiente (`teko` e `teko-stg`, ADR 0019).
4. **Login sem e-mail.** Sem domínio não há remetente com SPF, DKIM e DMARC próprios: login por
   e-mail e senha ou por link mágico fica fora. O login é OAuth (GitHub e Google) e passkey
   (ADR 0019), com um OAuth app por ambiente apontando para o callback do host canônico.
5. **Contato e identidade pública pelo repositório:** avisos de segurança pelo GitHub (Security
   Advisories e `SECURITY.md`), pedidos de titular pela própria conta (exportação e exclusão em
   `/api/v1/me`) e o registro de tratamento em `docs/privacy/ropa.md`.

## Consequências

- Bom: nenhum custo, nenhum DNS para manter e o TLS do host vem da Vercel.
- Bom: a Public Suffix List isola a sessão de qualquer outro projeto no `vercel.app`.
- Ruim: o `rpID` das passkeys é o host. Trocar de host (um domínio futuro, ou o Plano B no Render)
  invalida as passkeys registradas: o usuário entra de novo pelo OAuth e registra outra.
- Ruim: os callbacks dos OAuth apps e a origem do Better Auth ficam presos ao host; mudar o nome
  do projeto na Vercel exige atualizar os apps e o `WEB_ORIGIN`.
- Ruim: sem e-mail transacional, avisos à pessoa (mudança de Termos, incidente) só aparecem na
  interface, no próximo acesso.
- Neutro: o tipo `tag:teko-api.vercel.app,2026:problems/<code>` do problem+json continua igual: é
  um identificador opaco (ADR 0029).

## Confirmação

- `apps/api/src/config/env.ts`: `WEB_ORIGIN` é uma origem exata, em https no staging e na produção,
  que com banco exigem também `BETTER_AUTH_SECRET` e os dois OAuth apps.
- `apps/api/src/adapters/out/auth/better-auth.ts`: base URL, origem confiável e `rpID` derivados de
  `WEB_ORIGIN`; `test/integration/http/auth.test.ts` confere os cookies e a guarda de `Origin`.
- `scripts/build-vercel-output.test.ts`: o 308 dos domínios antigos para o canônico.

## Mais informações

- [ADR 0029](0029-web-e-api-na-mesma-origem.md) (mesma origem) e [ADR 0019](0019-oauth-e-passkey.md)
  (OAuth e passkey).
- Public Suffix List: `vercel.app` está na seção privada, mantida pela própria Vercel.
