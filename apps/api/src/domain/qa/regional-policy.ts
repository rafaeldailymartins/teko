/**
 * Política regional de provedores (`docs/architecture/README.md`, restrições): o Gemini free usa
 * os prompts para treino, então quem está no Espaço Econômico Europeu, no Reino Unido ou na Suíça
 * só é atendido pelo Groq com retenção zero (ZDR). A origem é o país declarado no onboarding **ou**
 * o país da requisição informado pela plataforma (geolocalização da Vercel); qualquer um dos dois
 * no grupo basta.
 */

/** UE (27), Islândia, Liechtenstein e Noruega (EEE), Reino Unido e Suíça; ISO 3166-1 alpha-2. */
export const ZERO_RETENTION_COUNTRIES: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'GB',
  'CH',
])

export function requiresZeroRetention(
  declaredCountry: string | null,
  requestCountry: string | null,
): boolean {
  return [declaredCountry, requestCountry].some(
    (country) => country !== null && ZERO_RETENTION_COUNTRIES.has(country.toUpperCase()),
  )
}
