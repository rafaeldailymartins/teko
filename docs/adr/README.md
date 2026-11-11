# Architecture Decision Records

Decisões de arquitetura do Tekó no formato [MADR 4](https://adr.github.io/madr/). Regras de
numeração, idioma e substituição estão na [ADR 0001](0001-record-architecture-decisions.md).

| ADR                                           | Título                                                                   | Status   |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| [0001](0001-record-architecture-decisions.md) | Registrar decisões de arquitetura em ADRs                                | accepted |
| [0002](0002-supply-chain-pnpm.md)             | Supply chain de dependências com pnpm 12                                 | accepted |
| [0003](0003-f1-spikes.md)                     | Resultados dos spikes da F1                                              | proposed |
| [0004](0004-vercel-hobby-api.md)              | API no Vercel Hobby (uma Function Fluid, dois projetos, `gru1`) + Render | accepted |

## Numeração e lista do plano

O plano de implementação traz uma lista temática de ADRs (0001 monorepo, 0002 Next estático +
FSD, 0003 Fastify hexagonal, 0004 Vercel Hobby, ..., 0020 estratégia de evals). Os números 0001 a
0003 já foram usados por ADRs escritas na F0 e na F1, então valem estas regras:

- **0004 a 0020 seguem a lista do plano**, com o mesmo número e tema (0004 Vercel Hobby + Plano B
  Render, 0005 Neon com 2 projetos, 0006 sem domínio, 0007 cadeia de LLM, 0008 BGE-M3/halfvec,
  0009 vigência bitemporal, 0010 híbrido RRF, 0011 Docling + parser RCTE, 0012 Langfuse Cloud,
  0013 OTel 2.x, 0014 Git Flow + git-cliff, 0015 custo zero e cotas, 0016 deploy via CLI
  Netlify, 0017 deploy `--prebuilt` do `.vercel/output` atestado, 0018 OpenSpec, 0019 OAuth +
  passkey, 0020 estratégia de evals).
- **Os três temas deslocados recebem os números seguintes ao fim da lista:**

  | Tema na lista do plano | Número no plano | Arquivo                                  |
  | ---------------------- | --------------- | ---------------------------------------- |
  | Monorepo               | 0001            | `0021-monorepo.md` (a escrever)          |
  | Next estático + FSD    | 0002            | `0022-next-estatico-fsd.md` (a escrever) |
  | Fastify hexagonal      | 0003            | `0023-fastify-hexagonal.md` (a escrever) |

- Os números 0001 a 0003 ficam com os arquivos existentes: registro de ADRs, supply chain com
  pnpm e spikes da F1. Quando o plano citar "ADR 0002" ou "ADR 0003", vale o arquivo existente
  (o próprio plano já cita `docs/adr/0002-supply-chain-pnpm.md` pelo caminho).
- Toda ADR nova a partir de 0024 recebe o próximo número livre.
