# Design

## Context

As fontes do corpus não avisam quando mudam. As páginas de Goiás (cp1252, geradas pelo Word)
trazem um cabeçalho com o último ato consolidado; o portal gov.br do SPED monta as páginas no
cliente e só expõe os links no JSON embutido; o WS de Tabelas Externas publica `versao`, `dtVersao`
e `hash` por tabela. O role `teko_watch` existe desde a F2, com `SELECT` em `corpus.coverage` e
`UPDATE (verified_at, gaps, gap_reason)`. As páginas reais foram baixadas em 2026-11-11 para
montar as fixtures (recortes mínimos, bytes originais).

## Goals / Non-Goals

**Goals:**

- `verified_at` avança todo dia em prod e no staging, com um único `UPDATE` por banco quando nada
  mudou.
- Mudança detectada vira lacuna de cobertura no mesmo dia, a partir da data de efeito.
- O job com a credencial dos artefatos (`GITHUB_TOKEN` com escrita, ADR 0030)
  nunca vê URL de banco, e vice-versa.

**Non-Goals:**

- Diff por dispositivo (é da ingestão: o `load` reconcilia por `stable_key`).
- Promoção automática para produção.

## Decisions

- **Sinais por tipo de página.** `consolidated` (rótulo e número do último ato), `act-list`
  (atos com número e data do DOE, filtrados pela ementa), `document-index` (URLs que casam com
  padrões, de `href` e do corpo inteiro com `/` desfeito) e `tables-ws` (`versao:hash` por
  tabela). A leitura fica num adapter de entrada (`htmlparser2`) atrás da porta
  `WatchSignalReader`; o caso de uso só compara sinais.
- **Linha de base.** A primeira observação de uma página (ou de uma URL nova, como o sumário de um
  ano novo) não reporta mudança; sem isso o primeiro run marcaria centenas de lacunas falsas.
- **Ato pendente até o consolidado.** Um decreto que aparece no sumário anual antes de entrar no
  `RCTE.htm` abre a lacuna e fica em `pending` no estado; é reapresentado a cada run (`status:
  'pending'`, sem disparar ingestão de novo) até o número do rótulo "CONSOLIDADO ATÉ O DECRETO Nº"
  da família alcançá-lo. Ato detectado e consolidado no mesmo run não abre lacuna (o consolidado
  novo já é a mudança). O filtro do sumário exige verbo de alteração ("Altera", "Acrescenta",
  "Revoga"...) e o Decreto 4.852: um decreto que só cita o RCTE ficaria pendente para sempre.
- **`{yyyy}` na URL.** O sumário é anual; o `404` de uma URL com `{yyyy}` (sumário do ano novo
  ainda não publicado) conta como página vazia, não como erro. Os pendentes do ano anterior
  continuam valendo.
- **Página não verificada não avança o `verified_at`.** Erro de rede, bloqueio do SafeFetcher,
  status inesperado ou sinal ausente (cabeçalho sumiu, tabela fora do `metadadosXml`) vão para
  `errors`, a família entra em `unverifiedFamilies` e o `UPDATE` ganha `AND family NOT IN (…)`.
  O job `watch-errors` deixa o run vermelho, mas só depois do `mark-coverage` marcar as demais.
- **`effectiveFrom`.** DOE do ato (ou a data do ato), data do rótulo do consolidado, `dtVersao`
  da tabela; documento novo num índice usa a data do run. A lacuna de cada família começa na menor
  data detectada, e o `gap_reason` lista as mudanças (até 500 caracteres).
- **`verified_at` = data do run do `detect`** (`runDate` do `discovered.json`, em
  `America/Sao_Paulo`), não a hora do `mark-coverage`: um "re-run" só do `mark-coverage` não
  certifica um dia que ninguém verificou.
- **Um `UPDATE` sem transação no caso comum.** Com lacunas, uma transação com um `UPDATE` por
  família e o avanço de `verified_at`. O teste de integração intercepta o pool e confere que o caso
  sem mudança emite exatamente uma instrução.
- **Duas portas novas**: `watch-coverage-repository.ts` (escrita do `teko_watch`) e
  `watch-report.ts`/`watch-signals.ts` (contratos do `discovered.json` e da leitura). O
  `discovered.json` é validado com zod no `coverage-mark`, que roda com credenciais de banco.

## Risks / Trade-offs

- **Sinal de versão por regex.** Uma mudança de layout das páginas de Goiás quebra o cabeçalho; o
  efeito é a família ficar sem verificação (visível no run vermelho e na recusa), nunca uma
  cobertura falsa.
- **ETag do gov.br** traz o sufixo do agente de monitoração da página e pode variar; o GET
  condicional vira GET completo, sem efeito no resultado.
- **Ano novo.** Decretos publicados entre 1º de janeiro e a primeira observação do sumário do ano
  entram na linha de base sem lacuna; o consolidado novo ainda os detecta.

## Context7

| Biblioteca / serviço | ID                                            | Consulta                                                             |
| -------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| htmlparser2 12       | `/fb55/htmlparser2`                           | `Parser` com `onopentag`/`ontext`/`onclosetag`, `xmlMode`, entidades |
| Drizzle ORM 1.0 RC   | `/websites/rqbv2_drizzle-orm-fe_pages_dev`    | `update().set({ col: sql\`…\` })`, `where`, transação                |
| GitHub Actions       | `/websites/github_en_actions`                 | `workflow_call` com segredos de environment, `schedule`              |
| Testcontainers       | `/testcontainers/testcontainers-node/v12.2.0` | já usado pela F2 (`test/setup/postgres.global.ts`)                   |
| Harden-Runner        | `/step-security/harden-runner`                | `egress-policy: block` com `allowed-endpoints` (tarefa 4.3)          |
