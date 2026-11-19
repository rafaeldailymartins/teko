# Tasks

## 1. API

- [x] 1.1 `PromoteLockedSnapshot` confere o sha256 do manifesto e a versão contra o lock, não escreve
  com o destino na versão do lock ou à frente dela e promove nos demais casos (verificar: testes
  unitários de `snapshot.test.ts` e o de integração `test/integration/ingest/snapshot.test.ts`)
- [x] 1.2 `cli snapshot promote --lock`, exclusivo com `--manifest`, `--corpus-version` e
  `--rollback`; lock sem snapshot falha (verificar: `adapters/in/cli/snapshot/snapshot.test.ts`)
- [x] 1.3 `loadSnapshotEnv` e `createSnapshotContainer`: a CLI do snapshot sem embeddings
  (verificar: `config/env.test.ts`, typecheck)

## 2. Workflow

- [x] 2.1 Passo `promote-corpus` no job `deploy` do `deploy.yml`, só na produção, entre o migrate e o
  env sync (verificar: `bash .github/scripts/ci-config.test.sh` e actionlint)

## 3. Documentos

- [x] 3.1 ADR 0038 (revisão), `ci-cd-e-ambientes.md`, `ingestao-e-avaliacao.md`, runbooks
  `deploy.md` e `rollback-corpus.md`, `roadmap.md` e `status.md` (verificar: revisão do diff)

## 4. Specs

- [x] 4.1 Deltas de `deployment` e `embedding-pipeline` (verificar: `pnpm spec:validate`)
