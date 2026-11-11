# Proposal

## Why

O repositório `rafaeldailymartins/teko` nasce público e vazio, mantido por uma só pessoa. Antes de
qualquer código (fase F0 do roteiro), ele precisa de regras de governança explícitas: licença,
política de segurança, código de conduta, guia de contribuição, branches protegidos e um processo
de especificação (OpenSpec) que toda mudança seguinte vai usar.

## What Changes

- `LICENSE` MIT (2026), `SECURITY.md` com Private Vulnerability Reporting, SLA e safe harbor,
  `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) e `CONTRIBUTING.md`.
- READMEs provisórios em inglês e pt-BR, com seletor de idioma (o README definitivo é da F9).
- Git Flow: `develop` default (staging) e `main` (produção), prefixos de branch, métodos de merge,
  rulesets sem bypass para push direto, assinatura de commits e DCO.
- OpenSpec inicializado (`openspec init --tools claude`, idioma pt-BR) com `openspec/config.yaml`
  trazendo o contexto do projeto e a regra Context7.
- ADR 0001 (registrar decisões de arquitetura) com a tabela de decisões e desvios do plano.
- `dependabot.yml`, `scorecard.yml`, `CODEOWNERS` e template de PR.
- Fora de escopo: criação das contas externas (feita manualmente em paralelo), README final (F9),
  `docs/legal/` (F4/F5).

## Capabilities

### New Capabilities

- `repository-governance`: políticas públicas do repositório (licença, segurança, conduta,
  contribuição), regras de branch e de commit, e o processo OpenSpec com fontes Context7.

### Modified Capabilities

Nenhuma.

## Impact

- Arquivos na raiz (`LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, READMEs),
  `.github/`, `openspec/`, `.claude/` (skills e comandos gerados pelo `openspec init`) e
  `docs/adr/0001-record-architecture-decisions.md`.
- Configuração do GitHub (rulesets, environments, App de release, Private Vulnerability
  Reporting), aplicada fora do código.
