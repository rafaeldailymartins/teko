# hybrid-search Specification

## Purpose

Define como o Tekó busca as redações em vigor numa data, cita o documento de origem e prova a cada
PR que a busca não regrediu em qualidade nem em desempenho.

## Requirements

### Requirement: Busca filtrada por vigência

A busca MUST devolver só chunks em vigor na data de referência, com conhecimento atual, das
famílias cobertas e com status de revisão permitido no ambiente (produção: `auto` e `approved`;
staging: também `pending`), fundindo os braços léxico, vetorial e da referência citada por RRF
com k = 60.

#### Scenario: Toda evidência em vigor

- **WHEN** a pergunta é sobre 2006-05-01
- **THEN** toda evidência devolvida tem vigência que contém 2006-05-01

#### Scenario: Mesmo dispositivo em datas diferentes

- **WHEN** a pergunta cita "art. 76, § 6º do RCTE" em 03/2004, 05/2006 e 01/2010
- **THEN** a busca devolve, respectivamente, a redação do Dec. 5.825, a do Dec. 6.026 e a revogação pelo Dec. 7.028

### Requirement: Citação pelo documento publicado

Cada evidência MUST trazer a versão de documento publicada cuja vigência contém a data ou, se
nenhuma contiver, o snapshot publicado mais recente que contém o chunk; a vigência citada SHALL
ser sempre a da redação.

#### Scenario: Snapshot consolidado posterior

- **WHEN** a pergunta é sobre 05/2006 e o único RCTE publicado é o consolidado até o Decreto nº 10.986, de 16.09.26
- **THEN** a evidência do § 6º do art. 76 tem a redação do Dec. 6.026, a vigência [2004-11-04, 2009-11-23) e cita o snapshot de 2026

### Requirement: Degradação sem embedding

Se o embedding da pergunta falhar ou passar de 3 s, a busca MUST seguir só com os braços léxico e
da referência, rotulada `lexical_only`, sem falhar a pergunta; o cancelamento pelo cliente SHALL
continuar cancelando.

#### Scenario: Provedor de embedding fora do ar

- **WHEN** o Workers AI responde erro para a pergunta
- **THEN** a busca devolve evidência com o modo `lexical_only`, ainda filtrada por vigência

### Requirement: Recusa sem evidência

A API MUST recusar como `no_evidence`, sem chamar o LLM, quando a busca não devolver nada ou
quando o maior RRF ficar abaixo de `MIN_EVIDENCE_RRF`.

#### Scenario: Pergunta sem nenhum termo do corpus

- **WHEN** a pergunta não casa com nenhum chunk e não cita dispositivo, no modo `lexical_only`
- **THEN** a resposta é recusa `no_evidence`

### Requirement: Gate de qualidade da busca

Todo PR que afeta busca ou ingestão MUST rodar as retrieval evals sobre a fixture única, sem LLM e
sem segredo, e SHALL reprovar se recall@10 < 0,90, MRR < 0,70 ou se vigência, recusa,
clarificação ou data de referência ficarem abaixo de 1,00.

#### Scenario: Regressão de ranking

- **WHEN** uma mudança derruba o MRR da fixture para 0,60
- **THEN** o job `retrieval-evals` falha e o `ci-gate` fica vermelho

#### Scenario: PR de fork

- **WHEN** um PR de fork altera a busca
- **THEN** as retrieval evals rodam normalmente, porque não usam segredo

### Requirement: Gate de desempenho da busca

Todo PR que afeta a API ou a busca MUST rodar o `sql-perf` sobre 100k chunks sintéticos, que SHALL
exigir HNSW, GIN e GiST no plano com filtro amplo, nenhum Seq Scan em `corpus.chunks`, k linhas do
ANN com filtro seletivo e mediana abaixo de 150 ms.

#### Scenario: Índice perdido

- **WHEN** uma mudança na instrução faz o plano varrer `corpus.chunks` sequencialmente
- **THEN** o job `sql-perf` falha e o `ci-gate` fica vermelho
