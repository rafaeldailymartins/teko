import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'htmlparser2'

/**
 * Comparador explícito para `sort`: ordem de unidade de código UTF-16 (a mesma do `sort()` sem
 * argumento), independente de locale, para o manifesto e os hashes saírem iguais em toda máquina.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

/**
 * Leitura do export estático (`apps/web/out`) para os passos de pós-build: a árvore de arquivos e,
 * de cada HTML, o conteúdo dos `<script>` e `<style>` inline (que entram na CSP por hash) e os
 * scripts externos que a página carrega no primeiro acesso (que entram no orçamento de bundle).
 */

/** Tipos de `<script>` que o navegador executa e que a diretiva `script-src` controla. */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'importmap',
  'speculationrules',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
])

export interface ParsedDocument {
  /** Conteúdo dos `<script>` inline executáveis, na ordem do documento. */
  readonly inlineScripts: readonly string[]
  /** Conteúdo dos `<style>` inline, na ordem do documento. */
  readonly inlineStyles: readonly string[]
  /**
   * Scripts externos do primeiro acesso: `<script src>` sem `nomodule` (o polyfill que navegador
   * moderno não baixa) e `<link rel="preload|modulepreload">` de script.
   */
  readonly firstLoadScripts: readonly string[]
}

/** O navegador normaliza CRLF e CR para LF antes de calcular o hash do conteúdo inline. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function isPreloadedScript(attributes: Readonly<Record<string, string>>): boolean {
  const rel = (attributes['rel'] ?? '').toLowerCase().split(/\s+/)
  if (rel.includes('modulepreload')) {
    return true
  }
  return rel.includes('preload') && (attributes['as'] ?? '').toLowerCase() === 'script'
}

/**
 * Extrai o que a CSP e o orçamento precisam de um HTML. O conteúdo de `<script>` e `<style>` é texto
 * cru no HTML (sem entidades), então o parser roda com `decodeEntities: false`: o hash sai dos
 * mesmos bytes que o navegador vê.
 */
export function parseDocument(html: string): ParsedDocument {
  const inlineScripts: string[] = []
  const inlineStyles: string[] = []
  const firstLoadScripts: string[] = []
  let capture: 'script' | 'style' | null = null
  let buffer = ''
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'script') {
          const type = (attributes['type'] ?? '').trim().toLowerCase()
          if (attributes['src'] !== undefined) {
            if (attributes['nomodule'] === undefined) {
              firstLoadScripts.push(attributes['src'])
            }
          } else if (EXECUTABLE_SCRIPT_TYPES.has(type)) {
            capture = 'script'
            buffer = ''
          }
        } else if (name === 'style') {
          capture = 'style'
          buffer = ''
        } else if (name === 'link' && attributes['href'] !== undefined) {
          if (isPreloadedScript(attributes)) {
            firstLoadScripts.push(attributes['href'])
          }
        }
      },
      ontext(text) {
        if (capture !== null) {
          buffer += text
        }
      },
      onclosetag(name) {
        if (capture !== null && name === capture) {
          const target = capture === 'script' ? inlineScripts : inlineStyles
          target.push(normalizeNewlines(buffer))
          capture = null
        }
      },
    },
    { decodeEntities: false },
  )
  parser.write(html)
  parser.end()
  return { inlineScripts, inlineStyles, firstLoadScripts }
}

/**
 * Todos os arquivos da árvore, com caminhos relativos em `/` e em ordem estável. Link simbólico
 * derruba a leitura: o export do Next não gera nenhum.
 */
export function listFiles(root: string, relative = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(root, relative)).sort(compareCodeUnits)) {
    const path = relative === '' ? name : `${relative}/${name}`
    const stat = lstatSync(join(root, path))
    if (stat.isSymbolicLink()) {
      throw new Error(`link simbólico no export estático: ${path}`)
    }
    if (stat.isDirectory()) {
      files.push(...listFiles(root, path))
    } else {
      files.push(path)
    }
  }
  return files
}

/** Os HTML do export, já lidos, por caminho relativo. */
export function readDocuments(outDir: string): Map<string, ParsedDocument> {
  const documents = new Map<string, ParsedDocument>()
  for (const file of listFiles(outDir)) {
    if (file.endsWith('.html')) {
      documents.set(file, parseDocument(readFileSync(join(outDir, file), 'utf8')))
    }
  }
  return documents
}
