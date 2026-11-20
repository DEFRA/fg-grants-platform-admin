import type {
  ExploreAnswer,
  ExploreContext,
  ExploreDocNote,
  ExploreOpen,
  ExploreRow,
  ExploreShow,
  ExploreStart
} from '../use-cases/explore-calls.ts'
import { docLine } from '../views/components/core/doc.ts'
import { explorePath } from './bucket-nav.ts'
import { firstValueOf, readBase64, toPrinted } from './explore-bson.ts'
import type { BsonValue, Stored } from './explore-bson.ts'
import { contextOf } from './explore-context.ts'

/** A form's hidden field. */
export interface HiddenField {
  name: string
  value: string
}

/** Show it's post: the run, the row it shows, and the row's number. */
export interface ShowForm {
  action: string
  label: string
  fields: HiddenField[]
}

/** Why a document isn't printed, and the way to it, if there is one. */
export type DocumentNote =
  | { text: string; action: null }
  | { text: string; action: 'download'; label: string }

/** A second printout under the first: the record the row's record names. */
export interface RelatedDocument {
  title: string
  doc: BsonValue
  label: string
}

/** What a result shows open: its document as stored, and what it sits beside; or why it isn't printed. */
export interface DocumentPrintout {
  doc: BsonValue | null
  /** An event's service and box, or that its record names no stored one. */
  context: string | null
  related: RelatedDocument | null
  note: DocumentNote | null
  /** Its record no longer passes the filter, as the read that printed it found. */
  changed: string | null
}

/**
 * A result's line: its document's start, typed as the printout types it, `cut`
 * when the start isn't the whole document, `quotedKey` when the last key cut in
 * it is printed quoted, as the whole key is, though its kept text needs no
 * quotes; or why there is none.
 */
export type DocumentLine =
  | { kind: 'start'; doc: BsonValue; cut: boolean; quotedKey: boolean }
  | { kind: 'note'; note: DocumentNote }

/**
 * How a result opens: Show it's form, posted in place for a document within
 * a page's printing bounds; for a larger one its caret opens, keeping its line,
 * onto Show it to its own page; or content the page holds, drawn open on the page
 * a Show it lands on.
 */
export type DocumentOpens =
  | {
      kind: 'form'
      form: ShowForm
      /** The same fields by name, as the line's form takes them. */
      fields: Record<string, string>
    }
  | {
      kind: 'show'
      open: boolean
      form: ShowForm
      /** Said beside Show it: why the document isn't printed here. */
      text: string
      /** The button's name, its visible text first. */
      buttonLabel: string
    }
  | { kind: 'page'; open: boolean; printout: DocumentPrintout }

export interface ExploreDocumentModel {
  id: string
  restoreHref: string | null
  label: string
  /** The line's own id, by its number: an open's answer draws the line of that id. */
  lineId: string
  line: DocumentLine
  /** Said under the line: its record no longer passes the filter, though it was found by it. */
  aside: string | null
  opens: DocumentOpens | null
}

/** What the page knows of a row before its document: where it is and its number among the results. */
export interface DocumentPlace {
  id: string
  restoreHref: string | null
  number: number
}

/** Where a result is drawn: in a run's list, as a Show it run's one row, or answering an open in place. */
export type DocumentWhere = 'list' | 'shown' | 'opened'

/** What a row's note is said about: its run, what a record is called, the Show it that reads it and the result's number. */
interface NoteAbout {
  run: string
  noun: string
  show: ExploreShow | null
  number: number
}

export const changedText =
  'Changed since it was found: it may no longer match the filter.'

/** A page prints an open in place within these: a larger document opens on the result's own page. */
export const inPlaceBytes = 1024 * 1024
export const inPlaceValues = 50_000

/** A group prints as its whole document; a value and a count as the one value they are. */
const shownOf = (mode: ExploreAnswer['mode'], doc: Stored): Stored =>
  mode === 'distinct' || mode === 'count' ? (firstValueOf(doc) ?? doc) : doc

const unreadable = (noun: string): DocumentNote => ({
  text: `This ${noun}’s document isn’t readable as BSON.`,
  action: null
})

const readOr = (base64: string): Stored | null => {
  try {
    return readBase64(base64)
  } catch {
    return null
  }
}

