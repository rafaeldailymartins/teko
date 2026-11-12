# Tasks

## 1. Regras de vigência (domínio)

- [x] 1.1 `domain/corpus/validity.ts`: pivô do ano, datas das notas, inclusivo → meio-aberto, leitura de `NotaVigncia`, `NovaRedao`/`NovaRedRev` e notas inline (prorrogação, "sem vigência", "EXAURIU-SE", renumeração, "ao caput") — `vitest run --project unit src/domain/corpus/validity.test.ts`
- [x] 1.2 Linha do tempo de um dispositivo (`resolveTimeline`), `mergeIdenticalConsecutive`, `flagOverlaps` e `applyRestructuringCut`, com os códigos de revisão estáveis — mesmos testes
- [x] 1.3 Propriedades fast-check: inclusivo → meio-aberto, ida e volta da data pelo pivô, merge de idênticas, ausência de sobreposição, hash invariante a whitespace — mesmos testes
- [x] 1.4 Cobertura do arquivo ≥ 95% de linhas e ≥ 90% de ramos (thresholds do `vitest.config.ts`) — `vitest run --project unit --coverage` (100% linhas, 91% ramos); Stryker restrito ao arquivo com 78,14 (limite 70) — `stryker run --mutate src/domain/corpus/validity.ts`

## 2. Parser `go-html-state-machine`

- [x] 2.1 Leitura cp1252 explícita com `htmlparser2` em streaming (`readParagraphs`) e rótulos de dispositivo (`parseLabel`, `sortPathOf`, `displayLabelOf`, `headingTailOf`) iguais aos da fixture da F2 — teste com todos os dispositivos de `rcte.json` e `cte.json`
- [x] 2.2 Máquina de estados (grupos, abertura herdada, bloco do pai, estilo, títulos, recorte do CTE, cabeçalho, renumeração com `labels`, `stats`) e `parseConsolidatedWithDiagnostics` — `vitest run --project unit src/adapters/in/cli/ingest/parsers/go-html-state-machine.test.ts`
- [x] 2.3 Golden `__fixtures__/rcte/art-76.htm` (bytes cp1252 reais dos §§ 5º a 10) e `art-76.expected.json`, com os intervalos da tabela do plano — mesmo teste
- [x] 2.4 Casos com recortes reais: "sem vigência" + renumeração (art. 59), "exauriu-se" (art. 64, IV), estilo trocado (art. 12, V), prorrogação (art. 76, § 3º-A), CTE de 1995 com pivô 91 (art. 71, IV); "vIGÊNCIA" e retroativo do Dec. 9.716 no golden; nota ilegível sem ato próprio (sintético, o caso não existe isolado na fonte) — mesmo teste
- [x] 2.5 Comparação com a fixture da F2 sobre os Títulos III–IV do RCTE e o Título II do CTE (`.htm.gz`), com as chaves do golden idênticas e ≥ 92% das `NotaVigncia` convertidas — mesmo teste

## 3. Medição e documentação

- [x] 3.1 Medição sobre o RCTE.htm e o CTE.htm inteiros, fora do CI e do repositório (RCTE 95,8%, CTE 96,6% das `NotaVigncia`; o restante em revisão) — tabela no `design.md`
- [x] 3.2 ADR 0011 "Docling + parser RCTE" — `docs/adr/0011-docling-e-parser-rcte.md`
- [x] 3.3 Registro do parser em `parsers/index.ts` e `year_pivot` das fontes `rcte` e `cte` no `sources.yaml` (frente D); `-text` das fixtures em `.gitattributes` (já aplicado) — `git check-attr text <fixture>.htm` = `unset`
- [x] 3.5 Linha da ADR 0011 no `docs/adr/README.md` (arquivo fora da frente; texto no relatório da frente A) — `pnpm spec:validate`
- [x] 3.4 Gramática da `stable_key` com segundo sufixo de artigo (`art: \d{1,4}(-[A-Z]){0,2}`) em `provision-id.ts`, para os 38 artigos "167-S-B" do RCTE saírem de `skipped` (aplicada pelo orquestrador: só amplia a gramática, nenhuma chave existente muda) — `vitest run --project unit src/domain/corpus/provision-id.test.ts`
