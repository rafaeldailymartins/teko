# Spec Delta

## Purpose

Define as políticas públicas do repositório do Tekó e as regras que toda contribuição segue:
licença, divulgação de vulnerabilidades, conduta, branches, commits e o processo OpenSpec.

## ADDED Requirements

### Requirement: Licença MIT

O repositório MUST publicar a licença MIT num arquivo `LICENSE` na raiz, com o ano e o titular do
copyright.

#### Scenario: Licença detectável

- **WHEN** alguém abre a raiz do repositório
- **THEN** encontra `LICENSE` com o texto MIT, o ano 2026 e o nome do titular
- **AND** o `package.json` da raiz e dos pacotes declara `"license": "MIT"`

### Requirement: Canal privado de vulnerabilidades

O repositório MUST oferecer um canal privado para reportar vulnerabilidades e SHALL documentar em
`SECURITY.md` as versões suportadas, os prazos de resposta, o escopo e o safe harbor.

#### Scenario: Pesquisador reporta uma falha

- **WHEN** um pesquisador lê `SECURITY.md`
- **THEN** encontra o link do Private Vulnerability Reporting do GitHub como único canal
- **AND** vê os prazos: confirmação em 72 h, triagem em 7 dias, correção crítica em 14 dias e alta em 30 dias

#### Scenario: Injeção de prompt está no escopo

- **WHEN** um pesquisador encontra uma injeção de prompt indireta via documento do corpus
- **THEN** `SECURITY.md` classifica o caso como dentro do escopo, junto com exfiltração via RAG

### Requirement: Código de conduta

O repositório MUST adotar um código de conduta publicado em `CODE_OF_CONDUCT.md`, com um canal
privado para denúncias.

#### Scenario: Denúncia de conduta

- **WHEN** alguém precisa denunciar um comportamento inaceitável
- **THEN** `CODE_OF_CONDUCT.md` indica o canal privado e o prazo de confirmação de 72 h

### Requirement: Branches protegidos pelo Git Flow

Os branches `main` e `develop` MUST rejeitar push direto, e PRs para `main` SHALL vir apenas de
`release/vX.Y.Z` ou `hotfix/vX.Y.Z`.

#### Scenario: Push direto rejeitado

- **WHEN** alguém tenta `git push` direto em `develop` ou `main`
- **THEN** o GitHub rejeita o push pelos rulesets

#### Scenario: PR de feature para main

- **WHEN** um PR de `feature/x` mira `main`
- **THEN** o check `gitflow-guard` falha e o PR não pode ser mesclado

### Requirement: Commits assinados com DCO

Todo commit humano MUST trazer a linha `Signed-off-by:` (DCO) e SHALL estar assinado.

#### Scenario: Commit sem sign-off

- **WHEN** um commit sem `Signed-off-by:` é criado localmente ou chega num PR
- **THEN** o commitlint local e o check `dco` do PR falham

### Requirement: Mudanças especificadas no OpenSpec com fontes Context7

Toda mudança de comportamento MUST ter uma mudança OpenSpec válida em modo estrito, e o `design.md`
SHALL listar na seção "Fontes Context7" as bibliotecas consultadas.

#### Scenario: Validação estrita

- **WHEN** `openspec validate --all --strict --no-interactive` roda no hook de pre-commit ou no CI
- **THEN** o comando termina com código 0 para mudanças bem formadas e diferente de 0 caso contrário

#### Scenario: Design sem fontes

- **WHEN** um revisor abre o `design.md` de uma mudança
- **THEN** encontra a seção "Fontes Context7" com IDs de biblioteca, versão e tópicos consultados
