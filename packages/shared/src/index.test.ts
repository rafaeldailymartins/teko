import { describe, expect, it } from 'vitest'
import * as analytics from './analytics/index.ts'
import * as contracts from './contracts/index.ts'
import * as errors from './errors/index.ts'
import * as i18n from './i18n/index.ts'
import * as root from './index.ts'
import * as pii from './pii/index.ts'
import * as vigencia from './vigencia/index.ts'

describe('ponto de entrada do pacote', () => {
  it('reexporta todos os subpaths sem colisão de nomes', () => {
    const modules = [analytics, contracts, errors, i18n, pii, vigencia]
    const names = modules.flatMap((module) => Object.keys(module))
    expect(new Set(names).size).toBe(names.length)
    expect(Object.keys(root).sort()).toEqual([...names].sort())
  })
})
