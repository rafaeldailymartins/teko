import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACCEPT_LANGUAGE_EN,
  rootRedirectFor,
} from '../apps/api/src/adapters/in/http/static-site/policy.ts'
import {
  rootLocaleFor,
  ACCEPT_LANGUAGE_EN as WEB_ACCEPT_LANGUAGE_EN,
} from '../apps/web/src/lib/i18n/root-locale.ts'

/**
 * A raiz `/` escolhe o idioma pela mesma regra em todo lugar: nas rotas de produção (Vercel, Caddy
 * e Plano B, a partir do `policy.ts` da API) e no `next dev` (`apps/web/src/lib/i18n/root-locale.ts`,
 * que o web não pode importar da API). Este teste (`pnpm test:scripts`) prende as duas cópias.
 */
describe('idioma da raiz', () => {
  it('a expressão do web é a mesma do policy.ts', () => {
    assert.equal(WEB_ACCEPT_LANGUAGE_EN, ACCEPT_LANGUAGE_EN)
  })

  it('o web escolhe o mesmo destino que as rotas de produção', () => {
    for (const header of [
      'en-US,en;q=0.9',
      'en',
      'pt-BR,pt;q=0.9,en;q=0.8',
      'es,en;q=0.5',
      '',
      undefined,
    ]) {
      assert.equal(`/${rootLocaleFor(header)}/`, rootRedirectFor(header), String(header))
    }
  })
})
