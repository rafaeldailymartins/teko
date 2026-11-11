# Proposal

## Why

A fase F1 precisa de um esqueleto que todas as fases seguintes reaproveitem: um monorepo com três
pacotes JS, ferramentas da raiz com versões exatas, uma cadeia de suprimentos de dependências
endurecida (o projeto é público e roda em produção sem orçamento para incidentes) e uma stack
local reproduzível que imite o proxy assinado da Netlify, já que a API recusa chamadas sem
`x-nf-sign`.

## What Changes

- Monorepo pnpm 12 + Turborepo com `@teko/web` (`apps/web`), `@teko/api` (`apps/api`) e
  `@teko/shared` (`packages/shared`); `tools/ingest` em Python/uv fora do workspace JS.
- Catálogo pnpm estrito com versões exatas e hardening: `minimumReleaseAge` de 7 dias,
  `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds` com `allowBuilds` revisado
  e guarda de lockfile de documento único (ADR 0002). O catálogo é a fonte da verdade das
  versões; 13 pacotes ficaram na versão anterior por causa da regra de 7 dias.
- Proveniência da Vercel: `@vercel/functions` fixado em 3.7.6 no workspace da aplicação, sem
  exceção de política, e o Vercel CLI 65.11.0 num projeto pnpm isolado (`tools/vercel-cli`, com
  lockfile e exceções próprios), usado só nos jobs de deploy (ADR 0002).
- `tsconfig.base.json` estrito (nodenext, `erasableSyntaxOnly`), Biome (proíbe `@vercel/*` em
  `domain`/`application`), Turborepo em `envMode` estrito, knip em dois modos (padrão e
  `--production` só de dependências) e git-cliff (sem Changesets).
- `.gitignore` com `/apps/web/out/` ancorado (o padrão `out/` sem âncora ignorava
  `apps/api/src/adapters/out`).
- `tools/ingest` com cooldown de 7 dias no uv (`exclude-newer = "7 days"`).
- `@teko/shared` com `contracts`, `errors`, `vigencia`, `pii`, `analytics` e `i18n`.
- `infra/local/compose.yaml` (PostgreSQL 18 + pgvector 0.8.6, proxy Caddy assinado em
  `127.0.0.1:8787`, profile opcional `langfuse`) e `infra/local/Caddyfile`.
- `pnpm dev:secrets` (`scripts/dev-secrets.ts`) gera os segredos locais em arquivos fora do git.
- Fora de escopo: schema do banco e migrações (F2), API funcional (F4), frontend completo (F5),
  stack de CI (`infra/ci`, F4) e deploy na Vercel (`infra/vercel`, `deploy-api.yml`, F7). O
  `apps/api/vercel.json` e os spikes (b) e (c) da F1, que dependem de tokens da Vercel e da
  Netlify, ficam no grupo 4 das tarefas.

## Capabilities

### New Capabilities

- `dependency-supply-chain`: regras que decidem quais versões de dependências podem entrar no
  lockfile e quais scripts de instalação podem rodar.
- `local-dev-environment`: stack local de desenvolvimento (banco, proxy assinado de dev, Langfuse
  opcional) e geração de segredos locais.

### Modified Capabilities

Nenhuma.

## Impact

- Raiz: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `biome.json`,
  `tsconfig.base.json`, `lefthook.yml`, `commitlint.config.mjs`, `knip.json`, `cliff.toml`,
  `.jscpd.json`, `scripts/check-lockfile.ts`, `scripts/dev-secrets.ts`.
- `apps/web`, `apps/api`, `packages/shared`, `tools/ingest`, `tools/vercel-cli`, `infra/local/`,
  `.gitignore`.
- ADRs 0002 (supply chain), 0003 (spikes da F1) e 0004 (API no Vercel Hobby + Plano B no
  Render).
