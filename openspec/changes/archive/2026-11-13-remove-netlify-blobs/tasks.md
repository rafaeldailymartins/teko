# Tasks

## 1. Código

- [x] 1.1 Remover o adapter do Netlify Blobs, o `ingest blobs-migrate` e os testes
- [x] 1.2 `env.ts` sem `NETLIFY_*` e sem o valor `netlify` do `BLOB_STORE`; raiz de composição só com o GitHub Releases
- [x] 1.3 `@netlify/blobs` fora do catálogo, da dependência, do override do OpenTelemetry e do lint do web

## 2. Workflows

- [x] 2.1 `ingest.yml` e `source-watch.yml` com `BLOB_STORE: github-releases`, sem Netlify, escrita só nos jobs que gravam
- [x] 2.2 Histórico do `corpus-eval` num job próprio, sem o código de um PR
- [x] 2.3 Sair o `blobs-migrate.yml`, a exceção no `zizmor.yml` e as checagens no `ci-config.test.sh`

## 3. Documentação

- [x] 3.1 Nota na ADR 0030, `docs/status.md`, `docs/architecture` e `infra/vercel/README.md`
