import { describe, expect, it } from 'vitest'
import { MAIN_CONTENT_ID, PRODUCT_NAME, REPOSITORY_URL, SITE_ORIGIN } from './site.ts'

describe('configuração do site', () => {
  it('usa o nome com acento só na exibição', () => {
    expect(PRODUCT_NAME).toBe('Tekó')
  })

  it('SITE_ORIGIN é uma origem https sem caminho (base de metadataBase)', () => {
    const url = new URL(SITE_ORIGIN)
    expect(url.protocol).toBe('https:')
    expect(url.origin).toBe(SITE_ORIGIN)
  })

  it('REPOSITORY_URL aponta para o repositório público em https', () => {
    expect(new URL(REPOSITORY_URL).protocol).toBe('https:')
  })

  it('MAIN_CONTENT_ID é um id HTML válido para o skip link', () => {
    expect(MAIN_CONTENT_ID).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})
