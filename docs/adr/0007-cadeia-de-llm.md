---

status: accepted
date: 2026-11-14
decision-makers: Rafael Daily Santos Martins
---

# 0007 — Cadeia de LLM: Gemini free → Groq com ZDR, pelo AI SDK da Vercel

## Contexto e problema

A resposta do Tekó precisa de um LLM com custo zero. O Gemini free tem cota diária generosa, mas
usa os prompts para treino e às vezes devolve 429 ou 5xx; o Groq tem retenção zero (ZDR), mas cota
menor. Quem está no Espaço Econômico Europeu, no Reino Unido ou na Suíça não pode ter o prompt
usado para treino. O desenho de 2026-11-12 previa `@google/genai` e `groq-sdk`, um SDK por
provedor.

Na F4, conferindo o registro do npm: nenhuma versão do `@google/genai` (de 1.40.0 a 3.0.0) foi
publicada com atestação de proveniência SLSA, que o ADR 0002 exige de dependência nova, e ele traz
`google-auth-library`, `protobufjs` (com script de build) e `ws`.

## Decisão

1. **AI SDK da Vercel** (`ai`, `@ai-sdk/google` e `@ai-sdk/groq`), decisão do mantenedor em
   2026-11-14. Os três têm proveniência, licença Apache-2.0 e dependem só de `@ai-sdk/provider` e
   `@ai-sdk/provider-utils`, fixados na mesma base no catálogo. Uma API só (`streamText`), com
   `abortSignal`, `temperature`, `maxOutputTokens` e uso de tokens. O `ai` é também o pacote do
   UI Message Stream que o front da F5 vai consumir. Os SDKs ficam só em `adapters/out/llm`
   (dependency-cruiser).
2. **Cadeia:** `GEMINI_MODEL_PRIMARY` → `GEMINI_MODEL_FALLBACK` → `GROQ_MODEL` (ZDR), IDs por env.
   Fallback só antes do primeiro token. Breaker por modelo: 429 abre até o `retry-after` ou, sem
   ele, até a meia-noite do Pacífico (renovação da cota do Gemini); 3 falhas seguidas de 5xx, rede
   ou outro 4xx abrem por 60 s. Sem retries do SDK (`maxRetries: 0`).
3. **Hosts fixos, conferidos por requisição:** cada provedor recebe a `baseURL` constante e um
   `fetch` que recusa qualquer outra origem antes da rede. `*_BASE_URL` de provedor no env continua
   derrubando o boot.
4. **Política regional:** país declarado no onboarding **ou** o país da requisição pela
   `geolocation()` da Vercel no grupo EEE/UK/CH → só modelos com ZDR. Sem modelo com ZDR na cadeia,
   451 `region_restricted`.
5. **Prompt versionado em TypeScript** (`application/prompts/answer.ts`, para entrar no bundle sem
   cópia de arquivo): `PROMPT_VERSION = answer@<semver>+<sha8>`, fontes em `<source id="Sn">` com
   escape, canário no system prompt (a saída que o contém é bloqueada), sentinela `INSUFICIENTE`,
   temperatura 0,1 e saída ≤ 1.200 tokens.
6. **`LLM_PROVIDER`:** `gemini` (cadeia completa, exige as duas chaves), `groq` (só o Groq) ou
   `fake` (development e ci, com marcadores de falha). `LLM_KILL_SWITCH` mantém só o cache.

## Consequências

- Sem exceção de proveniência no ADR 0002; o `@google/genai` e o `groq-sdk` não entram.
- O AI SDK publica versões quase todo dia e as majors quebram API: o catálogo fixa núcleo e
  provedores na mesma base, e o `cooldown` do Dependabot segura a cadência.
- O `ai` traz o `@ai-sdk/gateway`, que só age quando o modelo é passado como texto; o Tekó sempre
  passa a instância do provedor, e o AI Gateway fica desligado no time da Vercel.
- O ZDR do Groq é uma configuração da conta (console do Groq), feita pelo mantenedor; o código só
  marca o modelo como ZDR.
- Custo-sombra pelo preço de tabela (`services/pricing.ts`), gravado em toda resposta.
