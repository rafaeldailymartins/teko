# Fixture única do corpus

Excertos reais das fontes oficiais, usados pela integração, pelas retrieval evals, pelo e2e e (a
partir da F8) pelo red team. O `seed-fixtures` grava esta pasta no Postgres pelo mesmo
`CorpusWriter` da ingestão. O formato é o de
`src/adapters/in/cli/seed-fixtures/fixture-schema.ts`:

- `documents/<slug>.json`: um documento, suas versões (snapshots ou leiautes) e os dispositivos,
  cada um com as redações e o intervalo de vigência `[from, to)` (`to: null` = vigente);
- `coverage.json`: cobertura por família, com `verifiedAt` no relógio fixo dos testes (2026-11-10);
- `questions.json`: perguntas extras dos testes de integração e do e2e, além das do golden.

Os embeddings (`embeddings.json.gz`, vetores BGE-M3 reais indexados pelo `content_hash`) são
gerados à parte, por `pnpm --filter @teko/api fixtures:embed`, com `CF_ACCOUNT_ID` e `CF_AI_TOKEN`
(Workers AI) no ambiente ou no `apps/api/.env` (os mesmos valores do `tools/ingest/.env`). Regenere sempre que um texto desta pasta,
uma pergunta de `questions.json` ou de `evals/datasets/golden.yaml`, os títulos ou o chunker
mudarem; o script só chama a API para os hashes que faltam.

## Conteúdo

| Família        | Documentos | Dispositivos | Versões (≈ chunks) | Cobertura        |
| -------------- | ---------- | ------------ | ------------------ | ---------------- |
| `rcte`         | 1          | 640          | 755                | desde 1998-01-01 |
| `cte`          | 1          | 244          | 297                | desde 1997-01-01 |
| `efd-icms-ipi` | 1          | 142          | 156                | desde 2025-01-01 |
| `efd-reinf`    | 1          | 170          | 179                | desde 2023-03-01 |
| `tabelas-go`   | 4          | 139          | 168                | desde 2009-01-01 |
| `efd-go`       | 1          | 14           | 14                 | desde 2025-10-02 |
| **Total**      | **9**      | **1.349**    | **1.569**          |                  |

No seed, as 1.569 redações viram 1.574 chunks (as mais longas são divididas pelo chunker).
Todas as coberturas têm `verifiedAt: 2026-11-10` e nenhuma lacuna. `rcte-anexos` (Anexos VIII e
IX do RCTE, onda C3) não tem documento nem cobertura: perguntas sobre os Anexos são recusadas.
Não há chunk "envenenado" de red team (fica para a F8).

## Procedência

Tudo baixado em 2026-11-11 com o User-Agent `teko-corpus-watch (+github.com/rafaeldailymartins/teko)`,
no máximo 1 requisição por segundo. Os scripts de curadoria rodaram fora do repositório; a
ingestão real (parsers da F3) substitui esta extração quando o `cli eval-fixture export` existir.

