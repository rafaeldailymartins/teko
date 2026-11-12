import { Parser as XmlParser } from 'htmlparser2'
import { Family, Modality, ValidityBasis } from '#domain/corpus/family.ts'
import type { ParsedProvision, ParsedSource, SkippedVersion } from '#domain/corpus/parsed-source.ts'
import { buildStableKey, isStableKey } from '#domain/corpus/provision-id.ts'
import { buildVersion, resolveDescribedVersion } from './docling/source-version.ts'
import { ParseError, type Parser } from './parser.ts'

/**
 * Parser dos leiautes da EFD-REINF a partir dos XSD do pacote de esquemas (um `.xsd` por evento,
 * `R-4020-evt4020PagtoBeneficiarioPJ-v2_01_02.xsd`), lidos com `htmlparser2` em `xmlMode`. Um
 * dispositivo por evento, por grupo e por campo, com as chaves e os títulos da fixture da F2:
 * `br:efd-reinf:evt:R-4020:grupo:infoPgto:campo:vlrBruto`, título
 * `EFD-Reinf > R-4020 - Pagamentos/créditos a beneficiário pessoa jurídica > infoPgto > vlrBruto`.
 *
 * A numeração (`sortPath` `R-4020.029`) é a do leiaute em PDF: `Reinf` = 1, o elemento do evento
 * = 2, o atributo `id` = 3 e, depois, os elementos em profundidade, cada atributo logo depois do
 * seu elemento. Os grupos aninhados ficam achatados sob o evento (chave e título só com o grupo
 * imediato), como na fixture; o atributo `id` do evento e a assinatura (`ds:Signature`) não viram
 * dispositivo.
 *
 * Diferença conhecida em relação à fixture (que veio do PDF de leiautes): o XSD só tem a
 * `xs:documentation` curta e sem acentos ("Valor bruto"), e não a descrição, as validações e o
 * tipo do PDF. O texto das redações é montado com as colunas do leiaute derivadas do XSD (pai,
 * elemento, tipo, ocorrência, tamanho, decimais), a documentação e os valores válidos; o
 * `content_hash` difere do da fixture, e as chaves, títulos e rótulos são os mesmos.
 */

const FAMILY_LABEL = 'EFD-Reinf'
const DISPLAY_PREFIX = 'Leiaute EFD-Reinf'
const MEMBER = /(?:^|\/)(R-\d{4})-(evt\w+?)-v[\w]+\.xsd$/i

/**
 * Títulos dos eventos como no leiaute em PDF (o XSD só tem a documentação sem acentos). R-2010,
 * R-4020 e R-4080 conferidos com a fixture; os demais, com o sumário dos Leiautes 2.1.2.
 */
const EVENT_TITLES: Readonly<Record<string, string>> = {
  'R-1000': 'Informações do contribuinte',
  'R-1050': 'Tabela de entidades ligadas',
  'R-1070': 'Tabela de processos administrativos/judiciais',
  'R-2010': 'Retenção de contribuição previdenciária - serviços tomados',
  'R-2020': 'Retenção de contribuição previdenciária - serviços prestados',
  'R-2030': 'Recursos recebidos por associação desportiva',
  'R-2040': 'Recursos repassados para associação desportiva',
  'R-2050': 'Comercialização da produção por produtor rural PJ/agroindústria',
  'R-2055': 'Aquisição de produção rural',
  'R-2060': 'Contribuição previdenciária sobre a receita bruta - CPRB',
  'R-2098': 'Reabertura dos eventos da série R-2000',
  'R-2099': 'Fechamento dos eventos da série R-2000',
  'R-3010': 'Receita de espetáculo desportivo',
  'R-4010': 'Pagamentos/créditos a beneficiário pessoa física',
  'R-4020': 'Pagamentos/créditos a beneficiário pessoa jurídica',
  'R-4040': 'Pagamentos/créditos a beneficiários não identificados',
  'R-4080': 'Retenção no recebimento',
  'R-4099': 'Fechamento/reabertura dos eventos da série R-4000',
  'R-9000': 'Exclusão de eventos',
}

interface XmlNode {
  readonly name: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: XmlNode[]
  text: string
}

function parseXml(xml: string, member: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const parser = new XmlParser(
    {
      onopentag(name, attrs) {
        const node: XmlNode = { name, attrs, children: [], text: '' }
        stack.at(-1)?.children.push(node)
        stack.push(node)
      },
      ontext(text) {
        const current = stack.at(-1)
        if (current !== undefined) {
          current.text += text
        }
      },
      onclosetag() {
        stack.pop()
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.end(xml)
  const schema = root.children.find((node) => node.name === 'xs:schema')
  if (schema === undefined) {
    throw new ParseError(`${member}: não é um XSD (sem xs:schema)`)
  }
  return schema
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  return node?.attrs[name]
}

function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name)
}

function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((child) => child.name === name)
}

