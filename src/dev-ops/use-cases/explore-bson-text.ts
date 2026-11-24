import { BSON, Decimal128 } from 'bson'

const { parseToElements, NumberUtils, ByteUtils } = BSON.onDemand

type Quote = (text: string) => string

/** A BSON element: its type, where its key is and how long, and where its value is and how long. */
type Element = [number, number, number, number, number]

const elementsAt = (bytes: Uint8Array, at: number): Element[] =>
  Array.from(parseToElements(bytes, at), (element) => [...element] as Element)

/** Text stored as BSON: its length, then its bytes and a closing zero. */
const textAt = (bytes: Uint8Array, at: number): string => {
  const length = NumberUtils.getInt32LE(bytes, at)

  return ByteUtils.toUTF8(bytes, at + 4, at + 4 + length - 1, false)
}

/** The C string (a regex's pattern or flags) at `at`, and where the next one starts. */
const cStringAt = (bytes: Uint8Array, at: number): [string, number] => {
  const end = bytes.indexOf(0, at)

  return [ByteUtils.toUTF8(bytes, at, end, false), end + 1]
}

const hexOf = (bytes: Uint8Array, at: number, length: number): string =>
  ByteUtils.toHex(bytes.subarray(at, at + length))

const objectIdAt = (bytes: Uint8Array, at: number): string =>
  `ObjectId('${hexOf(bytes, at, 12)}')`

/** As mongosh writes a double: `-0`, `NaN` and `Infinity` included. */
const toDoubleText = (value: number): string =>
  Object.is(value, -0) ? '-0' : String(value)

/** The most milliseconds either side of 1970 a date can show. */
const dateMax = 8.64e15

const toDateText = (ms: bigint): string => {
  const value = Number(ms)

  return Math.abs(value) <= dateMax
    ? `ISODate('${new Date(value).toISOString()}')`
    : "ISODate('Invalid Date')"
}

const uuidOf = (hex: string): string =>
  [8, 4, 4, 4, 12]
    .reduce<
      [string[], number]
    >(([parts, at], size) => [[...parts, hex.slice(at, at + size)], at + size], [[], 0])[0]
    .join('-')

const binaryAt = (bytes: Uint8Array, at: number): string => {
  const length = NumberUtils.getInt32LE(bytes, at)
  const subtype = bytes[at + 4]
  const start = subtype === 2 ? at + 9 : at + 5
  const data = bytes.subarray(start, at + 5 + length)

  return subtype === 4 && length === 16
    ? `UUID('${uuidOf(ByteUtils.toHex(data))}')`
    : `Binary.createFromBase64('${ByteUtils.toBase64(data)}', ${subtype})`
}

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

const regexAt = (bytes: Uint8Array, at: number): string => {
  const [pattern, next] = cStringAt(bytes, at)
  const [flags] = cStringAt(bytes, next)

  return `/${toPatternText(pattern)}/${flags}`
}

const timestampAt = (bytes: Uint8Array, at: number): string =>
  `Timestamp({ t: ${NumberUtils.getUint32LE(bytes, at + 4)}, i: ${NumberUtils.getUint32LE(bytes, at)} })`

const toKey = (key: string, quote: Quote): string =>
  /^[A-Za-z_]\w*$/.test(key) ? key : quote(key)

const keyOf = (bytes: Uint8Array, [, at, length]: Element): string =>
  ByteUtils.toUTF8(bytes, at, at + length, false)

type Writer = (bytes: Uint8Array, at: number, quote: Quote) => string

/** Each BSON type as mongosh writes it, so it can be read, and as far as the language goes, pasted into a query. */
const writers: Record<number, Writer> = {
  1: (bytes, at) => toDoubleText(NumberUtils.getFloat64LE(bytes, at)),
  2: (bytes, at, quote) => quote(textAt(bytes, at)),
  3: (bytes, at, quote) => documentText(bytes, at, quote),
  4: (bytes, at, quote) => arrayText(bytes, at, quote),
  5: binaryAt,
  6: () => 'undefined',
  7: objectIdAt,
  8: (bytes, at) => String(bytes[at] === 1),
  9: (bytes, at) => toDateText(NumberUtils.getBigInt64LE(bytes, at)),
  10: () => 'null',
  11: regexAt,
  12: (bytes, at, quote) =>
    `DBPointer(${quote(textAt(bytes, at))}, ${objectIdAt(bytes, at + 4 + NumberUtils.getInt32LE(bytes, at))})`,
  13: (bytes, at, quote) => `Code(${quote(textAt(bytes, at))})`,
  14: (bytes, at, quote) => `BSONSymbol(${quote(textAt(bytes, at))})`,
  15: (bytes, at, quote) => {
    const code = at + 4
    const scope = code + 4 + NumberUtils.getInt32LE(bytes, code)

    return `Code(${quote(textAt(bytes, code))}, ${documentText(bytes, scope, quote)})`
  },
  16: (bytes, at) => String(NumberUtils.getInt32LE(bytes, at)),
  17: timestampAt,
  18: (bytes, at) => `Long('${NumberUtils.getBigInt64LE(bytes, at)}')`,
  19: (bytes, at) =>
    `Decimal128('${new Decimal128(bytes.subarray(at, at + 16)).toString()}')`,
  127: () => 'MaxKey()',
  255: () => 'MinKey()'
}

const valueText = (bytes: Uint8Array, element: Element, quote: Quote) => {
  const [type, , , at] = element
  const writer = writers[type] as Writer | undefined

  return writer ? writer(bytes, at, quote) : `BSON type ${type}`
}

const documentText = (bytes: Uint8Array, at: number, quote: Quote): string => {
  const entries = elementsAt(bytes, at).map(
    (element) =>
      `${toKey(keyOf(bytes, element), quote)}: ${valueText(bytes, element, quote)}`
  )

  return entries.length ? `{ ${entries.join(', ')} }` : '{}'
}

const arrayText = (bytes: Uint8Array, at: number, quote: Quote): string => {
  const items = elementsAt(bytes, at).map((element) =>
    valueText(bytes, element, quote)
  )

  return `[${items.join(', ')}]`
}

/** The first value of a BSON document, as mongosh writes it; bytes that aren't BSON say so rather than fail. */
export const toBsonText = (bytes: Uint8Array, quote: Quote): string => {
  try {
    const [first] = elementsAt(bytes, 0)

    return first ? valueText(bytes, first, quote) : 'nothing'
  } catch {
    return '(not readable as BSON)'
  }
}
