import type { Telemetry } from '../telemetry.ts'

/** Uma chamada à porta `Telemetry`: o método e os argumentos. */
export interface TelemetryCall {
  readonly method: keyof Telemetry
  readonly args: readonly unknown[]
}

/** `Telemetry` que só grava as chamadas, para os testes da aplicação conferirem os sinais. */
export function recordingTelemetry(): Telemetry & {
  readonly calls: TelemetryCall[]
  of(method: keyof Telemetry): unknown[][]
} {
  const calls: TelemetryCall[] = []
  const record =
    (method: keyof Telemetry) =>
    (...args: unknown[]): void => {
      calls.push({ method, args })
    }
  return {
    calls,
    of: (method) => calls.filter((call) => call.method === method).map((call) => [...call.args]),
    httpRequest: record('httpRequest'),
    answer: record('answer'),
    citationsInvalidated: record('citationsInvalidated'),
    insufficientSentinel: record('insufficientSentinel'),
    rerankerScores: record('rerankerScores'),
    llmCall: record('llmCall'),
    providerError: record('providerError'),
    providerFallback: record('providerFallback'),
    quotaUsage: record('quotaUsage'),
  }
}
