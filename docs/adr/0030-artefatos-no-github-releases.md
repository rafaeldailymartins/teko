---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0030 — Artefatos da ingestão no GitHub Releases

## Contexto e problema

Na F3, os artefatos da ingestão ficaram no Netlify Blobs do site `tekoia` (`@netlify/blobs`,
`siteID` + PAT, região `us-east-2`): os arquivos baixados (`corpus-raw`), as saídas do Docling
(`corpus-docling`, que funcionam como cache: o `discover` pula a extração de uma parte que já tem
`docling.json`), os snapshots da promoção (`corpus-snapshots`), o estado do watch
(`corpus-manifests`) e o histórico de evals (`eval-artifacts`). Com a web e a API na mesma origem
na Vercel ([ADR 0029](0029-web-e-api-na-mesma-origem.md)), a Netlify ficaria só para guardar
arquivos, com um PAT de conta inteira no environment `staging`, uma dependência
(`@netlify/blobs`, que ainda traz o `@netlify/otel` e força um override do OpenTelemetry) e as
cotas do plano Free.

Onde guardar esses artefatos sem serviço novo, sem custo e com integridade conferível?

## Fatores de decisão

- Custo zero e nenhuma conta nova.
- Credencial de escopo mínimo, de preferência efêmera e só nos jobs que gravam.
- Integridade: cada artefato conferível por sha256, inclusive o que volta do armazenamento.
- Os artefatos são públicos por natureza (textos de legislação, saídas do Docling, contagens).
- Migração sem perder o cache do Docling (horas de extração) nem os snapshots referenciados pelo
  `corpus.lock.json`.

## Opções consideradas

- **GitHub Releases do próprio repositório** (assets em releases prerelease).
- **Netlify Blobs** (o que existe).
- **Artifacts do Actions** (retenção máxima de 90 dias, sem acesso fora do run sem token).
- **Cloudflare R2** (exige cartão, mesmo no nível gratuito).
- **Arquivos no próprio git** (LFS tem cota baixa; sem LFS, o histórico incha com binários).

## Decisão

Opção escolhida: **GitHub Releases do próprio repositório**, num adapter novo da porta `BlobStore`
(`apps/api/src/adapters/out/blobs/github-releases-blob-store.ts`), escolhido por `BLOB_STORE`
(`github-releases`; o `netlify` existiu só até a etapa C2).

### Releases e assets

| Store              | Release (tag)                           | Asset                                                |
| ------------------ | --------------------------------------- | ---------------------------------------------------- |
| `corpus-snapshots` | `corpus-v<N>` (um por `corpus_version`) | o arquivo (`manifest.json`, `<tabela>.jsonl.zst`)    |
| `corpus-raw`       | `corpus-raw-<0-f>` (16 shards)          | a chave com `/` trocado por `__`                     |
| `corpus-docling`   | `corpus-docling-<0-f>` (16 shards)      | idem                                                 |
| `corpus-manifests` | `corpus-watch-state-<0-3>` (4 shards)   | idem (`watch-state.json`, `discovered__<data>.json`) |
| `eval-artifacts`   | `corpus-eval-history-<0-3>` (4 shards)  | idem                                                 |

- Todos os releases são **prerelease** com `make_latest: "false"`, criados sob demanda no commit
  padrão; nenhum usa o prefixo `v*` (o ruleset `release-tags` e o git-cliff só olham `v*`).
- **Shard** = `sha256(chave) mod shards`, em hex: mantém cada release longe do limite de 1.000
  assets do GitHub (o adapter recusa gravar num release cheio e manda aumentar os shards, o que
  exige migração). O número de shards por store é constante no código.
- **Nome do asset** = a chave com `/` trocado por `__`: reversível sem índice, até 255 caracteres;
  chave com `__`, `..` ou caractere fora de `[A-Za-z0-9._/-]` é recusada (o GitHub renomearia o
  asset). As chaves de fonte já trazem o sha256 do conteúdo (`{família}/{doc}/{versão}/{sha256}...`).
- **Snapshots:** apagar o último asset de `corpus-v<N>` apaga o release e a tag (a retenção do
  `ExportSnapshot` continua funcionando).
- **Integridade:** o GitHub devolve o `digest` (`sha256:...`) de cada asset. O download confere
  tamanho e digest; o upload confere o digest devolvido contra o sha256 dos bytes enviados e apaga
  o asset que chegou diferente; um `set` com o mesmo conteúdo não sobe nada. Não há sobrescrita
  atômica: trocar um asset é apagar e subir (o GitHub recusa nome repetido), então os jobs que
  gravam ficam no grupo de concorrência `ingest-staging`.
