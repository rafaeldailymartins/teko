import type {
  CorpusIngestionRepository,
  DocumentHealth,
  ReviewQueueCount,
} from '../ports/corpus-ingestion-repository.ts'

/**
 * Leituras do estado do corpus para o relatório do `load`: o estado publicado por documento (gate
 * de saúde) e a fila de revisão aberta por família e motivo (o que ficou `pending`, fora da busca de
 * produção, não some sem aviso).
 */
export interface InspectCorpus {
  documentHealth(): Promise<DocumentHealth[]>
  openReviewQueue(): Promise<ReviewQueueCount[]>
}

export function createInspectCorpus(deps: {
  readonly repository: CorpusIngestionRepository
}): InspectCorpus {
  return {
    documentHealth: () => deps.repository.documentHealth(),
    openReviewQueue: () => deps.repository.openReviewQueue(),
  }
}
