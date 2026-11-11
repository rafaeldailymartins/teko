import { createHash } from 'node:crypto'
import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sha256ContentHasher } from './sha256-content-hasher.ts'

describe('sha256ContentHasher', () => {
  it('é o sha256 hexadecimal do texto normalizado', () => {
    expect(sha256ContentHasher.hash('  § 6º​  Revogado. ')).toBe(
      createHash('sha256').update('§ 6º Revogado.', 'utf8').digest('hex'),
    )
    expect(sha256ContentHasher.hash('x')).toMatch(/^[0-9a-f]{64}$/)
  })

  test.prop([fc.string(), fc.constantFrom(' ', '\n', '\t​')])(
    'é determinístico e invariante a espaços nas pontas',
    (text, padding) => {
      expect(sha256ContentHasher.hash(`${padding}${text}${padding}`)).toBe(
        sha256ContentHasher.hash(text),
      )
    },
  )
})
