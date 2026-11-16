/**
 * Roteiro da demonstração animada da landing, como uma lista de quadros pré-calculada: cada passo é
 * um quadro (o que a janela de chat mostra) e quanto tempo ele fica na tela antes do próximo. A
 * sequência, por cena (uma data de referência):
 *
 * 1. o usuário digita a pergunta, caractere a caractere;
 * 2. o chip da data de referência aparece (ou troca, na segunda cena);
 * 3. a pergunta vai para a conversa e a resposta "pensa";
 * 4. chega o cabeçalho (data e vigência) e o texto vem em stream, palavra a palavra;
 * 5. as fontes aparecem, com o chip numerado e o intervalo de vigência.
 *
 * Depois da última cena, a conversa sobe e sai, e o roteiro recomeça. O quadro final (a última
 * resposta completa) é também o do HTML estático e o do movimento reduzido.
 */

export const DemoPhase = {
  /** Compositor vazio, antes de digitar. */
  Idle: 'idle',
  Typing: 'typing',
  /** Pergunta digitada; o chip da data aparece ou troca. */
  Choosing: 'choosing',
  /** Pergunta enviada, resposta ainda sem texto. */
  Thinking: 'thinking',
  Streaming: 'streaming',
  Answered: 'answered',
  /** A conversa sobe e sai antes do recomeço. */
  Clearing: 'clearing',
} as const
export type DemoPhase = (typeof DemoPhase)[keyof typeof DemoPhase]

/** Uma troca (pergunta e resposta) já enviada para a conversa. */
export interface DemoExchange {
  /** Cena (data de referência) da troca. */
  readonly scene: number
  /** Cabeçalho da resposta (data e vigência) visível. */
  readonly header: boolean
  /** Palavras da resposta já recebidas. */
  readonly words: number
  /** Resposta completa, com a linha de fontes. */
  readonly sources: boolean
}

export interface DemoFrame {
  readonly phase: DemoPhase
  /** Caracteres da pergunta já digitados no compositor. */
  readonly typed: number
  /** Cena cuja data está no chip do compositor (`null`: nenhuma data escolhida ainda). */
  readonly reference: number | null
  readonly exchanges: readonly DemoExchange[]
}

export interface DemoStep {
  readonly frame: DemoFrame
  /** Milissegundos do quadro na tela antes do próximo. */
  readonly hold: number
}

export interface DemoScript {
  /** A pergunta (a mesma nas duas cenas). */
  readonly question: string
  /** Número de palavras da resposta de cada cena, na ordem das cenas. */
  readonly answerWords: readonly number[]
}

export interface DemoTiming {
  /** Antes de começar a digitar. */
  readonly idle: number
  /** Por caractere, na primeira cena e nas seguintes (a pergunta repetida vai mais rápido). */
  readonly typeChar: number
  readonly retypeChar: number
  /** Pausa depois de digitar e antes do chip da data. */
  readonly beforeChoosing: number
  /** Com o chip na tela, antes de enviar. */
  readonly choosing: number
  readonly thinking: number
  /** Com o cabeçalho na tela, antes da primeira palavra. */
  readonly header: number
  readonly word: number
  /** Resposta completa entre uma cena e outra, e na última. */
  readonly sceneHold: number
  readonly finalHold: number
  readonly clearing: number
}

export const DEFAULT_DEMO_TIMING: DemoTiming = {
  idle: 700,
  typeChar: 55,
  retypeChar: 30,
  beforeChoosing: 450,
  choosing: 900,
  thinking: 900,
  header: 350,
  word: 70,
  sceneHold: 2600,
  finalHold: 5200,
  clearing: 650,
}

/** Pausas naturais da digitação: um pouco mais no espaço e na pontuação. */
export function charDelay(char: string, base: number): number {
  if (char === ' ') return Math.round(base * 1.6)
  if (/[,.;:?!]/.test(char)) return base * 3
  return base
}

/** Os caracteres da pergunta como o usuário os digita (pontos de código, não unidades UTF-16). */
export function questionChars(question: string): readonly string[] {
  return Array.from(question)
}

/** Palavras de uma resposta, na ordem do stream (espaços simples; o texto já vem normalizado). */
export function answerWords(answer: string): readonly string[] {
  return answer.split(/\s+/).filter((word) => word !== '')
}

/** O roteiro a partir dos textos: a pergunta e as respostas de cada cena, na ordem. */
export function demoScript(question: string, answers: readonly string[]): DemoScript {
  return { question, answerWords: answers.map((answer) => answerWords(answer).length) }
}

/** Monta os passos do roteiro. O primeiro é o compositor vazio; o penúltimo, o quadro final. */
export function buildDemoSteps(
  script: DemoScript,
  timing: DemoTiming = DEFAULT_DEMO_TIMING,
): readonly DemoStep[] {
  const chars = questionChars(script.question)
  const steps: DemoStep[] = []
  let exchanges: readonly DemoExchange[] = []
  let reference: number | null = null
  const push = (frame: Omit<DemoFrame, 'exchanges' | 'reference'>, hold: number) => {
    steps.push({ frame: { ...frame, reference, exchanges }, hold })
  }
  const answer = (scene: number, patch: Partial<DemoExchange>) => {
    exchanges = exchanges.map((exchange) =>
      exchange.scene === scene ? { ...exchange, ...patch } : exchange,
    )
  }

  push({ phase: DemoPhase.Idle, typed: 0 }, timing.idle)
  script.answerWords.forEach((words, scene) => {
    const base = scene === 0 ? timing.typeChar : timing.retypeChar
    chars.forEach((char, index) => {
      const last = index === chars.length - 1
      push(
        { phase: DemoPhase.Typing, typed: index + 1 },
        last ? timing.beforeChoosing : charDelay(char, base),
      )
    })
    reference = scene
    push({ phase: DemoPhase.Choosing, typed: chars.length }, timing.choosing)
    exchanges = [...exchanges, { scene, header: false, words: 0, sources: false }]
    push({ phase: DemoPhase.Thinking, typed: 0 }, timing.thinking)
    answer(scene, { header: true })
    push({ phase: DemoPhase.Streaming, typed: 0 }, timing.header)
    for (let word = 1; word <= words; word += 1) {
      answer(scene, { words: word })
      push({ phase: DemoPhase.Streaming, typed: 0 }, timing.word)
    }
    answer(scene, { sources: true })
    const lastScene = scene === script.answerWords.length - 1
    push({ phase: DemoPhase.Answered, typed: 0 }, lastScene ? timing.finalHold : timing.sceneHold)
  })
  push({ phase: DemoPhase.Clearing, typed: 0 }, timing.clearing)
  return steps
}

/** Índice do quadro final (a última resposta completa): o do HTML estático e do movimento reduzido. */
export function finalStepIndex(steps: readonly DemoStep[]): number {
  return Math.max(0, steps.length - 2)
}

/** Duração de uma volta inteira do roteiro, em milissegundos. */
export function loopDuration(steps: readonly DemoStep[]): number {
  return steps.reduce((total, step) => total + step.hold, 0)
}
