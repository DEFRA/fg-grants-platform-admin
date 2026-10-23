/**
 * How GAS resolves each mapping value: `resolve-process-mapping.js`, whose
 * test pins the same cases as `mapping-table.test.ts`.
 */
const jsonataPrefix = 'jsonata:'
const rootReferencePattern =
  /^\$\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/
const rowReferencePattern =
  /^@\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|\*)\])*$/
const rowTermPattern = /(^|[^\w'"@$])@\./
const rootPattern = /\$\.([A-Za-z_$][\w$]*)/g

export type MappingKind =
  | 'literal'
  | 'reference'
  | 'expression'
  | 'list'
  | 'collection'
  | 'object'

/** The operator's word for where a value comes from. */
export type ComesFrom =
  | 'fixed'
  | 'empty'
  | 'copied'
  | 'calculated'
  | 'list'
  | 'for each'

export interface MappingValue {
  /** An expression without its `jsonata:` prefix: its Comes from says it. */
  text: string
  kind: MappingKind
  comesFrom: ComesFrom
  /** The literal `""`. */
  empty: boolean
}

/** One field of a mapping: a value, or a heading over the fields beneath it. */
export type MappingRow = { field: string; depth: number } & (
  | { kind: 'value'; value: MappingValue }
  | { kind: 'group' }
  | { kind: 'list' }
  | { kind: 'each'; forEach: string }
)

export type Mapping = Record<string, unknown>

export const isObject = (value: unknown): value is Mapping =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const isCollection = (value: unknown): value is Mapping =>
  isObject(value) && Object.hasOwn(value, 'itemsRef')

const toStringKind = (value: string): MappingKind => {
  if (value.startsWith(jsonataPrefix)) {
    return 'expression'
  }

  return rootReferencePattern.test(value) || rowReferencePattern.test(value)
    ? 'reference'
    : 'literal'
}

const toObjectKind = (value: object): MappingKind => {
  if (Array.isArray(value)) {
    return 'list'
  }

  return isCollection(value) ? 'collection' : 'object'
}

const toKind = (value: unknown): MappingKind => {
  if (typeof value === 'string') {
    return toStringKind(value)
  }

  return value !== null && typeof value === 'object'
    ? toObjectKind(value)
    : 'literal'
}

const comesFromOf: Record<MappingKind, ComesFrom> = {
  literal: 'fixed',
  reference: 'copied',
  expression: 'calculated',
  list: 'list',
  collection: 'for each',
  object: 'fixed'
}

const toText = (value: unknown, kind: MappingKind): string => {
  if (typeof value !== 'string') {
    return JSON.stringify(value)
  }

  return kind === 'expression' ? value.slice(jsonataPrefix.length) : value
}

export const toMappingValue = (value: unknown): MappingValue => {
  const kind = toKind(value)
  const empty = value === ''

  return {
    text: toText(value, kind),
    kind,
    comesFrom: empty ? 'empty' : comesFromOf[kind],
    empty
  }
}

/** What a collection walks, as written. */
export const toForEach = (collection: Mapping): string =>
  toMappingValue(collection.itemsRef).text

type ToRows = (field: string, value: unknown, depth: number) => MappingRow[]

const toChildRows = (mapping: Mapping, depth: number): MappingRow[] =>
  Object.entries(mapping).flatMap(([field, value]) =>
    toRows(field, value, depth)
  )

const toEachRows: ToRows = (field, value, depth) => {
  const { items } = value as Mapping
  const head: MappingRow = {
    field,
    depth,
    kind: 'each',
    forEach: toForEach(value as Mapping)
  }

  return isObject(items)
    ? [head, ...toChildRows(items, depth + 1)]
    : [head, ...toRows('(each)', items, depth + 1)]
}

const toListRows: ToRows = (field, value, depth) => [
  { field, depth, kind: 'list' },
  ...(value as unknown[]).flatMap((element, index) =>
    toRows(String(index + 1), element, depth + 1)
  )
]

const toRows: ToRows = (field, value, depth) => {
  if (isCollection(value)) {
    return toEachRows(field, value, depth)
  }

  if (Array.isArray(value)) {
    return toListRows(field, value, depth)
  }

  return isObject(value)
    ? [{ field, depth, kind: 'group' }, ...toChildRows(value, depth + 1)]
    : [{ field, depth, kind: 'value', value: toMappingValue(value) }]
}

/** Every field of a mapping, nested fields beneath their parent, in the order written. */
export const toMappingRows = (mapping: Mapping): MappingRow[] =>
  toChildRows(mapping, 0)

/** The text of every value GAS resolves rather than sends as written: literals read nothing. */
const readTexts = (value: unknown): string[] => {
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(readTexts)
  }

  const { text, kind } = toMappingValue(value)

  return kind === 'literal' ? [] : [text]
}

/** The `$.` roots a mapping reads. */
export const contextRootsOf = (mapping: object): ReadonlySet<string> =>
  new Set(
    readTexts(mapping).flatMap((text) =>
      [...text.matchAll(rootPattern)].map(([, root]) => root)
    )
  )

/** Whether a mapping reads the current row of a For each, as GAS rewrites `@.`. */
export const readsRows = (mapping: object): boolean =>
  readTexts(mapping).some((text) => rowTermPattern.test(text))

/** Whether a mapping reads anything the pattern matches. */
export const reads = (mapping: object, pattern: RegExp): boolean =>
  readTexts(mapping).some((text) => pattern.test(text))
