import { Readable } from 'node:stream'

import { logger } from '../../common/logger.ts'
import type {
  ExploreShow,
  ExploreSkipped,
  ExploreSource,
  ExploreStreamEnd,
  ExploreStreamHeader,
  ExploreStreamLine,
  ExploreStreamRow
} from '../use-cases/explore-calls.ts'
import { firstValueOf, kindOf, readBase64, toEjson } from './explore-bson.ts'
import { contextOf } from './explore-context.ts'
import { toStopText } from './explore-csv.view-model.ts'

/** A stream that broke, or ended without its last line: what was written stands, and the file says it stopped. */
const broken: ExploreStreamEnd = {
  stopped: 'error',
  searchedTo: null,
  skipped: []
}

/** GAS's stream ended with no end line. */
class MissingEndError extends Error {
  constructor() {
    super('Explore stream ended without its last line')
    this.name = 'MissingEndError'
  }
}

export const toJsonFilename = ({ name }: ExploreSource): string =>
  `explore-${name.replace(/[^a-z0-9-]/gi, '')}.json`

const documentJson = (base64: string): string => toEjson(readBase64(base64))

const orNull = (base64: string | null): string =>
  base64 === null ? 'null' : documentJson(base64)

/** No `_id` in base64 BSON that should hold one. */
class MissingIdError extends Error {
  constructor() {
    super('Explore row id holds no _id')
    this.name = 'MissingIdError'
  }
}

/** A record's `_id` as canonical Extended JSON, from base64 BSON of `{ _id }`; null when there is none. Throws when it isn't readable. */
const idJson = (id: string | null | undefined): string => {
  if (!id) {
    return 'null'
  }

  const value = firstValueOf(readBase64(id))

  if (!value) {
    throw new MissingIdError()
  }

  return toEjson(value)
}

/** An event's service and box as they are; a joined record as stored, in canonical Extended JSON. */
const contextJson = (row: Pick<ExploreStreamRow, 'context'>): string =>
  contextOf(row.context, {
    none: () => 'null',
    box: ({ service, box }) => JSON.stringify({ service, box }),
    definition: (definition) => `{"definition":${orNull(definition)}}`,
    agreement: (agreement) => `{"agreement":${orNull(agreement)}}`
  })

/** What a file has met that it couldn't read: how many rows, and the first error's kind. */
interface Unread {
  rows: number
  kind: string | null
}

/** A part of a row read, or null with the part named, when it isn't readable as BSON. */
const readPart = (
  read: () => string,
  { name, unreadable }: { name: string; unreadable: string[] },
  unread: Unread
): string => {
  try {
    return read()
  } catch (error) {
    unreadable.push(name)
    unread.kind ??= kindOf(error)

    return 'null'
  }
}

const isGone = ({ docNote }: ExploreStreamRow): boolean =>
  Boolean(docNote && 'gone' in docNote)

/** What GAS said of the row, and the parts that couldn't be read, by name. */
const saidOf = (
  { docNote }: ExploreStreamRow,
  unreadable: string[]
): string[] => [
  ...(docNote ? [JSON.stringify(docNote).slice(1, -1)] : []),
  ...(unreadable.length ? [`"unreadable":${JSON.stringify(unreadable)}`] : [])
]

/** The row's note: what was said of it, a record gone or not read named by its `_id`; null when nothing was. */
const noteJson = (
  row: ExploreStreamRow,
  unreadable: string[],
  id: string | null
): string => {
  const said = saidOf(row, unreadable)
  const named = id === null ? said : [...said, `"_id":${id}`]

  return named.length ? `{${named.join(',')}}` : 'null'
}

const item = (document: string, context: string, note: string): string =>
  `{"document":${document},"context":${context},"note":${note}}`

/** One shape for every item, so a stored document's keys never meet the file's: the document, what it sits beside, and what GAS said of it; a part that can't be read is null, named in the note, and the rest stands. */
const toItem = (row: ExploreStreamRow, unread: Unread): string => {
  const unreadable: string[] = []
  const document = readPart(
    () => orNull(row.doc ?? null),
    { name: 'document', unreadable },
    unread
  )
  const context = readPart(
    () => contextJson(row),
    { name: 'context', unreadable },
    unread
  )
  const id =
    isGone(row) || unreadable.length
      ? readPart(() => idJson(row.id), { name: '_id', unreadable }, unread)
      : null

  unread.rows += unreadable.length ? 1 : 0

  return item(document, context, noteJson(row, unreadable, id))
}