function documentation(node: XmlNode): string {
  const doc = firstChild(firstChild(node, 'xs:annotation'), 'xs:documentation')
  return (doc?.text ?? '').replace(/\s+/g, ' ').trim()
}

/** Elementos e atributos filhos de um `complexType` (atravessando sequence/choice/all). */
function complexChildren(complexType: XmlNode): { elements: XmlNode[]; attributes: XmlNode[] } {
  const elements: XmlNode[] = []
  const attributes: XmlNode[] = []
  const walk = (node: XmlNode): void => {
    for (const child of node.children) {
      if (child.name === 'xs:element') {
        elements.push(child)
      } else if (child.name === 'xs:attribute') {
        attributes.push(child)
      } else if (['xs:sequence', 'xs:choice', 'xs:all'].includes(child.name)) {
        walk(child)
      }
    }
  }
  walk(complexType)
  return { elements, attributes }
}

interface SchemaTypes {
  readonly complex: ReadonlyMap<string, XmlNode>
  readonly simple: ReadonlyMap<string, XmlNode>
}

function globalTypes(schema: XmlNode): SchemaTypes {
  const named = (name: string) =>
    new Map(
      childrenNamed(schema, name)
        .filter((node) => attr(node, 'name') !== undefined)
        .map((node) => [attr(node, 'name') ?? '', node]),
    )
  return { complex: named('xs:complexType'), simple: named('xs:simpleType') }
}

function complexTypeOf(node: XmlNode, types: SchemaTypes): XmlNode | undefined {
  return firstChild(node, 'xs:complexType') ?? types.complex.get(attr(node, 'type') ?? '')
}

interface Restriction {
  readonly base: string
  readonly facets: ReadonlyMap<string, string[]>
}

function restrictionOf(node: XmlNode, types: SchemaTypes): Restriction {
  const simple = firstChild(node, 'xs:simpleType') ?? types.simple.get(attr(node, 'type') ?? '')
  const restriction = firstChild(simple, 'xs:restriction')
  const facets = new Map<string, string[]>()
  for (const facet of restriction?.children ?? []) {
    facets.set(facet.name, [...(facets.get(facet.name) ?? []), attr(facet, 'value') ?? ''])
  }
  return { base: attr(restriction, 'base') ?? attr(node, 'type') ?? 'xs:string', facets }
}

const NUMERIC_BASES: ReadonlySet<string> = new Set(
  [
    'byte',
    'decimal',
    'int',
    'integer',
    'long',
    'negativeInteger',
    'nonNegativeInteger',
    'nonPositiveInteger',
    'positiveInteger',
    'short',
    'unsignedByte',
    'unsignedInt',
    'unsignedLong',
    'unsignedShort',
  ].map((name) => `xs:${name}`),
)
const DECIMAL_COMMA = /^\[0-9\]\{1,(\d+)\}\[,\]\[0-9\]\{(\d+)\}$/
const SIMPLE_ATOM = /^(?:\\d|\[[^\]]+\]|[A-Za-z0-9-])(?:\{(\d+)(?:,(\d+))?\})?/

/**
 * Tamanho máximo de um padrão simples (`[0-9]{8}|[0-9]{14}` → 14, `1|2` → 1); `null` quando o
 * padrão tem grupos, quantificadores abertos ou outra construção.
 */
export function patternMaxLength(pattern: string): number | null {
  let longest = 0
  for (const alternative of pattern.split('|')) {
    let length = 0
    let rest = alternative
    while (rest !== '') {
      const atom = SIMPLE_ATOM.exec(rest)
      if (!atom) {
        return null
      }
      length += Number(atom[2] ?? atom[1] ?? 1)
      rest = rest.slice(atom[0].length)
    }
    longest = Math.max(longest, length)
  }
  return longest === 0 ? null : longest
}

/** Valores válidos de um padrão que é só alternância de literais (`1|2`, `S|N`). */
function literalValues(pattern: string | undefined): string[] {
  if (pattern === undefined || !/^[A-Za-z0-9]+(?:\|[A-Za-z0-9]+)*$/.test(pattern)) {
    return []
  }
  return pattern.split('|')
}

interface Columns {
  readonly registroPai: string
  readonly elemento: 'G' | 'E' | 'A'
  readonly tipo: string
  readonly ocorrencia: string
  readonly tamanho: string
  readonly decimais: string
}

function pad3(value: number): string {
  return String(value).padStart(3, '0')
}

function occurrence(node: XmlNode, attribute: boolean): string {
  if (attribute) {
    return attr(node, 'use') === 'required' ? '1-1' : '0-1'
  }
  const max = attr(node, 'maxOccurs') ?? '1'
  return `${attr(node, 'minOccurs') ?? '1'}-${max === 'unbounded' ? 'N' : max}`
}

