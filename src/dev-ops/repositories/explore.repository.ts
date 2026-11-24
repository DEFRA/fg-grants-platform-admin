import { config } from '../../common/config.ts'
import { getFromGas, postToGas } from '../../common/gas.ts'

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

export type ExploreOpen =
  | { kind: 'application' | 'case'; code: string; ref: string }
  | { kind: 'grant' | 'workflow'; code: string; version: string }
  | {
      kind: 'event'
      service: 'GAS' | 'CW'
      box: 'outbox' | 'inbox'
      id: string
    }

export interface ExploreRow {
  open: ExploreOpen | null
  cells: Record<string, ExploreCell>
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

/** Reads nothing: GAS only checks the query, and names its source. */
export const checkExplore = async (
  query: string
): Promise<{ ok: true; source: string } & WithVocabulary> =>
  postToGas<{ ok: true; source: string } & WithVocabulary>(queryPath, {
    payload: { query, check: true }
  })

export const findVocabulary = async (): Promise<Vocabulary> =>
  getFromGas<Vocabulary>('/grant-admin/explore/vocabulary')
