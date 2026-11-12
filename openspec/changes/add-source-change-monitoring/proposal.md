# Proposal

## Why

O `CheckCoverage` recusa como `out_of_coverage` toda data posterior ao `verified_at` de cada
família. Sem um processo que confira as fontes todo dia e avance esse `verified_at`, o Tekó
recusaria até a data padrão (mês anterior) poucos dias depois de cada ingestão; e, quando uma
fonte muda (decreto novo, Guia novo, tabela nova), a cobertura precisa marcar a lacuna a partir da
data de efeito até a ingestão alcançar a mudança. É a mudança `add-source-change-monitoring` da F3.

## What Changes

- `corpus/watch.yaml` e o loader com schema (`adapters/in/cli/sources-watch/watch-config.ts`): as
  páginas monitoradas (RCTE, CTE, decretos atualizadores, sumário anual de decretos, leis
  atualizadoras do CTE, índices do SPED, Guia EFD-GO e WS de Tabelas Externas), com tipo, família,
  modo `live`/`pinned` e filtros.
- Leitura dos sinais (`signals.ts`, `htmlparser2`): cabeçalho "CONSOLIDADO ATÉ O DECRETO Nº …",
  listas de atos com data do DOE, links de documentos (inclusive no JSON embutido do gov.br) e
  `versao`/`hash` das tabelas do WS.
- Caso de uso `WatchSources`: GET condicional (ETag e Last-Modified em
  `corpus-manifests/watch-state.json`), linha de base na primeira observação, atos pendentes até o
  consolidado alcançá-los, `discovered.json` com `{family, sourceUrl, effectiveFrom, versionLabel,
  kind}` (mais `pageId`, `mode`, `status`) e famílias não verificadas.
- Caso de uso `MarkCoverage` e o repositório `pg-coverage-watch-repository.ts` (role
  `teko_watch`): sem mudança, exatamente um `UPDATE corpus.coverage SET verified_at = <data do run>
  WHERE verified_at < <data do run>`; com mudança, também `gaps + [effectiveFrom, ∞)` e
  `gap_reason`.
- Handlers `runSourcesWatch` e `runCoverageMark` (dependências por parâmetro; a fiação no
  `cli.ts` fica com o orquestrador).
- `.github/workflows/source-watch.yml`: cron `0 9 * * *` + dispatch; `detect` (environment
  `staging`, Blobs e GETs, sem banco) dispara o `ingest.yml` quando muda uma fonte `live`;
  `mark-coverage` (environment `corpus-watch`, só as URLs do `teko_watch`); `watch-errors` deixa o
  run vermelho se alguma página não foi verificada.
- Fora de escopo: evento ao Sentry (F6, sem DSN ainda), métrica `teko_coverage_verified_age_days`
  e alerta do Grafana (`ops.yml`, F6/F7).

## Capabilities

### New Capabilities

- `source-change-monitoring`: verificação diária das fontes, detecção de versão nova e marcação
  da cobertura (`verified_at`, `gaps`, `gap_reason`).

### Modified Capabilities

- Nenhuma.

## Impact

- Plano: "Monitoramento de mudanças" (as páginas "Decretos de <mês>" são o sumário anual
  `INDICES/sumarios/Decretos_<ano>.htm`, que lista cada decreto com data e DOE; o CTE usa
  `leis_atualizadoras.htm`; página não verificada não avança o `verified_at` da família).
- Nenhuma dependência nova (`htmlparser2`, `yaml`, `zod` e `drizzle-orm` já estão no catálogo).
- Hosts das fontes na allowlist do SafeFetcher (frente de pipeline): `appasp.economia.go.gov.br`,
  `www.gov.br`, `goias.gov.br`, `www.sped.fazenda.gov.br`.
