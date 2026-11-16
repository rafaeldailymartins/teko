import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEMO_MILESTONES,
  DEMO_PROVISION_KEY,
  DEMO_SCALE,
  DEMO_SCENES,
  scalePosition,
} from './demo-case.ts'
import {
  answerWords,
  buildDemoSteps,
  charDelay,
  DEFAULT_DEMO_TIMING,
  DemoPhase,
  type DemoStep,
  finalStepIndex,
  loopDuration,
  questionChars,
} from './demo-timeline.ts'

const QUESTION = 'O que diz o § 6º?'
const SCRIPT = { question: QUESTION, answerWords: [4, 2] } as const

function phases(steps: readonly DemoStep[]): string[] {
  // Sequência de fases sem repetições seguidas, para ler o roteiro de uma vez.
  return steps
    .map((step) => step.frame.phase)
    .filter((phase, index, all) => index === 0 || all[index - 1] !== phase)
}

describe('buildDemoSteps', () => {
  const steps = buildDemoSteps(SCRIPT)

  it('segue a ordem: digitar, escolher a data, pensar, stream e fontes, em cada cena', () => {
    expect(phases(steps)).toEqual([
      DemoPhase.Idle,
      DemoPhase.Typing,
      DemoPhase.Choosing,
      DemoPhase.Thinking,
      DemoPhase.Streaming,
      DemoPhase.Answered,
      DemoPhase.Typing,
      DemoPhase.Choosing,
      DemoPhase.Thinking,
      DemoPhase.Streaming,
      DemoPhase.Answered,
      DemoPhase.Clearing,
    ])
  })

  it('digita a pergunta caractere a caractere, contando pontos de código', () => {
    const typing = steps.filter((step) => step.frame.phase === DemoPhase.Typing)
    const length = questionChars(QUESTION).length
    expect(length).toBe(17)
    expect(typing.map((step) => step.frame.typed)).toEqual([
      ...Array.from({ length }, (_, index) => index + 1),
      ...Array.from({ length }, (_, index) => index + 1),
    ])
  })

  it('o chip da data aparece só depois de digitar e troca para a segunda data na segunda cena', () => {
    const first = steps.findIndex((step) => step.frame.phase === DemoPhase.Choosing)
    expect(steps[first - 1]?.frame.reference).toBeNull()
    expect(steps[first]?.frame.reference).toBe(0)
    const second = steps.findLastIndex((step) => step.frame.phase === DemoPhase.Choosing)
    expect(steps[second - 1]?.frame.reference).toBe(0)
    expect(steps[second]?.frame.reference).toBe(1)
  })

  it('a resposta chega com o cabeçalho, depois palavra a palavra, e só no fim com as fontes', () => {
    const answer = steps
      .map((step) => step.frame.exchanges[0])
      .filter((exchange) => exchange !== undefined)
    expect(answer[0]).toEqual({ scene: 0, header: false, words: 0, sources: false })
    expect(answer[1]).toEqual({ scene: 0, header: true, words: 0, sources: false })
    expect(answer.slice(2, 6).map((exchange) => exchange.words)).toEqual([1, 2, 3, 4])
    expect(answer.slice(2, 6).every((exchange) => !exchange.sources)).toBe(true)
    expect(answer[6]).toEqual({ scene: 0, header: true, words: 4, sources: true })
  })

  it('o quadro final tem as duas respostas completas e a segunda data no chip', () => {
    const final = steps[finalStepIndex(steps)]
    expect(final?.frame).toEqual({
      phase: DemoPhase.Answered,
      typed: 0,
      reference: 1,
      exchanges: [
        { scene: 0, header: true, words: 4, sources: true },
        { scene: 1, header: true, words: 2, sources: true },
      ],
    })
    expect(final?.hold).toBe(DEFAULT_DEMO_TIMING.finalHold)
  })

  it('começa vazio e termina limpando a conversa, para o loop recomeçar do zero', () => {
    expect(steps[0]?.frame).toEqual({
      phase: DemoPhase.Idle,
      typed: 0,
      reference: null,
      exchanges: [],
    })
    const last = steps.at(-1)
    expect(last?.frame.phase).toBe(DemoPhase.Clearing)
    expect(last?.frame.exchanges).toHaveLength(2)
  })

  it('a pergunta repetida vai mais rápido e a volta inteira cabe em menos de 40 s', () => {
    const typing = steps.filter((step) => step.frame.phase === DemoPhase.Typing)
    const length = questionChars(QUESTION).length
    // A primeira letra de cada cena: 'O' na velocidade da cena.
    expect(typing[0]?.hold).toBe(DEFAULT_DEMO_TIMING.typeChar)
    expect(typing[length]?.hold).toBe(DEFAULT_DEMO_TIMING.retypeChar)
    expect(typing[length - 1]?.hold).toBe(DEFAULT_DEMO_TIMING.beforeChoosing)
    expect(loopDuration(steps)).toBeLessThan(40_000)
  })

  it('aceita outro relógio', () => {
    const fast = buildDemoSteps(SCRIPT, { ...DEFAULT_DEMO_TIMING, word: 1, finalHold: 2 })
    expect(fast[finalStepIndex(fast)]?.hold).toBe(2)
  })
})

