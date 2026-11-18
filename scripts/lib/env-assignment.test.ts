import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { envAssignmentPattern } from './env-assignment.ts'

const pattern = envAssignmentPattern(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'WEB_ORIGIN'])

describe('envAssignmentPattern', () => {
  it('pega linha de dotenv, com ou sem export e recuo', () => {
    assert.ok(pattern.test('LANGFUSE_SECRET_KEY=sk-lf-1'))
    assert.ok(pattern.test('# config\nexport WEB_ORIGIN=https://x'))
    assert.ok(pattern.test('a=1\n  LANGFUSE_PUBLIC_KEY=pk'))
  })

  it('pega chave JSON com valor, compacta ou formatada', () => {
    assert.ok(pattern.test('{"WEB_ORIGIN":"https://x"}'))
    assert.ok(pattern.test('{"a": 1, "LANGFUSE_SECRET_KEY": "sk"}'))
    assert.ok(pattern.test('{\n  "environment": {\n    "LANGFUSE_PUBLIC_KEY": "pk"\n  }\n}'))
  })

  it('não confunde o ternário do código compilado com chave JSON', () => {
    const compiled =
      'issue(env.LANGFUSE_PUBLIC_KEY === void 0 ? "LANGFUSE_PUBLIC_KEY" : "LANGFUSE_SECRET_KEY", "vêm juntas");'
    assert.equal(pattern.test(compiled), false)
  })

  it('ignora menções sem valor: acesso, mensagem, valor vazio e nome maior', () => {
    assert.equal(pattern.test('const o = env.WEB_ORIGIN'), false)
    assert.equal(pattern.test("issue('WEB_ORIGIN', 'obrigatória')"), false)
    assert.equal(pattern.test('{"WEB_ORIGIN": ""}'), false)
    assert.equal(pattern.test('WEB_ORIGIN= '), false)
    assert.equal(pattern.test('MY_WEB_ORIGIN=x'), false)
    assert.equal(pattern.test(' * `RUNTIME_TARGET=vercel` WEB_ORIGIN'), false)
  })

  it('escapa os nomes e recusa lista vazia', () => {
    assert.equal(envAssignmentPattern(['A.B']).test('AxB=1'), false)
    assert.throws(() => envAssignmentPattern([]), /nenhum nome/)
  })
})
