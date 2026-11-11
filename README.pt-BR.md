# Tekó

[English](README.md) · **Português (Brasil)**

[![CI](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/ci.yml?branch=develop&style=flat-square&label=CI)](https://github.com/rafaeldailymartins/teko/actions/workflows/ci.yml?query=branch%3Adevelop)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/codeql.yml?branch=develop&style=flat-square&label=CodeQL)](https://github.com/rafaeldailymartins/teko/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/rafaeldailymartins/teko?style=flat-square&label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/rafaeldailymartins/teko)
[![OpenSSF Best Practices](https://img.shields.io/cii/level/16550?style=flat-square&label=OpenSSF%20Best%20Practices)](https://www.bestpractices.dev/projects/16550)
[![Codecov](https://img.shields.io/codecov/c/github/rafaeldailymartins/teko/develop?style=flat-square&label=cobertura)](https://app.codecov.io/gh/rafaeldailymartins/teko/tree/develop)
[![Quality Gate](https://img.shields.io/sonar/quality_gate/rafaeldailymartins_teko?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&label=quality%20gate)](https://sonarcloud.io/summary/new_code?id=rafaeldailymartins_teko)
[![Score de mutação](https://img.shields.io/endpoint?style=flat-square&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Frafaeldailymartins%2Fteko%2Fdevelop)](https://dashboard.stryker-mutator.io/reports/github.com/rafaeldailymartins/teko/develop)
[![Licença: MIT](https://img.shields.io/github/license/rafaeldailymartins/teko?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Frafaeldailymartins%2Fteko%2Fdevelop%2Fpackage.json&query=%24.engines.node&label=node&style=flat-square&logo=nodedotjs)](.nvmrc)

> Tekó é um nome de origem tupi.

O Tekó é um **assistente RAG de código aberto e custo zero para a legislação fiscal brasileira,
com consciência de vigência**. Cobre EFD ICMS/IPI, EFD-REINF e as regras de Goiás (RCTE e EFD-GO).
Em vez de misturar redações de épocas diferentes, ele:

- resolve uma **data de referência** (em geral o período de apuração) e pergunta quando a data é
  ambígua;
- **filtra a busca por vigência** em SQL, usando só a redação em vigor naquela data;
- **cita a fonte exata**: artigo, parágrafo ou registro e campo, com a versão do documento e o
  intervalo de vigência;
- **recusa** quando a data está fora da cobertura indexada.

> **Status: desenvolvimento inicial (fase F1).** O esqueleto do monorepo, os gates de qualidade e
> a infraestrutura local estão prontos; os spikes de plataforma estão pendentes. Nada está
> publicado e as respostas ainda não são utilizáveis. Alguns badges mostram "unknown" até a
> primeira execução.

## Stack

| Camada      | Tecnologia                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web         | Next.js 16 com export estático (sem functions) na Netlify, React 19, Tailwind CSS 4, next-intl (en, pt-BR), Feature-Sliced Design                                                                                    |
| API         | Fastify 5 em Node.js 24, arquitetura hexagonal, contratos Zod compartilhados via `@teko/shared`; publicada como uma única Vercel Function (Fluid compute, região `gru1`) no Vercel Hobby, com Plano B no Render Free |
| Dados       | PostgreSQL 18 + pgvector (Neon em `aws-sa-east-1`, Docker localmente), busca híbrida com RRF                                                                                                                         |
| IA          | Embeddings BGE-M3, Gemini free com fallback no Groq; PII redigida antes de qualquer provedor                                                                                                                         |
| Ferramentas | workspaces do pnpm 12 com política estrita de supply chain, Turborepo, Biome, Vitest, Stryker, OpenSpec, lefthook, git-cliff                                                                                         |

A API roda em dois projetos da Vercel, `teko-api` (produção, `teko-api.vercel.app`) e
`teko-api-staging` (`teko-api-staging.vercel.app`). O GitHub Actions constrói e atesta o output e
publica com `vercel deploy --prebuilt`; não há integração Git. O motivo (e por que não uma VM)
está na [ADR 0004](docs/adr/0004-vercel-hobby-api.md).

**Uso não comercial.** A API roda no plano Hobby da Vercel, que é para uso pessoal e não
comercial. O Tekó continua gratuito e MIT, sem anúncios, links de afiliado, planos pagos ou
serviços pagos ligados ao deploy. Doações são bem-vindas.

## Início rápido

Requisitos: Node.js 24, Corepack e Docker. No Windows, use o Git Bash.

```bash
corepack enable                 # ou pule e prefixe cada comando pnpm com "corepack"
pnpm install --frozen-lockfile  # ex.: corepack pnpm install --frozen-lockfile
pnpm dev:secrets                                         # segredos só locais, fora do git
docker compose -f infra/local/compose.yaml up -d --wait  # Postgres + pgvector, proxy assinado de dev
pnpm lint && pnpm typecheck && pnpm test
```

O [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês) traz o setup completo, o Git Flow, o fluxo
OpenSpec e os gates de qualidade.

## Documentos do projeto

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, branches, commits (DCO), OpenSpec, gates de qualidade
- [SECURITY.md](SECURITY.md): como reportar vulnerabilidades em privado
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 2.1
- [docs/adr/](docs/adr/): registros de decisões de arquitetura

## Aviso

O Tekó é uma ferramenta de pesquisa e produtividade para profissionais da área fiscal. Não é
consultoria jurídica nem tributária; confira sempre as fontes oficiais citadas.

## Licença

[MIT](LICENSE) © 2026 Rafael Daily Santos Martins
