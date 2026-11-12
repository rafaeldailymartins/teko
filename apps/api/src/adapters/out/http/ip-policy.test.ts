import { describe, expect, it } from 'vitest'
import { isBlockedAddress, parseIpv4, parseIpv6 } from './ip-policy.ts'

describe('parseIpv4 e parseIpv6', () => {
  it('converte e recusa formas inválidas', () => {
    expect(parseIpv4('10.0.0.1')).toBe(0x0a000001n)
    expect(parseIpv4('256.0.0.1')).toBeNull()
    expect(parseIpv4('1.2.3')).toBeNull()
    expect(parseIpv4('a.b.c.d')).toBeNull()
    expect(parseIpv6('::1')).toBe(1n)
    expect(parseIpv6('2001:db8::1')).toBe(0x20010db8000000000000000000000001n)
    expect(parseIpv6('::ffff:127.0.0.1')).toBe(0xffff7f000001n)
    expect(parseIpv6('fe80::1%eth0')).toBe(0xfe800000000000000000000000000001n)
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toBe(0x00010002000300040005000600070008n)
    expect(parseIpv6('1::2::3')).toBeNull()
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIpv6('1:2:3')).toBeNull()
    expect(parseIpv6('::gggg')).toBeNull()
    expect(parseIpv6('::ffff:300.0.0.1')).toBeNull()
    expect(parseIpv6('1:2:3:4:5:6:7::8')).toBeNull()
  })
})

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    '2001:db8::1',
    'fec0::1',
    '100::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::10.0.0.1',
    '2002:c0a8:0101::1',
    'não é ip',
    '',
  ])('bloqueia %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    '161.148.164.31',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2804:214:8000::1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::8.8.8.8',
    '2002:0808:0808::1',
  ])('permite %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })
})
