/**
 * Diff por palavra entre duas redações (rota `/api/v1/provisions/:stableKey/diff`), pelo algoritmo
 * de Myers (O((N+M)·D)). Os espaços ficam grudados na palavra seguinte, então concatenar os
 * segmentos `equal` + `delete` devolve o texto antigo, e `equal` + `insert`, o novo.
 *
 * Antes do Myers, o prefixo e o sufixo comuns saem do problema (o caso típico é uma redação que
 * troca poucas palavras). Se a distância passar de `maxEdits`, o resultado degrada para "apaga
 * tudo, insere tudo" no miolo: a UI continua mostrando as duas redações, sem custo quadrático.
 */
type WordDiffOp = 'equal' | 'insert' | 'delete'

export interface WordDiffSegment {
  readonly op: WordDiffOp
  readonly text: string
}

/** Teto padrão de edições do Myers (memória O(D²) no histórico das diagonais). */
const DEFAULT_MAX_EDITS = 1500

const WHITESPACE = /\s/

function isSpace(text: string, index: number): boolean {
  return WHITESPACE.test(text.charAt(index))
}

/**
 * Palavras com o espaço que as precede: `"a  b"` → `["a", "  b"]`; espaço no fim vira um token
 * próprio. Varredura linear (uma regex com alternativa sobre `\s+` faria backtracking quadrático
 * em textos com muito espaço).
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let start = 0
  let index = 0
  while (index < text.length) {
    while (index < text.length && isSpace(text, index)) {
      index += 1
    }
    while (index < text.length && !isSpace(text, index)) {
      index += 1
    }
    tokens.push(text.slice(start, index))
    start = index
  }
  return tokens
}

function push(segments: WordDiffSegment[], op: WordDiffOp, text: string): void {
  if (text === '') {
    return
  }
  const last = segments.at(-1)
  if (last?.op === op) {
    segments[segments.length - 1] = { op, text: last.text + text }
    return
  }
  segments.push({ op, text })
}

/** Leitura de uma diagonal; os índices ficam sempre dentro do vetor (offset = max + 1). */
function at(v: Int32Array, index: number): number {
  return v[index] as number
}

/** Caminho de Myers sobre `a` e `b`; `null` se a distância passar de `maxEdits`. */
function myers(a: readonly string[], b: readonly string[], maxEdits: number): WordDiffOp[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxEdits)
  const offset = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice())
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && at(v, offset + k - 1) < at(v, offset + k + 1))
      let x = down ? at(v, offset + k + 1) : at(v, offset + k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(next)
        return backtrack(trace, offset, n, m)
      }
    }
    v = next
  }
  return null
}

function backtrack(
  trace: readonly Int32Array[],
  offset: number,
  n: number,
  m: number,
): WordDiffOp[] {
  const ops: WordDiffOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 2; d >= 0; d -= 1) {
    const v = trace[d] as Int32Array
    const k = x - y
    const down = k === -d || (k !== d && at(v, offset + k - 1) < at(v, offset + k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = at(v, offset + prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('equal')
      x -= 1
      y -= 1
    }
    if (d > 0) {
      ops.push(down ? 'insert' : 'delete')
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

export function wordDiff(
  before: string,
  after: string,
  maxEdits: number = DEFAULT_MAX_EDITS,
): WordDiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const segments: WordDiffSegment[] = []
  push(segments, 'equal', a.slice(0, start).join(''))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops = myers(midA, midB, maxEdits)
  if (ops === null) {
    push(segments, 'delete', midA.join(''))
    push(segments, 'insert', midB.join(''))
  } else {
    let i = 0
    let j = 0
    for (const op of ops) {
      if (op === 'equal') {
        push(segments, 'equal', midA[i] as string)
        i += 1
        j += 1
      } else if (op === 'delete') {
        push(segments, 'delete', midA[i] as string)
        i += 1
      } else {
        push(segments, 'insert', midB[j] as string)
        j += 1
      }
    }
  }
  push(segments, 'equal', a.slice(endA).join(''))
  return segments
}