| Documento                       | Fonte                                                                                                                                                                                                                            | sha256 do arquivo baixado                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| RCTE (`rcte.json`)              | https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm, "CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26"                                                                                                          | `d4a32c039621ac398466caf885d192e499a29c856bd6080416dcf485e8913456`                                               |
| CTE (`cte.json`)                | https://appasp.economia.go.gov.br/Legislacao/arquivos/Cte/CTE.htm, "ATUALIZADO ATÉ A LEI Nº 24.391 DE 29.06.26"                                                                                                                  | `ad008f818a3670f2da66f5cc996dbab0d203ce262246b0132f670c7d5d7a3525`                                               |
| Guia Prático EFD-ICMS/IPI 3.1.9 | https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi/manuais-e-documentos-tecnicos/guia-pratico-efd-versao-3-1-9.pdf                                                                                       | `e7e064a40faaa12d47f8c2fa3c25c97981dbb2ba5bd56f5ecd39947d022b773e`                                               |
| Guia Prático EFD-ICMS/IPI 3.2.4 | https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi/manuais-e-documentos-tecnicos/guia-pratico-efd-versao-3-2-4.pdf                                                                                       | `01e76f177996cb11b1454cbf39f19ad8ce9577876cd8c222ddf3e4aa45b6f164` (o mesmo do spike F1 (f))                     |
| Leiautes EFD-Reinf 2.1.1        | `leiautes-da-efd-reinf-v-2-1-1.zip` em https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-reinf/documento-tecnicos/versao-atual/leiautes (zip `b6a97d0950669ba58a08055a34322a05101e57d80eb3772be463564290fbd9f3`) | PDF "Leiautes da EFD-Reinf versão 2.1.1.pdf": `332ae3e2f6fef07df300a97373dbe9e76a0f6f103de2333758d25368470a3276` |
| Leiautes EFD-Reinf 2.1.2        | `leiautes-da-efd-reinf-v-2-1-2.zip`, mesma página (zip `221659d713f94c873028418667bc066cd5a5402d42ede10b0b0c3230d40902cd`)                                                                                                       | PDF "Leiautes da EFD-Reinf versão 2.1.2.pdf": `8546f6d26f039a3eb035f3008d25fec90fcfab75b5aab344d9a658677f2414be` |
| Tabela 5.1.1 GO (id 37, v151)   | `https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=37&versao=151`                                                                                                                                 | `6dab80030aeb4c55ebe7c3e45f9d1c05b0a557243319cc602dcffc847dda38ad`                                               |
| Tabela 5.2 GO (id 38, v51)      | `...obterTabela.ashx?idTabela=38&versao=51`                                                                                                                                                                                      | `63aeeeb1202d78e8cca7e107d4f911624f80d4d49a706d1bffd07fa8caa60977`                                               |
| Tabela 5.3 GO (id 39, v47)      | `...obterTabela.ashx?idTabela=39&versao=47`                                                                                                                                                                                      | `6cadd53cf2f44eb452c9da348c9845cb29372b5571c185b04a48086ce7ef2d9e`                                               |
| Tabela 5.5 GO (id 40, v5)       | `...obterTabela.ashx?idTabela=40&versao=5`                                                                                                                                                                                       | `6baa95f7263b38bfa512750badfaca71db9f5a44d03e6d347d6b37432a9a414d`                                               |
| Guia Prático EFD Goiás 5.8      | https://goias.gov.br/economia/wp-content/uploads/sites/45/2025/10/Guia_pratico_5.8.pdf                                                                                                                                           | `4e67a85b1350220ccb81b3b9f03455ef359c80e1b8b0128cb4c773ffd5463d29`                                               |
| Guia Prático EFD Goiás 5.9      | https://goias.gov.br/economia/wp-content/uploads/sites/45/2026/03/Guia_pratico_5.9.pdf                                                                                                                                           | `625f045550a1dfc6d38479a340103606e1c0b15c6cf55aea01cd65ba28c565c1`                                               |

O SHA-1 de cada tabela de Goiás confere com o `hash` do `consultarVersoesTabelasExternas` de
2026-11-09 (`<tabelas dthc="2026-11-09" versao="1959">`).

## Método e regras de vigência

### RCTE e CTE (`legal_effect`)

HTML em cp1252 lido parágrafo a parágrafo pela classe (`ParNormal`, `TextoRevo`, `NotaVigncia`,
`NovaRedao`/`NovaRedRev`, `PargrafoAlterador`), com uma máquina de estados de curadoria (não é o
parser da F3):

- `NotaVigncia` "Redação com vigência de dd.mm.aa a dd.mm.aa" fecha a redação superada em
  `[a, b+1)`; anotações inline "(Redação ... - vigência: a a b)" valem igual;
