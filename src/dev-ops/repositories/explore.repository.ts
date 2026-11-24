import { config } from '../../common/config.ts'
import { getFromGas, postToGas, streamFromGas } from '../../common/gas.ts'
import { readLines } from '../../common/lines.ts'

/** What a column's values are: numbers, times, or text. */
export type ExploreKind = 'text' | 'number' | 'date'

export type ExploreRead = 'exact' | 'windowed' | 'full'

/** What the query asked for: records, groups, one count, or a path's values. */
export type ExploreMode = 'rows' | 'groups' | 'count' | 'distinct'

export interface ExploreColumn {
  key: string
  label: string
  kind: ExploreKind
  aggregate: boolean
  /** The stored path of a plain-path column, `_id` among them; null for a name the query gives or a worked-out value. */
  path: string | null
}

export type ExploreValue = string | number

/** An object, written inline as mongosh prints it, whole. */
export interface ExploreObject {
  text: string
}

/** A list holds what a cell does, lists inside lists as stored. */
export type ExploreCell = ExploreValue | ExploreObject | ExploreCell[] | null

/** The service an event is held in, and its box there. */
export type EventService = 'GAS' | 'CW'
export type EventBox = 'outbox' | 'inbox'

export type ExploreOpen =
  | { kind: 'application' | 'case'; code: string; ref: string }
  | { kind: 'grant' | 'workflow'; code: string; version: string }
  | { kind: 'event'; service: EventService; box: EventBox; id: string }

/** An event's service and box, or a version's or payment's joined record as stored (base64 BSON), null when it has none. */
export type ExploreContext =
  | { service: EventService; box: EventBox }
  | { definition: string | null }
  | { agreement: string | null }

/**
 * Why a row has no document, or what to know about the one it has:
 * `changed`, its record no longer passes the filter; `gone`, deleted since it
 * was found; `later`, on an answer of one row, past what one answer prints,
 * with its bytes (null for a projection never fetched) and printed values;
 * `tooLarge`, the projection makes it larger than mongod allows.
 */
export type ExploreDocNote =
  | { changed: true }
  | { gone: true }
  | { later: number | null; values: number }
  | { tooLarge: true }

/** With `starts`: the record's start, base64 BSON cut from it as stored, and whether anything was cut; `quotedKey`, the key it was cut in needs quotes whole, though its kept part doesn't. */
export interface ExploreStart {
  doc: string
  cut: boolean
  quotedKey?: boolean
}

/** With `starts`: the BSON bytes and printed values of the document as fetched, before it was cut. */
export interface ExplorePrinted {
  bytes: number
  values: number
}

export interface ExploreRow {
  open: ExploreOpen | null
  cells: Record<string, ExploreCell>
  /** With `documents` or `starts`: base64 BSON of `{ _id }`, the record's own; null for a group, value or count. */
  id?: string | null
  /** With `documents` or `starts`: the row's place in each list the query's `$unwind`s took it from (null where one kept a record with none); empty for a row not unwound. */
  at?: (number | null)[] | null
  /** With `documents` or `show`, and for a group, value or count with `starts`: base64 BSON of the document as mongod returns it; null when `docNote` says why. */
  doc?: string | null
  /** With `starts`, a record's row: its start, null when `docNote` says why; beside a `doc` (a group's, value's or count's with `starts`, or Show it's record): that document's start, null only with no document. */
  start?: ExploreStart | null
  /** With `starts`, a record's row: what its document as fetched would print. */
  printed?: ExplorePrinted | null
  context?: ExploreContext | null
  /** With `documents` or `show`, a Table read too: what to know of the row's record. */
  docNote?: ExploreDocNote | null
}

/** Opaque to this app: held in the session and sent back as it came. */
export type ExplorePositions = string

/** A record too large to search: the record it opens, and its `_id` as base64 BSON of `{ _id }`. */
export interface ExploreSkipped {
  open: ExploreOpen | null
  id: string
}

export interface ExploreWindow {
  /** The ISO time searched back to; null when the window read nothing. */
  to: string | null
  /** At the source's oldest record. */
  end: boolean
  positions: ExplorePositions | null
  /** Records the window passed over as too large to search. */
  skipped: ExploreSkipped[]
}

