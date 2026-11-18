---

status: accepted
date: 2026-11-18
decision-makers: Rafael Daily Santos Martins
---

# 0038 — Sem Plano B no Render

## Contexto e problema

A [ADR 0004](0004-vercel-hobby-api.md) pôs a API no Vercel Hobby e deixou o Render Free como Plano
B: um web service (`teko-api-planb`, Virginia) com o mesmo `server.ts`, para o caso de a Vercel
pausar o projeto, encerrar a conta ou mudar os termos do Hobby. A
[ADR 0029](0029-web-e-api-na-mesma-origem.md) ampliou o Plano B para servir também o export do web
(`WEB_STATIC_DIR`, `@fastify/static`). O serviço nunca foi criado, mas o código carregava um
terceiro perfil de plataforma (`RUNTIME_TARGET=render`, `TRUST_PROXY` obrigatória), o plugin do
site estático, a configuração em `infra/planb-render/` e um ensaio a cada release minor no DoD da
F7.

## Fatores de decisão

- Mantenedor solo: cada plataforma a mais é configuração, segredos, ensaio e revisão de
  dependências que não são usados no dia a dia.
- O Render Free não tem região na América do Sul (mais de 100 ms por ida e volta até o Neon), dorme
  após 15 min e é construído pelo próprio Render, fora da proveniência atestada do CI.
- O corte mudaria o host: passkeys (`rpID`), apps OAuth e `WEB_ORIGIN` teriam de ser refeitos, e os
  usuários recadastrariam as passkeys.

## Opções consideradas

- **Manter o Plano B**, com o ensaio a cada release minor.
- **Sem Plano B**: a prevenção da pausa fica toda na Vercel.

## Decisão

Opção escolhida: **sem Plano B**, por decisão do mantenedor em 2026-11-18. Saem do repositório o
`RUNTIME_TARGET=render`, a `TRUST_PROXY`, o plugin `static-site` com a `WEB_STATIC_DIR`, o
`@fastify/static`, o `infra/planb-render/` e o ensaio do Plano B da F7. A política das rotas do
estático continua, agora em `scripts/lib/static-site-policy.ts`, porque a Vercel (`config.json` do
`build-vercel-output`) e o Caddy da stack de CI a usam. O perfil `node` (stack de CI, Docker e
`pnpm dev`) continua; em staging e produção o único `RUNTIME_TARGET` aceito é `vercel`.

### Consequências

- Bom, porque sobra uma plataforma publicada e dois perfis de plataforma no código (`vercel` e
  `node`), com menos configuração, testes e dependências.
- Ruim, porque, se a Vercel pausar o projeto (503 `DEPLOYMENT_PAUSED`; no Hobby o recurso estourado
  fica parado cerca de 30 dias) ou encerrar a conta, o Tekó fica fora do ar até o ciclo virar e o
  mantenedor retomar o projeto, ou até migrar para outra plataforma.
- A prevenção fica nos tetos da aplicação, no WAF da Vercel e no `vercel-usage` com kill switch
  (F7). Teste de carga continua só na stack de CI, nunca contra a Vercel.

### Confirmação

- `apps/api/src/config/env.test.ts`: `render` rejeitado como `RUNTIME_TARGET`; em staging e
  produção, só `vercel`.
- `git grep -i "planb\|plano b\|onrender"` só acha o histórico (mudanças arquivadas do OpenSpec,
  esta ADR e as notas de revisão das ADRs anteriores).

## Mais informações

- Mudança OpenSpec `remove-planb-render`.
- Fonte Context7 consultada em 2026-11-18: `/websites/vercel` (Hobby: ao estourar uma cota, o
  recurso para por cerca de 30 dias; uma equipe pausada só volta por ação do dono ou pelo suporte).
- Substitui em parte: [ADR 0004](0004-vercel-hobby-api.md) (seção "Plano B: Render Free") e
  [ADR 0029](0029-web-e-api-na-mesma-origem.md) (item 10).