function simpleColumns(
  restriction: Restriction,
): Omit<Columns, 'registroPai' | 'elemento' | 'ocorrencia'> {
  const pattern = restriction.facets.get('xs:pattern')?.[0]
  const decimal = pattern === undefined ? null : DECIMAL_COMMA.exec(pattern)
  if (decimal) {
    const integer = Number(decimal[1])
    const decimals = Number(decimal[2])
    return { tipo: 'N', tamanho: pad3(integer + decimals), decimais: String(decimals) }
  }
  if (restriction.base === 'xs:date' || restriction.base === 'xs:dateTime') {
    return { tipo: 'D', tamanho: '-', decimais: '-' }
  }
  const declared =
    restriction.facets.get('xs:length')?.[0] ?? restriction.facets.get('xs:maxLength')?.[0]
  const size =
    declared !== undefined
      ? Number(declared)
      : pattern === undefined
        ? null
        : patternMaxLength(pattern)
  return {
    tipo: NUMERIC_BASES.has(restriction.base) ? 'N' : 'C',
    tamanho: size === null || Number.isNaN(size) ? '-' : pad3(size),
    decimais: '-',
  }
}

interface EventContext {
  readonly code: string
  readonly title: string
  readonly eventKey: string
  readonly types: SchemaTypes
  readonly provisions: ParsedProvision[]
  readonly skipped: SkippedVersion[]
  readonly keys: Set<string>
  readonly groups: string[]
  readonly validDuring: ParsedSource['version']['validDuring']
  counter: number
}

function rowText(number: number, name: string, columns: Columns, doc: string): string {
  const { registroPai, elemento, tipo, ocorrencia, tamanho, decimais } = columns
  return [number, name, registroPai, elemento, tipo, ocorrencia, tamanho, decimais, doc]
    .filter((part) => part !== '')
    .join(' ')
}

function pushProvision(
  context: EventContext,
  provision: Omit<ParsedProvision, 'versions'> & {
    readonly label: string
    readonly text: string
    readonly structured: Columns
  },
): void {
  if (context.keys.has(provision.stableKey) || !isStableKey(provision.stableKey)) {
    context.skipped.push({
      stableKey: provision.stableKey,
      reason: 'duplicate-or-invalid-key',
      rawNote: provision.text,
    })
    return
  }
  context.keys.add(provision.stableKey)
  const { label, text, structured, ...rest } = provision
  context.provisions.push({
    ...rest,
    versions: [
      buildVersion({
        displayLabel: label,
        validDuring: context.validDuring,
        modality: Modality.Mandatory,
        validityBasis: ValidityBasis.LeiautePeriod,
        text,
        structured: { ...structured },
      }),
    ],
  })
}

/** Percorre os filhos de um grupo (ou do evento, com `group === null`). */
function walkChildren(
  context: EventContext,
  parentNode: XmlNode,
  parentName: string,
  group: string | null,
): void {
  const complexType = complexTypeOf(parentNode, context.types)
  if (complexType === undefined) {
    return
  }
  const { elements, attributes } = complexChildren(complexType)
  // Atributos do grupo vêm logo depois da linha do grupo (os do evento, como `id`, são omitidos).
  for (const attribute of attributes) {
    context.counter += 1
    if (group !== null) {
      emitField(context, attribute, parentName, group, true)
    }
  }
  for (const element of elements) {
    if (attr(element, 'ref') !== undefined) {
      continue
    }
    context.counter += 1
    if (complexTypeOf(element, context.types) === undefined) {
      emitField(context, element, parentName, group, false)
      continue
    }
    const name = attr(element, 'name') ?? ''
    const columns: Columns = {
      registroPai: parentName,
      elemento: 'G',
      tipo: '-',
      ocorrencia: occurrence(element, false),
      tamanho: '-',
      decimais: '-',
    }
    context.groups.push(name)
    pushProvision(context, {
      stableKey: `${context.eventKey}:grupo:${name}`,
      kind: 'grupo',
      // Grupo aninhado tem como pai o grupo imediato; o de primeiro nível, o evento.
      parent: group === null ? context.eventKey : `${context.eventKey}:grupo:${group}`,
      sortPath: `${context.code}.${pad3(context.counter)}`,
      headingPath: `${FAMILY_LABEL} > ${context.title} > ${name}`,
      label: `${DISPLAY_PREFIX}, evento ${context.code}, grupo ${name}`,
      text: rowText(context.counter, name, columns, documentation(element)),
      structured: columns,
    })
    walkChildren(context, element, name, name)
  }
}

