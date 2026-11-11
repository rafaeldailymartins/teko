# Design

## Context

Repositório público, mantenedor solo, custo zero e nenhum domínio próprio (portanto, nenhuma
caixa de e-mail do projeto). Ver `proposal.md` para a motivação.

## Goals / Non-Goals

**Goals:**

- Políticas que funcionam sem e-mail: tudo passa pelo GitHub.
- Regras de branch e commit verificáveis por máquina (rulesets, commitlint, check `dco`).
- OpenSpec pronto para a F1 em diante, com o contexto do projeto injetado nas instruções.

**Non-Goals:**

- Automação de releases (F9) e README definitivo (F9).
- Segundo revisor obrigatório: o bypass do admin em `review-*` existe até haver outro mantenedor.

## Decisions

- **Private Vulnerability Reporting como canal único** (segurança e conduta). Alternativa: e-mail
  pessoal; descartada para não expor dados pessoais e porque não há domínio. Denúncias de
  conduta usam o mesmo canal com o prefixo `[Conduct]` no título.
- **Contributor Covenant 2.1 por referência.** O texto oficial fica no site do projeto; o arquivo
  local traz a adoção, o escopo e o canal. Alternativa: colar o texto integral; descartada para
  evitar divergência do texto canônico. (O plano cita a 3.0; a troca é só de link e versão.)
- **Git Flow sem linear history.** Os merge commits de release e back-merge são incompatíveis com
  histórico linear; `strict` status checks substituem a merge queue, indisponível em repositório
  de usuário.
- **DCO em vez de CLA.** Menor atrito para contribuidores, verificável por regex; a App de release
  inclui o próprio `Signed-off-by`.
- **OpenSpec com `--tools claude` e `--language "Portuguese (pt-BR)"`.** O OpenSpec mantém as
  palavras normativas `SHALL`/`MUST` e os títulos estruturais em inglês; o resto em pt-BR. O
  `config.yaml` recebe o contexto (produto, stack, convenções, regra Context7) e regras por artefato.
- **ADRs em MADR 4** em `docs/adr/`, numeradas e imutáveis depois de aceitas (uma nova ADR
  substitui a anterior). A tabela de desvios da ADR 0001 é um resumo vivo do plano e é
  sincronizada quando o plano muda (como na troca da VM Oracle pelo Vercel Hobby, ADR 0004). A
  lista temática de ADRs do plano usa 0001 a 0003 para temas diferentes dos arquivos já escritos:
  de 0004 a 0020 os números do plano valem, e os três temas deslocados recebem 0021 a 0023 (índice
  em `docs/adr/README.md`).

## Risks / Trade-offs

- [Mantenedor solo com bypass de revisão] → bypass só no modo `pull_request`; push direto continua
  impossível e todos os checks seguem obrigatórios.
- [Private Vulnerability Reporting desligado por engano] → o checklist da F0 inclui ativá-lo e o
  Scorecard sinaliza a ausência de `SECURITY.md`.
- [Telemetria do OpenSpec] → `OPENSPEC_TELEMETRY=0` no CI e documentado no CONTRIBUTING.

## Fontes Context7

| Biblioteca        | ID Context7                    | Versão conferida                  | Tópicos                                                                                                                                                                          |
| ----------------- | ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenSpec          | `/fission-ai/openspec`         | 1.16.0 (CLI local); docs v1.13.0+ | `openspec/config.yaml` (`schema`, `context`, `rules`), formato de delta (`## ADDED Requirements`, `#### Scenario:`), regras do `validate --strict`, `init --language`            |
| MADR / ADR        | `/adr/adr.github.io`           | MADR 4.0.0                        | estrutura do template (status, contexto, opções consideradas, decisão, consequências)                                                                                            |
| Shields.io        | `/badges/shields`              | serviço atual                     | rotas `github/actions/workflow/status`, `ossf-scorecard`, `cii/level`, `codecov/c`, `sonar/quality_gate` (com `server`), `badge/dynamic/json` e `endpoint`, estilo `flat-square` |
| Stryker Dashboard | `/websites/stryker-mutator_io` | docs atuais                       | projeto `github.com/<org>/<repo>`, versão por branch, `module` por pacote; badge pelo endpoint `badge-api.stryker-mutator.io` (formato conferido no README do stryker-js)        |