/** An event's service and box, so Show it reads that box alone. */
const boxOf = (
  context: ExploreContext | null | undefined
): Pick<ExploreShow, 'service' | 'box'> =>
  contextOf<Pick<ExploreShow, 'service' | 'box'>>(context, {
    none: () => ({ service: null, box: null }),
    box: ({ service, box }) => ({ service, box }),
    definition: () => ({ service: null, box: null }),
    agreement: () => ({ service: null, box: null })
  })

/** The row Show it reads: its record's `_id`, the places `$unwind` took it from, and an event's box; none for a group, value or count. */
export const toRowShow = (row: ExploreRow): ExploreShow | null =>
  row.id ? { id: row.id, at: row.at ?? [], ...boxOf(row.context) } : null

/** Show it posts the run and the row it shows, and the row's number. */
export const toShowForm = (
  run: string,
  show: ExploreShow,
  number: number
): ShowForm => ({
  action: explorePath,
  label: `Show result ${number}`,
  fields: [
    { name: 'run', value: run },
    { name: 'show', value: show.id },
    { name: 'result', value: String(number) },
    ...(show.at.length
      ? [{ name: 'at', value: show.at.map(String).join(',') }]
      : []),
    ...(show.service && show.box
      ? [
          { name: 'service', value: show.service },
          { name: 'box', value: show.box }
        ]
      : [])
  ]
})

export const goneText = (noun: string): string =>
  `This ${noun} no longer exists. Run the query again.`

const tooLargeHere = (noun: string): string =>
  `This ${noun}’s document is too large to print on a page.`

/** Show it to its own page, beside why the document isn't printed here. */
const toShowOpens = (
  open: boolean,
  { run, noun, number }: Omit<NoteAbout, 'show'>,
  show: ExploreShow
): DocumentOpens => ({
  kind: 'show',
  open,
  form: toShowForm(run, show, number),
  text: tooLargeHere(noun),
  buttonLabel: `Show in new tab, result ${number}`
})

type Notes = {
  [K in 'gone' | 'later' | 'tooLarge']: (
    note: Extract<ExploreDocNote, Record<K, unknown>>,
    about: NoteAbout
  ) => DocumentNote
}

/** Each note GAS sends in place of a document, as the page says it: a document too large for one answer is in Download JSON. */
const notes: Notes = {
  gone: (_, { noun }) => ({ text: goneText(noun), action: null }),
  later: (_, { noun }) => ({
    text: `${tooLargeHere(noun)} Download JSON holds it whole.`,
    action: 'download',
    label: 'Download JSON'
  }),
  tooLarge: () => ({
    text: 'This projection makes the document larger than mongod allows.',
    action: null
  })
}

const noteKind = (docNote: ExploreDocNote): keyof Notes | null => {
  const [kind] = Object.keys(docNote)

  return Object.hasOwn(notes, kind) ? (kind as keyof Notes) : null
}

const toNote = (
  docNote: ExploreDocNote | null | undefined,
  about: NoteAbout
): DocumentNote => {
  const kind = docNote ? noteKind(docNote) : null

  return kind
    ? (notes[kind] as (n: ExploreDocNote, a: NoteAbout) => DocumentNote)(
        docNote!,
        about
      )
    : unreadable(about.noun)
}

const isChanged = (docNote: ExploreDocNote | null | undefined): boolean =>
  Boolean(docNote && 'changed' in docNote)

const isGone = (docNote: ExploreDocNote | null | undefined): boolean =>
  Boolean(docNote && 'gone' in docNote)

const isLater = (docNote: ExploreDocNote | null | undefined): boolean =>
  Boolean(docNote && 'later' in docNote)

/** What a Show it row's Table says of its record, as its document would: changed since it was found, or gone. */
export const toShownNote = (
  { docNote }: ExploreRow,
  noun: string
): string | null => {
  if (isChanged(docNote)) {
    return changedText
  }

  return isGone(docNote) ? goneText(noun) : null
}

/** Whose definition a version names, by what it opens. */
const definitionTitles: Partial<Record<ExploreOpen['kind'], string>> = {
  grant: 'Its grant definition (grants: ',
  workflow: 'Its workflow definition (workflows: '
}

const definitionTitle = (open: ExploreOpen | null): string => {
  const title = open && definitionTitles[open.kind]

  return title && 'version' in open
    ? `${title}${open.code} ${open.version})`
    : 'Its definition'
}

