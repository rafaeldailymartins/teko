/**
 * Países para o "país de residência" do onboarding (ISO 3166-1 alpha-2, os 249 códigos atribuídos).
 * Os nomes saem do `Intl.DisplayNames` do navegador, no idioma da interface: nenhuma tabela de
 * nomes entra no bundle.
 */
const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
  'BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW ' +
  'GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY ' +
  'KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV ' +
  'MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
  'QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG ' +
  'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

/** País sugerido quando o usuário ainda não informou nenhum. */
export const DEFAULT_COUNTRY = 'BR'

export interface CountryOption {
  readonly code: string
  readonly name: string
}

/** Opções do seletor, com o nome no idioma da interface e em ordem alfabética desse idioma. */
export function countryOptions(locale: string): CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' })
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  )
}

/** Texto comparável: sem acento, sem diferença de caixa e sem espaço nas pontas. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').trim()
}

/**
 * Países que casam com a busca, sem acento nem caixa ("sao" acha "São Tomé"), pelo nome ou pelo
 * código: primeiro o código exato e os nomes que começam pelo texto, depois os que o contêm, cada
 * grupo na ordem alfabética de `options`. Busca vazia devolve tudo.
 */
export function searchCountries(options: readonly CountryOption[], query: string): CountryOption[] {
  const needle = fold(query)
  if (needle === '') {
    return [...options]
  }
  const first: CountryOption[] = []
  const rest: CountryOption[] = []
  for (const option of options) {
    const name = fold(option.name)
    if (option.code.toLowerCase() === needle || name.startsWith(needle)) {
      first.push(option)
    } else if (name.includes(needle)) {
      rest.push(option)
    }
  }
  return [...first, ...rest]
}

/** Se o código é um dos países do seletor (o que vem da API pode ser de uma versão anterior). */
export function isCountryCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && COUNTRY_CODES.includes(value)
}
