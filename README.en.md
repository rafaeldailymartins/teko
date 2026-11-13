<div align="center">

<img src="docs/assets/logo.svg" alt="Tekó logo: a T whose bar is a timeline, with leaves sprouting from the stem" width="128" height="128">

# Tekó

**The AI assistant for Brazilian tax law that knows which rule applied on which date.**

[![CI](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/rafaeldailymartins/teko/actions/workflows/ci.yml?query=branch%3Amain)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/rafaeldailymartins/teko/codeql.yml?branch=main&style=flat-square&label=CodeQL)](https://github.com/rafaeldailymartins/teko/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://img.shields.io/ossf-scorecard/github.com/rafaeldailymartins/teko?style=flat-square&label=OpenSSF%20Scorecard)](https://scorecard.dev/viewer/?uri=github.com/rafaeldailymartins/teko)
[![OpenSSF Best Practices](https://img.shields.io/cii/level/16550?style=flat-square&label=OpenSSF%20Best%20Practices)](https://www.bestpractices.dev/projects/16550)
[![Quality Gate](https://img.shields.io/sonar/quality_gate/rafaeldailymartins_teko?server=https%3A%2F%2Fsonarcloud.io&style=flat-square&label=quality%20gate)](https://sonarcloud.io/summary/new_code?id=rafaeldailymartins_teko)
[![Mutation score](https://img.shields.io/endpoint?style=flat-square&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Frafaeldailymartins%2Fteko%2Fmain)](https://dashboard.stryker-mutator.io/reports/github.com/rafaeldailymartins/teko/main)
[![License: MIT](https://img.shields.io/github/license/rafaeldailymartins/teko?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Frafaeldailymartins%2Fteko%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&style=flat-square&logo=nodedotjs)](.nvmrc)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18_%2B_pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

[🇧🇷 Português](README.md) · [🇺🇸 English](README.en.md)

</div>

## 💡 About

Anyone who files Brazilian tax bookkeeping knows the right answer depends on the date. An EFD
field, an adjustment code or an article of a regulation gets reworded, and mixing versions from
different periods is the easiest way to get it wrong. **Tekó** is an open-source, zero-cost RAG
assistant that answers questions about Brazilian tax law **with awareness of when each rule was in
force**. It covers EFD ICMS/IPI, EFD-REINF and the rules of the state of Goiás (RCTE and EFD-GO).

> 🌱 **Why "Tekó"?** It is a word of Tupi-Guarani origin tied to a people's "way of being", its way
> of living. Here, it is the right way to read the law: in the time it applied.

## ✨ How it works

- 📅 **Reference date.** It resolves the date the question is about (usually the tax period) and
  asks back when that date is ambiguous.
- 🔎 **Search filtered by validity.** The validity filter runs in SQL, before ranking. Only the
  wording in force on that date reaches the context, through a hybrid (vector + text) search with
  RRF.
- 📌 **Exact citation.** Every answer points to the article, paragraph, or record and field, with
  the document version and its validity interval.
- 🛑 **Honest refusal.** When the date is outside the indexed coverage, Tekó says it does not know
  instead of making something up.
- 🛡️ **Privacy.** Personal data (CPF, CNPJ, e-mail and so on) is redacted before any call to an AI
  provider.

## 🚦 Status

> [!NOTE]
> **Early development.** The monorepo skeleton, the quality gates, the local infrastructure and the
> platform spikes are done (phases F0 and F1), and so are the validity domain, the corpus schema
> and the hybrid search, evaluated on a fixture of real texts (phase F2).
> The ingestion of the official sources (EFD ICMS/IPI, EFD-Reinf, RCTE, CTE, EFD-GO and Goiás
> tables), the embeddings and daily change monitoring are implemented, and the full corpus is
> already in staging (phase F3). The next phase brings the full API. Nothing is published and
> answers are not usable yet. Progress lives in [`docs/status.md`](docs/status.md) and the next
> phases in [`docs/roadmap.md`](docs/roadmap.md) (both in Portuguese).

## 🧱 Tech stack

| Layer      | Technology                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 🖥️ Web     | Next.js 16 static export served by Vercel on the same origin as the API, React 19, Tailwind CSS 4, next-intl (pt-BR and en)                    |
| ⚙️ API     | Fastify 5 on Node.js 24, hexagonal architecture, Zod contracts shared through `@teko/shared`; a single Vercel Function (Fluid compute, `gru1`) |
| 🗄️ Data    | PostgreSQL 18 + pgvector (Neon in `aws-sa-east-1`; Docker locally), Drizzle ORM with `pg`, hybrid search with RRF                              |
| 🤖 AI      | BGE-M3 embeddings (Cloudflare Workers AI), Gemini free tier with Groq as fallback                                                              |
| 📥 Ingest  | Python with Docling (TableFormer `ACCURATE`) for the PDFs, and SPED's External Tables web service; artifacts on GitHub Releases                |
| 🧰 Tooling | pnpm 12 with a strict supply-chain policy, Turborepo, Biome, Vitest, Stryker, promptfoo, OpenSpec, lefthook, git-cliff                         |

## 🏗️ Architecture

```
Browser ── tekoia.vercel.app (same origin) ──┬── static site (Vercel CDN)
                                             └── /api/* → Fastify API (Vercel Function, gru1)
                                                   ├── Postgres + pgvector (Neon)
                                                   ├── embeddings and reranker (Workers AI)
                                                   └── LLM: Gemini → Groq (fallback)
```

- Site and API live in the same Vercel project, in two environments: `tekoia` (production) and
  `tekoia-staging`.
- GitHub Actions builds and attests the artifact and deploys it with `vercel deploy --prebuilt`;
  there is no Git integration. ADRs [0004](docs/adr/0004-vercel-hobby-api.md) and 0029 explain why.
- If Vercel goes away, there is a Plan B on Render Free that serves both the site and the API.
- The full design, by area, is in [`docs/architecture/`](docs/architecture/) (in Portuguese).

## 🚀 Getting started

### 📋 Prerequisites

- [Node.js](https://nodejs.org) 24 and Corepack
- [Docker](https://www.docker.com) with Compose v2
- On Windows, use Git Bash

### ▶️ Running

```bash
corepack enable                                          # or prefix every command with "corepack"
pnpm install --frozen-lockfile
pnpm dev:secrets                                         # local-only secrets, outside git
docker compose -f infra/local/compose.yaml up -d --wait  # Postgres + pgvector
pnpm lint && pnpm typecheck && pnpm test
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the full setup, the branch flow, the OpenSpec workflow and
every gate.

## ✅ Quality gates

Everything below fails the pull request (or the nightly run) instead of warning. The `ci-gate`
check aggregates the PR jobs and is required to merge into the trunk. The expensive checks
(mutation, dependency audit, generation evals) run nightly, on schedule or before a release.

| Gate                      | Tool                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎨 Formatting and lint    | Biome with no warnings, ruff in the Python ingestion, actionlint on the workflows                                                                    |
| 🧩 Architecture           | dependency-cruiser (hexagonal)                                                                                                                       |
| 🧹 Dead code and monorepo | knip, sherif, jscpd                                                                                                                                  |
| 🔤 Types                  | strict `tsc` and type-coverage ≥ 99%; pyright in the ingestion                                                                                       |
| 🧪 Coverage               | Vitest: ≥ 95% of lines in the API's domain and application layers and in `shared`, ≥ 80% in the adapters and the web                                 |
| 🧬 Mutation               | Stryker nightly, minimum score of 70                                                                                                                 |
| 🔎 Retrieval              | retrieval evals (promptfoo) on the real-text fixture: recall@10 ≥ 0.9, MRR ≥ 0.7; validity, refusal, clarification and reference date with no errors |
| ⚡ Performance            | `sql-perf` of the hybrid search over 100k chunks: no Seq Scan and a median under 150 ms                                                              |
| 🗃️ Migrations             | `migration-guard`: expand/contract only, a published migration is immutable                                                                          |
| 🔐 Security               | CodeQL, Semgrep, gitleaks, osv-scanner, zizmor, dependency review                                                                                    |
| 📦 Supply chain           | pnpm with releases at least 7 days old and provenance                                                                                                |
| 📐 Specs                  | `openspec validate --all --strict`                                                                                                                   |

## 🔒 Security

Found a vulnerability? Report it privately as [SECURITY.md](SECURITY.md) describes, never in a
public issue. Prompt injection and data exfiltration through RAG are in scope.

## 💸 Zero cost and non-commercial use

Tekó runs on free tiers only, with no card on file at any service. The API uses Vercel's Hobby
plan, which is for personal, non-commercial use: the project stays free and MIT, with no ads,
affiliate links, paid plans or paid services tied to the deployment. Donations are welcome.

## 🤖 How it is built

The project is developed with [Claude Code](https://claude.com/claude-code). Every requirement
change starts as an [OpenSpec](https://github.com/Fission-AI/OpenSpec) proposal; the work follows
the rules in [`CLAUDE.md`](CLAUDE.md) and passes the gates above in CI. Architecture decisions live in
[`docs/adr/`](docs/adr/) (in Portuguese).

## 📚 Project documents

- 🤝 [CONTRIBUTING.md](CONTRIBUTING.md): setup, branches, commits (DCO), OpenSpec and gates
- 🔒 [SECURITY.md](SECURITY.md): how to report vulnerabilities privately
- 💬 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): Contributor Covenant 2.1
- 🗺️ [docs/roadmap.md](docs/roadmap.md): phases F4 to F10 and what completes each one
- 📍 [docs/status.md](docs/status.md): where each phase stands
- 🧭 [docs/architecture/](docs/architecture/): the current design, by area
- 🏛️ [docs/adr/](docs/adr/): architecture decision records

## ⚖️ Disclaimer

Tekó is a research and productivity tool for tax professionals. It is not legal or tax advice:
always check the official sources it cites.

## 📄 License

[MIT](LICENSE) © 2026 Rafael Daily Santos Martins

## 👨‍💻 Author

Created and maintained by:

| [<img src="https://avatars.githubusercontent.com/u/162728324?v=4" width="60px;" alt=""/><br /><sub><b>Rafael Daily</b></sub>](https://github.com/rafaeldailymartins) |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
