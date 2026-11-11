import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  createBuildInfo,
  gitShaSchema,
  releaseVersionSchema,
  UNKNOWN_GIT_SHA,
} from './build-info.ts'

describe('createBuildInfo', () => {
  it('aceita versão SemVer e SHA completo', () => {
    const sha = 'a'.repeat(40)
    expect(createBuildInfo({ version: '0.1.0', gitSha: sha })).toEqual({
      version: '0.1.0',
      gitSha: sha,
    })
  })

  it('usa "unknown" quando o SHA não foi informado', () => {
    expect(createBuildInfo({ version: '0.0.0' }).gitSha).toBe(UNKNOWN_GIT_SHA)
    expect(createBuildInfo({ version: '0.0.0', gitSha: undefined }).gitSha).toBe(UNKNOWN_GIT_SHA)
  })

  it('normaliza SHA em maiúsculas e com espaços', () => {
    expect(createBuildInfo({ version: '0.0.0', gitSha: '  ABCDEF1 ' }).gitSha).toBe('abcdef1')
  })

  it('devolve um objeto congelado', () => {
    expect(Object.isFrozen(createBuildInfo({ version: '1.0.0' }))).toBe(true)
  })

  it.each(['abcdef', 'g123456', 'a'.repeat(41), ''])('rejeita SHA malformado %j', (gitSha) => {
    expect(() => createBuildInfo({ version: '0.1.0', gitSha })).toThrow(/GIT_SHA/)
  })

  it.each(['0.1.0', '0.0.0-abc1234', '1.2.3-rc.1+build.5', '10.20.30'])(
    'aceita a versão %s',
    (version) => {
      expect(releaseVersionSchema.parse(version)).toBe(version)
    },
  )

  it.each(['v0.1.0', '01.2.3', '1.2', '1.2.3-', 'latest', ''])('rejeita a versão %j', (version) => {
    expect(() => createBuildInfo({ version })).toThrow(/SemVer/)
  })
})

describe('gitShaSchema (propriedades)', () => {
  test.prop([fc.stringMatching(/^[0-9a-f]{7,40}$/)])(
    'todo hex minúsculo de 7 a 40 é aceito sem mudança',
    (sha) => {
      expect(gitShaSchema.parse(sha)).toBe(sha)
    },
  )

  test.prop([fc.stringMatching(/^[0-9A-F]{7,40}$/)])('hex maiúsculo é normalizado', (sha) => {
    expect(gitShaSchema.parse(sha)).toBe(sha.toLowerCase())
  })

  test.prop([fc.stringMatching(/^[0-9a-f]{0,6}$/)])('menos de 7 caracteres é rejeitado', (sha) => {
    expect(gitShaSchema.safeParse(sha).success).toBe(false)
  })
})
