# Design

## Context

O job Python existe desde o spike F1 (f): `teko-ingest convert` grava `out/<sha256>/{docling.json,
manifest.json}` com o pipeline travado (TableFormer V1 `ACCURATE`, cell matching, OCR só com
`ocr: true`, `document_timeout` de 3600 s, serviços remotos desligados) e recusa
`PARTIAL_SUCCESS`. A F3 o coloca no Actions: um job por documento (ou parte), sem segredos, entre
o `discover` e o `load` do CLI Node.

## Goals / Non-Goals

**Goals:**

- Documento longo dividido em partes que cabem no `document_timeout` e no teto de 330 min.
- XLSX pelo mesmo caminho (REINF, tabelas em planilha).
- `extract` sem segredos e sem rede além do índice de pacotes; modelos só do cache.
- PR do lock assinado e com DCO, aberto por um token que dispara o `pr-gate`.

**Non-Goals:**

- Escolha das partes de cada documento (é do `corpus/sources.yaml`, frente de pipeline).
- Junção das partes (o parser Node lê os `docling.json` na ordem de `page_range`).

## Decisions

- **Parte = intervalo de páginas, no nome e no manifesto.** O diretório da saída é
  `<sha256>-p<início>-<fim>` e o manifesto ganha `page_range` (`[início, fim]` ou `null`) e
  `part` (`p<início>-<fim>` ou `null`). O `schema_version` continua 1: os campos são opcionais na
  leitura e o leitor confere a coerência entre os dois. O nome do artifact do `extract` repete o
  diretório (`docling-<sha256>[-p…]`), então o `load` junta todos com `merge-multiple` sem colisão.
- **`page_range` só quando pedido.** Sem `--page-range`, o `convert` chama o Docling sem o
  argumento (o padrão dele é o documento inteiro); com ele, passa uma tupla `(início, fim)` de
  inteiros, que é o que o `validate_call(strict=True)` do `DocumentConverter.convert` aceita.
- **Formatos restritos.** `allowed_formats=[PDF, XLSX]` e a extensão conferida antes de calcular
  o hash: um arquivo inesperado falha em segundos (código 2), não depois de minutos de conversão.
  XLSX usa o `ExcelFormatOption` padrão (sem modelos).
- **Matriz validada no `discover`.** O CLI Node grava `extract-matrix.json` (lista de
  `{id, file, sourceId, url, pageRange, ocr, timeoutSeconds}`); o workflow confere cada campo com
  `jq` (regex de sha256/parte, caminho relativo sem `..`, URL `https`, no máximo 256 itens) antes
  de virar parâmetro de jobs. Os valores chegam aos `run:` só por `env`.
- **Um job grava o cache dos modelos.** `docling-models` restaura o cache
  `docling-${{ hashFiles('tools/ingest/uv.lock') }}-layout-tableformer` e, se faltar, roda
  `uv run docling-tools models download --output-dir .cache/docling-models layout tableformer` e
  salva. Só esses dois: sem a lista, o `docling-tools` baixa o conjunto padrão, e o OCR do RapidOCR
  vem do ModelScope (`cdn-lfs-cn-1.modelscope.cn`), que o harden-runner bloqueou no primeiro run
  (2026-11-12). Como nenhuma fonte liga o OCR, o `discover` recusa `ocr: true` até o modelo entrar
  no cache. Os itens da
  matriz só restauram (`fail-on-cache-miss`) e rodam com `HF_HUB_OFFLINE=1`: a conversão não toca
  a rede, e a allowlist do `extract` não inclui Hugging Face.
- **Jobs depois do `load` com condição explícita.** `lock-pr` e `corpus-eval` usam
  `!cancelled() && needs.load.result == 'success' && …`. Um `if:` sem função de status ganha um
  `success()` implícito, que dá falso quando um ancestral foi pulado: no run sem PDF novo
  (2026-11-12, `extract` pulado), os dois foram pulados com o `load` verde.
- **Código 75 não é falha.** O `load` termina verde com `status=budget_exhausted` quando o
  orçamento diário de neurons acaba; o resumo pede outro run, que retoma pelo `embedding_cache`.
- **Commit do lock pela API GraphQL (`createCommitOnBranch`).** Com o token da App
  (`actions/create-github-app-token`, `client-id` + chave privada), o GitHub assina o commit
  (Verified) sem chave no runner; a mensagem leva `Signed-off-by` do bot. Branch
  `chore/corpus-lock-<run_number>`, título `chore(ingest): …`. Um PR aberto pela App dispara o
  `pr-gate` (o `GITHUB_TOKEN` não dispararia).
- **Segredos de environment num workflow chamado.** Pela documentação do GitHub, o chamador
  precisa repassar pelo nome os segredos que os jobs com `environment` usam; o `ingest.yml`
  declara todos em `workflow_call.secrets` e o `source-watch.yml` os repassa (nunca
  `secrets: inherit`).
- **harden-runner em `block` em todos os jobs**, com allowlist por job: GitHub e artifacts em
  todos; npm/Node nos jobs Node; fontes oficiais e `api.netlify.com` no `discover`; Netlify,
  Cloudflare e Neon no `load`; PyPI, `download.pytorch.org` e Hugging Face só no
  `docling-models`; `releases.astral.sh` (binário do uv) onde o `setup-uv` roda.

## Risks / Trade-offs

- **Hosts não observados.** A allowlist foi montada sem um período em `audit`: o destino das URLs
  assinadas do Netlify Blobs (`*.s3.us-east-2.amazonaws.com` é uma suposição), o CDN atual do
  PyTorch e os hosts de modelos do RapidOCR podem divergir. O primeiro run mostra o bloqueio no
  insights do harden-runner e a correção é acrescentar o host.
- **Curingas no `allowed-endpoints`** (`*.neon.tech:5432`, `*.blob.core.windows.net:443`):
  necessários porque os hosts mudam por projeto e por conta de armazenamento.
- **`corpus-eval` com relógio fixo.** O provider das evals fixa 2026-11-10; os casos de recusa
  "depois do `verified_at`" dependem da cobertura real do staging e podem mudar de resultado
  conforme o tempo passa. O gate é o mesmo `thresholds.json` das evals do PR.

## Context7

| Biblioteca / serviço            | ID                                 | Consulta                                                                                                           |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Docling 2.146                   | `/docling-project/docling`         | `DocumentConverter.convert(page_range=…)`, `ExcelFormatOption`, `allowed_formats`, `docling-tools models download` |
| GitHub Actions                  | `/websites/github_en_actions`      | segredos de environment em workflow chamado, `workflow_call.secrets`                                               |
| actions/create-github-app-token | `/actions/create-github-app-token` | `client-id`, `permission-*`, outputs `token` e `app-slug`                                                          |
| htmlparser2 12 (fixtures)       | `/fb55/htmlparser2`                | ver `add-source-change-monitoring`                                                                                 |

O harden-runner (step-security) não está no Context7; as entradas foram conferidas no
`action.yml` publicado (`egress-policy`, `allowed-endpoints`).
