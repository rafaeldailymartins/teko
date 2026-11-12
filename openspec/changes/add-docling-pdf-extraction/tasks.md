# Tasks

## 1. tools/ingest

- [x] 1.1 `--page-range` em `convert` e `manifest`, com `page_range`/`part` no manifesto e saída em `<sha256>-p<início>-<fim>/` — `uv run --frozen pytest` (dublês em `tests/docling_fakes.py`)
- [x] 1.2 XLSX pelo `ExcelFormatOption`, `allowed_formats=[PDF, XLSX]` e recusa de outro formato com código 2 — idem
- [x] 1.3 README atualizado (partes, XLSX, matriz do `extract`) — `uv run --frozen ruff check . && uv run --frozen ruff format --check . && uv run --frozen pyright && uv run --frozen pytest` (cobertura 100%)

## 2. ingest.yml

- [x] 2.1 Jobs `discover` → `docling-models` → `extract` → `load` → `lock-pr` / `corpus-eval` → `summary`, com harden-runner em `block` e allowlist por job — actionlint 1.7.12 (Docker)
- [x] 2.2 Falha cedo sem `NETLIFY_SITE_ID`/`NEON_STAGING_PROJECT_ID`; só `target=staging`; código 75 como retomada; PR do lock com a App e commit pela API — `bash .github/scripts/ci-config.test.sh`
- [ ] 2.3 Primeiro run real no staging (depois do merge, com as variáveis cadastradas): medir o tempo do Guia por parte no runner e acertar a allowlist com o insights do harden-runner

## 3. Escopo afetado

- [x] 3.1 Grupo `ingest` com domínio do corpus, CLIs, `corpus/` e os dois workflows — `bash .github/scripts/affected.test.sh`
