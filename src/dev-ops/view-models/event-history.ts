import type {
  EventDetail,
  EventHistoryEntry
} from '../use-cases/get-event.use-case.ts'
import { timeOf, toBlock } from './event-context.ts'
import { toPurgeReasonLabel } from './purge-form.ts'
import { toMillisecondTime, toSecondsTime } from './times.ts'
import type { TimeText, Times } from './times.ts'

type Kind = EventHistoryEntry['kind']

type HistoryTone = 'neutral' | 'danger' | 'warning' | 'info' | 'success'

export type HistoryContent =
  | { kind: 'error'; label: string; code: string }
  | { kind: 'purge'; reason: string | null; note: string | null }
  | {
      kind: 'edit'
      note: string | null
      diff: { before: string; after: string } | null
    }

export interface HistoryItem {
  /** Counted from the oldest, so an entry keeps its id as newer ones arrive. */
  id: string
  icon: string
  tone: HistoryTone
  /** Null for an attempt: its time and its error say it. */
  title: string | null
  hiddenTitle: string | null
  at: TimeText | null
  content: HistoryContent | null
}

const quoted = (note: string | null): string | null =>
  note ? `“${note}”` : null

const toJson = (value: unknown): string => JSON.stringify(value, null, 2)

const toDiff = (entry: { before: unknown; after: unknown }) =>
  entry.before == null || entry.after == null
    ? null
    : { before: toJson(entry.before), after: toJson(entry.after) }

const itemIcons: Record<Kind, string> = {
  received: 'inbox',
  attempt: 'x',
  'dead-lettered': 'archive',
  purged: 'trash',
  'payload-edited': 'pencil',
  redriven: 'refresh-cw',
  delivered: 'check'
}

const itemTones: Record<Kind, HistoryTone> = {
  received: 'neutral',
  attempt: 'danger',
  'dead-lettered': 'warning',
  purged: 'neutral',
  'payload-edited': 'info',
  redriven: 'info',
  delivered: 'success'
}

type EntryOf<K extends Kind> = Extract<EventHistoryEntry, { kind: K }>

type PerKind<T> = { [K in Kind]: (entry: EntryOf<K>) => T }

const byKind = <T>(builders: PerKind<T>, entry: EventHistoryEntry): T =>
  (builders[entry.kind] as (entry: EventHistoryEntry) => T)(entry)

const titles: PerKind<string | null> = {
  received: () => 'Received',
  attempt: () => null,
  'dead-lettered': () => 'Marked as a dead letter',
  purged: ({ by }) => `Purged by ${by}`,
  'payload-edited': ({ by }) => `Payload edited by ${by}`,
  redriven: ({ by }) => `Redriven by ${by}`,
  delivered: () => 'Delivered'
}

const toEdit = (entry: EntryOf<'payload-edited'>): HistoryContent | null => {
  const note = quoted(entry.note)
  const diff = toDiff(entry)

  return note || diff ? { kind: 'edit', note, diff } : null
}

const contents: PerKind<HistoryContent | null> = {
  received: () => null,
  attempt: (entry) => ({
    kind: 'error',
    label: `Attempt ${entry.number}: error`,
    code: toBlock(entry)
  }),
  'dead-lettered': () => null,
  purged: ({ reasonCode, note }) => ({
    kind: 'purge',
    reason: toPurgeReasonLabel(reasonCode) || null,
    note: quoted(note)
  }),
  'payload-edited': toEdit,
  redriven: () => null,
  delivered: () => null
}

/** Attempts come within a second of each other, so theirs are to the millisecond. */
const toAt = (entry: EventHistoryEntry, times: Times): TimeText | null =>
  timeOf(
    entry.at,
    times,
    entry.kind === 'attempt' ? toMillisecondTime : toSecondsTime
  )

const isKnown = (entry: EventHistoryEntry): boolean =>
  Object.hasOwn(itemIcons, entry.kind)

/** Newest first; a kind this page doesn't know yet is left out. */
export const toHistory = (event: EventDetail, times: Times): HistoryItem[] => {
  const entries = (event.history ?? []).filter(isKnown)

  return entries.map((entry, index) => ({
    id: `history-${entries.length - index}`,
    icon: itemIcons[entry.kind],
    tone: itemTones[entry.kind],
    title: byKind(titles, entry),
    hiddenTitle:
      entry.kind === 'attempt' ? `Attempt ${entry.number} failed` : null,
    at: toAt(entry, times),
    content: byKind(contents, entry)
  }))
}
