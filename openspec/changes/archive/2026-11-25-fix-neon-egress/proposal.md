# Proposal

## Why

Em 2026-11-18 o Neon suspendeu o compute do `teko-staging`: 5,09 GB de transferência pública
(egress, o que sai do banco para os clientes) no ciclo iniciado em 2026-11-10, contra os 5 GB por
projeto por mês do Free. O staging fica sem banco até o ciclo virar (~2026-12-10). O `teko-prod`
está quase zerado. Ninguém media essa cota: o job `quotas` só olhava CU-h, e nada impedia uma
ingestão ou um `corpus-eval` de rodar com a cota no fim.

Pelo código e pelos 31 runs do `ingest.yml` no ciclo, o gasto vem de leituras que trazem o vetor
`halfvec(1024)` em texto (~12,7 KB por chunk, medido nos vetores BGE-M3 da fixture) ou o corpus
inteiro para fora do banco: as 13 exportações de snapshot (~340 MB cada, ~270 MB só de vetores), a
ingestão que lia cada vetor novo do `embedding_cache` duas vezes, a poda do cache e os
`corpus-eval`.

## What Changes

- Ingestão sem vetor saindo do banco: o `EmbeddingCache` troca `getMany` (vetores) por
  `cachedHashes` (só as chaves); `insertVersions` copia o vetor do `embedding_cache` para o chunk
  por subconsulta SQL e recusa chunk novo sem vetor; a poda (`retainOnly`) apaga no banco com a
  lista do que fica como parâmetro.
- Exportação do snapshot: o vetor sai pelo binário do `halfvec_send` em base64 (~2,8 KB) e vira o
  texto canônico na aplicação (`halfvec-wire.ts`), sem mudar o formato do arquivo; com
  `reuseExisting` (o `ingest load`), o manifesto da mesma versão e migração já gravado no store é
  devolvido sem reler o banco.
- `ingest load`: a poda do `embedding_cache` só roda quando o plano cobriu todas as famílias **e**
  alguma versão foi publicada.
- Monitoramento: o job `quotas` (`scripts/ops-metrics.ts`) emite `teko_neon_data_transfer_ratio`
  (`data_transfer_bytes` do período sobre 5 GB), com painel no dashboard de cotas e os alertas
  `teko-neon-transfer-50` (aviso) e `teko-neon-transfer-80` (crítico) no Grafana as code.
- Guarda: job `neon-transfer` no `ingest.yml`, antes de qualquer job que toca o banco (nos dois
  modos), com `scripts/neon-transfer-guard.ts`: para com `::error` acima de 80%, salvo o input
  `allow_high_transfer`, e põe o número no resumo.
- Runbook `neon-suspended.md` (seção "Transferência acima da cota": esperar o ciclo ou trocar de
  projeto, e como achar o fluxo culpado); `contas-e-cotas.md`, `observabilidade.md`,
  `infra/grafana/README.md` e `docs/status.md` (incidente).

Fora de escopo: qualquer chamada ao Neon real, disparo de workflow ou mudança de configuração; o
`corpus-eval` continua lendo as evidências que avalia (é o próprio objeto da medida), coberto pela
guarda.

Fase: incidente entre a F7 e a F8. ADRs afetadas: nenhuma; segue `contas-e-cotas.md`.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `embedding-pipeline`: o vetor não sai do banco na ingestão; a poda só em run que publicou.
- `corpus-ingestion`: exportação com o vetor em binário e reaproveitamento do snapshot da mesma
  versão e migração.
- `operations-monitoring`: métrica e alertas de transferência do Neon.
- `ingestion-workflow`: guarda de transferência antes da ingestão e do `corpus-eval`.

## Impact

- `apps/api/src/application/ports/{embedding-cache,corpus-ingestion-repository}.ts`,
  `apps/api/src/application/use-cases/{embed-pending,ingest-document-version,export-snapshot,promote-snapshot}.ts`,
  `apps/api/src/adapters/out/persistence/drizzle/repositories/{pg-embedding-cache,pg-ingestion-corpus-repository,pg-snapshot-repository,halfvec-wire}.ts`,
  `apps/api/src/adapters/in/cli/ingest/load.ts`, com os testes unitários e de integração.
- `scripts/ops-metrics.ts`, `scripts/neon-transfer-guard.ts`, `scripts/lib/grafana-as-code.ts` e
  testes; `infra/grafana/{alerts.json,README.md,dashboards/quotas.json}`.
- `.github/workflows/ingest.yml`, `.github/scripts/ci-config.test.sh`.
- `docs/runbooks/neon-suspended.md`, `docs/architecture/{contas-e-cotas,observabilidade}.md`,
  `docs/status.md`.
