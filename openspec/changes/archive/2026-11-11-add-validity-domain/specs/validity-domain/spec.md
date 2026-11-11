# Spec Delta

## Purpose

Define como o Tekó decide a data de referência de uma pergunta, se o corpus cobre essa data e como
identifica cada dispositivo citado.

## ADDED Requirements

### Requirement: Precedência da data de referência

A API MUST resolver a data de referência nesta ordem: escolha explícita do usuário (`explicit`,
`periodo_apuracao` ou `clarified`), data única citada no texto (`question_text`) e, por fim,
`default`, o dia 1 do mês anterior a hoje calculado em `America/Sao_Paulo`. Um período de
apuração `AAAA-MM` SHALL resolver para o dia 1 do mês.

#### Scenario: Sem escolha nem data no texto

- **WHEN** o relógio marca 2026-11-10 e a pergunta chega com `source: 'default'` e sem data no texto
- **THEN** a data resolvida é 2026-10-01 com origem `default`

#### Scenario: Data única no texto

- **WHEN** a pergunta com `source: 'default'` diz "em maio de 2006, qual era o valor mínimo?"
- **THEN** a data resolvida é 2006-05-01 com origem `question_text`

#### Scenario: Período de apuração explícito

- **WHEN** o cliente envia `periodoApuracao: '2004-03'` com `source: 'periodo_apuracao'`
- **THEN** a data resolvida é 2004-03-01 com origem `periodo_apuracao`

### Requirement: Pedido de esclarecimento

A API MUST responder `needs_clarification`, com as datas candidatas ordenadas, quando a data do
texto conflitar com a escolha explícita ou quando o texto citar datas conflitantes entre si. Uma
escolha feita depois do esclarecimento (`clarified`) SHALL valer sem novo confronto com o texto.

#### Scenario: Texto contra PA explícito

- **WHEN** o PA escolhido é 2026-03 e o texto pergunta "como era em 05/2006?"
- **THEN** a resposta é `needs_clarification` com o motivo `explicit_conflict` e as candidatas 2006-05-01 e 2026-03-01

#### Scenario: Menção compatível com o PA

- **WHEN** o PA escolhido é 2006-05 e o texto diz "em maio de 2006"
- **THEN** a data resolvida é 2006-05-01, sem pedido de esclarecimento

#### Scenario: Escolha depois do esclarecimento

- **WHEN** o cliente reenvia a pergunta com `source: 'clarified'` e a data 2006-05-01
- **THEN** a data resolvida é 2006-05-01, mesmo que o texto cite outra data

### Requirement: Recusa fora da cobertura

A API MUST recusar como `out_of_coverage`, sem buscar nem chamar o LLM, toda pergunta cuja data
não esteja na cobertura efetiva de nenhuma família pedida. A cobertura efetiva SHALL ser a
cobertura da família limitada a `verified_at` (inclusive) e sem as lacunas registradas.

#### Scenario: Data depois do verified_at

- **WHEN** o RCTE está coberto desde 1998 com `verified_at` 2026-11-10 e a pergunta é sobre 2026-11-15
- **THEN** a pergunta é recusada como `out_of_coverage`, com o intervalo coberto do RCTE até 2026-11-10

#### Scenario: Família sem cobertura

- **WHEN** a pergunta pede só `rcte-anexos` antes da onda C3
- **THEN** a pergunta é recusada como `out_of_coverage`

#### Scenario: Cobertura parcial

- **WHEN** a pergunta pede `rcte` e `efd-icms-ipi` para 2024-06 e só o RCTE cobre a data
- **THEN** a busca segue só no RCTE e `efd-icms-ipi` aparece nas famílias não cobertas

### Requirement: Aviso de fronteira no período de apuração

Quando a data veio de um período de apuração, a API MUST marcar `periodBoundaryInside` se alguma
vigência da evidência começar ou terminar estritamente dentro daquele mês.

#### Scenario: Redação muda no meio do mês

- **WHEN** o PA é 2026-07 e a evidência tem uma redação em vigor a partir de 2026-07-28
- **THEN** `periodBoundaryInside` é verdadeiro

### Requirement: Chave estável de dispositivo

Todo dispositivo do corpus MUST ter uma `stable_key` no formato
`<jurisdição>:<família>(:<tipo>:<valor>)+`, com jurisdição coerente com a família e tipos de um
conjunto fechado; a chave SHALL ser imutável, e uma renumeração muda só o rótulo exibido.

#### Scenario: Chave válida

- **WHEN** a ingestão ou a fixture registram `go:rcte:art:76:par:6`
- **THEN** a chave é aceita e o pai calculado é `go:rcte:art:76`

#### Scenario: Jurisdição trocada

- **WHEN** alguém registra `br:rcte:art:76`
- **THEN** a chave é rejeitada porque o RCTE é de Goiás (`go`)
