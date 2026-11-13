# Spec Delta

## MODIFIED Requirements

### Requirement: Aviso de fronteira no período de apuração

Quando a data veio de um período de apuração, a API MUST marcar `periodBoundaryInside` se alguma
vigência da evidência começar ou terminar estritamente dentro daquele mês. Como a busca roda no
dia 1, a API SHALL considerar também as vigências que cruzam o mês nos dispositivos sob a unidade
de topo (artigo, registro, evento, tabela) de cada evidência e de cada chave citada, com os mesmos
filtros da busca; uma data exata (fora de PA) MUST NOT gerar o aviso.

#### Scenario: Redação muda no meio do mês

- **WHEN** o PA é 2026-07 e a evidência tem uma redação em vigor a partir de 2026-07-28
- **THEN** `periodBoundaryInside` é verdadeiro

#### Scenario: Dispositivo acrescentado no meio do mês

- **WHEN** o PA é 2005-12, a pergunta é sobre o art. 47 do CTE e os §§ dele passam a valer em 2005-12-29, sem redação anterior
- **THEN** nenhuma evidência mostra a fronteira, mas `periodBoundaryInside` é verdadeiro

## ADDED Requirements

### Requirement: Cobertura em memória

A API MUST manter a cobertura em memória de cada instância e relê-la sob demanda no máximo a cada
10 minutos; leituras simultâneas com o cache vencido SHALL dividir a mesma consulta, e uma leitura
que falhou MUST NOT ficar no cache.

#### Scenario: Perguntas seguidas

- **WHEN** duas perguntas chegam à mesma instância com 5 minutos de intervalo
- **THEN** só a primeira lê `corpus.coverage`
