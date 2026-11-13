<div align="center">

<img src="docs/assets/logo.svg" alt="Logo do Tekó: um T cuja barra é uma linha do tempo, com folhas brotando da haste" width="128" height="128">

# Tekó

**O assistente de IA para a legislação fiscal brasileira que sabe qual regra valia em cada data.**

[![CI](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/ci.yml?branch=develop&style=flat-square&label=CI)](https://github.com/rafaeldailymartins/teko/actions/workflows/ci.yml?query=branch%3Adevelop)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/codeql.yml?branch=develop&style=flat-square&label=CodeQL)](https://github.com/rafaeldailymartins/teko/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/rafaeldailymartins/teko?style=flat-square&label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/rafaeldailymartins/teko)
[![OpenSSF Best Practices](https://img.shields.io/cii/level/16550?style=flat-square&label=OpenSSF%20Best%20Practices)](https://www.bestpractices.dev/projects/16550)
[![Cobertura](https://img.shields.io/sonar/coverage/rafaeldailymartins_teko/develop?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&label=cobertura)](https://sonarcloud.io/component_measures?id=rafaeldailymartins_teko&metric=coverage)
[![Quality Gate](https://img.shields.io/sonar/quality_gate/rafaeldailymartins_teko?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&label=quality%20gate)](https://sonarcloud.io/summary/new_code?id=rafaeldailymartins_teko)
[![Score de mutação](https://img.shields.io/endpoint?style=flat-square&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Frafaeldailymartins%2Fteko%2Fdevelop)](https://dashboard.stryker-mutator.io/reports/github.com/rafaeldailymartins/teko/develop)
[![Licença: MIT](https://img.shields.io/github/license/rafaeldailymartins/teko?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Frafaeldailymartins%2Fteko%2Fdevelop%2Fpackage.json&query=%24.engines.node&label=node&style=flat-square&logo=nodedotjs)](.nvmrc)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18_%2B_pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

[🇧🇷 Português](README.md) · [🇺🇸 English](README.en.md)

</div>

## 💡 Sobre

Quem trabalha com escrituração fiscal sabe: a resposta certa depende da data. Um campo da EFD, um
código de ajuste ou um artigo do regulamento muda de redação, e misturar versões de épocas
diferentes é a forma mais fácil de errar. O **Tekó** é um assistente RAG de código aberto e custo
zero que responde sobre a legislação fiscal brasileira **com consciência de vigência**. Ele cobre a
EFD ICMS/IPI, a EFD-REINF e as regras de Goiás (RCTE e EFD-GO).

> 🌱 **Por que "Tekó"?** É uma palavra de origem tupi-guarani ligada ao "modo de ser", ao jeito de
> viver de um povo. Aqui, é o jeito certo de ler a lei: no tempo em que ela valia.

## ✨ Como funciona

- 📅 **Data de referência.** Resolve a data da pergunta (em geral o período de apuração) e pergunta
  de volta quando ela é ambígua.
- 🔎 **Busca filtrada por vigência.** O filtro de vigência é feito em SQL, antes do ranking. Só
  entra no contexto a redação em vigor naquela data, numa busca híbrida (vetorial + texto) com RRF.
- 📌 **Citação exata.** Cada resposta aponta o artigo, o parágrafo ou o registro e o campo, com a
  versão do documento e o intervalo de vigência.
- 🛑 **Recusa honesta.** Quando a data está fora da cobertura indexada, o Tekó diz que não sabe em
  vez de inventar.
- 🛡️ **Privacidade.** Dados pessoais (CPF, CNPJ, e-mail etc.) são removidos antes de qualquer
  chamada a um provedor de IA.

## 🚦 Status

> [!NOTE]
> **Desenvolvimento inicial.** O esqueleto do monorepo, os gates de qualidade, a infraestrutura
> local e os spikes de plataforma estão prontos (fases F0 e F1), assim como o domínio de vigência,
> o schema do corpus e a busca híbrida, avaliados sobre uma fixture de textos reais (fase F2).
> A ingestão das fontes oficiais (EFD ICMS/IPI, EFD-Reinf, RCTE, CTE, EFD-GO e tabelas de Goiás),
> os embeddings e o monitoramento diário de mudanças estão implementados (fase F3); a primeira
> carga do staging roda pelo Actions. A próxima fase traz a API completa. Nada está publicado e
> as respostas ainda não são utilizáveis.

## 🧱 Stack

| Camada         | Tecnologia                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🖥️ Web         | Next.js 16 com export estático (sem functions) na Netlify, React 19, Tailwind CSS 4, next-intl (pt-BR e en), Feature-Sliced Design                 |
| ⚙️ API         | Fastify 5 em Node.js 24, arquitetura hexagonal, contratos Zod compartilhados via `@teko/shared`; uma única Vercel Function (Fluid compute, `gru1`) |
| 🗄️ Dados       | PostgreSQL 18 + pgvector (Neon em `aws-sa-east-1`; Docker localmente), Drizzle ORM com `pg`, busca híbrida com RRF                                 |
| 🤖 IA          | Embeddings BGE-M3 (Cloudflare Workers AI), Gemini no plano gratuito com fallback no Groq                                                           |
| 📥 Ingestão    | Python com Docling (TableFormer `ACCURATE`) para os PDFs e o WS de Tabelas Externas do SPED                                                        |
| 🧰 Ferramentas | pnpm 12 com política estrita de supply chain, Turborepo, Biome, Vitest, Stryker, promptfoo, OpenSpec, lefthook, git-cliff                          |

## 🏗️ Arquitetura

```
Navegador
  └── site estático (Netlify) ── proxy assinado (x-nf-sign) ──> API Fastify (Vercel Function, gru1)
                                                                  ├── Postgres + pgvector (Neon)
                                                                  ├── embeddings BGE-M3 (Workers AI)
                                                                  └── LLM: Gemini → Groq (fallback)
```

- A API roda em dois projetos da Vercel: `teko-api` (produção) e `teko-api-staging`.
- O GitHub Actions constrói e atesta o artefato e publica com `vercel deploy --prebuilt`; não há
  integração Git. O porquê está na [ADR 0004](docs/adr/0004-vercel-hobby-api.md).
- Se a Vercel faltar, há um Plano B no Render Free.

## 🚀 Início rápido

### 📋 Pré-requisitos

- [Node.js](https://nodejs.org) 24 e Corepack
- [Docker](https://www.docker.com) com Compose v2
- No Windows, use o Git Bash

### ▶️ Rodando

```bash
corepack enable                                          # ou prefixe cada comando com "corepack"
pnpm install --frozen-lockfile
pnpm dev:secrets                                         # segredos só locais, fora do git
docker compose -f infra/local/compose.yaml up -d --wait  # Postgres + pgvector e proxy assinado de dev
pnpm lint && pnpm typecheck && pnpm test
```

O [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês) traz o setup completo, o Git Flow, o fluxo
OpenSpec e todos os gates.

## ✅ Gates de qualidade

Tudo abaixo reprova o PR em vez de só avisar. O check `ci-gate` agrega os jobs e é obrigatório para
entrar em `develop` e `main`.

| Gate                       | Ferramenta                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 🎨 Formatação e lint       | Biome sem warnings, ruff na ingestão Python, actionlint nos workflows                                                                      |
| 🧩 Arquitetura             | dependency-cruiser (hexagonal)                                                                                                             |
| 🧹 Código morto e monorepo | knip, sherif, jscpd                                                                                                                        |
| 🔤 Tipos                   | `tsc` estrito e type-coverage ≥ 99%; pyright na ingestão                                                                                   |
| 🧪 Cobertura               | Vitest: ≥ 95% de linhas no domínio e na aplicação da API e no `shared`, ≥ 80% nos adapters e na web                                        |
| 🧬 Mutação                 | Stryker, score mínimo de 70, toda noite (fora do PR)                                                                                       |
| 🔎 Recuperação             | retrieval evals (promptfoo) sobre a fixture real: recall@10 ≥ 0,9, MRR ≥ 0,7; vigência, recusa, clarificação e data de referência sem erro |
| ⚡ Desempenho              | `sql-perf` da busca híbrida sobre 100 mil chunks: sem Seq Scan e mediana abaixo de 150 ms                                                  |
| 🗃️ Migrações               | `migration-guard`: só expand/contract, migração publicada é imutável                                                                       |
| 🔐 Segurança               | CodeQL, Semgrep, gitleaks, osv-scanner, zizmor, dependency review                                                                          |
| 📦 Supply chain            | pnpm com release de pelo menos 7 dias e proveniência                                                                                       |
| 📐 Specs                   | `openspec validate --all --strict`                                                                                                         |

## 🔒 Segurança

Achou uma vulnerabilidade? Reporte em privado, como descreve o [SECURITY.md](SECURITY.md), e nunca
numa issue pública. Injeção de prompt e vazamento de dados via RAG estão no escopo.

## 💸 Custo zero e uso não comercial

O Tekó roda só em planos gratuitos, sem cartão cadastrado em nenhum serviço. A API usa o plano
Hobby da Vercel, que é para uso pessoal e não comercial: o projeto continua gratuito e MIT, sem
anúncios, links de afiliado, planos pagos ou serviços pagos ligados ao deploy. Doações são
bem-vindas.

## 🤖 Como é desenvolvido

O projeto é desenvolvido com o [Claude Code](https://claude.com/claude-code). Cada mudança nasce
como uma proposta [OpenSpec](https://github.com/Fission-AI/OpenSpec), segue as regras do
[`CLAUDE.md`](CLAUDE.md) e passa pelos gates acima no CI. As decisões de arquitetura ficam em
[`docs/adr/`](docs/adr/).

## 📚 Documentos

- 🤝 [CONTRIBUTING.md](CONTRIBUTING.md): setup, branches, commits (DCO), OpenSpec e gates
- 🔒 [SECURITY.md](SECURITY.md): como reportar vulnerabilidades em privado
- 💬 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 2.1
- 🏛️ [docs/adr/](docs/adr/): registros de decisões de arquitetura

## ⚖️ Aviso

O Tekó é uma ferramenta de pesquisa e produtividade para profissionais da área fiscal. Não é
consultoria jurídica nem tributária: confira sempre as fontes oficiais citadas.

## 📄 Licença

[MIT](LICENSE) © 2026 Rafael Daily Santos Martins

## 👨‍💻 Autor

Criado e mantido por:

| [<img src="https://avatars.githubusercontent.com/u/162728324?v=4" width="60px;" alt=""/><br /><sub><b>Rafael Daily</b></sub>](https://github.com/rafaeldailymartins) |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
