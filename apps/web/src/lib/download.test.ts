// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadJson } from './download.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('downloadJson', () => {
  it('baixa o JSON por um link temporário com blob e libera a URL depois', async () => {
    vi.useFakeTimers()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:teko/1')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks: { href: string; download: string; attached: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download, attached: this.isConnected })
    })

    downloadJson('teko-meus-dados.json', { user: { name: 'Ana' } })

    expect(clicks).toEqual([
      { href: 'blob:teko/1', download: 'teko-meus-dados.json', attached: true },
    ])
    expect(document.querySelector('a[download]')).toBeNull()
    const blob = created.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as Blob).type).toBe('application/json')
    expect(JSON.parse(await (blob as Blob).text())).toEqual({ user: { name: 'Ana' } })
    expect(revoked).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoked).toHaveBeenCalledWith('blob:teko/1')
  })
})