/** A Show it whose record is gone: GAS sends no row, so the file names it by its `_id`. */
const goneItem = ({ id, service, box }: ExploreShow): string =>
  item(
    'null',
    service && box ? JSON.stringify({ service, box }) : 'null',
    `{"gone":true,"_id":${idJson(id)}}`
  )

/** A skipped record's `_id`, or null, counted among what the file couldn't read, when it isn't readable. */
const skippedJson = ({ id }: ExploreSkipped, unread: Unread): string => {
  const unreadable: string[] = []
  const json = readPart(() => idJson(id), { name: '_id', unreadable }, unread)

  unread.rows += unreadable.length ? 1 : 0

  return json
}

/** The file's last item says how it ended: `$explore` is never a stored key, which the escape sees to. */
const toEndItem = (
  end: ExploreStreamEnd,
  header: ExploreStreamHeader,
  unread: Unread
) =>
  `{"$explore":{"stopped":${JSON.stringify(end.stopped)},"searchedTo":${JSON.stringify(end.searchedTo)},"skipped":[${end.skipped.map((skipped) => skippedJson(skipped, unread)).join(',')}],"text":${JSON.stringify(toStopText({ rows: header.download.rows, ...end }))}}}`

const isEnd = (line: ExploreStreamLine): line is { end: ExploreStreamEnd } =>
  'end' in line

/** What a file is written from: GAS's header and lines, the row a Show it run shows, and what it met that it couldn't read. */
interface Writing {
  header: ExploreStreamHeader
  lines: AsyncIterable<ExploreStreamLine>
  show: ExploreShow | null
  unread: Unread
}

const saysGone = ({ documents }: ExploreStreamHeader): boolean =>
  documents?.gone === true

/** A Show it whose record GAS says is gone, with no row for it: the file names it by its `_id` before its end. */
const goneWithNoRow = ({ show, header }: Writing, rows: number): string[] =>
  show && rows === 0 && saysGone(header) ? [goneItem(show)] : []

/** Each row's item as it comes, then GAS's end item. */
const readItems = async function* (writing: Writing): AsyncGenerator<string> {
  let rows = 0

  for await (const line of writing.lines) {
    if (isEnd(line)) {
      yield* goneWithNoRow(writing, rows)
      yield toEndItem(line.end, writing.header, writing.unread)

      return
    }

    rows += 1
    yield toItem(line.row, writing.unread)
  }

  throw new MissingEndError()
}

/** The items read before the stream broke stand; how it ended is said either way, and the log says only what kind of break it was. */
const itemsThenEnd = async function* (
  writing: Writing
): AsyncGenerator<string> {
  try {
    yield* readItems(writing)
  } catch (error) {
    logger.warn(`Explore JSON download stopped early: ${kindOf(error)}`)
    yield toEndItem(broken, writing.header, writing.unread)
  }
}

/** Once a file: how many rows had a part that couldn't be read, and the kind of the first. */
const logUnread = ({ rows, kind }: Unread): void => {
  if (rows) {
    logger.warn(
      `Explore JSON download: ${rows} rows with a part not readable as BSON: ${kind}`
    )
  }
}

/**
 * Download JSON as it is written: a JSON array of canonical Extended JSON,
 * an item a row as GAS sends it, one at a time, and last an item that says
 * where the download stopped, if it did, and what it skipped. A stream that
 * breaks, or ends without GAS's last line, is closed with
 * `"stopped": "error"`, never left cut.
 */
export const toJsonFile = async function* (
  header: ExploreStreamHeader,
  lines: AsyncIterable<ExploreStreamLine>,
  show: ExploreShow | null = null
): AsyncGenerator<string> {
  const writing = { header, lines, show, unread: { rows: 0, kind: null } }
  let opening = '[\n'

  for await (const text of itemsThenEnd(writing)) {
    yield `${opening}${text}`
    opening = ',\n'
  }

  logUnread(writing.unread)
  yield '\n]\n'
}

/** The file as a stream that reads one item at a time: a document's JSON is held only until it is written. */
export const toJsonStream = (
  header: ExploreStreamHeader,
  lines: AsyncIterable<ExploreStreamLine>,
  show: ExploreShow | null = null
): Readable =>
  Readable.from(toJsonFile(header, lines, show), {
    objectMode: false,
    highWaterMark: 1
  })
