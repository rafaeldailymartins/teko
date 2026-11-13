/** Invariante do corpus violada no banco (pai ausente, chunk publicável sem fonte publicada...). */
export class CorpusInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorpusInvariantError'
  }
}
