import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { driftedFiles, GENERATED_PATHS } from './check-api-client.ts'

describe('driftedFiles', () => {
  it('árvore limpa não tem drift', () => {
    assert.deepEqual(driftedFiles(''), [])
    assert.deepEqual(driftedFiles('\n'), [])
  })

  it('lista alterados, novos e apagados pelo caminho', () => {
    const porcelain = [
      ' M apps/web/openapi.json',
      '?? apps/web/src/lib/api/__generated__/novo.gen.ts',
      ' D apps/web/src/lib/api/__generated__/sdk.gen.ts',
      '',
    ].join('\n')
    assert.deepEqual(driftedFiles(porcelain), [
      'apps/web/openapi.json',
      'apps/web/src/lib/api/__generated__/novo.gen.ts',
      'apps/web/src/lib/api/__generated__/sdk.gen.ts',
    ])
  })

  it('ignora o CR de uma saída com fim de linha do Windows', () => {
    assert.deepEqual(driftedFiles(' M apps/web/openapi.json\r\n'), ['apps/web/openapi.json'])
  })
})

describe('GENERATED_PATHS', () => {
  it('cobre o OpenAPI versionado e a pasta do cliente gerado', () => {
    assert.deepEqual(
      [...GENERATED_PATHS],
      ['apps/web/openapi.json', 'apps/web/src/lib/api/__generated__'],
    )
  })
})
