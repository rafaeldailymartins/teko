import { containsPii, cpfCheckDigits } from '@teko/shared/pii'
import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH, REDACTED, ScrubbedError, scrubError, scrubText } from './scrub.ts'

const CPF = `529982247${cpfCheckDigits('529982247')}`

describe('scrubText', () => {
  it('troca a PII de texto livre pelos marcadores do PiiRedactor', () => {
    const text = scrubText(`falhou para maria@example.com, CPF ${CPF}`)
    expect(text).toBe('falhou para [EMAIL], CPF [CPF]')
    expect(containsPii(text)).toBe(false)
  })

  it('tira usuário e senha de URLs', () => {
    expect(scrubText('connect postgres://teko_app:s3cr3t@ep-x.neon.tech/teko failed')).toBe(
      `connect postgres://${REDACTED}@ep-x.neon.tech/teko failed`,
    )
    expect(scrubText('GET https://token@api.example.com/x')).toBe(
      `GET https://${REDACTED}@api.example.com/x`,
    )
  })

  it('deixa como está o texto técnico sem PII', () => {
    expect(scrubText('registro 0150 campo 07, CFOP 5102')).toBe('registro 0150 campo 07, CFOP 5102')
  })
})

describe('scrubError', () => {
  it('copia nome, mensagem e pilha sem PII nem a causa', () => {
    const original = new TypeError(`não achei ${CPF}`, { cause: { email: 'a@b.com' } })
    const scrubbed = scrubError(original)
    expect(scrubbed).toBeInstanceOf(ScrubbedError)
    expect(scrubbed).not.toBe(original)
    expect(scrubbed.name).toBe('TypeError')
    expect(scrubbed.message).toBe('não achei [CPF]')
    expect(scrubbed.stack).toContain('TypeError: não achei [CPF]')
    expect(scrubbed.stack).not.toContain(CPF)
    expect(scrubbed.cause).toBeUndefined()
    expect(scrubbed.errorCode).toBeNull()
  })

  it('mantém só um código técnico do erro original', () => {
    const withCode = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    expect(scrubError(withCode).errorCode).toBe('ECONNRESET')
    const freeText = Object.assign(new Error('x'), { code: 'maria@example.com' })
    expect(scrubError(freeText).errorCode).toBeNull()
  })

  it('corta mensagens longas', () => {
    const scrubbed = scrubError(new Error('x'.repeat(MAX_MESSAGE_LENGTH + 10)))
    expect(scrubbed.message).toHaveLength(MAX_MESSAGE_LENGTH + 1)
    expect(scrubbed.message.endsWith('…')).toBe(true)
    expect(scrubbed.stack).not.toContain('x'.repeat(MAX_MESSAGE_LENGTH + 1))
  })

  it('erro sem mensagem nem pilha', () => {
    const error = new Error('')
    delete error.stack
    const scrubbed = scrubError(error)
    expect(scrubbed.message).toBe('')
    expect(scrubbed.stack).toBeUndefined()
  })

  it('nome fora do formato vira Error', () => {
    const error = new Error('x')
    error.name = 'Erro de maria@example.com'
    expect(scrubError(error).name).toBe('Error')
  })

  it('valor que não é Error não é serializado', () => {
    const scrubbed = scrubError({ question: `meu CPF é ${CPF}` })
    expect(scrubbed.name).toBe('NonErrorThrown')
    expect(scrubbed.message).toBe('non-Error value thrown (object)')
    expect(JSON.stringify(scrubbed)).not.toContain(CPF)
  })
})
