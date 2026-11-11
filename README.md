# Tekó

**English** · [Português (Brasil)](README.pt-BR.md)

[![CI](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/ci.yml?branch=develop&style=flat-square&label=CI)](https://github.com/rafaeldailymartins/teko/actions/workflows/ci.yml?query=branch%3Adevelop)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/codeql.yml?branch=develop&style=flat-square&label=CodeQL)](https://github.com/rafaeldailymartins/teko/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/rafaeldailymartins/teko?style=flat-square&label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/rafaeldailymartins/teko)
[![OpenSSF Best Practices](https://img.shields.io/cii/level/16550?style=flat-square&label=OpenSSF%20Best%20Practices)](https://www.bestpractices.dev/projects/16550)
[![Codecov](https://img.shields.io/codecov/c/github/rafaeldailymartins/teko/develop?style=flat-square&label=coverage)](https://app.codecov.io/gh/rafaeldailymartins/teko/tree/develop)
[![Quality Gate](https://img.shields.io/sonar/quality_gate/rafaeldailymartins_teko?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&label=quality%20gate)](https://sonarcloud.io/summary/new_code?id=rafaeldailymartins_teko)
[![Mutation score](https://img.shields.io/endpoint?style=flat-square&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Frafaeldailymartins%2Fteko%2Fdevelop)](https://dashboard.stryker-mutator.io/reports/github.com/rafaeldailymartins/teko/develop)
[![License: MIT](https://img.shields.io/github/license/rafaeldailymartins/teko?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Frafaeldailymartins%2Fteko%2Fdevelop%2Fpackage.json&query=%24.engines.node&label=node&style=flat-square&logo=nodedotjs)](.nvmrc)

> The name Tekó comes from the Tupi language.

Tekó is an open-source, zero-cost **RAG assistant for Brazilian tax legislation that is aware of
validity dates** ("vigência"). It covers EFD ICMS/IPI, EFD-REINF and Goiás state rules (RCTE and
EFD-GO). Instead of mixing wordings from different years, it:

- resolves a **reference date** (usually the tax period), asking when the date is ambiguous;
- **filters retrieval by validity range** in SQL, so only the wording in force on that date is used;
- **cites the exact source**: article, paragraph or record and field, with document version and
  validity interval;
- **refuses** when the date falls outside the indexed coverage.

> **Status: early development (phase F1).** The monorepo skeleton, quality gates and local
> infrastructure are in place; the platform spikes are pending. Nothing is deployed yet and the
> answers are not usable. Some badges show "unknown" until their first run.

## Stack

| Layer   | Technology                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web     | Next.js 16 static export (no functions) on Netlify, React 19, Tailwind CSS 4, next-intl (en, pt-BR), Feature-Sliced Design                                                                                |
| API     | Fastify 5 on Node.js 24, hexagonal architecture, Zod contracts shared via `@teko/shared`; deployed as a single Vercel Function (Fluid compute, region `gru1`) on Vercel Hobby, with Render Free as Plan B |
| Data    | PostgreSQL 18 + pgvector (Neon in `aws-sa-east-1`, Docker locally), hybrid search with RRF                                                                                                                |
| AI      | BGE-M3 embeddings, Gemini free tier with Groq fallback; PII redacted before any provider call                                                                                                             |
| Tooling | pnpm 12 workspaces with a strict supply-chain policy, Turborepo, Biome, Vitest, Stryker, OpenSpec, lefthook, git-cliff                                                                                    |

The API runs in two Vercel projects, `teko-api` (production, `teko-api.vercel.app`) and
`teko-api-staging` (`teko-api-staging.vercel.app`). GitHub Actions builds and attests the output
and deploys it with `vercel deploy --prebuilt`; there is no Git integration. See
[ADR 0004](docs/adr/0004-vercel-hobby-api.md) for why (and why not a VM).

**Non-commercial.** The API runs on Vercel's Hobby plan, which is for personal, non-commercial
use. Tekó stays free and MIT-licensed, with no ads, affiliate links, paid tiers or paid services
tied to the deployment. Donations are welcome.

## Quick start

Requirements: Node.js 24, Corepack, Docker. On Windows, use Git Bash.

```bash
corepack enable                 # or skip it and prefix every pnpm command with "corepack"
pnpm install --frozen-lockfile  # e.g. corepack pnpm install --frozen-lockfile
pnpm dev:secrets                                         # local-only secrets, git-ignored
docker compose -f infra/local/compose.yaml up -d --wait  # Postgres + pgvector, signed dev proxy
pnpm lint && pnpm typecheck && pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup, Git Flow, the OpenSpec workflow and
the quality gates.

## Project documents

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, branches, commits (DCO), OpenSpec, quality gates
- [SECURITY.md](SECURITY.md): how to report vulnerabilities privately
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 2.1
- [docs/adr/](docs/adr/): architecture decision records

## Disclaimer

Tekó is a research and productivity tool for tax professionals. It is not legal or tax advice;
always check the official sources it cites.

## License

[MIT](LICENSE) © 2026 Rafael Daily Santos Martins
