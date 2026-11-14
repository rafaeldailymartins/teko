/**
 * Instante da próxima meia-noite num fuso (ex.: `America/Los_Angeles`, onde o Gemini free renova a
 * cota diária). Calculado pelo deslocamento do fuso no próprio instante da meia-noite, o que acerta
 * os dias de mudança de horário de verão.
 */
const PARTS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const

function offsetMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(instantMs))
  const value = (type: (typeof PARTS)[number]): number =>
    Number(parts.filter((part) => part.type === type).map((part) => part.value)[0])
  const local = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  )
  return local - Math.floor(instantMs / 1000) * 1000
}

export function nextMidnightMs(nowMs: number, timeZone: string): number {
  const shifted = new Date(nowMs + offsetMs(nowMs, timeZone))
  const localMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  )
  const guess = localMidnight - offsetMs(localMidnight, timeZone)
  return localMidnight - offsetMs(guess, timeZone)
}
