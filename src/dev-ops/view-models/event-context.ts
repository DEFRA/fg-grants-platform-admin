import type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'
import type {
  EventAttempt,
  EventDetail,
  EventKey,
  EventRecord
} from '../use-cases/get-event.use-case.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import type { AttemptCount } from './attempt-count.ts'
import { backKey } from './bucket-links.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import { toEventHref, toValidDate } from './event-formats.ts'
import type { EventState } from '../use-cases/event-state.ts'
import { toFittingBack } from './record-filters.ts'
import { toTime } from './times.ts'
import type { TimeText, Times } from './times.ts'

/** What every part of the event page is drawn from. */
export interface EventContext {
  event: EventDetail
  key: EventKey
  state: EventState
  count: AttemptCount | null
  times: Times
  /** GAS or CW: the service that owns the event. */
  service: string
  /** The page it was opened from, checked; empty for none. */
  from: string
  eventHref: string
  /** The tab the page is on, which its own links keep. */
  tab: 'overview' | 'history'
  catalogue: Catalogue | null
  /** The list the event's queue is on. */
  ownList: BucketEntry | null
}

export const serviceNames: Record<EventKey['service'], string> = {
  gas: 'GAS',
  caseworking: 'CW'
}

const toParams = (from: string, tab: string) =>
  new URLSearchParams({
    ...(from ? { [backKey]: toFittingBack(from) } : {}),
    ...(tab === 'history' ? { tab } : {})
  })

/** The event page's query: the page it goes back to, its tab unless the Overview, and at most one ask. */
export const toEventQuery = (
  from: string,
  tab: string,
  extra?: [string, string]
): string => {
  const params = toParams(from, tab)

  if (extra) {
    params.set(...extra)
  }

  return params.size ? `?${params}` : ''
}

/** The event's own address, keeping the page it came from, its tab and, at most, one ask of the page. */
export const toSelfHref = (
  {
    key,
    from,
    tab = 'overview'
  }: Pick<EventContext, 'key' | 'from'> & Partial<Pick<EventContext, 'tab'>>,
  extra?: [string, string],
  fragment = ''
): string => `${toEventHref(key)}${toEventQuery(from, tab, extra)}${fragment}`

const dateOf = (value: string | null | undefined): Date | null =>
  value ? toValidDate(value) : null

/** A time as the page writes it, in the person's zone; none for a value that is no time. */
export const timeOf = (
  value: string | null | undefined,
  times: Times,
  format = toTime
): TimeText | null => {
  const date = dateOf(value)

  return date && format(date, times)
}

const recordLinks: Record<
  EventRecord['kind'],
  { toHref: (record: EventRecord) => string; title: string }
> = {
  application: {
    toHref: ({ code, ref }) => toApplicationHref({ code, clientRef: ref }),
    title: applicationType.title
  },
  case: {
    toHref: ({ code, ref }) => toCaseHref({ workflowCode: code, caseRef: ref }),
    title: caseType.title
  }
}

export interface RecordLink {
  title: string
  text: string
  href: string
}

/** The one record the event belongs to, as the service that stored it names it. */
export const toRecordLink = (
  record: EventRecord | null | undefined
): RecordLink | null => {
  if (!record) {
    return null
  }

  const link = recordLinks[record.kind]

  return link
    ? { title: link.title, text: record.ref, href: link.toHref(record) }
    : null
}

/** `Error: message`, as the service would log it. */
export const errorLine = ({
  name,
  message
}: Pick<EventAttempt, 'name' | 'message'>): string =>
  name ? `${name}: ${message}` : message

/** The error and its stack trace in one block: the stack's own first line is the error, else it is put first. */
export const toBlock = (
  attempt: Pick<EventAttempt, 'name' | 'message' | 'stack'>
): string => {
  const { stack, name } = attempt

  if (!stack) {
    return errorLine(attempt)
  }

  return stack.startsWith(name) ? stack : `${errorLine(attempt)}\n${stack}`
}

/** An empty message says nothing, so it is the same as no other. */
const sameMessage = (a: string, b: string): boolean =>
  a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a))

/** One error cut shorter than the other is the same error. */
export const sameError = (
  a: Pick<EventAttempt, 'name' | 'message'>,
  b: Pick<EventAttempt, 'name' | 'message'>
): boolean => a.name === b.name && sameMessage(a.message, b.message)
