# Spec Delta

## MODIFIED Requirements

### Requirement: Citações navegáveis

O link `cite:<id>` MUST virar um chip numerado com prévia no hover. O clique SHALL abrir o painel de
citação (Drawer abaixo de 768 px) com documento, versão, badge do intervalo de vigência, texto em
`lang="pt-BR"`, campos, link da fonte, "copiar citação", "reportar", navegação por `[`/`]` e o link
"Abrir o dispositivo" para a página do dispositivo.

#### Scenario: Chip de citação

- **WHEN** o usuário clica no chip 1 de uma resposta
- **THEN** o painel mostra a citação S1 com o intervalo de vigência, e `]` passa para a S2

## ADDED Requirements

### Requirement: Linha do tempo e O que mudou no painel de citação

O painel de citação MUST mostrar a linha do tempo do dispositivo citado (`ProvisionTimeline`), com a
redação vigente na data de referência da resposta marcada. "O que mudou" (`ProvisionDiff`) SHALL
comparar essa redação com a anterior e MUST ter o código e a consulta à API só depois do clique.

#### Scenario: Linha do tempo no painel

- **WHEN** o usuário abre a citação do RCTE, art. 76, § 6º numa resposta de 05/2008
- **THEN** o painel lista as redações do § 6º com a de 04/11/2004 a 22/11/2009 marcada, sem pedir o diff

#### Scenario: O que mudou no painel

- **WHEN** o usuário clica em "Ver o que mudou em relação à redação anterior"
- **THEN** o painel pede o diff da redação anterior contra a vigente em 01/05/2008 e marca inserções e remoções
