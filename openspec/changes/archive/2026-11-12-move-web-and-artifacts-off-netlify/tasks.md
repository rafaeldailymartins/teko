# Tasks

## 1. Web e API na mesma origem (ADR 0029)

- [x] 1.1 `build-vercel-output`: export em `static/`, rotas do `config.json`, chunks do bundle e teste com o simulador de rotas
- [x] 1.2 Web sem Netlify e com `src/app`, `src/components` e `src/lib`
- [x] 1.3 API sem CORS, ticket nem caminho proxiado; `FUNCTION_MAX_DURATION_S` obrigatória na Vercel
- [x] 1.4 Plano B servindo o export (`WEB_STATIC_DIR`, `@fastify/static`)
- [x] 1.5 `infra/vercel` (env, WAF, README), `infra/planb-render` e dev local sem proxy assinado

## 2. Artefatos no GitHub Releases (ADR 0030, etapa C1)

- [x] 2.1 Adapter `BlobStore` do GitHub Releases, com testes contra um GitHub de mentira
- [x] 2.2 `BLOB_STORE`, `GITHUB_TOKEN` e `GITHUB_REPOSITORY` no `env.ts` e na raiz de composição
- [x] 2.3 `cli ingest blobs-migrate` e o workflow `blobs-migrate.yml`
- [x] 2.4 `ingest.yml` e `source-watch.yml` com `BLOB_STORE: netlify`; checagens no `ci-config.test.sh`

## 3. Documentação

- [x] 3.1 ADRs 0029 e 0030 e notas de revisão nas ADRs 0002, 0003, 0004 e 0017
- [x] 3.2 `docs/architecture` (frontend, backend, ingestão) e delta da mudança aberta `add-source-change-monitoring`