- **Credencial:** o `GITHUB_TOKEN` do próprio job, com `contents: write` só nos jobs que gravam
  (`load` do `ingest.yml`, `detect` do `source-watch.yml` e o `blobs-migrate.yml`); o `discover`
  lê com `contents: read`. O `GITHUB_TOKEN` é proibido na API publicada (`RUNTIME_TARGET` vercel
  ou render), como as demais credenciais da ingestão. Releases criados com o `GITHUB_TOKEN` não
  disparam workflows.

### Migração em duas etapas

- **C1 (esta mudança):** o adapter, o `BLOB_STORE`, o comando `cli ingest blobs-migrate` (lista
  cada store do Netlify Blobs e copia cada chave para os releases, idempotente, conferindo o
  sha256 depois de gravar; `--store` e `--dry-run`) e o workflow `blobs-migrate.yml`
  (`workflow_dispatch`, environment `staging`, `contents: write`, harden-runner em `block` com os
  hosts dos dois lados, `dry_run` ligado por padrão e o grupo de concorrência do `ingest.yml`). O
  `ingest.yml` e o `source-watch.yml` declaram `BLOB_STORE: netlify` no topo e continuam no
  Netlify Blobs até a migração; o `ci-config.test.sh` cobra as credenciais e as permissões das
  duas formas.
- **C2 (depois de a migração rodar verde):** `BLOB_STORE: github-releases` nos dois workflows,
  `contents: write` no `load`, no `detect` e no job do `source-watch.yml` que chama o
  `ingest.yml`; saem o adapter e o teste do Netlify Blobs, o `@netlify/blobs` (catálogo,
  dependência e o override do OpenTelemetry que ele forçava), o comando e o workflow de migração,
  as variáveis `NETLIFY_*` do `env.ts` e o `NETLIFY_AUTH_TOKEN`/`NETLIFY_SITE_ID` do environment
  `staging`; o site `tekoia` pode ser apagado.

## Consequências

- Bom: nenhum serviço nem segredo de longa duração; o token é do job e expira com ele.
- Bom: integridade conferida em toda leitura e gravação, pelo digest que o próprio GitHub calcula.
- Bom: os artefatos são públicos e baixáveis por qualquer pessoa, o que combina com o projeto
  aberto (reprodução da ingestão sem credencial de terceiros).
- Ruim: a página de releases do repositório ganha cerca de 40 prereleases técnicos (fora do
  "latest"); a descrição de cada um diz que não é versão do produto.
- Ruim: listar um store percorre todos os shards (16 chamadas, com cache por processo).
- Ruim: se o repositório ligar "immutable releases" (desligado em 2026-11-12), os releases
  publicados deixam de aceitar assets novos, e o desenho precisa de releases em rascunho.

## Confirmação

- `github-releases-blob-store.test.ts`: mapeamento de chaves, shards, idempotência, digest no
  download e no upload, retentativa de 5xx, 422 de corrida na criação, paginação e o limite de
  assets, contra um GitHub de mentira.
- `run-blobs-migrate.test.ts`: cópia de todos os stores, segunda rodada sem cópia, `--dry-run`,
  falhas por chave.
- `ci-config.test.sh`: as duas formas do `BLOB_STORE` nos workflows e o `blobs-migrate.yml`.
- Operação: duas rodadas verdes do `blobs-migrate.yml` antes da etapa C2.

## Mais informações

- Fontes Context7 consultadas em 2026-11-12: `/websites/github_en_rest` (Releases: criar com
  `prerelease`/`make_latest`, release por tag, upload em `uploads.github.com` com `name`, 422 de
  nome repetido, 502 que deixa asset `starter`, listar assets, `digest` no asset, download com
  `Accept: application/octet-stream` e redirect).
- Ruleset `release-tags` (só `refs/tags/v*`) e "immutable releases" desligado conferidos pela API
  em 2026-11-12, sem alterar nada.
- Plano congelado, seção "Escrita, Blobs, snapshot e promoção"; o vigente está em
  `docs/architecture/ingestao-e-avaliacao.md`.

## Nota (2026-11-13): migração feita e etapa C2

O `blobs-migrate.yml` copiou os artefatos no run 43355872236: 150 itens (59 raw, 55 do Docling, 33
de snapshot e 3 do watch; nenhum de eval), sem falha, e o dry-run seguinte deu 150 já iguais. A
etapa C2 tirou o adapter, o comando e o workflow da migração, o `@netlify/blobs` (com o override do
OpenTelemetry que ele forçava), as variáveis `NETLIFY_*` e o valor `netlify` do `BLOB_STORE`. O
`ingest.yml` e o `source-watch.yml` declaram `BLOB_STORE: github-releases` (a CLI exige o
`GITHUB_TOKEN` em vez de cair no store em memória), com `contents: write` só no `load`, no
`detect`, no job do `source-watch.yml` que chama o `ingest.yml` e no `corpus-eval-history`, um
job novo que grava o histórico do `corpus-eval` sem nunca rodar o código de um PR (`ref`): o
`corpus-eval`, que roda esse código no modo eval-only, ficou só com leitura.
