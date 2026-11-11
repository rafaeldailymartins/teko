---

status: accepted
date: 2026-11-10
decision-makers: Rafael Daily Santos Martins
---

# 0001 — Registrar decisões de arquitetura em ADRs

## Contexto e problema

O Tekó é mantido por uma pessoa, com um plano de implementação longo (fases F0 a F10) que desvia
em vários pontos do pedido original por causa das restrições de custo zero, ausência de domínio
próprio e limites dos free tiers. Sem um registro, o motivo de cada desvio se perde, e futuras
contribuições reabrem decisões já tomadas ou repetem erros já avaliados.

## Fatores de decisão

- Decisões precisam ser revisáveis em PR, junto com o código que as implementa.
- Toda versão e API fixadas no plano são conferidas via Context7; divergências exigem correção
  rastreável no mesmo PR.
- Custo de manutenção baixo: texto puro no repositório, sem ferramenta externa.

## Opções consideradas

- ADRs em Markdown no formato MADR 4, em `docs/adr/`.
- ADRs no formato Nygard (título, status, contexto, decisão, consequências).
- Só o plano de implementação e as mudanças OpenSpec, sem ADRs.

## Decisão

Opção escolhida: **MADR 4 em `docs/adr/`**, porque registra as opções consideradas com prós e
contras, que é justamente o que se perde num desvio do pedido original, e tem metadados de status
e data. As mudanças OpenSpec descrevem _o que_ muda; as ADRs registram _por que_ a arquitetura é
assim e sobrevivem ao arquivamento das mudanças.

Regras:

- numeração sequencial de 4 dígitos (`NNNN-titulo-em-kebab-case.md`), em pt-BR;
- uma ADR aceita não é reescrita; uma decisão nova cria outra ADR com status
  `superseded by NNNN` na anterior;
- correções de versão vindas do Context7 atualizam a ADR correspondente no mesmo PR;
- o `design.md` de cada mudança OpenSpec referencia as ADRs que a fundamentam.

### Consequências

- Bom, porque decisões e desvios ficam auditáveis e próximos do código.
- Bom, porque novas pessoas entendem o contexto sem ler o plano inteiro.
- Ruim, porque cada decisão relevante custa um documento a mais no PR.

### Confirmação

A revisão de PR confere que mudanças de arquitetura trazem a ADR correspondente; o CODEOWNERS
cobre `docs/adr/`.

## Decisões e desvios do pedido original (resumo)

Tabela consolidada a partir do plano de implementação. Cada linha ganha uma ADR própria quando a
fase correspondente for implementada. Esta seção é um resumo vivo do plano, e não a decisão em si:
quando o plano muda, ela é sincronizada no mesmo PR e a decisão detalhada vai para a ADR do tema.
A revisão de 2026-11-10 trocou a VM Oracle pelo Vercel Hobby
([ADR 0004](0004-vercel-hobby-api.md)).

