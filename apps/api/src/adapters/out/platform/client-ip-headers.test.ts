import { describe, expect, it } from 'vitest'
import type { ClientIpInput } from '#app/ports/client-ip.ts'
import {
  NETLIFY_CLIENT_IP_HEADER,
  NO_CLIENT_IP,
  proxiedClientIp,
  singleIpHeader,
} from './client-ip-headers.ts'

describe('singleIpHeader', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 2001:db8::1 ', '2001:db8::1'],
    ['203.0.113.7, 10.0.0.1', null],
    ['not-an-ip', null],
    ['', null],
    [undefined, null],
    [['203.0.113.7', '203.0.113.8'], null],
  ])('%j → %j', (value, expected) => {
    expect(singleIpHeader({ 'x-real-ip': value }, 'x-real-ip')).toBe(expected)
  })
})

describe('proxiedClientIp', () => {
  const input = (signatureValid: boolean, ip: string | undefined): ClientIpInput => ({
    path: 'proxied',
    signatureValid,
    headers: { [NETLIFY_CLIENT_IP_HEADER]: ip },
    forwardedIp: '198.51.100.1',
  })

  it('usa o header da Netlify só com assinatura válida e confiança comprovada', () => {
    expect(proxiedClientIp(input(true, '203.0.113.7'), true)).toEqual({
      ip: '203.0.113.7',
      source: 'netlify_proxy',
    })
  })

  it.each([
    [false, '203.0.113.7', true],
    [true, '203.0.113.7', false],
    [true, undefined, true],
    [true, 'lixo', true],
  ])(
    'sem as três condições, nenhum IP (assinatura=%s, header=%j, confiança=%s)',
    (sig, ip, trust) => {
      expect(proxiedClientIp(input(sig, ip), trust)).toEqual(NO_CLIENT_IP)
    },
  )
})
