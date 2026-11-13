# Proposal

## Why

Na revisão de arquitetura de 2026-11-12 (antes da F4), o mantenedor aprovou tirar a Netlify do
Tekó: a web passa a ser servida pelo mesmo projeto Vercel da API, na mesma origem (ADR 0029), e os
artefatos da ingestão vão do Netlify Blobs para o GitHub Releases do próprio repositório
(ADR 0030), em duas etapas. Esta mudança é a etapa C1: o backend novo e a migração existem, mas os
workflows continuam no Netlify Blobs até a migração rodar verde.

## What Changes

- `scripts/build-vercel-output.ts`: o export do web em `static/`, rotas próprias no `config.json`
  (só `/api/*` e `/healthz` na Function) e os chunks do bundle que o `server.mjs` importa.
- Web: sai a Netlify (`netlify.toml`, plugin `context-routing`, `_redirects`,
  `@netlify/plugin-nextjs`); `src/` vira `app/`, `components/` e `lib/`; em dev, o `next dev`
  repassa `/api/*` direto à API.
- API: saem o CORS e o ticket do stream, o `NETLIFY_PROXY_JWS_SECRET` e o caminho proxiado do
  `ClientIp`; `FUNCTION_MAX_DURATION_S` sem padrão; o Plano B serve o export (`WEB_STATIC_DIR`).
- Ingestão: adapter `BlobStore` do GitHub Releases, `BLOB_STORE` (padrão `github-releases`),
  `GITHUB_TOKEN` proibido na API publicada, comando `ingest blobs-migrate` e workflow
  `blobs-migrate.yml`; `ingest.yml` e `source-watch.yml` com `BLOB_STORE: netlify` explícito.
- Dev local: saem o Caddy do proxy assinado, o `DEV_PROXY_JWS_SECRET` e o `DEV_STATIC_JWS`.
- CI: sai o `tools/netlify-cli` e os spikes da Netlify.

## Capabilities

### Modified Capabilities

- `corpus-ingestion`: os artefatos de fonte passam a uma porta com backend escolhido por
  `BLOB_STORE`, e as variáveis da ingestão ganham `BLOB_STORE`, `GITHUB_TOKEN` e
  `GITHUB_REPOSITORY`.
- `ingestion-workflow`: a checagem inicial e o egress seguem o backend do `BLOB_STORE`, e entra o
  workflow de migração.
- `local-dev-environment`: sai o proxy assinado de dev; o `next dev` repassa `/api/*` à API.

## Impact

- `scripts/build-vercel-output.ts`, `apps/web/**`, `apps/api/src/**` (config, platform, HTTP,
  blobs, CLI), `packages/shared/src/contracts` e `errors`, `infra/**`, `.github/workflows/**`,
  `.github/scripts/ci-config.test.sh`, `scripts/dev-secrets.ts`, ADRs 0029 e 0030 e notas nas
  ADRs 0002, 0003, 0004 e 0017.
