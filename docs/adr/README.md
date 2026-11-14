# Architecture Decision Records

Decisões de arquitetura do Tekó no formato [MADR 4](https://adr.github.io/madr/). Regras de
numeração, idioma e substituição estão na [ADR 0001](0001-record-architecture-decisions.md). O
desenho vigente, com todas as decisões aplicadas, fica em [`docs/architecture/`](../architecture/);
o roteiro, em [`docs/roadmap.md`](../roadmap.md).

| ADR                                                  | Título                                                                               | Status   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| [0001](0001-record-architecture-decisions.md)        | Registrar decisões de arquitetura em ADRs                                            | accepted |
| [0002](0002-supply-chain-pnpm.md)                    | Supply chain de dependências com pnpm 12                                             | accepted |
| [0003](0003-f1-spikes.md)                            | Resultados dos spikes da F1                                                          | accepted |
| [0004](0004-vercel-hobby-api.md)                     | API no Vercel Hobby (uma Function Fluid, dois projetos, `gru1`) + Render             | accepted |
| [0006](0006-sem-dominio-proprio.md)                  | Sem domínio próprio: os hosts `*.vercel.app` de cada projeto                         | accepted |
| [0007](0007-cadeia-de-llm.md)                        | Cadeia de LLM: Gemini free → Groq com ZDR, pelo AI SDK da Vercel                     | accepted |
| [0008](0008-bge-m3-e-halfvec.md)                     | Embeddings `bge-m3` do Workers AI, gravados como `halfvec(1024)`                     | accepted |
| [0009](0009-vigencia-bitemporal.md)                  | Vigência bitemporal e cobertura limitada pelo `verified_at`                          | accepted |
| [0010](0010-busca-hibrida-rrf.md)                    | Busca híbrida numa instrução SQL, RRF k = 60, filtrada por vigência                  | accepted |
| [0011](0011-docling-e-parser-rcte.md)                | Docling (TableFormer V1 ACCURATE) para PDF e máquina de estados HTML para RCTE/CTE   | accepted |
| [0017](0017-vercel-build-output-tsdown.md)           | Deploy `--prebuilt` de um `.vercel/output` montado do bundle do tsdown               | accepted |
| [0019](0019-oauth-e-passkey.md)                      | Login por OAuth (GitHub e Google) e passkey, com o Better Auth                       | accepted |
| [0024](0024-environments-em-pull-request.md)         | Regra de branch dos environments em eventos `pull_request`                           | accepted |
| [0025](0025-reconciliacao-incremental-e-snapshot.md) | Reconciliação incremental do corpus e identidade no snapshot                         | accepted |
| [0026](0026-revisao-do-parser.md)                    | Revisão do parser na identidade da versão de documento                               | accepted |
| [0027](0027-reranker-workers-ai.md)                  | Reranker do Workers AI na busca híbrida                                              | accepted |
| [0028](0028-excecao-http-com-pin.md)                 | Exceção http com pin para os Guias do portal antigo do SPED                          | accepted |
| [0029](0029-web-e-api-na-mesma-origem.md)            | Web e API na mesma origem na Vercel                                                  | accepted |
| [0030](0030-artefatos-no-github-releases.md)         | Artefatos de ingestão no GitHub Releases                                             | accepted |
| [0031](0031-ragops-avaliacao-e-gates.md)             | RAGOps: avaliação dev/holdout, gate do corpus-eval, linhagem e rollback              | accepted |
| [0032](0032-gates-e-ferramentas-enxutos.md)          | Gates e ferramentas de CI enxutos                                                    | accepted |
| [0033](0033-trunk-based.md)                          | Trunk-based com `main` como tronco, produção por tag `v*` e changelog pelo git-cliff | accepted |
| [0034](0034-reescrita-da-pergunta.md)                | Reescrita da pergunta pelo LLM antes da busca                                        | accepted |

As ADRs 0029 a 0032 chegam pelos PRs da revisão de 2026-11-12 ([status](../status.md)), um por
pacote; o link entra quando o arquivo estiver em `main`.

### Revisão de 2026-11-12

As decisões aprovadas antes da F4 alteram ADRs aceitas. Cada uma ganha, no PR que muda o tema,
uma nota de revisão apontando para a ADR nova, sem reescrever a decisão original:

| ADR alterada | Por quê                                                                                  | ADR nova   |
| ------------ | ---------------------------------------------------------------------------------------- | ---------- |
| 0002         | saem as exceções da Netlify (`tools/netlify-cli`, `@netlify/plugin-nextjs`) e do steiger | 0029, 0032 |
| 0003         | os spikes (a) e (c), de web na Netlify e proxy assinado, ficam superados                 | 0029       |
| 0004         | projetos `tekoia` e `tekoia-staging`, mesma origem, WAF sem a regra do `x-nf-sign`       | 0029       |
| 0017         | o `.vercel/output` leva o estático e rotas próprias; a Function leva os chunks do bundle | 0029       |
| 0024         | o `release-rehearsal` passa a aceitar só a tag `v*`; não há mais PR de release           | 0033       |

## Numeração e lista do plano

O plano de implementação (congelado em 2026-11-12) traz uma lista temática de ADRs (0001
monorepo, 0002 Next estático + FSD, 0003 Fastify hexagonal, 0004 Vercel Hobby, ..., 0020
estratégia de evals). Os números 0001 a 0003 já foram usados por ADRs escritas na F0 e na F1,
então valem estas regras:

- **0004 a 0020 seguem a lista do plano**, com o mesmo número e tema. Um número reservado só
  existe quando a ADR é escrita; até lá, os documentos citam o tema como "ADR a escrever na fase
  X", nunca o número.
- **Toda decisão fora da lista recebe o próximo número livre** a partir de 0024 (a revisão de
  2026-11-12 usou 0029 a 0033).
- **Dois temas da lista foram cobertos por ADRs novas** e não serão escritos com o número
  reservado.

| Nº na lista | Tema do plano                                    | Situação                                                                                                                                   |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0004        | Vercel Hobby + Plano B Render                    | [escrita](0004-vercel-hobby-api.md)                                                                                                        |
| 0005        | Neon com 2 projetos                              | a escrever na F7 (deploy e rehearsal)                                                                                                      |
| 0006        | Sem domínio (proxy + ticket)                     | [escrita](0006-sem-dominio-proprio.md)                                                                                                     |
| 0007        | Cadeia de LLM                                    | [escrita](0007-cadeia-de-llm.md)                                                                                                           |
| 0008        | BGE-M3/halfvec                                   | [escrita](0008-bge-m3-e-halfvec.md)                                                                                                        |
| 0009        | Vigência bitemporal                              | [escrita](0009-vigencia-bitemporal.md)                                                                                                     |
| 0010        | Híbrido RRF                                      | [escrita](0010-busca-hibrida-rrf.md)                                                                                                       |
| 0011        | Docling + parser RCTE                            | [escrita](0011-docling-e-parser-rcte.md)                                                                                                   |
| 0012        | Langfuse Cloud                                   | a escrever na F6                                                                                                                           |
| 0013        | OTel 2.x                                         | a escrever na F6                                                                                                                           |
| 0014        | Git Flow + git-cliff                             | **coberto pela [0033](0033-trunk-based.md)** (trunk-based + git-cliff)                                                                     |
| 0015        | Custo zero e cotas                               | a escrever na F7 (o estado atual está em [contas e cotas](../architecture/contas-e-cotas.md))                                              |
| 0016        | Deploy via CLI Netlify                           | **coberto pela 0029** (web e API na mesma origem na Vercel, deploy pela CLI da Vercel)                                                     |
| 0017        | Deploy `--prebuilt` do `.vercel/output` atestado | [escrita](0017-vercel-build-output-tsdown.md)                                                                                              |
| 0018        | OpenSpec                                         | a escrever na F9 (a regra vigente está na [ADR 0001](0001-record-architecture-decisions.md#adendo-2026-11-12-documentação-no-repositório)) |
| 0019        | OAuth + passkey                                  | [escrita](0019-oauth-e-passkey.md)                                                                                                         |
| 0020        | Estratégia de evals                              | a escrever na F8 (a parte de retrieval e RAGOps está na ADR 0031)                                                                          |

- **Os três temas deslocados recebem os números seguintes ao fim da lista:**

  | Tema na lista do plano | Número no plano | Arquivo                                                           |
  | ---------------------- | --------------- | ----------------------------------------------------------------- |
  | Monorepo               | 0001            | `0021-monorepo.md` (a escrever na F9)                             |
  | Next estático + FSD    | 0002            | coberto pela 0029 (Next estático na Vercel) e pela 0032 (sem FSD) |
  | Fastify hexagonal      | 0003            | `0023-fastify-hexagonal.md` (a escrever na F9)                    |

- Os números 0001 a 0003 ficam com os arquivos existentes: registro de ADRs, supply chain com
  pnpm e spikes da F1.
