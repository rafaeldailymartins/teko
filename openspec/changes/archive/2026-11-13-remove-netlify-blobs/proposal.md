# Proposal

## Why

A migração dos artefatos da ingestão do Netlify Blobs para o GitHub Releases terminou em
2026-11-13 (run 43355872236 do `blobs-migrate.yml`: 150 itens conferidos pelo sha256, e um dry-run
seguinte com os 150 já iguais). Esta é a etapa C2 da ADR 0030: o Netlify Blobs sai do código e dos
workflows.

## What Changes

- Saem o adapter do Netlify Blobs, o `cli ingest blobs-migrate`, o `blobs-migrate.yml`, o
  `@netlify/blobs` (com o override do OpenTelemetry que ele forçava), as variáveis `NETLIFY_*` e o
  valor `netlify` do `BLOB_STORE`.
- `ingest.yml` e `source-watch.yml` declaram `BLOB_STORE: github-releases`, sem segredos da
  Netlify, com `contents: write` só nos jobs que gravam.
- O histórico do `corpus-eval` vai para um job próprio (`corpus-eval-history`), que nunca roda o
  código de um PR; o `corpus-eval`, que roda esse código no modo eval-only, fica só com leitura.

## Capabilities

### Modified Capabilities

- `corpus-ingestion`: os artefatos ficam só no GitHub Releases; saem as variáveis da Netlify e a
  migração.
- `ingestion-workflow`: checagem e egress sem o Netlify Blobs, escrita só no `load` e no
  `corpus-eval-history`, e sai o workflow de migração.

## Impact

- `apps/api/src` (config, composition root, CLI, blobs), `apps/web` (lint), `pnpm-workspace.yaml`,
  `.github/workflows/{ingest,source-watch}.yml`, `.github/scripts/ci-config.test.sh`,
  `.github/zizmor.yml`, ADR 0030 e documentação.