| Pedido original / pesquisa                                                             | Decisão                                                                                                                                                                                                                                                                                     | Motivo principal                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify em Netlify Functions                                                           | Fastify (Node 24) como uma única Vercel Function (Fluid compute) no Vercel Hobby, região `gru1`, em dois projetos (`teko-api`, `teko-api-staging`), com deploy `--prebuilt` do output atestado no CI; Plano B no Render Free com o mesmo `server.ts` ([ADR 0004](0004-vercel-hobby-api.md)) | Functions da Netlify param em 60 s, ficam em Ohio e consomem os créditos do front; o Hobby dá 300 s com streaming, região junto do Neon e pausa em vez de cobrar |
| VM Oracle Always Free A1 (decisão anterior do plano: Docker, Caddy, deSEC, blue/green) | Descartada; a API vai para o Vercel Hobby, que era o Plano B                                                                                                                                                                                                                                | O cadastro da Oracle Cloud no Brasil só oferece "Customer type: Corporate", que exige CNPJ, e o mantenedor não tem CNPJ                                          |
| Staging como Preview da Vercel                                                         | Dois projetos, cada um com deploy de produção e domínio público próprio                                                                                                                                                                                                                     | Custom Environments são Pro, branch URLs exigem a integração Git (desligada) e previews ficam atrás do Vercel Authentication                                     |
| Rate limit em memória do processo                                                      | `@fastify/rate-limit` com store em Postgres nas rotas proxiadas e regra de rate limit do WAF da Vercel no stream                                                                                                                                                                            | A Fluid escala para várias instâncias; memória local não limita nada entre elas                                                                                  |
| Netlify Database                                                                       | Neon Free PG18 em dois projetos (`teko-prod`, `teko-staging`)                                                                                                                                                                                                                               | O Netlify DB cobra do pool de créditos                                                                                                                           |
| Next.js com SSR na Netlify                                                             | `output: 'export'` (0 functions, 0 edge), com guard no CI                                                                                                                                                                                                                                   | SSR consome o pool compartilhado de créditos                                                                                                                     |
| Domínio próprio e e-mail                                                               | `*.netlify.app` com proxy assinado same-origin + `teko-api.vercel.app` e `teko-api-staging.vercel.app`; login por OAuth GitHub/Google + passkey                                                                                                                                             | Sem domínio não há remetente de e-mail confiável                                                                                                                 |
| Langfuse self-hosted                                                                   | Langfuse Cloud Hobby (EU); self-hosted só no dev local                                                                                                                                                                                                                                      | Self-hosted exige 4 vCPU, 16 GB e ClickHouse                                                                                                                     |
| LLM pago                                                                               | Gemini free (flash → flash-lite) → Groq `openai/gpt-oss-120b` com ZDR                                                                                                                                                                                                                       | Custo zero                                                                                                                                                       |
| Embeddings                                                                             | BGE-M3 via Workers AI (1024 dims, `halfvec`), com degradação rotulada para FTS                                                                                                                                                                                                              | Cota diária grátis com hard stop                                                                                                                                 |
| Reranker                                                                               | Fora do MVP; necessidade medida pelas retrieval evals                                                                                                                                                                                                                                       | Custo e latência                                                                                                                                                 |
| Changesets                                                                             | git-cliff + GitHub App `teko-release-bot`                                                                                                                                                                                                                                                   | Pacotes privados; conflito com o Git Flow                                                                                                                        |
| Linear history                                                                         | Não exigido                                                                                                                                                                                                                                                                                 | Incompatível com os merge commits do Git Flow                                                                                                                    |
| Merge queue                                                                            | `strict` status checks                                                                                                                                                                                                                                                                      | Indisponível em repositório de usuário                                                                                                                           |
| Carga, stress e DAST ativo no ambiente real                                            | Só na stack efêmera de CI, com os limites de uma instância Fluid do Hobby (1 vCPU, 2 GB)                                                                                                                                                                                                    | Rodar no real queimaria créditos da Netlify, CU-h do Neon, cota de LLM e as cotas do Hobby, com risco de pausa de 30 dias                                        |
| Plugins remote-only do promptfoo                                                       | Plugins locais + casos YAML escritos à mão                                                                                                                                                                                                                                                  | Os remotos falham sem geração remota ou enviam dados ao serviço                                                                                                  |
| Scorecard alto desde o início                                                          | ≥ 7 na v0.1.0 e ≥ 8 na v0.2.0                                                                                                                                                                                                                                                               | `Maintained` só pontua após 90 dias; Code-Review exige segundo revisor                                                                                           |
| Trusted Types em enforce                                                               | Report-only até a v0.2.0; enforce após 14 dias sem violação                                                                                                                                                                                                                                 | Risco de quebra por dependências                                                                                                                                 |
| Anexos VIII/IX do RCTE junto com o corpo                                               | Onda C3, na F10                                                                                                                                                                                                                                                                             | Arquivos de 57 e 73 MB e o limite de 1 GB do Neon                                                                                                                |

## Mais informações

- [MADR](https://adr.github.io/madr/) e o
  [template 4.0.0](https://github.com/adr/madr/blob/4.0.0/template/adr-template.md).
- ADRs seguintes: [0002 — Supply chain com pnpm](0002-supply-chain-pnpm.md),
  [0003 — Spikes da F1](0003-f1-spikes.md) e
  [0004 — API no Vercel Hobby com Plano B no Render](0004-vercel-hobby-api.md).
- A correspondência entre a lista temática de ADRs do plano e os números já usados está no
  [índice](README.md#numeração-e-lista-do-plano).
