/**
 * Utilitários do teste de paridade dos catálogos (`src/lib/i18n/messages.test.ts`): achatam um
 * catálogo em `chave.pontuada → valor` e comparam as chaves de dois idiomas.
 */

import { compareCodeUnits } from '../scripts/lib/html.ts'

type Catalog = Record<string, unknown>

function isNamespace(value: unknown): value is Catalog {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Achata um catálogo em `chave.pontuada → folha` (listas e valores não textuais viram folha). */
export function flattenCatalog(catalog: Catalog, prefix = ''): Map<string, unknown> {
  const entries = new Map<string, unknown>()
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isNamespace(value)) {
      for (const [nested, leaf] of flattenCatalog(value, path)) entries.set(nested, leaf)
    } else {
      entries.set(path, value)
    }
  }
  return entries
}

export interface CatalogKeyDiff {
  /** Chaves da referência que faltam no outro catálogo. */
  readonly missing: readonly string[]
  /** Chaves do outro catálogo que a referência não tem. */
  readonly extra: readonly string[]
}

/** Diferença de chaves entre a referência (pt-BR) e outro idioma, em ordem alfabética. */
export function diffCatalogKeys(reference: Catalog, other: Catalog): CatalogKeyDiff {
  const referenceKeys = new Set(flattenCatalog(reference).keys())
  const otherKeys = new Set(flattenCatalog(other).keys())
  return {
    missing: [...referenceKeys].filter((key) => !otherKeys.has(key)).sort(compareCodeUnits),
    extra: [...otherKeys].filter((key) => !referenceKeys.has(key)).sort(compareCodeUnits),
  }
}
