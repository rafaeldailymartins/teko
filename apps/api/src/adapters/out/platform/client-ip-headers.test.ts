import { describe, expect, it } from 'vitest'
import { singleIpHeader } from './client-ip-headers.ts'

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