type Joined = {
  related: RelatedDocument | null
  context: string | null
  joined: Stored | null
}

const noJoin: Joined = { related: null, context: null, joined: null }

/** A joined record as a printout of its own, titled; the words when the row's record names none. */
const toJoined = (
  base64: string | null,
  { title, none, number }: { title: string; none: string; number: number }
): Joined => {
  const joined = base64 === null ? null : readOr(base64)

  if (joined === null) {
    return {
      ...noJoin,
      context: base64 === null ? none : unreadable('record').text
    }
  }

  return {
    related: {
      title,
      doc: toPrinted(joined),
      label: `${title}, result ${number}`
    },
    context: null,
    joined
  }
}

/** An event's service and box as a line; a version's or payment's record as a printout of its own. */
const toContext = (
  context: ExploreContext | null | undefined,
  { open, number }: { open: ExploreOpen | null; number: number }
): Joined =>
  contextOf(context, {
    none: () => noJoin,
    box: ({ service, box }) => ({ ...noJoin, context: `${service} ${box}` }),
    definition: (definition) =>
      toJoined(definition, {
        title: definitionTitle(open),
        none: 'It names no stored definition.',
        number
      }),
    agreement: (agreement) =>
      toJoined(agreement, {
        title: 'Its agreement',
        none: 'It names no agreement.',
        number
      })
  })

/** A list's or object's own elements, every one at every depth, as GAS counts a document's printed values. */
const valuesIn = (value: Stored): number => {
  if (value.t === 'object' || value.t === 'array') {
    return value.entries.reduce((n, [, inner]) => n + 1 + valuesIn(inner), 0)
  }

  return value.t === 'javascriptWithScope' ? valuesIn(value.scope) : 0
}

const bytesOf = (base64: string): number => Buffer.byteLength(base64, 'base64')

const joinedOf = (context: ExploreContext | null | undefined): string | null =>
  contextOf(context, {
    none: () => null,
    box: () => null,
    definition: (definition) => definition,
    agreement: (agreement) => agreement
  })

/** A document and its joined record, as GAS sized them, within what a page prints in place. */
const isWithinPage = ({ bytes, values }: { bytes: number; values: number }) =>
  bytes <= inPlaceBytes && values <= inPlaceValues

const valuesOr = (value: Stored | null): number =>
  value === null ? 0 : valuesIn(value)

/** An open's answer, read again: its document and joined record together, within what a page prints in place. */
const fitsInPlace = (row: ExploreRow, doc: Stored, joined: Stored | null) =>
  isWithinPage({
    bytes: bytesOf(row.doc ?? '') + bytesOf(joinedOf(row.context) ?? ''),
    values: valuesIn(doc) + valuesOr(joined)
  })

const toLine = (
  start: ExploreStart,
  noun: string,
  mode: ExploreAnswer['mode'] = 'rows'
): DocumentLine => {
  const doc = readOr(start.doc)

  return doc
    ? {
        kind: 'start',
        doc: toPrinted(shownOf(mode, doc)),
        cut: start.cut,
        quotedKey: start.quotedKey === true
      }
    : { kind: 'note', note: unreadable(noun) }
}

const noteLine = (note: DocumentNote): DocumentLine => ({ kind: 'note', note })

/** The line a row's start prints, or null when it has none or it isn't readable. */
const startLineOf = (
  row: ExploreRow,
  noun: string,
  mode: ExploreAnswer['mode'] = 'rows'
): DocumentLine | null => {
  if (!row.start) {
    return null
  }

  const line = toLine(row.start, noun, mode)

  return line.kind === 'start' ? line : null
}

const readDocOf = (row: ExploreRow): Stored | null =>
  row.doc ? readOr(row.doc) : null

const isPrintedInPlace = (printed: ExploreRow['printed']): boolean =>
  Boolean(printed && isWithinPage(printed))

const toOpenForm = (
  row: ExploreRow,
  about: NoteAbout,
  show: ExploreShow
): DocumentOpens => {
  const form = toShowForm(about.run, show, about.number)

  if (!isPrintedInPlace(row.printed)) {
    return toShowOpens(false, about, show)
  }

  return {
    kind: 'form',
    form,
    fields: Object.fromEntries(
      form.fields.map(({ name, value }) => [name, value])
    )
  }
}

