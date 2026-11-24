import { BSON, Decimal128 } from 'bson'

import type { BsonValue, DocText } from '../views/components/core/doc.ts'
import { toQuoted } from '../use-cases/explore-queries.ts'

export type { BsonValue }

const { parseToElements, NumberUtils, ByteUtils } = BSON.onDemand

/** Text as stored: decoded, and its bytes when they aren't UTF-8, so they can be written back as they are. */
export interface StoredText {
  text: string
  invalid: Uint8Array | null
}

/**
 * A stored value read from its BSON, element by element, nothing converted:
 * every key and a list's keys in stored order, a date as its int64, Int64 and
 * Decimal128 as their exact text, and any text with its bytes when they aren't
 * UTF-8.
 */
export type Stored =
  | { t: 'object'; entries: [StoredText, Stored][] }
  | { t: 'array'; entries: [StoredText, Stored][] }
  | { t: 'string'; v: StoredText }
  | ({ t: 'symbol'; v: StoredText } & WholeBson)
  | ({ t: 'regex'; pattern: StoredText; flags: StoredText } & WholeBson)
  | ({ t: 'dbPointer'; ns: StoredText; id: string } & WholeBson)
  | ({ t: 'javascript'; code: StoredText } & WholeBson)
  | ({ t: 'javascriptWithScope'; code: StoredText; scope: Stored } & WholeBson)
  | { t: 'int32'; v: number }
  | { t: 'double'; v: number }
  | { t: 'int64'; v: string }
  | { t: 'decimal128'; v: string }
  | { t: 'date'; v: string }
  | { t: 'objectId'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'undefined' }
  | { t: 'minKey' }
  | { t: 'maxKey' }
  | { t: 'binary'; v: string; sub: number }
  | { t: 'timestamp'; ts: number; i: number }

/** A value whose own text isn't UTF-8, with the base64 BSON of `{ v: <it> }` as stored, which Extended JSON can't write otherwise. */
interface WholeBson {
  bson?: string
}

/** A BSON element: its type, where its key is and how long, and where its value is and how long. */
type Element = [number, number, number, number, number]

const elementsAt = (bytes: Uint8Array, at: number): Element[] =>
  Array.from(parseToElements(bytes, at), (element) => [...element] as Element)

/** Strict, and a leading byte-order mark kept as the text it is. */
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const textBetween = (
  bytes: Uint8Array,
  at: number,
  end: number
): StoredText => {
  const slice = bytes.subarray(at, end)

  try {
    return { text: strict.decode(slice), invalid: null }
  } catch {
    return { text: ByteUtils.toUTF8(bytes, at, end, false), invalid: slice }
  }
}

/** Text stored as BSON: its length, then its bytes and a closing zero. */
const textAt = (bytes: Uint8Array, at: number): StoredText =>
  textBetween(bytes, at + 4, at + 4 + NumberUtils.getInt32LE(bytes, at) - 1)

/** The C string (a key, a regex's pattern or flags) at `at`, and where the next one starts. */
const cStringAt = (bytes: Uint8Array, at: number): [StoredText, number] => {
  const end = bytes.indexOf(0, at)

  return [textBetween(bytes, at, end), end + 1]
}

const hexOf = (bytes: Uint8Array, at: number, length: number): string =>
  ByteUtils.toHex(bytes.subarray(at, at + length))

/** The old binary subtype holds its own length before its bytes, as the driver reads it. */
const oldBinary = 2

const binaryAt = (bytes: Uint8Array, at: number): Stored => {
  const length = NumberUtils.getInt32LE(bytes, at)
  const sub = bytes[at + 4]
  const start = sub === oldBinary ? at + 9 : at + 5

  return {
    t: 'binary',
    v: ByteUtils.toBase64(bytes.subarray(start, at + 5 + length)),
    sub
  }
}

const regexAt = (bytes: Uint8Array, at: number): Stored => {
  const [pattern, next] = cStringAt(bytes, at)
  const [flags] = cStringAt(bytes, next)

  return { t: 'regex', pattern, flags }
}

const keyOf = (bytes: Uint8Array, [, at, length]: Element): StoredText =>
  textBetween(bytes, at, at + length)

type Reader = (bytes: Uint8Array, at: number) => Stored