/** `name` is the source as FROM names it, `noun` one of its records. */
export interface ExploreSource {
  name: string
  noun: string
}

export interface ExploreAnswer {
  source: ExploreSource
  mode: ExploreMode
  read: ExploreRead
  columns: ExploreColumn[]
  rows: ExploreRow[]
  /** Null for a windowed read; `groups` is how many groups there are in all. */
  count: { n: number; capped: boolean; groups?: number } | null
  /** The rows are groups. */
  groups: boolean
  /** The rows are what $unwind made of the records, and the count counts them. */
  unwound: boolean
  /** The window ran out of work and ended early, back to `window.to`. */
  partial: boolean
  /** Paths the query reads that no definition names, so may be mistyped. */
  unseen: string[]
  /** Null for an exact or full read. */
  window: ExploreWindow | null
  /** With `windows`: the rows each window read, in turn. */
  windowRows?: number[]
  /** With `windows`: the window after the last read, which failed; the rows before it stand. */
  stopped?: ExploreStop | null
  /** With `csv`: where the download stopped short, if it did. */
  download?: ExploreDownload | null
  /** With `documents` or `starts`: whether they are whole records, and the bytes sent; with `show`, whether the record shown is gone. */
  documents?: { whole: boolean; bytes: number; gone?: boolean } | null
}

/**
 * Why a download holds less than its query found: its row limit, its
 * deadline, its windows, its size, or a later window that couldn't be read.
 */
export type ExploreDownloadStop =
  | 'rows'
  | 'time'
  | 'windows'
  | 'bytes'
  | 'error'

/** `rows`: the row limit the download ran with, a limit the query typed included. */
export interface ExploreDownload {
  rows: number
  stopped: ExploreDownloadStop | null
  /** The ISO time it searched back to, when known. */
  searchedTo: string | null
}

/** Why GAS read no further windows: `TOO_MANY_CELLS` when the next wouldn't fit in one answer. */
export interface ExploreStop {
  statusCode: number
  code: string
}

export interface ExploreQuery {
  query: string
  positions?: ExplorePositions
  limit?: number
  csv?: boolean
  /** With `csv`: read every window to the source's oldest record, whatever the positions. */
  untilEnd?: boolean
  /** Windows 1 to N read in turn from the top, as one answer. */
  windows?: number
  /** Each row's document as stored: Show it and Download JSON. */
  documents?: boolean
  /** Each record's start, and a group's, value's or count's document: a Documents page. */
  starts?: boolean
  /** With `csv` and `documents`: the download as lines, a header, a row a line, and an end. */
  stream?: boolean
  /** Show it: the one row of the run's query this names, by its record's `_id`, its unwound places and an event's box. */
  show?: ExploreShow
}

/** One row of a run, as its page showed it: the base64 BSON of its record's `{ _id }`, the places `$unwind` took it from, and an event's service and box. */
export interface ExploreShow {
  id: string
  at: (number | null)[]
  service: EventService | null
  box: EventBox | null
}

export interface QueryError {
  message: string
  at: number
  end: number
}

/** A closed path's value, as stored, and its name. */
export interface VocabularyValue {
  value: string
  label: string
}

/** A stored path a query may name, as the definitions type it. */
export interface VocabularyPath {
  path: string
  type?: 'text' | 'number' | 'boolean' | 'date' | 'objectId'
  indexed: boolean
  /** A closed path's values, most used first. */
  values?: VocabularyValue[]
}

export interface VocabularySource {
  name: string
  label: string
  /** The path its records are timed by. */
  time: string | null
  paths: VocabularyPath[]
}

export interface Vocabulary {
  sources: VocabularySource[]
}

/** Null when GAS couldn't read it. */
export interface WithVocabulary {
  vocabulary: Vocabulary | null
}

const queryPath = '/grant-admin/explore/query'

/**
 * A POST, so the query and its positions travel in the body and never in a
 * logged URL. The answer, or refusal, carries the editor's vocabulary, so the
 * page it draws asks nothing more.
 */
export const queryExplore = async (
  body: ExploreQuery
): Promise<ExploreAnswer & WithVocabulary> =>
  postToGas<ExploreAnswer & WithVocabulary>(queryPath, {
    payload: body,
    timeoutMs: config.get('gas.exploreTimeoutMs')
  })