/** A list row with no start is gone or made too large by its projection, and says so. */
const isNotedInList = (docNote: ExploreDocNote | null | undefined): boolean =>
  Boolean(docNote && ('gone' in docNote || 'tooLarge' in docNote))

/** A start is read whole when GAS cut nothing: a cut one always prints past the line. */
const isLineWhole = (
  start: ExploreStart,
  mode: ExploreAnswer['mode'] = 'rows'
): boolean => {
  const doc = readOr(start.doc)

  return (
    doc === null || !start.cut || docLine(toPrinted(shownOf(mode, doc))).cut
  )
}

const isNotedBesideStart = (
  docNote: ExploreDocNote | null | undefined
): boolean => Boolean(docNote) && !isChanged(docNote)

/** A start's row names its record and says at most that it changed, and a cut start prints past the line. */
const malformedStart = (
  row: ExploreRow,
  start: ExploreStart
): string | null => {
  if (!row.id) {
    return 'a start with no _id'
  }

  if (isNotedBesideStart(row.docNote)) {
    return 'a start with a note'
  }

  return isLineWhole(start) ? null : 'a cut start that prints whole'
}

/** What makes a list row one GAS can't have sent: no start but for gone or too large, or a start that is malformed. */
const malformedListRow = (row: ExploreRow): string | null => {
  if (row.start) {
    return malformedStart(row, row.start)
  }

  return isNotedInList(row.docNote) ? null : 'a row with no start'
}

/** A row beside its document (a group, value or count, or Show it's record) carries the start its line is printed from. */
const malformedBesideDoc = (
  row: ExploreRow,
  mode: ExploreAnswer['mode']
): string | null => {
  if (!row.doc) {
    return null
  }

  if (!row.start) {
    return 'a document with no start'
  }

  return isLineWhole(row.start, mode) ? null : 'a cut start that prints whole'
}

const firstMalformed = (
  rows: ExploreRow[],
  malformed: (row: ExploreRow) => string | null
): string | null => {
  for (const row of rows) {
    const found = malformed(row)

    if (found) {
      return found
    }
  }

  return null
}

/** Why a Documents list can't be drawn from this answer, or null: its record rows carry starts, its groups, values and counts a start beside their documents. */
export const toMalformedList = (answer: ExploreAnswer): string | null =>
  firstMalformed(answer.rows, (row) =>
    answer.mode === 'rows'
      ? malformedListRow(row)
      : malformedBesideDoc(row, answer.mode)
  )

/** Why a Show it answer can't be drawn, or null: its record's document comes with the start its line is printed from. */
export const toMalformedShown = (answer: ExploreAnswer): string | null =>
  firstMalformed(answer.rows, (row) => malformedBesideDoc(row, answer.mode))

/** A record's row in a run's list: its start's line, opened by Show it's form, in place while its document as fetched is within what a page prints, else onto its line kept and Show it under it. */
const toListRecord = (
  row: ExploreRow,
  about: NoteAbout
): Pick<ExploreDocumentModel, 'line' | 'opens'> => {
  const line = row.start
    ? toLine(row.start, about.noun)
    : noteLine(toNote(row.docNote, about))

  return {
    line,
    opens:
      line.kind === 'start' && about.show
        ? toOpenForm(row, about, about.show)
        : null
  }
}

/** A group, value or count: worked out, not stored, so its printout is in the page and opens without a read; its line is its start's. */
const toWorkedOut = (
  row: ExploreRow,
  mode: ExploreAnswer['mode'],
  noun: string
): Pick<ExploreDocumentModel, 'line' | 'opens'> => {
  const doc = readDocOf(row)
  const line = startLineOf(row, noun, mode)

  if (!doc || !line) {
    return { line: noteLine(unreadable(noun)), opens: null }
  }

  const shown = toPrinted(shownOf(mode, doc))

  return {
    line,
    opens: {
      kind: 'page',
      open: false,
      printout: {
        doc: shown,
        context: null,
        related: null,
        note: null,
        changed: null
      }
    }
  }
}

type Shape = Pick<ExploreDocumentModel, 'line' | 'opens'>

const notOpened = (note: DocumentNote): Shape => ({
  line: noteLine(note),
  opens: null
})

const drawnOpen = (
  line: DocumentLine,
  doc: Stored,
  printout: Omit<DocumentPrintout, 'doc'>
): Shape => ({
  line,
  opens: {
    kind: 'page',
    open: true,
    printout: { doc: toPrinted(doc), ...printout }
  }
})

