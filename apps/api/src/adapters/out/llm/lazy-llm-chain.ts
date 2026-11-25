import type { LlmEvent, LlmModel, LlmRequest } from '#app/ports/llm-port.ts'
import { lazyModule, type Preloadable } from '../lazy-module.ts'
import { chainIdentities, type LlmChainConfig } from './chain-models.ts'

/**
 * A cadeia de LLM com o AI SDK carregado sob demanda: os modelos (provedor, nome e ZDR) saem da
 * configuração, e o `ai-sdk-llm.ts` (AI SDK e os provedores Gemini e Groq) só é importado no
 * primeiro `stream` (ou no `preload` de qualquer modelo; a carga é uma só para a cadeia). Cada
 * modelo daqui delega ao modelo de mesma posição da cadeia real, que abre o span `chat <modelo>` e
 * converte os erros como antes; o router e os breakers não percebem a diferença.
 */
export function createLazyLlmChain(config: LlmChainConfig): (LlmModel & Preloadable)[] {
  const chain = lazyModule(async () => {
    const { createLlmChain } = await import('./ai-sdk-llm.ts')
    return createLlmChain(config)
  })
  return chainIdentities(config).map((identity, index) => ({
    ...identity,
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const model = (await chain())[index]
      if (model === undefined) {
        throw new Error(`cadeia de LLM sem o modelo ${identity.model}`)
      }
      yield* model.stream(request)
    },
    preload: async () => {
      await chain()
    },
  }))
}