/** Download JSON's first line: what the download is of, and the rows it may hold. */
export interface ExploreStreamHeader {
  source: ExploreSource
  download: { rows: number }
  /** With `show`, `gone` says the record shown no longer exists: no row follows. */
  documents?: { whole: boolean; gone?: boolean }
}

/** A row of Download JSON: no cells, its document. */
export type ExploreStreamRow = Omit<ExploreRow, 'cells'>

/** Download JSON's last line: why it stopped, if it did, how far back it searched, and what it skipped. */
export interface ExploreStreamEnd {
  stopped: ExploreDownloadStop | null
  searchedTo: string | null
  skipped: ExploreSkipped[]
}

export type ExploreStreamLine =
  | { row: ExploreStreamRow }
  | { end: ExploreStreamEnd }

export interface ExploreStream {
  header: ExploreStreamHeader
  /** Read as they come; throws where the stream breaks or sends a line that isn't GAS's. */
  lines: AsyncIterable<ExploreStreamLine>
}

/** GAS's stream sent what its protocol has no place for. */
export class ExploreStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExploreStreamError'
  }
}

/** A line holds one document and its joined record, each at most 16 MiB of BSON, in base64, and its row. */
const streamLineMax = 44 * 1024 * 1024

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const lineKinds = ['header', 'row', 'end']

/** A line of GAS's stream by the one key that names it. */
const toLine = (text: string): Record<string, unknown> => {
  const line: unknown = JSON.parse(text)
  const keys = isObject(line) ? Object.keys(line) : []

  if (keys.length !== 1 || !lineKinds.includes(keys[0])) {
    throw new ExploreStreamError('Explore stream line of no kind')
  }

  return line as Record<string, unknown>
}

const isHeader = (line: Record<string, unknown>): boolean => {
  const header = isObject(line.header) ? line.header : {}

  return isObject(header.source) && isObject(header.download)
}

const linesOf = async function* (
  texts: AsyncIterable<string>
): AsyncGenerator<Record<string, unknown>> {
  for await (const text of texts) {
    yield toLine(text)
  }
}

const rowsAndEnd = async function* (
  lines: AsyncIterator<Record<string, unknown>>
): AsyncGenerator<ExploreStreamLine> {
  try {
    for (let line = await lines.next(); !line.done; line = await lines.next()) {
      if ('header' in line.value) {
        throw new ExploreStreamError(
          'Explore stream header after its first line'
        )
      }

      yield line.value as ExploreStreamLine
    }
  } finally {
    await lines.return?.(undefined)
  }
}

/** GAS's first line, or the stream let go and refused when it is anything else. */
const readHeader = async (
  lines: AsyncIterator<Record<string, unknown>>,
  release: () => void
): Promise<ExploreStreamHeader> => {
  const first = await lines.next().catch((error: unknown) => {
    release()
    throw error
  })

  if (first.done || !isHeader(first.value)) {
    release()
    throw new ExploreStreamError('Explore stream without its header')
  }

  return first.value.header as ExploreStreamHeader
}

/** Download JSON: GAS's header once it has said it will answer (a refusal comes before it, as any query's), then its rows and end as they come. */
export const streamExploreQuery = async (
  body: ExploreQuery
): Promise<ExploreStream> => {
  const timeoutMs = config.get('gas.exploreTimeoutMs')
  const response = await streamFromGas(queryPath, {
    payload: { ...body, csv: true, documents: true, stream: true },
    timeoutMs,
    idleMs: timeoutMs
  })
  const lines = linesOf(readLines(response, streamLineMax))
  const header = await readHeader(lines, () => response.destroy())

  return { header, lines: rowsAndEnd(lines) }
}

/** Reads nothing: GAS only checks the query, and names its source. */
export const checkExplore = async (
  query: string
): Promise<{ ok: true; source: string } & WithVocabulary> =>
  postToGas<{ ok: true; source: string } & WithVocabulary>(queryPath, {
    payload: { query, check: true }
  })

export const findVocabulary = async (): Promise<Vocabulary> =>
  getFromGas<Vocabulary>('/grant-admin/explore/vocabulary')