/** A record too large to print in place: its line drawn open, kept, with Show it to its own page under it. */
const onItsOwnPage = (line: DocumentLine, about: NoteAbout): Shape => ({
  line,
  opens: about.show ? toShowOpens(true, about, about.show) : null
})

/** A record read whole by Show it: drawn open under its start's line, its document with what it sits beside; an open in place prints it only within what a page prints. */
const toReadDocument = (
  row: ExploreRow,
  { doc, line }: { doc: Stored; line: DocumentLine },
  about: NoteAbout,
  where: DocumentWhere
): Shape => {
  const { joined, ...context } = toContext(row.context, {
    open: row.open,
    number: about.number
  })

  if (where === 'opened' && !fitsInPlace(row, doc, joined)) {
    return onItsOwnPage(line, about)
  }

  return drawnOpen(line, doc, {
    ...context,
    note: null,
    changed: isChanged(row.docNote) ? changedText : null
  })
}

/** The record an open names, as its line, when the answer holds no document of it. */
export const toIdDoc = (show: ExploreShow): BsonValue | null => {
  const id = readOr(show.id)

  return id && toPrinted(id)
}

/** The line of a record an open in place reads past one answer: its start's, or its `_id`'s when no start of it came. */
const toLaterLine = (
  row: ExploreRow,
  about: NoteAbout
): DocumentLine | null => {
  const id = about.show && toIdDoc(about.show)

  return (
    startLineOf(row, about.noun) ??
    (id ? { kind: 'start', doc: id, cut: false, quotedKey: false } : null)
  )
}

/** A record read with no document: in place, one past one answer keeps its line drawn open with Show it under it; otherwise its note in place of the line. */
const toDocless = (
  row: ExploreRow,
  about: NoteAbout,
  where: DocumentWhere
): Shape => {
  const line =
    where === 'opened' && isLater(row.docNote) ? toLaterLine(row, about) : null

  return line
    ? onItsOwnPage(line, about)
    : notOpened(toNote(row.docNote, about))
}

const toReadRecord = (
  row: ExploreRow,
  about: NoteAbout,
  where: DocumentWhere
): Shape => {
  if (!row.doc) {
    return toDocless(row, about, where)
  }

  const doc = readDocOf(row)
  const line = startLineOf(row, about.noun)

  return doc && line
    ? toReadDocument(row, { doc, line }, about, where)
    : notOpened(unreadable(about.noun))
}

const toShape = (
  answer: ExploreAnswer,
  row: ExploreRow,
  about: NoteAbout,
  where: DocumentWhere
): Shape => {
  if (answer.mode !== 'rows') {
    return toWorkedOut(row, answer.mode, about.noun)
  }

  return where === 'list'
    ? toListRecord(row, about)
    : toReadRecord(row, about, where)
}

/** Results are numbered across every window a page shows, so a number names one line on it. */
export const toLineId = (number: number): string => `result-${number}`

const asideOf = (row: ExploreRow, where: DocumentWhere): string | null =>
  where === 'list' && isChanged(row.docNote) ? changedText : null

/**
 * A row as Documents draws it, numbered across every window shown: a line
 * that opens into its document as stored; a row whose document isn't there
 * says why in place of its line, with nothing to open.
 */
export const toDocument = (
  answer: ExploreAnswer,
  row: ExploreRow,
  { id, restoreHref, number }: DocumentPlace,
  {
    run,
    where,
    show
  }: { run: string; where: DocumentWhere; show?: ExploreShow }
): ExploreDocumentModel => {
  const about = {
    run,
    noun: answer.source.noun,
    show: show ?? toRowShow(row),
    number
  }
  return {
    id,
    restoreHref,
    label: `Result ${number}`,
    lineId: toLineId(number),
    ...toShape(answer, row, about, where),
    aside: asideOf(row, where)
  }
}

/** A result whose document isn't drawn, by a note in place of its line: gone with no row for it, or one an open can't show. */
export const toNotedDocument = (
  { id, restoreHref, number }: DocumentPlace,
  note: DocumentNote
): ExploreDocumentModel => ({
  id,
  restoreHref,
  label: `Result ${number}`,
  lineId: toLineId(number),
  line: noteLine(note),
  aside: null,
  opens: null
})