describe('helpers do roteiro', () => {
  it('charDelay alonga o espaço e a pontuação', () => {
    expect(charDelay('a', 50)).toBe(50)
    expect(charDelay(' ', 50)).toBe(80)
    expect(charDelay('?', 50)).toBe(150)
    expect(charDelay(',', 50)).toBe(150)
  })

  it('answerWords separa por espaços e ignora os repetidos', () => {
    expect(answerWords(' Em 05/2008  valia\na redação ')).toEqual([
      'Em',
      '05/2008',
      'valia',
      'a',
      'redação',
    ])
  })

  it('finalStepIndex é o penúltimo passo e não fica negativo', () => {
    expect(finalStepIndex([])).toBe(0)
    expect(finalStepIndex(buildDemoSteps(SCRIPT))).toBe(buildDemoSteps(SCRIPT).length - 2)
  })
})

describe('scalePosition', () => {
  const scale = { from: '2000-01-01', to: '2000-01-11' }

  it('mede em dias de calendário, presa às pontas', () => {
    expect(scalePosition('2000-01-01', scale)).toBe(0)
    expect(scalePosition('2000-01-06', scale)).toBe(50)
    expect(scalePosition('2000-01-11', scale)).toBe(100)
    expect(scalePosition('1999-01-01', scale)).toBe(0)
    expect(scalePosition('2001-01-01', scale)).toBe(100)
  })

  it('escala vazia fica no zero', () => {
    expect(scalePosition('2000-01-05', { from: '2000-01-01', to: '2000-01-01' })).toBe(0)
  })

  it('as datas do caso ficam dentro da escala do hero, em ordem', () => {
    const positions = [
      ...DEMO_MILESTONES.map((milestone) => milestone.date),
      ...DEMO_SCENES.map((scene) => scene.referenceDate),
    ].map((date) => scalePosition(date, DEMO_SCALE))
    for (const position of positions) {
      expect(position).toBeGreaterThan(0)
      expect(position).toBeLessThan(100)
    }
  })
})

interface FixtureVersion {
  readonly validDuring: { readonly from: string; readonly to: string | null }
  readonly text: string
}

describe('o caso da demonstração', () => {
  const path = fileURLToPath(
    new URL('../../../../api/test/fixtures/corpus/documents/rcte.json', import.meta.url),
  )
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as {
    provisions: { stableKey: string; versions: FixtureVersion[] }[]
  }
  const provision = fixture.provisions.find((entry) => entry.stableKey === DEMO_PROVISION_KEY)
  const versions = provision?.versions ?? []

  function versionAt(date: string): FixtureVersion | undefined {
    return versions.find(
      ({ validDuring }) =>
        validDuring.from <= date && (validDuring.to === null || date < validDuring.to),
    )
  }

  it('cada cena cita a redação que a fixture do corpus dá como vigente na data', () => {
    for (const scene of DEMO_SCENES) {
      expect(versionAt(scene.referenceDate)?.validDuring).toEqual(scene.validity)
    }
    expect(versionAt(DEMO_SCENES[0].referenceDate)?.text).toContain('40.000,00')
    expect(versionAt(DEMO_SCENES[1].referenceDate)?.text).toBe('§ 6º Revogado.')
  })

  it('os marcos da linha do tempo são os inícios das redações', () => {
    expect(DEMO_MILESTONES.map((milestone) => milestone.date)).toEqual(
      versions.map((version) => version.validDuring.from),
    )
  })
})