- `NovaRedao`/`NovaRedRev` "vigência: dd.mm.aa" abre a redação seguinte; o ato e a data do ato
  vão para `amendment`, e `retroactive` é `true` quando o efeito é anterior ao ato (ex.: Dec.
  5.885, de 30.12.03, com vigência desde 27.12.01);
- redação vigente sem nota e sem histórico é a original (RCTE: 01.01.98; CTE: 01.03.92);
  dispositivos filhos herdam a abertura de um acréscimo ou de uma nova redação do pai, nunca a de
  uma nova redação só do "caput";
- pivô do ano com 2 dígitos: 97 no RCTE e 91 no CTE;
- o RCTE tem um único snapshot (16.09.26) e todas as redações históricas apontam para ele: é o
  cenário "pergunta em 05/2006 com só o snapshot 2026 devolve a redação do Dec. 6.026";
- "Revogado" vira uma versão com o próprio texto ("§ 6º Revogado.") a partir da revogação.

Recorte: RCTE arts. 44 a 87 (Título III, compensação, apuração e pagamento, com o art. 76
completo, e Título IV); CTE arts. 44 em diante do Título II (sujeição passiva, compensação e
pagamento). Os demais artigos ficaram de fora só por tamanho.

Ficou de fora, por ambiguidade, em vez de virar um intervalo adivinhado (contagens do recorte):

| Motivo                                                                       | RCTE | CTE |
| ---------------------------------------------------------------------------- | ---- | --- |
| Redação superada sem nota de vigência própria nem bloco do pai               | 19   | 14  |
| Redação vigente sem nota de abertura logo depois de uma redação superada     | 13   | 45  |
| Nota inline sem data final                                                   | 3    | 14  |
| Data de abertura ilegível ou divergente da nota de vigência                  | 5    | 1   |
| Versão que começaria antes do próprio dispositivo pai                        | 16   | 46  |
| Versões que se sobrepõem, intervalo vazio ou dispositivo sem versão restante | 15   | 40  |

Peculiaridades das fontes, mantidas como publicadas:

- **RCTE art. 76, §§ 2º a 4º:** as redações anteriores terminam em 30.09.08 e as novas (Dec.
  7.043, de 29.12.09) começam em 01.10.09. O ano de lacuna pode ser erro de digitação na fonte
  (30.09.09), mas a fixture segue a nota: não há redação desses dispositivos entre 2008-10-01 e
  2009-09-30.
- **RCTE art. 76, § 5º, I:** a nota traz "vigência de 230.09.03"; vale a data da abertura
  (30.09.03).
- **CTE:** a lei foi reestruturada com vigência em 01.01.97 e vários números de artigo trocaram de
  conteúdo (ex.: o "Art. 44" anterior tratava de benefícios fiscais). Para não misturar
  dispositivos diferentes sob a mesma chave, a fixture corta o CTE em 1997-01-01: redações que
  terminavam antes disso foram omitidas e as que atravessavam a data começam nela. A cobertura do
  CTE é a partir de 1997-01-01.
- Renumerações de parágrafo (ex.: "RENUMERADO O PARÁGRAFO ÚNICO ... PARA § 1º") não geram
  `provision_labels` aqui: o rótulo é o atual e a versão começa na renumeração.

### Guia Prático EFD-ICMS/IPI (`leiaute_period`)

Texto extraído com pypdfium2 (registro, tabela de campos e observações "Campo NN (...)"); um
dispositivo por registro e um filho por campo, com tipo, tamanho, decimais e obrigatoriedade em
`structured`. Registros: 0000, C100, C170, C190, C197, E110, E111 e 1310.

- **3.1.9** (atualização de 13/05/2025) cobre o leiaute 2025: `[2025-01-01, 2026-01-01)`. O próprio
  Guia lista a 3.1.8 como "para 2025".
- **3.2.4** (atualização de 30/07/2026) cobre o leiaute 2026: `[2026-01-01, ∞)`. A 3.2.3 altera
  campos "a partir do leiaute 2026".
