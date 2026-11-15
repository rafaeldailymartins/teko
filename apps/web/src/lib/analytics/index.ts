import { publicEnv } from '@/lib/env'
import { createAnalytics } from './adapter.ts'
import { loadAnalyticsClient } from './client-loader.ts'

/** Instância única do app, ligada pela camada de consentimento (`ConsentProvider`). */
export const analytics = createAnalytics({ key: publicEnv.posthogKey, load: loadAnalyticsClient })