/** Each BSON type by its tag. */
const readers: Record<number, Reader> = {
  1: (bytes, at) => ({ t: 'double', v: NumberUtils.getFloat64LE(bytes, at) }),
  2: (bytes, at) => ({ t: 'string', v: textAt(bytes, at) }),
  3: (bytes, at) => entriesAt('object', bytes, at),
  4: (bytes, at) => entriesAt('array', bytes, at),
  5: binaryAt,
  6: () => ({ t: 'undefined' }),
  7: (bytes, at) => ({ t: 'objectId', v: hexOf(bytes, at, 12) }),
  8: (bytes, at) => ({ t: 'bool', v: bytes[at] === 1 }),
  9: (bytes, at) => ({
    t: 'date',
    v: String(NumberUtils.getBigInt64LE(bytes, at))
  }),
  10: () => ({ t: 'null' }),
  11: regexAt,
  12: (bytes, at) => ({
    t: 'dbPointer',
    ns: textAt(bytes, at),
    id: hexOf(bytes, at + 4 + NumberUtils.getInt32LE(bytes, at), 12)
  }),
  13: (bytes, at) => ({ t: 'javascript', code: textAt(bytes, at) }),
  14: (bytes, at) => ({ t: 'symbol', v: textAt(bytes, at) }),
  15: (bytes, at) => {
    const code = at + 4

    return {
      t: 'javascriptWithScope',
      code: textAt(bytes, code),
      scope: entriesAt(
        'object',
        bytes,
        code + 4 + NumberUtils.getInt32LE(bytes, code)
      )
    }
  },
  16: (bytes, at) => ({ t: 'int32', v: NumberUtils.getInt32LE(bytes, at) }),
  17: (bytes, at) => ({
    t: 'timestamp',
    ts: NumberUtils.getUint32LE(bytes, at + 4),
    i: NumberUtils.getUint32LE(bytes, at)
  }),
  18: (bytes, at) => ({
    t: 'int64',
    v: String(NumberUtils.getBigInt64LE(bytes, at))
  }),
  19: (bytes, at) => ({
    t: 'decimal128',
    v: new Decimal128(bytes.subarray(at, at + 16)).toString()
  }),
  127: () => ({ t: 'maxKey' }),
  255: () => ({ t: 'minKey' })
}

/** The base64 BSON of `{ v: <the element's value> }`, its bytes as stored. */
const wholeOf = (
  bytes: Uint8Array,
  [type, , , at, length]: Element
): string => {
  const size = Buffer.alloc(4)
  const body = Buffer.concat([
    Buffer.from([type, 0x76, 0]),
    bytes.subarray(at, at + length),
    Buffer.from([0])
  ])

  size.writeInt32LE(body.length + 4)

  return Buffer.concat([size, body]).toString('base64')
}

/** A value whose own text isn't UTF-8 keeps its bytes whole. */
const withWhole = (bytes: Uint8Array, element: Element, value: Stored) =>
  quietTextsOf(value).some(({ invalid }) => invalid)
    ? { ...value, bson: wholeOf(bytes, element) }
    : value

const valueOf = (bytes: Uint8Array, element: Element): Stored => {
  const [type, , , at] = element
  const reader = readers[type] as Reader | undefined

  if (!reader) {
    throw new Error(`BSON type ${type} isn't one Explore reads`)
  }

  return withWhole(bytes, element, reader(bytes, at))
}

/** An object's or a list's every key in stored order, repeated ones too. */
const entriesAt = (
  t: 'object' | 'array',
  bytes: Uint8Array,
  at: number
): Extract<Stored, { t: 'object' | 'array' }> => ({
  t,
  entries: elementsAt(bytes, at).map((element) => [
    keyOf(bytes, element),
    valueOf(bytes, element)
  ])
})

/** A stored document, element by element from its bytes: throws for bytes that aren't BSON. */
export const readDocument = (bytes: Uint8Array): Stored =>
  entriesAt('object', bytes, 0)

/** The base64 BSON GAS sends, as a document. */
export const readBase64 = (base64: string): Stored =>
  readDocument(Buffer.from(base64, 'base64'))

/** What kind of failure it was, never its value: its name, and its code where it has one. */
export const kindOf = (error: unknown): string => {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
  const named = typeof name === 'string' ? name : 'unknown'

  return typeof code === 'string' ? `${named} ${code}` : named
}

