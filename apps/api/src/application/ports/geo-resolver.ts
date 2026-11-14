import type { RequestHeaders } from './client-ip.ts'

/**
 * País da requisição informado pela plataforma (ISO 3166-1 alpha-2), para a política regional de
 * provedores. Na Vercel, a `geolocation()` lê o header de país que a borda grava; fora dela não há
 * fonte confiável (`null`), e vale só o país declarado no onboarding. Nunca serve para
 * autorização.
 */
export interface GeoResolver {
  countryOf(headers: RequestHeaders): string | null
}
