# Tasks

## 1. Documentos de governança

- [x] 1.1 Criar `LICENSE` (MIT, 2026, titular igual a `git config user.name`) e conferir que o GitHub detecta "MIT License"
- [x] 1.2 Escrever `SECURITY.md` (Private Vulnerability Reporting, versões suportadas, SLA 72 h/7 d/14 d/30 d, escopo com injeção de prompt e exfiltração via RAG, safe harbor, divulgação em 90 dias) e conferir os links
- [x] 1.3 Escrever `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 por referência, canal privado) e conferir o link da versão
- [x] 1.4 Escrever `CONTRIBUTING.md` (setup, `TEKO_TMP`, Git Flow, OpenSpec com "Fontes Context7", escopos do commitlint, DCO, gates) e conferir que a lista de escopos é idêntica à de `commitlint.config.mjs`
- [x] 1.5 Escrever `README.md` e `README.pt-BR.md` provisórios com seletor de idioma e conferir os links relativos
- [x] 1.6 Atualizar `SECURITY.md`, READMEs e `CONTRIBUTING.md` para a API no Vercel Hobby (sem VM Oracle) e a postura não comercial do Hobby, e conferir com `grep -rniE "oracle|dedyn|desec" README*.md CONTRIBUTING.md SECURITY.md` sem resultado

## 2. OpenSpec e ADR

- [x] 2.1 Rodar `openspec init --tools claude --language "Portuguese (pt-BR)"` e conferir `openspec/config.yaml`, `.claude/skills/openspec-*` e `.claude/commands/opsx/*`
- [x] 2.2 Preencher o `context` e as `rules` de `openspec/config.yaml` e conferir com `openspec instructions proposal --change <id> --json`
- [x] 2.3 Escrever `docs/adr/0001-record-architecture-decisions.md` com a tabela de decisões e desvios
- [x] 2.4 Rodar `openspec validate --all --strict --no-interactive` e conferir código de saída 0
- [x] 2.5 Escrever a ADR 0004 (Vercel Hobby + Plano B Render), sincronizar a tabela de desvios da ADR 0001 e registrar a numeração das ADRs do plano em `docs/adr/README.md`

## 3. Configuração do GitHub

- [x] 3.1 Criar o repositório público com `main` e `develop` (default) e conferir em Settings → Branches (conferido pela API em 2026-11-11)
- [x] 3.2 Criar os rulesets `checks-*`, `review-*`, `release-tags` e `branch-names` e conferir que um push direto em `develop` é rejeitado (os seis ativos; `checks-develop` exige PR e não tem bypass, e `GET /rules/branches/develop` traz `pull_request` e `non_fast_forward`)
- [x] 3.3 Ativar Private Vulnerability Reporting, secret scanning e push protection e conferir na aba Security
- [x] 3.4 Criar a App `teko-release-bot` e os environments (inclusive `ops`) e conferir em Settings → Environments
- [x] 3.5 Rodar o spike de environments em `pull_request` (ref avaliada) e registrar o resultado em `docs/adr/` (`refs/pull/N/merge`; ADR 0024)
- [x] 3.6 Conferir o DoD da F0: Scorecard publica (7,4 em 2026-11-11) e `/healthz` responde em `teko-api.vercel.app` e `teko-api-staging.vercel.app`
- [ ] 3.7 Conferir o DoD da F0: o Dependabot abre o primeiro PR `chore(deps): …` (primeira rodada em 2026-11-16)

## Workflow follow-up

- Arquivar a mudança (`openspec archive bootstrap-repository-governance --yes`) no PR que marcar a 3.7.