/** A one-key document's value, such as `{ _id }`, `{ v }` or `{ n }`. */
export const firstValueOf = (document: Stored): Stored | null =>
  document.t === 'object' ? (document.entries[0]?.[1] ?? null) : null

/** A value's own text besides a text value's: a pattern or its flags, code, a symbol or a namespace. */
const quietTextsOf = (value: Stored): StoredText[] => {
  const texts: Partial<Record<Stored['t'], (v: never) => StoredText[]>> = {
    regex: ({ pattern, flags }: { pattern: StoredText; flags: StoredText }) => [
      pattern,
      flags
    ],
    dbPointer: ({ ns }: { ns: StoredText }) => [ns],
    javascript: ({ code }: { code: StoredText }) => [code],
    javascriptWithScope: ({ code }: { code: StoredText }) => [code],
    symbol: ({ v }: { v: StoredText }) => [v]
  }

  return texts[value.t]?.(value as never) ?? []
}

/** Text as the printout takes it: decoded, with its bytes' count where they aren't UTF-8. */
const docText = ({ text, invalid }: StoredText): DocText =>
  invalid ? { text, bytes: invalid.length } : text

type Printer<T extends Stored['t']> = (
  value: Extract<Stored, { t: T }>
) => BsonValue

const printers: Partial<{ [T in Stored['t']]: Printer<T> }> = {
  object: ({ entries }) => ({
    t: 'object',
    entries: entries.map(([key, item]) => [docText(key), toPrinted(item)])
  }),
  array: ({ entries }) => ({
    t: 'array',
    items: entries.map(([, item]) => toPrinted(item))
  }),
  string: ({ v }) =>
    v.invalid
      ? { t: 'invalid', text: v.text, bytes: v.invalid.length }
      : { t: 'string', v: v.text },
  symbol: ({ v }) => ({ t: 'symbol', v: docText(v) }),
  regex: ({ pattern, flags }) => ({
    t: 'regex',
    pattern: docText(pattern),
    flags: docText(flags)
  }),
  dbPointer: ({ ns, id }) => ({ t: 'dbPointer', ns: docText(ns), id }),
  javascript: ({ code }) => ({ t: 'javascript', code: docText(code) }),
  javascriptWithScope: ({ code, scope }) => ({
    t: 'javascriptWithScope',
    code: docText(code),
    scope: toPrinted(scope)
  })
}

/** A stored value as the document printout takes it: text decoded, text that isn't UTF-8 tagged wherever it is. */
export const toPrinted = (value: Stored): BsonValue => {
  const printer = printers[value.t] as Printer<Stored['t']> | undefined

  return printer ? printer(value) : (value as BsonValue)
}

type Quote = (text: string) => string

/** As mongosh writes a double: `-0`, `NaN` and `Infinity` included. */
const toDoubleText = (value: number): string =>
  Object.is(value, -0) ? '-0' : String(value)

/** The most milliseconds either side of 1970 a date can show. */
const dateMax = 8.64e15

const toDateText = (ms: string): string => {
  const value = Number(ms)

  return Math.abs(value) <= dateMax
    ? `ISODate('${new Date(value).toISOString()}')`
    : "ISODate('Invalid Date')"
}

