# Corpus do Tekó

Manifesto das fontes oficiais que a ingestão (`cli ingest`, workflow `.github/workflows/ingest.yml`)
traz para o staging, e o estado promovível para a produção. Plano: "Corpus por ondas" e
"Ingestão, vigência e avaliação".

| Arquivo                                        | Conteúdo                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`sources.yaml`](sources.yaml)                 | Fontes das ondas C1 e C2: documento, parser, URL, modo, sha256, datas e partes do Docling |
| [`leiaute-periods.yaml`](leiaute-periods.yaml) | Períodos de leiaute (Ato COTEPE/ICMS 44/2018 e ADE Cofis), curados à mão                  |
| [`overrides/`](overrides/README.md)            | Resoluções da revisão manual, chave `(stable_key, note_hash)`, aprovadas por PR           |
| [`corpus.lock.json`](corpus.lock.json)         | Snapshot promovível (`corpusVersion`, manifesto no Blobs) e o sha256 de cada fonte        |
| [`watch.yaml`](watch.yaml)                     | Páginas que o `sources-watch` monitora (frente E)                                         |

Schemas e loaders: `apps/api/src/adapters/in/cli/ingest/{sources,corpus-lock,overrides-loader}.ts`
e `apps/api/src/domain/corpus/overrides.ts`. O teste `sources.test.ts` valida os arquivos reais.

## Fluxo

1. `cli ingest discover --target staging --out <dir>`: baixa cada fonte habilitada pelo
   `SafeFetcher` (só https, allowlist dos hosts de `sources.yaml`, DNS sem IP interno, ≤ 3
   redirects, ≤ 1 req/s por host), confere o sha256 das `pinned`, e grava `plan.json` e
   `extract-matrix.json` (as partes de PDF sem `docling.json` no Blobs). Fonte `pinned` já gravada
   no store `corpus-raw` não é baixada de novo.
2. `teko-ingest convert` (Python, `tools/ingest`) converte cada parte com o Docling.
3. `cli ingest load --target staging --plan <dir>/plan.json --docling-dir <dir> [--migrate]
   [--bulk] [--report <arquivo>]`: parseia, aplica os overrides, grava no staging (embeddings sob
   o orçamento diário), recalcula a cobertura, exporta o snapshot e atualiza `corpus.lock.json`.
   Código 75 = orçamento de neurons esgotado (o run seguinte retoma pelo `embedding_cache`).
4. O PR do lock leva o snapshot à produção no release (`snapshot promote`).

## Levantamento (2026-11-11)

Feito com User-Agent `teko-corpus-watch (+github.com/rafaeldailymartins/teko)` e no máximo 1
requisição por segundo; os arquivos foram baixados fora do repositório só para medir sha256 e
páginas.

- **gov.br/sped.** A URL "limpa" de cada arquivo devolve a página HTML do portal; o PDF ou zip só
  vem com o sufixo `/@@download/file`, que todas as URLs de `sources.yaml` usam. As datas do CMS
  (março a junho de 2026) são da migração do portal, não da publicação: `published_on` vem da capa
  ou do controle de alterações do próprio documento (ou do `CreationDate` do PDF, dito na nota).
- **Guia Prático EFD ICMS/IPI.** 3.1.9 a 3.2.4 estão no gov.br (habilitadas). 3.0.1 a 3.1.8 só
  existem no portal antigo `sped.rfb.gov.br`, que recusa https: ficam registradas com sha256 e
  `enabled: false`, porque o `SafeFetcher` só aceita https (habilitar exige o aval do mantenedor
  para uma exceção http com pin obrigatório). Por isso a cobertura da EFD ICMS/IPI começa em
  2025-01-01, como na fixture. Não publicadas em lugar nenhum: o Guia 3.0 (anotado sem efeitos no
  Ato 44/2018) e o 2.0.21; as versões 2.0.x são anteriores ao Ato 44/2018 e ficam fora.
- **MD5 do Ato COTEPE.** O Ato registra o MD5 de cada Guia e NT. As NTs batem; nove Guias não
  (3.0.1, 3.0.4, 3.0.5, 3.1.3, 3.1.4, 3.1.7, 3.2.1, 3.2.2 e o 3.2.4 vigente): o PDF publicado foi
  regerado depois. O pin é o sha256 do arquivo publicado; o MD5 do Ato fica só como metadado.
- **Versões corretivas.** 3.2.0 a 3.2.4 são do ciclo do leiaute 020 (2026) e dividem o intervalo
  `[2026-01-01, ∞)`; a reconciliação fecha o conhecimento da anterior em `published_on`. A 3.1.9 fica
  no leiaute 019 (2025), como na fixture da F2.
- **NTs da EFD ICMS/IPI.** 2023.001 v1.2, 2024.001, 2025.001 e 2026.001 (leiautes 018 a 021). As
  NTs 2018.001 a 2022.001 e a 2023.001 v1.0 não estão publicadas. A v1.1 da 2023.001 (sem efeitos) e
  a Nota Orientativa 2026.001 (incorporada ao Guia 3.2.4) ficam desabilitadas.
- **EFD-REINF.** O leiaute entra pelos pacotes de XSD (os zips de "leiautes" só têm PDF, com zips
  aninhados): 2.1.1 (`EFD-Reinf_XSD-v2_01_01-A`) e 2.1.2 (`v2_01_02d`, de 2024-09-30). O XSD de CNPJ
  alfanumérico (NT 03/2026, produção "em data a divulgar") e a revisão de 23/09/2026 ficam
  desabilitados até haver período. As NTs da REINF não declaram data de efeito no texto: ficam
  registradas, desabilitadas, até a curadoria das datas. A NT 02/2023 só existe em http (o item
  `2-2023` do gov.br serve a NT 03/2023). A 2.1 (ADE 93/2021) foi substituída antes de produzir
  efeito. O texto dos ADE não sai do portal de normas da RFB por HTTP simples; as competências
  vieram das notícias oficiais do SPED.
- **RCTE e CTE.** Modo `live` (cp1252, só declarado na meta tag). O RCTE.htm (~10 MB) é regravado
  sem mudar a consolidação ("CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26" em 2026-11-11), então
  o sha256 muda sem mudança de texto: a reconciliação por dispositivo não cria linhas. O CTE estava
  "ATUALIZADO ATÉ A LEI Nº 24.608 DE 06.11.26".
- **Guia EFD-GO.** 4.2 a 5.9, todas publicadas na página índice. As 4.7 a 5.3 foram reenviadas em
  2024/06 ("corrig"), não são os PDFs originais. A 4.6 usa a data da capa (03/10/2017): o índice
  repete a data da 4.5.
- **Tabelas GO.** ids 37 a 40 do WS de Tabelas Externas (`ws-tabela`): a versão atual vem do
  `consultarVersoesTabelasExternas` e o parser confere o SHA-1 do TXT com o `hash` do WS. O WS
  ainda serve versões antigas (`obterTabela.ashx?idTabela=37&versao=150`).