function emitField(
  context: EventContext,
  node: XmlNode,
  parentName: string,
  group: string | null,
  attribute: boolean,
): void {
  const name = attr(node, 'name') ?? ''
  const restriction = restrictionOf(node, context.types)
  const columns: Columns = {
    registroPai: parentName,
    elemento: attribute ? 'A' : 'E',
    ocorrencia: occurrence(node, attribute),
    ...simpleColumns(restriction),
  }
  const enumerations = restriction.facets.get('xs:enumeration') ?? []
  const values =
    enumerations.length > 0
      ? enumerations
      : literalValues(restriction.facets.get('xs:pattern')?.[0])
  const base = rowText(context.counter, name, columns, documentation(node))
  const groupKey = group === null ? context.eventKey : `${context.eventKey}:grupo:${group}`
  pushProvision(context, {
    stableKey: `${groupKey}:campo:${name}`,
    kind: 'campo',
    parent: groupKey,
    sortPath: `${context.code}.${pad3(context.counter)}`,
    headingPath: [FAMILY_LABEL, context.title, ...(group === null ? [] : [group]), name].join(
      ' > ',
    ),
    label: `${DISPLAY_PREFIX}, evento ${context.code}${group === null ? '' : `, grupo ${group}`}, campo ${name}`,
    text: values.length > 0 ? `${base}\nValores válidos: ${values.join(', ')}.` : base,
    structured: columns,
  })
}

function parseEvent(
  member: string,
  bytes: Uint8Array,
  validDuring: ParsedSource['version']['validDuring'],
  skipped: SkippedVersion[],
): ParsedProvision[] {
  const match = MEMBER.exec(member)
  const code = (match?.[1] ?? '').toUpperCase()
  const schema = parseXml(new TextDecoder('utf-8').decode(bytes), member)
  const types = globalTypes(schema)
  const reinf = childrenNamed(schema, 'xs:element').find((node) => attr(node, 'name') === 'Reinf')
  const event =
    reinf === undefined
      ? undefined
      : complexChildren(complexTypeOf(reinf, types) ?? reinf).elements.find(
          (node) => attr(node, 'ref') === undefined,
        )
  if (event === undefined) {
    throw new ParseError(`${member}: sem o elemento Reinf e o elemento do evento`)
  }
  const eventName = attr(event, 'name') ?? ''
  const title = `${code} - ${EVENT_TITLES[code] ?? documentation(event)}`
  const eventKey = buildStableKey(Family.EfdReinf, [{ kind: 'evt', value: code }])
  const context: EventContext = {
    code,
    title,
    eventKey,
    types,
    provisions: [],
    skipped,
    keys: new Set(),
    groups: [],
    validDuring,
    // Reinf = 1 e o evento = 2; o atributo `id` do evento recebe o 3 dentro de walkChildren.
    counter: 2,
  }
  walkChildren(context, event, eventName, null)
  const eventProvision: ParsedProvision = {
    stableKey: eventKey,
    kind: 'evento',
    sortPath: code,
    headingPath: `${FAMILY_LABEL} > ${title}`,
    versions: [
      buildVersion({
        displayLabel: `${DISPLAY_PREFIX}, evento ${code}`,
        validDuring,
        modality: Modality.Mandatory,
        validityBasis: ValidityBasis.LeiautePeriod,
        text: [
          title,
          `Elemento ${eventName}: ${documentation(event)}`,
          `Grupos: ${context.groups.join(', ')}`,
        ].join('\n'),
      }),
    ],
  }
  return [eventProvision, ...context.provisions]
}

export const parseReinfXsd: Parser = (input) => {
  if (input.source.family !== Family.EfdReinf) {
    throw new ParseError(`${input.source.id}: reinf-xsd só lê os leiautes da EFD-REINF`)
  }
  const { version, validDuring } = resolveDescribedVersion(input)
  const members = [...input.members.entries()]
    .filter(([path]) => MEMBER.test(path))
    .sort(([a], [b]) => (MEMBER.exec(a)?.[1] ?? '').localeCompare(MEMBER.exec(b)?.[1] ?? ''))
  if (members.length === 0) {
    throw new ParseError(`${input.source.id}: nenhum XSD de evento (R-XXXX-evt….xsd) no pacote`)
  }
  const skipped: SkippedVersion[] = []
  const seenEvents = new Set<string>()
  const provisions: ParsedProvision[] = []
  for (const [path, bytes] of members) {
    const code = (MEMBER.exec(path)?.[1] ?? '').toUpperCase()
    if (seenEvents.has(code)) {
      skipped.push({ stableKey: null, reason: 'duplicate-event', rawNote: path })
      continue
    }
    seenEvents.add(code)
    provisions.push(...parseEvent(path, bytes, validDuring, skipped))
  }
  const source: ParsedSource = {
    document: input.source.document,
    version,
    replacementWindow: validDuring,
    provisions,
    skipped,
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  }
  return source
}
