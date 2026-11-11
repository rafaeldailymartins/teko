# quality-gates Specification

## Purpose

Define as verificações automáticas que toda mudança do Tekó passa antes de chegar a `develop` ou
`main`, com feedback local antecipado e um único check agregador obrigatório no PR.

## Requirements

### Requirement: Check agregador único

Todo PR para `develop` ou `main` MUST ser aprovado pelo check `ci-gate`, que SHALL falhar quando
qualquer job agregado falhar ou for cancelado.

#### Scenario: Job de lint falha

- **WHEN** o job `lint` do `ci.yml` falha num PR
- **THEN** o `ci-gate` fica vermelho e o PR não pode ser mesclado

#### Scenario: Pacote não afetado

- **WHEN** um PR altera só `apps/web`
- **THEN** os passos da API são pulados dentro dos jobs e o `ci-gate` continua verde se o resto passar

### Requirement: Mensagens de commit convencionais

Toda mensagem de commit e todo título de PR MUST seguir Conventional Commits com um escopo da
lista do `commitlint.config.mjs`.

#### Scenario: Escopo desconhecido

- **WHEN** alguém cria o commit `feat(frontend): nova tela`
- **THEN** o hook `commit-msg` rejeita a mensagem porque `frontend` não é um escopo permitido

#### Scenario: Título de PR inválido

- **WHEN** um PR tem o título "ajustes"
- **THEN** o check `pr-title` falha

### Requirement: Lint e formatação sem avisos

O código MUST passar no Biome sem erros nem avisos (`biome ci --error-on-warnings`).

#### Scenario: Aviso de lint

- **WHEN** um arquivo alterado gera um aviso do Biome
- **THEN** o `pnpm lint` termina com código diferente de 0 localmente e no CI

### Requirement: Especificações válidas

As mudanças e specs do OpenSpec MUST passar em `openspec validate --all --strict --no-interactive`.

#### Scenario: Requisito sem cenário

- **WHEN** um delta traz um requisito sem `#### Scenario:`
- **THEN** o hook de pre-commit e o job `lint` do CI falham

### Requirement: Segredos bloqueados

Um commit ou PR que contenha um segredo MUST ser bloqueado pelo gitleaks antes do merge.

#### Scenario: Chave de API commitada

- **WHEN** um PR adiciona um arquivo com uma chave de API real
- **THEN** o job `gitleaks` do `security.yml` falha e o `ci-gate` fica vermelho

### Requirement: Dependências vulneráveis bloqueadas

Um PR MUST falhar quando introduzir dependência de runtime com vulnerabilidade conhecida de
qualquer severidade ou licença fora da allowlist.

#### Scenario: Dependência com CVE

- **WHEN** um PR adiciona uma dependência de produção com CVE de severidade baixa
- **THEN** o `dependency-review` ou o `pnpm audit --prod --audit-level low` falha

### Requirement: Fluxo Git Flow verificado

Um PR para `main` MUST vir de `release/vX.Y.Z` ou `hotfix/vX.Y.Z`, e todo commit humano do PR MUST
ter `Signed-off-by:`.

#### Scenario: Commit sem DCO no PR

- **WHEN** um PR contém um commit humano sem `Signed-off-by:`
- **THEN** o check `dco` falha

### Requirement: Tempo de CI

O caminho crítico do `ci-gate` SHALL terminar em até 8 minutos num PR típico com cache aquecido.

#### Scenario: PR típico

- **WHEN** um PR altera um pacote e o cache do Turborepo está aquecido
- **THEN** o `ci-gate` conclui em até 8 minutos
