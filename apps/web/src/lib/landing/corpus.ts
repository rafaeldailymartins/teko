import type { IsoDate } from '@teko/shared/vigencia'
import { scalePosition } from './demo-case.ts'

/**
 * Famílias do corpus na régua da landing, com o ano aproximado do texto mais antigo de cada uma
 * no corpus (a landing não chama a API; os períodos exatos, com lacunas e a última verificação, são
 * os da página de cobertura, que lê `GET /api/v1/coverage`). Fontes: `corpus/sources.yaml`,
 * `corpus/leiaute-periods.yaml` e `docs/status.md` (EFD ICMS/IPI desde 2021, leiautes 2.1 da
 * EFD-Reinf desde 2023, Guia da EFD de Goiás desde 2016, RCTE desde 1998, CTE desde 1991).
 */
export const LANDING_CORPUS = [
  { key: 'efdIcmsIpi', jurisdiction: 'BR', since: 2021 },
  { key: 'efdReinf', jurisdiction: 'BR', since: 2023 },
  { key: 'rcte', jurisdiction: 'GO', since: 1998 },
  { key: 'cte', jurisdiction: 'GO', since: 1991 },
  { key: 'efdGo', jurisdiction: 'GO', since: 2016 },
] as const

export type LandingFamily = (typeof LANDING_CORPUS)[number]['key']

/** Escala da régua: de 1990 até o fim do ano corrente do corpus ("hoje" na ponta direita). */
const CORPUS_SCALE = { from: '1990-01-01', to: '2027-01-01' } as const satisfies {
  from: IsoDate
  to: IsoDate
}

/** Anos marcados no eixo da régua. */
export const CORPUS_AXIS_YEARS = [1990, 2000, 2010, 2020] as const

/** Posição (0–100) do começo de um ano na régua. */
export function yearPosition(year: number): number {
  return scalePosition(`${String(year).padStart(4, '0')}-01-01`, CORPUS_SCALE)
}
