import { describe, expect, it } from 'vitest'
import { noopErrorReporter } from './error-reporter.ts'

describe('noopErrorReporter', () => {
  it('desligado: não guarda nada, e flush e shutdown resolvem na hora', async () => {
    expect(noopErrorReporter.enabled).toBe(false)
    expect(() =>
      noopErrorReporter.report(new Error('x'), {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        method: 'GET',
        route: null,
        statusCode: 500,
      }),
    ).not.toThrow()
    await expect(noopErrorReporter.flush()).resolves.toBeUndefined()
    await expect(noopErrorReporter.shutdown(10)).resolves.toBeUndefined()
  })
})
