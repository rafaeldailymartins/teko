import type { IsoDate, PeriodoApuracao, ValidityInterval } from '@teko/shared/vigencia'

/**
 * O caso real da demonstração da landing: o RCTE de Goiás, art. 76, § 6º. Em 05/2008 valia a
 * redação do Decreto nº 6.026/2004 (GOYAZES ou PROESPORTE, R$ 40.000,00 ou mais); desde
 * 23/11/2009 o parágrafo está revogado (Decreto nº 7.028/2009). As datas são as da fixture do
 * corpus (`apps/api/test/fixtures/corpus/documents/rcte.json`), e o teste confere que continuam
 * iguais: a demonstração não pode dizer outra coisa que o corpus.
 */
export const DEMO_PROVISION_KEY = 'go:rcte:art:76:par:6'

/** Uma cena da demonstração: a data de referência e a redação vigente nela. */
export interface DemoScene {
  readonly reference: PeriodoApuracao
  /** Primeiro dia do período de apuração (a data que a API resolve). */
  readonly referenceDate: IsoDate
  /** Vigência `[from, to)` da redação citada na resposta. */
  readonly validity: ValidityInterval
}

export const DEMO_SCENES: readonly [DemoScene, DemoScene] = [
  {
    reference: '2008-05',
    referenceDate: '2008-05-01',
    validity: { from: '2004-11-04', to: '2009-11-23' },
  },
  {
    reference: '2010-01',
    referenceDate: '2010-01-01',
    validity: { from: '2009-11-23', to: null },
  },
]

/** Marcos do dispositivo na linha do tempo do hero. */
export const MilestoneKind = {
  Added: 'added',
  Amended: 'amended',
  Revoked: 'revoked',
} as const
export type MilestoneKind = (typeof MilestoneKind)[keyof typeof MilestoneKind]

export interface DemoMilestone {
  readonly date: IsoDate
  readonly kind: MilestoneKind
}

export const DEMO_MILESTONES: readonly DemoMilestone[] = [
  { date: '2003-09-12', kind: MilestoneKind.Added },
  { date: '2004-11-04', kind: MilestoneKind.Amended },
  { date: '2009-11-23', kind: MilestoneKind.Revoked },
]

/** Escala da linha do tempo do hero: de 2003 ao fim de 2010, com folga nas pontas. */
export const DEMO_SCALE = { from: '2002-07-01', to: '2011-07-01' } as const

/** Anos marcados na régua da linha do tempo. */
export const DEMO_SCALE_YEARS = [2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011] as const

const DAY_MS = 86_400_000

function dayNumber(date: IsoDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

/**
 * Posição de uma data na escala, em porcentagem (0 a 100, presa às pontas). Conta dias em UTC,
 * sem fuso: é data de calendário.
 */
export function scalePosition(
  date: IsoDate,
  scale: { readonly from: IsoDate; readonly to: IsoDate },
): number {
  const start = dayNumber(scale.from)
  const span = (dayNumber(scale.to) - start) / DAY_MS
  if (span <= 0) return 0
  const offset = (dayNumber(date) - start) / DAY_MS
  const percent = (offset / span) * 100
  return Math.min(100, Math.max(0, Number(percent.toFixed(3))))
}
