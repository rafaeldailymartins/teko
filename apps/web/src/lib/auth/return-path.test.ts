import { describe, expect, it } from 'vitest'
import {
  currentReturnPath,
  defaultReturnPath,
  regionRestrictedPath,
  SignInError,
  safeReturnPath,
  signInErrorOf,
  signInPath,
} from './return-path.ts'

describe('safeReturnPath', () => {
  it.each([
    '/pt-BR/chat/',
    '/pt-BR/chat/?q=0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b&c=abc&ref=2024-03',
    '/en/history/#ultima',
    '/en/settings/',
  ])('aceita o caminho da própria origem %s', (path) => {
    expect(safeReturnPath(path, 'pt-BR')).toBe(path)
  })

  it.each([
    ['URL absoluta', 'https://evil.example/pt-BR/chat/'],
    ['protocolo relativo', '//evil.example/pt-BR/chat/'],
    ['barra invertida', '/\\evil.example'],
    ['barra invertida no meio', '/pt-BR\\..\\chat'],
    ['javascript:', 'javascript:alert(1)'],
    ['sem barra inicial', 'pt-BR/chat/'],
    ['separador codificado', '/%2F%2Fevil.example'],
    ['barra invertida codificada', '/pt-BR/%5Cevil'],
    ['caractere de controle', '/pt-BR/chat/\n'],
    ['tab que vira //', '/\t/evil.example'],
    ['DEL', '/pt-BR/\u007f'],
    ['controle C1', '/pt-BR/\u0085'],
    ['rota da API', '/api/v1/me'],
    ['a própria entrada (laço)', '/pt-BR/sign-in/?callbackURL=/pt-BR/chat/'],
    ['entrada sem barra final', '/en/sign-in'],
    ['vazio', ''],
    ['longo demais', `/pt-BR/chat/?q=${'a'.repeat(1100)}`],
  ])('recusa %s e volta ao chat do idioma', (_label, path) => {
    expect(safeReturnPath(path, 'pt-BR')).toBe('/pt-BR/chat/')
  })

  it('sem valor, vai para o chat do idioma atual', () => {
    expect(safeReturnPath(null, 'en')).toBe('/en/chat/')
    expect(safeReturnPath(undefined, 'pt-BR')).toBe(defaultReturnPath('pt-BR'))
  })
})

describe('signInPath', () => {
  it('leva o retorno saneado na query', () => {
    expect(signInPath('pt-BR', '/pt-BR/history/?c=1')).toBe(
      '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F%3Fc%3D1',
    )
    expect(signInPath('en', 'https://evil.example')).toBe(
      '/en/sign-in/?callbackURL=%2Fen%2Fchat%2F',
    )
  })

  it('sem retorno, só a página de entrada', () => {
    expect(signInPath('en')).toBe('/en/sign-in/')
  })
})

describe('currentReturnPath', () => {
  it('junta o caminho e a query da página atual', () => {
    expect(currentReturnPath({ pathname: '/pt-BR/chat/', search: '?q=1' })).toBe('/pt-BR/chat/?q=1')
  })
})

describe('regionRestrictedPath', () => {
  it('é a entrada com o código da API no ?error=', () => {
    expect(regionRestrictedPath('pt-BR')).toBe('/pt-BR/sign-in/?error=region_restricted')
    expect(signInErrorOf('region_restricted')).toBe(SignInError.RegionRestricted)
  })
})

describe('signInErrorOf', () => {
  it.each([
    ['access_denied', SignInError.Cancelled],
    ['banned', SignInError.Blocked],
    ['account_blocked', SignInError.Blocked],
    ['account_not_linked', SignInError.AccountNotLinked],
    ['account_already_linked_to_different_user', SignInError.AccountNotLinked],
    ['email_not_found', SignInError.EmailMissing],
    ['state_mismatch', SignInError.Generic],
    ['constructor', SignInError.Generic],
  ])('%s vira %s', (code, expected) => {
    expect(signInErrorOf(code)).toBe(expected)
  })

  it('sem código, sem erro', () => {
    expect(signInErrorOf(null)).toBeNull()
    expect(signInErrorOf('')).toBeNull()
  })
})