const uuidOf = (hex: string): string =>
  [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')

const uuidSubtype = 4

const toBinaryText = (base64: string, sub: number): string => {
  const hex = Buffer.from(base64, 'base64').toString('hex')

  return sub === uuidSubtype && hex.length === 32
    ? `UUID('${uuidOf(hex)}')`
    : `Binary.createFromBase64('${base64}', ${sub})`
}

const textOf = (text: DocText): string =>
  typeof text === 'string' ? text : text.text

const patternEscapes: Record<string, string> = {
  '/': '\\/',
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
}

/** A pattern as a regex literal holds it: `/` and line breaks escaped, escapes already there kept, an escaped line break as its escape. */
const toPatternText = (pattern: string): string =>
  pattern.replace(
    /\\?[/\n\r\u2028\u2029]|\\./g,
    (match) => patternEscapes[match.at(-1) ?? ''] ?? match
  )

const toKeyText = (key: DocText, quote: Quote): string =>
  /^[A-Za-z_]\w*$/.test(textOf(key)) ? textOf(key) : quote(textOf(key))

type Writer<T extends BsonValue['t']> = (
  value: Extract<BsonValue, { t: T }>,
  quote: Quote
) => string

const queryWriters: { [T in BsonValue['t']]: Writer<T> } = {
  object: ({ entries }, quote) =>
    entries.length
      ? `{ ${entries.map(([key, value]) => `${toKeyText(key, quote)}: ${toQueryValue(value, quote)}`).join(', ')} }`
      : '{}',
  array: ({ items }, quote) =>
    `[${items.map((item) => toQueryValue(item, quote)).join(', ')}]`,
  string: ({ v }, quote) => quote(v),
  invalid: ({ text }, quote) => quote(text),
  int32: ({ v }) => String(v),
  double: ({ v }) => toDoubleText(v),
  int64: ({ v }) => `Long('${v}')`,
  decimal128: ({ v }) => `Decimal128('${v}')`,
  bool: ({ v }) => String(v),
  null: () => 'null',
  undefined: () => 'undefined',
  date: ({ v }) => toDateText(String(v)),
  objectId: ({ v }) => `ObjectId('${v}')`,
  binary: ({ v, sub }) => toBinaryText(v, sub ?? 0),
  timestamp: ({ ts, i }) => `Timestamp({ t: ${ts}, i: ${i} })`,
  regex: ({ pattern, flags }) =>
    `/${toPatternText(textOf(pattern))}/${flags === undefined ? '' : textOf(flags)}`,
  dbPointer: ({ ns, id }, quote) =>
    `DBPointer(${quote(textOf(ns))}, ObjectId('${id}'))`,
  javascript: ({ code }, quote) => `Code(${quote(textOf(code))})`,
  javascriptWithScope: ({ code, scope }, quote) =>
    `Code(${quote(textOf(code))}, ${toQueryValue(scope, quote)})`,
  symbol: ({ v }, quote) => `BSONSymbol(${quote(textOf(v))})`,
  minKey: () => 'MinKey()',
  maxKey: () => 'MaxKey()'
}

/** A value as mongosh writes it, so it can be read, and as far as the language goes, pasted into a query. */
const toQueryValue = (value: BsonValue, quote: Quote): string =>
  (queryWriters[value.t] as Writer<BsonValue['t']>)(value, quote)

/** The first value of a BSON document, as mongosh writes it; bytes that aren't BSON say so rather than fail. */
const toBsonText = (bytes: Uint8Array): string => {
  try {
    const first = firstValueOf(readDocument(bytes))

    return first ? toQueryValue(toPrinted(first), toQuoted) : 'nothing'
  } catch {
    return '(not readable as BSON)'
  }
}

/** A record's `_id`, sent as base64 BSON of `{ _id }`, as a query writes its type: `ObjectId('…')`, text in quotes, `Long('…')`, `ISODate('…')`. */
export const toIdText = (id: string): string =>
  toBsonText(Buffer.from(id, 'base64'))

/** Keys canonical Extended JSON reads as a type, and the file's own. */
const typeKeys = new Set([
  '$oid',
  '$date',
  '$numberInt',
  '$numberLong',
  '$numberDouble',
  '$numberDecimal',
  '$binary',
  '$uuid',
  '$regularExpression',
  '$timestamp',
  '$code',
  '$scope',
  '$symbol',
  '$minKey',
  '$maxKey',
  '$undefined',
  '$dbPointer',
  '$regex',
  '$explore'
])

const isDbRef = (keys: Set<string>): boolean =>
  keys.has('$ref') && keys.has('$id')

/** An object a reader of canonical Extended JSON would take for a type or for the file's own, or one with a key it can't hold as text. */
const needsEscape = (entries: [StoredText, Stored][]): boolean => {
  const keys = new Set(entries.map(([key]) => key.text))

  return (
    isDbRef(keys) ||
    entries.some(([key]) => typeKeys.has(key.text) || key.invalid)
  )
}

/** A list whose keys are its places, 0 to n, as a list's are written. */
const isPlainList = (entries: [StoredText, Stored][]): boolean =>
  entries.every(([key], n) => key.invalid === null && key.text === String(n))

const json = (value: string): string => JSON.stringify(value)

const tagged = (key: string, value: string): string => `{${json(key)}:${value}}`

const explore = (key: string, value: string): string =>
  tagged('$explore', tagged(key, value))

/** Text as stored: bytes that aren't UTF-8 as `{ "$explore": { "utf8": <base64> } }`, so a reader gets the bytes back. */
const textJson = ({ text, invalid }: StoredText): string =>
  invalid ? explore('utf8', json(ByteUtils.toBase64(invalid))) : json(text)

/** As the driver writes a double canonically: a whole number with `.0`, `-0.0`, `NaN`, `Infinity`. */
const toCanonicalDouble = (value: number): string => {
  if (Object.is(value, -0)) {
    return '-0.0'
  }

  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

const toSubtype = (sub: number): string => sub.toString(16).padStart(2, '0')

const entriesJson = (entries: [StoredText, Stored][]): string =>
  `[${entries.map(([key, value]) => `[${textJson(key)},${toEjson(value)}]`).join(',')}]`

const objectJson = (entries: [StoredText, Stored][]): string =>
  needsEscape(entries)
    ? explore('entries', entriesJson(entries))
    : `{${entries.map(([key, value]) => `${json(key.text)}:${toEjson(value)}`).join(',')}}`

const arrayJson = (entries: [StoredText, Stored][]): string =>
  isPlainList(entries)
    ? `[${entries.map(([, value]) => toEjson(value)).join(',')}]`
    : explore('list', entriesJson(entries))

type JsonWriter<T extends Stored['t']> = (
  value: Extract<Stored, { t: T }>
) => string

const jsonWriters: { [T in Stored['t']]: JsonWriter<T> } = {
  object: ({ entries }) => objectJson(entries),
  array: ({ entries }) => arrayJson(entries),
  string: ({ v }) => textJson(v),
  int32: ({ v }) => tagged('$numberInt', json(String(v))),
  double: ({ v }) => tagged('$numberDouble', json(toCanonicalDouble(v))),
  int64: ({ v }) => tagged('$numberLong', json(v)),
  decimal128: ({ v }) => tagged('$numberDecimal', json(v)),
  bool: ({ v }) => String(v),
  null: () => 'null',
  undefined: () => tagged('$undefined', 'true'),
  date: ({ v }) => tagged('$date', tagged('$numberLong', json(v))),
  objectId: ({ v }) => tagged('$oid', json(v)),
  binary: ({ v, sub }) =>
    tagged(
      '$binary',
      `{"base64":${json(v)},"subType":${json(toSubtype(sub))}}`
    ),
  timestamp: ({ ts, i }) => tagged('$timestamp', `{"t":${ts},"i":${i}}`),
  regex: ({ pattern, flags }) =>
    tagged(
      '$regularExpression',
      `{"pattern":${json(pattern.text)},"options":${json(flags.text)}}`
    ),
  dbPointer: ({ ns, id }) =>
    tagged(
      '$dbPointer',
      `{"$ref":${json(ns.text)},"$id":${tagged('$oid', json(id))}}`
    ),
  javascript: ({ code }) => tagged('$code', json(code.text)),
  javascriptWithScope: ({ code, scope }) =>
    `{"$code":${json(code.text)},"$scope":${toEjson(scope)}}`,
  symbol: ({ v }) => tagged('$symbol', json(v.text)),
  minKey: () => tagged('$minKey', '1'),
  maxKey: () => tagged('$maxKey', '1')
}

/**
 * A value as canonical Extended JSON, so `EJSON.parse` gives back its type:
 * keys in stored order, repeated ones too; a date as its stored int64,
 * whatever it is. Four escapes, each `{ "$explore": … }`, give back what
 * Extended JSON can't hold: `entries`, an object whose keys it would read as
 * a type (or one not UTF-8); `list`, a list whose keys aren't 0 to n; `utf8`,
 * text whose bytes aren't UTF-8; `bson`, a pattern, code, symbol or
 * namespace whose text isn't, as the base64 BSON of `{ v: <it> }`.
 */
export const toEjson = (value: Stored): string =>
  'bson' in value && value.bson
    ? explore('bson', json(value.bson))
    : (jsonWriters[value.t] as JsonWriter<Stored['t']>)(value)
