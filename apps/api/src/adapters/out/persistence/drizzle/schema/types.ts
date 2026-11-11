import {
  fromPostgresMultirange,
  fromPostgresRange,
  toPostgresMultirange,
  toPostgresRange,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { customType } from 'drizzle-orm/pg-core'

/**
 * Tipos do Postgres sem coluna nativa no Drizzle. O `pg` devolve `daterange`, `datemultirange` e
 * `tsvector` como texto (não há parser registrado para esses OIDs), e a conversão usa a mesma
 * representação canônica `[from, to)` do domínio (`@teko/shared/vigencia`).
 */

/** `daterange` não vazio. Um range vazio vindo do banco é erro de dados (as CHECKs o impedem). */
export const daterange = customType<{ data: ValidityInterval; driverData: string }>({
  dataType: () => 'daterange',
  toDriver: (value) => toPostgresRange(value),
  fromDriver: (value) => {
    const interval = fromPostgresRange(value)
    if (interval === null) {
      throw new RangeError(`daterange vazio vindo do banco: ${value}`)
    }
    return interval
  },
})

/** `datemultirange` canônico (ordenado, disjunto, sem vazios). */
export const datemultirange = customType<{ data: ValidityInterval[]; driverData: string }>({
  dataType: () => 'datemultirange',
  toDriver: (value) => toPostgresMultirange(value),
  fromDriver: (value) => fromPostgresMultirange(value),
})

/** `tsvector`, só leitura (coluna gerada). */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})
