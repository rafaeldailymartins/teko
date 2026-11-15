import { describe, expect, it } from 'vitest'
import { cn } from './utils.ts'

describe('cn', () => {
  it('junta classes e ignora valores falsos', () => {
    expect(
      cn('flex', false, undefined, null, 'gap-2', { hidden: false, 'items-center': true }),
    ).toBe('flex gap-2 items-center')
  })

  it('a última classe vence um conflito do Tailwind', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4')
    expect(cn('bg-primary', 'bg-muted')).toBe('bg-muted')
  })

  it('mantém utilitários de tokens próprios lado a lado com os do Tailwind', () => {
    expect(cn('text-muted-foreground', 'text-sm')).toBe('text-muted-foreground text-sm')
  })
})
