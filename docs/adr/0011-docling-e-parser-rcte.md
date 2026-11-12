---

status: accepted
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0011 — Docling (TableFormer V1 `ACCURATE`) para PDF e máquina de estados HTML para o RCTE e o CTE

## Contexto e problema

O corpus da onda C1 tem duas naturezas de fonte. Os Guias Práticos, as NTs e os leiautes vêm em
PDF (e XLSX), com tabelas de registros e campos que atravessam páginas. O RCTE (Decreto
4.852/1997, ~10 MB) e o CTE (Lei 11.651/1991, ~2 MB) são consolidados em HTML exportado do Word,
em Windows-1252, em que cada redação histórica de cada dispositivo fica no próprio documento,
marcada pela classe do parágrafo (`ParNormal`, `TextoRevo`, `NovaRedao`/`NovaRedRev`,
`NotaVigncia`) e por notas de vigência escritas à mão ("Redação com vigência de 12.09.03 a
03.11.04", "vIGÊNCIA: 01.12.19", "230.09.03", "EXAURIU-SE"). A vigência de cada redação é o que o
Tekó responde, então a extração precisa ser reproduzível, auditável e mandar a anomalia para a
fila de revisão em vez de adivinhar.

## Fatores de decisão

- Custo zero e execução no GitHub Actions (sem serviço pago de OCR ou de layout).
- Tabelas de campos do Guia com número, nome, tipo e tamanho separados, inclusive depois da quebra
  de página.
- Vigência dos consolidados meio-aberta (`[a, b + 1)`), com a ordem dos parágrafos valendo mais
  que o texto das notas; DoD da F3: ≥ 92% das `NotaVigncia` convertidas e 100% do restante na
  fila de revisão.
- Chaves, `headingPath` e rótulos idênticos aos da fixture da F2 (o golden e as retrieval evals
  dependem deles).

## Opções consideradas

- PDF: Docling com TableFormer V1 `ACCURATE`; Docling com `TableStructureV2Options`; extração de
  texto simples (pypdfium2, usada na curadoria da fixture).
- HTML: o mesmo Docling (HTML → `DoclingDocument`); DOM completo (cheerio/jsdom) com seletores;
  **máquina de estados em Node sobre o `htmlparser2` em streaming**.

## Decisão

**PDF e XLSX: Docling 2.146.0 com TableFormer V1 `ACCURATE` e cell matching**, como decidido no
spike F1 (f) (ADR 0003, "Spike (f): ingestão", decisão do mantenedor em 2026-11-11). O V2 é 43%
mais rápido, mas funde número e nome do campo (69 células `01 REG` na amostra) e perde o cabeçalho
das tabelas de registros; o V1 converteu o Guia 3.2.4 inteiro (366 páginas, 457 tabelas) sem
erros. A conversão roda em `tools/ingest` (Python, sem segredos), e o parser `docling-guia`
costura as tabelas que continuam depois da quebra de página.

**RCTE e CTE: parser `go-html-state-machine` em Node** (`apps/api/src/adapters/in/cli/ingest/
parsers/`), com as regras puras de vigência em `apps/api/src/domain/corpus/validity.ts`:

1. **Leitura.** `new TextDecoder('windows-1252')` explícito, em pedaços de 64 KB, alimentando o
   `htmlparser2` 12 em streaming; só o texto dos `<p>` (com a classe e as âncoras) interessa.
   O RCTE inteiro sai em menos de 2 s.
2. **Máquina de estados por parágrafo.** `NovaRedao`/`NovaRedRev` abre o primeiro dispositivo
   depois dela e os filhos dele (nunca numa "nova redação ao caput"); `NotaVigncia` fecha o grupo
   de redações superadas logo antes dela (as que não se fecharam com nota inline); `ParNormal` é a
   redação vigente; notas editoriais (`NotaDisc*`, `NotaRev*`) são transparentes. Filho superado
   sem nota própria fecha com o "bloco do pai". O rótulo (`Art. 76.`, `§ 6º`, `II -`, `a)`, `1.`)
   dá a posição na estrutura; a chave sai de `buildStableKey`.
3. **Regras de vigência** (domínio, sem I/O): pivô de ano por documento (97 no RCTE, 91 no CTE);
   inclusivo → meio-aberto; "sem vigência" vira `skipped`; "EXAURIU-SE" fecha no fim da redação
   anterior ou vai para revisão; efeito anterior ao ato = `retroactive`; estilo incoerente
   (`NovaRedao` antes de `TextoRevo` e vice-versa), nota ilegível ou ambígua, abertura divergente,
   intervalo invertido, sobreposição e versão anterior ao pai vão para a revisão (`pending`, com o
   código do motivo e a nota original); redações consecutivas com o mesmo texto canônico viram
   uma só.
4. **Renumeração.** As redações publicadas com o rótulo antigo passam para a chave do rótulo
   atual (uma chave para a história toda) e o rótulo antigo vai para `labels`.
5. **CTE e a Lei 12.972/96.** O recorte é o Título II do Livro I. Como a lei trocou o conteúdo de
   vários números de artigo em 1997-01-01, as redações que terminam até essa data vão para revisão
   (`before-restructuring`) e as que a atravessam começam nela, como na fixture da F2.

## Consequências

- Bom, porque o DoD passa com folga nos arquivos oficiais de 2026-11-11: RCTE 881 de 920
  `NotaVigncia` convertidas (95,8%), CTE 310 de 321 (96,6%); todas as demais foram para a revisão.
- Bom, porque o golden do art. 76 (§§ 5º a 10, bytes cp1252 reais) bate com a tabela do plano, e
  a comparação com a fixture da F2 (recortes inteiros versionados em `.htm.gz`) bate em 723 de 750
  redações do RCTE e 279 de 297 do CTE; as diferenças restantes são categorias documentadas na
  mudança `add-rcte-cte-html-parser` (o parser manda para revisão o que a curadoria omitiu).
- Ruim, porque a máquina de estados conhece a diagramação do Word da Sefaz-GO: uma mudança de
  classe ou de formato das notas derruba a taxa de conversão. Mitigação: o `source-watch` detecta
  a mudança e a ingestão do staging mostra a taxa no relatório antes de qualquer promoção.
- Ruim, porque 38 artigos do RCTE com sufixo duplo ("Art. 167-S-B") não cabem na gramática da
  `stable_key` (`art: \d{1,4}(-[A-Z])?`) e vão para `skipped` (`chave-invalida`) até a gramática
  aceitar o segundo sufixo.
- Neutro: o HTML não passa pelo Docling. O `DoclingDocument` do HTML perde a classe dos
  parágrafos, que é justamente o que carrega a vigência.

## Mais informações

- Mudança OpenSpec `add-rcte-cte-html-parser` (F3), com os IDs do Context7 e as decisões de
  detalhe no `design.md`; `add-docling-pdf-extraction` para o lado Python.
- ADR 0003 ("Spike (f): ingestão") e ADR 0009 (vigência bitemporal).
- Plano: "Máquina de estados RCTE/CTE", "Regras de vigência" e "Testes do pipeline".
