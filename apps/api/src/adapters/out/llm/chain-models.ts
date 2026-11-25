/**
 * Configuração e identidade dos modelos da cadeia de LLM, sem o AI SDK: a raiz de composição monta
 * a cadeia (`lazy-llm-chain.ts`) sem carregar o SDK, e o `ai-sdk-llm.ts` usa a mesma ordem.
 */

export interface LlmChainConfig {
  readonly geminiApiKey: string
  readonly groqApiKey: string
  readonly geminiModels: readonly string[]
  readonly groqModel: string
  readonly fetch?: typeof fetch
}

export interface ModelIdentity {
  readonly provider: 'gemini' | 'groq'
  readonly model: string
  readonly zeroDataRetention: boolean
}

/** Cadeia do plano: Gemini primário → Gemini de fallback → Groq (ZDR). */
export function chainIdentities(config: LlmChainConfig): ModelIdentity[] {
  return [
    ...config.geminiModels.map(
      (model): ModelIdentity => ({ provider: 'gemini', model, zeroDataRetention: false }),
    ),
    { provider: 'groq', model: config.groqModel, zeroDataRetention: true },
  ]
}
