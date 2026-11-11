import { describe, expect, it } from 'vitest'
import {
  FAMILIES,
  Family,
  isFamily,
  jurisdictionOf,
  PUBLISHABLE_REVIEW_STATUSES,
  ReviewStatus,
} from './family.ts'

describe('famílias do corpus', () => {
  it('lista as famílias com a jurisdição fixa de cada uma', () => {
    expect(FAMILIES).toEqual([
      'efd-icms-ipi',
      'efd-reinf',
      'rcte',
      'cte',
      'efd-go',
      'tabelas-go',
      'rcte-anexos',
    ])
    expect(jurisdictionOf(Family.EfdIcmsIpi)).toBe('BR')
    expect(jurisdictionOf(Family.EfdReinf)).toBe('BR')
    expect(FAMILIES.filter((family) => jurisdictionOf(family) === 'GO')).toEqual([
      'rcte',
      'cte',
      'efd-go',
      'tabelas-go',
      'rcte-anexos',
    ])
  })

  it('reconhece só slugs de família conhecidos', () => {
    expect(isFamily('rcte')).toBe(true)
    expect(isFamily('RCTE')).toBe(false)
    expect(isFamily('efd')).toBe(false)
    expect(isFamily(42)).toBe(false)
    expect(isFamily(undefined)).toBe(false)
  })

  it('publicável = auto e approved (pending só no staging, rejected nunca)', () => {
    expect(PUBLISHABLE_REVIEW_STATUSES).toEqual([ReviewStatus.Auto, ReviewStatus.Approved])
  })
})