- Campo com o mesmo texto nas duas versões (comparado palavra a palavra) vira uma versão só,
  `[2025-01-01, ∞)`.
- Campos incluídos no leiaute a partir de um ano (Capítulo I, Subseções 15 e 16 do Guia 3.2.4):
  1310 campo 11 (`CAP_TANQUE`) desde 2026-01-01; C197 campo 09 e E111 campo 05
  (`IND_BENEFICIO`) desde 2027-01-01, fora da cobertura atual.

### Leiautes da EFD-Reinf (`leiaute_period`)

Eventos R-2010, R-4020 e R-4080, com um dispositivo por evento, por grupo e por campo
(`evt:R-4020:grupo:infoPgto:campo:vlrBruto`). Períodos dos comunicados do SPED:

- **2.1.1** (ADE Cofis nº 60, de 6 de julho de 2022): "exigida para os eventos ocorridos a partir
  da competência de março de 2023", até a 2.1.2: `[2023-03-01, 2023-09-01)`;
- **2.1.2** (ADE Cofis nº 23, de 10 de março de 2023): "a partir da competência de setembro de
  2023": `[2023-09-01, ∞)`.

As Notas Técnicas 01/2023 a 05/2026 ajustaram campos da 2.1.2 sem dizer a data de efeito. Nesses
campos, a redação da 2.1.2 foi omitida (sobra só a da 2.1.1, até 2023-09-01): no R-4020,
`cnpjBenef`, `ideEvtAdic`, `dtFG`, `vlrBruto`, `percSCP`, `indJud`, `vlrAgreg`, `vlrBaseCSLL`,
`vlrCSLL`, `vlrCofins`, `vlrPP`, `nrProc`, `cnpjOrigRecurso`, `nifBenef`, `frmTribut` e
`codPostal`. A detecção leu as linhas "Campo/Registro {nome}" das NTs; uma NT escrita em outro
formato pode ter escapado.

### Tabelas de Goiás (`table_declared`)

TXT em cp1252 do WS de Tabelas Externas; cada código é um dispositivo e cada linha é uma versão
`[DT_INI, DT_FIM + 1)` (`DT_FIM` vazio = vigente). O texto é `código - descrição`, com a descrição
literal (o separador `|` do TXT virou `-`). As datas são as declaradas na tabela, não vigência
jurídica. Recorte: todos os 14 códigos da 5.5 e os primeiros códigos da 5.1.1 (70, mais GO000029
e GO000030, citados no Guia de Goiás), da 5.2 (25) e da 5.3 (25).

### Guia Prático da EFD de Goiás (`publication_approx`)

Versões 5.8 (02/10/2025) e 5.9 (16/03/2026), com vigência `[publicação, próxima publicação)`.
Tópicos 1.1, 1.3, 1.4, 1.5, 4.1, 4.2, 5, 6, 7, 8, 9, 14.1, 18 e 18.1; o tópico 26 (novo na 5.9)
ficou de fora por tamanho (32 mil caracteres, com quadros). As diferenças entre as duas versões
nesses tópicos são só de espaçamento da extração, então cada tópico é uma versão só, desde
2025-10-02.

## Golden (`evals/datasets/golden.yaml`)

50 casos: EFD ICMS/IPI 15, EFD-Reinf 8, RCTE/CTE 12, EFD-GO e tabelas 5, recusas 6, ambíguos 4.
Todos os `provisions`, `validity`, `facts` e `source_quote` dos casos respondidos saem do texto
desta fixture. `candidates` dos ambíguos estão em ordem cronológica. Curadoria assistida, com
todos os casos revisados pelo mantenedor em 2026-11-11 (`reviewed_at: "2026-11-11"`).

É o conjunto `dev` (ADR 0031). O conjunto `holdout` (`evals/datasets/holdout.yaml`) não usa esta
fixture: roda só no `corpus-eval`, contra o corpus real do staging, e suas perguntas não entram no
`embeddings.json.gz`.
