# Proposal

## Why

Os Guias Práticos (EFD ICMS/IPI e EFD-GO), as Notas Técnicas e parte dos documentos da EFD-REINF
só existem em PDF ou XLSX. O spike F1 (f) fixou o pipeline do Docling (TableFormer V1 `ACCURATE`,
sem OCR, timeout por documento) e mediu o Guia 3.2.4 inteiro em 71,7 min numa máquina disputada:
no runner, um documento maior pode passar do `document_timeout` e do teto de 330 min do job. A F3
precisa extrair esses documentos no Actions, sem segredos, em paralelo e com retomada por parte, e
ligar a extração ao resto da ingestão (`discover` → `extract` → `load`). É a mudança
`add-docling-pdf-extraction` da F3.

## What Changes

- `tools/ingest` (Python, uv):
  - `--page-range <início>-<fim>` em `convert` e `manifest` (o `page_range` do Docling, páginas
    com base 1): a parte vai para o manifesto (`page_range`, `part`) e para o nome da saída
    (`<sha256>-p<início>-<fim>/`), para documentos longos serem divididos em vários jobs;
  - conversão de XLSX (`ExcelFormatOption`), com o conversor restrito a PDF e XLSX
    (`allowed_formats`) e a extensão conferida antes da conversão (código `2` para outro formato).
- `.github/workflows/ingest.yml`: `workflow_dispatch` (só `target=staging`, `family`, `bulk`) e
  `workflow_call` (chamado pelo `source-watch.yml`), com os jobs `discover` (staging) →
  `docling-models` (cache `docling-<hash do uv.lock>`) → `extract` (matriz, `ubuntu-24.04`,
  `timeout-minutes: 330`, sem segredos) → `load` (staging, `--migrate`, código 75 = retomar) →
  `lock-pr` (App `teko-release-bot`, commit assinado pela API) e `corpus-eval` (retrieval evals
  contra o staging com embeddings reais) → `summary`. harden-runner em `block` em todos os jobs.
- `.github/affected-paths.yml`: o grupo `ingest` passa a cobrir o domínio do corpus, todos os CLIs
  da API, o `corpus/` e os dois workflows; testes em `affected.test.sh` e invariantes do
  `ingest.yml` em `ci-config.test.sh`.
- Fora de escopo: os subcomandos `cli ingest discover|load` (mudança `add-embedding-pipeline`),
  os parsers do JSON do Docling (`add-sped-guides-ingestion`) e o `promote-corpus` do release (F7).

## Capabilities

### New Capabilities

- `docling-extraction`: extração de PDF/XLSX com o Docling, por documento ou por parte, sem
  segredos e com manifesto rastreável.
- `ingestion-workflow`: o `ingest.yml` (orquestração no Actions, environments, egress bloqueado,
  PR do lock e eval do corpus).

### Modified Capabilities

- Nenhuma.

## Impact

- Plano: "`tools/ingest`" (divisão por `page_range` e XLSX) e "Workflows" (jobs do `ingest.yml`);
  desvio consciente da F3: `--migrate` no `load` do staging (registrado no plano pelo
  orquestrador).
- Nenhuma dependência nova: Docling 2.146.0, torch e as actions já usadas no repositório, mais
  `actions/create-github-app-token` v3.3.0 (fixada por SHA).
- Environment `staging` precisa das variáveis `NETLIFY_SITE_ID` e `NEON_STAGING_PROJECT_ID`
  (o workflow falha cedo, com a instrução de cadastro, se faltarem).
