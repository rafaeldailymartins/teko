# hybrid-search Specification

## Purpose

Define como o Tekó busca as redações em vigor numa data, cita o documento de origem e prova a cada
PR que a busca não regrediu em qualidade nem em desempenho.

## Requirements

### Requirement: Busca filtrada por vigência

A busca MUST devolver só chunks em vigor na data de referência, com conhecimento atual, das
famílias cobertas e com status de revisão permitido no ambiente (produção: `auto` e `approved`;
staging: também `pending`), fundindo os braços léxico, vetorial e da referência citada por RRF
com k = 60. Cada braço SHALL ranquear no máximo um chunk por versão de dispositivo, e a fusão
SHALL somar os votos por versão de dispositivo, devolvendo um único chunk representante por
versão.

#### Scenario: Toda evidência em vigor

- **WHEN** a pergunta é sobre 2006-05-01
- **THEN** toda evidência devolvida tem vigência que contém 2006-05-01

#### Scenario: Mesmo dispositivo em datas diferentes

- **WHEN** a pergunta cita "art. 76, § 6º do RCTE" em 03/2004, 05/2006 e 01/2010
- **THEN** a busca devolve, respectivamente, a redação do Dec. 5.825, a do Dec. 6.026 e a revogação pelo Dec. 7.028

#### Scenario: Dispositivo partido em vários chunks

- **WHEN** a versão de um dispositivo tem três chunks que casam com a pergunta
- **THEN** a busca devolve um único resultado para essa versão, e as outras vagas do top-k ficam para outros dispositivos

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
continuar cancelando. Corpo de resposta ilegível (não JSON ou conexão encerrada durante a
leitura) MUST contar como falha do provedor.

#### Scenario: Provedor de embedding fora do ar

- **WHEN** o Workers AI responde erro para a pergunta
- **THEN** a busca devolve evidência com o modo `lexical_only`, ainda filtrada por vigência

#### Scenario: Corpo ilegível

- **WHEN** o Workers AI responde 200 com uma página HTML de erro, ou a conexão cai no meio do corpo
- **THEN** a busca degrada para `lexical_only` em vez de falhar a pergunta

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
exigir o HNSW e o GIN no plano com filtro amplo e o GiST no plano com filtro seletivo, nenhum Seq
Scan em `corpus.chunks`, k linhas do ANN com filtro seletivo e mediana abaixo de 150 ms num runner
até a velocidade de referência.

#### Scenario: Índice perdido

- **WHEN** uma mudança na instrução faz o plano varrer `corpus.chunks` sequencialmente
- **THEN** o job `sql-perf` falha e o `ci-gate` fica vermelho

### Requirement: Teto do sql-perf relativo ao runner

A velocidade do runner SHALL ser medida no mesmo run do `sql-perf` por uma consulta que não depende
da busca, e o teto da mediana MUST ser `150 ms × max(1, referência ÷ referência de corte)`, com a
referência de corte no topo da faixa observada no CI.

#### Scenario: Runner mais lento que o de referência

- **WHEN** a referência mede 330 ms (corte de 280 ms) e a busca com uma família leva 160 ms
- **THEN** o teto é 150 × 330 ÷ 280 ≈ 177 ms e o job passa, porque a lentidão é do runner e não da busca

### Requirement: Reordenação pelo reranker

Com o reranker configurado, a busca MUST pedir 40 candidatos à instrução híbrida, reordená-los pela
nota do reranker para a pergunta e devolver os 12 primeiros; sem reranker, SHALL devolver os 12
primeiros pela ordem do RRF. Falha do reranker (inclusive corpo ilegível) ou mais de 3 s MUST
manter a ordem do RRF, sem falhar a pergunta, e o resultado SHALL indicar se foi reordenado.

#### Scenario: Campo sobe acima do registro-pai

- **WHEN** a pergunta é "Quais códigos de situação do documento são aceitos no registro C100?" e o RRF põe o registro C100 em 1º e o campo 06 em 2º
- **THEN** o reranker põe o campo 06 em 1º e o resultado é marcado como reordenado

#### Scenario: Reranker fora do ar

- **WHEN** o Workers AI responde erro para o reranker
- **THEN** a busca devolve os 12 primeiros na ordem do RRF, marcados como não reordenados

### Requirement: Leitura resiliente à queda de conexão

As leituras idempotentes da API (busca e cobertura) MUST ser repetidas uma única vez, numa conexão
nova, quando a primeira tentativa cair com `57P01` ou `ECONNRESET` (scale-to-zero do Neon); a
conexão caída MUST NOT voltar ao pool. Escritas e transações com escrita MUST NOT ser repetidas.

#### Scenario: Neon suspendeu o compute

- **WHEN** a conexão do pool foi encerrada pelo Neon e a busca recebe `57P01`
- **THEN** a busca roda de novo numa conexão nova e devolve a evidência

### Requirement: Reescrita da pergunta pelo LLM

Com `QUERY_REWRITE_ENABLED` e uma cadeia de LLM, a busca MUST pedir à cadeia, antes do embedding,
uma consulta em português na linguagem do corpus para a pergunta já redigida, com a política
regional da resposta. O braço léxico SHALL receber a pergunta e a consulta; o embedding e o
reranker, a consulta. O resultado SHALL trazer a consulta usada.

#### Scenario: Pergunta na linguagem de contador

- **WHEN** a reescrita está ligada e a pergunta é "Qual era a alíquota geral do ICMS nas vendas dentro de Goiás?"
- **THEN** o LLM recebe a pergunta entre `<pergunta>` e `</pergunta>`, a busca usa a consulta devolvida e o resultado a informa

#### Scenario: Usuário do EEE

- **WHEN** a reescrita está ligada e a pergunta vem de um usuário do EEE, do Reino Unido ou da Suíça
- **THEN** só modelos com ZDR recebem a pergunta para reescrever

### Requirement: Degradação da reescrita

Falha da cadeia de LLM, mais de 4 s ou saída vazia na reescrita MUST seguir com a pergunta
original, sem falhar a pergunta, e o resultado SHALL vir sem consulta. A recusa fora da cobertura
MUST acontecer antes da reescrita.

#### Scenario: Cadeia de LLM fora do ar

- **WHEN** a reescrita está ligada e todos os modelos da cadeia falham
- **THEN** a busca segue com a pergunta original e o resultado não traz consulta

#### Scenario: Fora da cobertura

- **WHEN** a reescrita está ligada e a data de referência está fora da cobertura
- **THEN** a pergunta é recusada sem nenhuma chamada ao LLM
