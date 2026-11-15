import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listFiles, parseDocument, readDocuments } from './html.ts'

describe('parseDocument', () => {
  it('separa scripts e estilos inline dos externos, na ordem do documento', () => {
    const document = parseDocument(
      [
        '<!DOCTYPE html><html><head>',
        '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>',
        '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/p.js"/>',
        '<link rel="modulepreload" href="/_next/static/chunks/m.js"/>',
        '<link rel="preload" as="font" href="/_next/static/media/f.woff2"/>',
        '<script src="/_next/static/chunks/a.js" async=""></script>',
        '<script src="/_next/static/chunks/polyfill.js" noModule=""></script>',
        '<style>body{color:red}</style>',
        '</head><body><script>self.a=1</script><script id="_R_">self.b=2</script>',
        '<script type="application/ld+json">{"@type":"WebSite"}</script>',
        '<script type="module">import "/x.js"</script>',
        '</body></html>',
      ].join(''),
    )
    expect(document.inlineScripts).toEqual(['self.a=1', 'self.b=2', 'import "/x.js"'])
    expect(document.inlineStyles).toEqual(['body{color:red}'])
    expect(document.firstLoadScripts).toEqual([
      '/_next/static/chunks/p.js',
      '/_next/static/chunks/m.js',
      '/_next/static/chunks/a.js',
    ])
  })

  it('mantém o texto cru do script (entidades e "<" não são decodificados) e normaliza CRLF', () => {
    const document = parseDocument('<script>if (a &amp;&amp; b < c) {\r\n x()\r}</script>')
    expect(document.inlineScripts).toEqual(['if (a &amp;&amp; b < c) {\n x()\n}'])
  })

  it('script vazio também entra (o navegador cobra o hash da string vazia)', () => {
    expect(parseDocument('<script></script>').inlineScripts).toEqual([''])
  })
})

describe('árvore do export', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'teko-web-html-'))
    mkdirSync(join(dir, 'en', '404'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<script>a()</script>')
    writeFileSync(join(dir, 'en', '404', 'index.html'), '<style>p{}</style>')
    writeFileSync(join(dir, 'en', 'index.txt'), 'rsc')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lista os arquivos com caminhos em / e lê só os HTML', () => {
    expect(listFiles(dir)).toEqual(['en/404/index.html', 'en/index.txt', 'index.html'])
    const documents = readDocuments(dir)
    expect([...documents.keys()]).toEqual(['en/404/index.html', 'index.html'])
    expect(documents.get('index.html')?.inlineScripts).toEqual(['a()'])
  })

  it('recusa link simbólico', (context) => {
    try {
      symlinkSync(join(dir, 'en'), join(dir, 'link'), 'junction')
    } catch {
      context.skip()
    }
    expect(() => listFiles(dir)).toThrow(/link simbólico no export estático: link/)
  })
})
