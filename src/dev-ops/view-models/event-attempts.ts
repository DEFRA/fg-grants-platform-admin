import type { BucketEntry } from '../repositories/buckets.repository.ts'
import { errorKeyFact, noErrorKey } from './error-search.ts'
import type {
  EventAttempt,
  EventDetail
} from '../use-cases/get-event.use-case.ts'
import type { AttemptCount } from './attempt-count.ts'
import { toUrlService } from './event-address.ts'
import {
  allSame,
  errorLine,
  lastAttemptOf,
  sameError,
  timeOf,
  toBlock
} from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { isAfter, toGap } from './event-formats.ts'
import { deadLetterStatus, toEventsHref } from './events-list.ts'
import { hasNoAttemptsSinceEdit } from './payload-edit.ts'
import { toClockTime, toSecondsTime } from './times.ts'
import type { TimeText } from './times.ts'

export interface AttemptItem {
  title: string
  tone: 'danger' | 'warning'
  clock: TimeText | null
  gap: string | null
  /** Said where this attempt's error differs from the last. */
  differs: { message: string; stack: string | null } | null
  /** Said where errors differ but this one is the last's. */
  sameAsLast: boolean
}

export interface RedrivenSince {
  at: TimeText | null
  by: string
  service: string
  allowed: number | null
  error: string | null
}

interface ErrorsLink {
  text: string
  href: string
}

export interface AttemptsModel {
  count: string | null
  errors: ErrorsLink | null
  /** Redriven since the attempts, with none since. */
  redriven: RedrivenSince | null
  lead: string | null
  lastAt: TimeText | null
  block: string | null
  items: AttemptItem[]
  noAttemptsSinceEdit: boolean
}

interface Anchor {
  at: string
  after: string
}

/** After creation, and not after the attempt it would be measured to. */
const isBetween = (redrive: string, { createdAt }: EventDetail, at: string) =>
  isAfter(redrive, createdAt) && !isAfter(redrive, at)

const redriveAnchor = (event: EventDetail, at: string): Anchor | null => {
  const redrive = event.lastRedrive?.at

  return redrive && isBetween(redrive, event, at)
    ? { at: redrive, after: 'the redrive' }
    : null
}

/** A redrive newer than creation starts the clock again for the attempt after it. */
const firstAnchor = (event: EventDetail, at: string): Anchor =>
  redriveAnchor(event, at) ?? { at: event.createdAt, after: 'it was created' }

const after = (from: string, at: string, what: string): string | null => {
  const gap = toGap(from, at)

  return gap && `${gap} after ${what}`
}

/** Unknown instants get no gap, and the next one is measured from the last known. */
const toGapText = (
  event: EventDetail,
  history: EventAttempt[],
  index: number
): string | null => {
  const at = history[index].at

  if (at === null) {
    return null
  }

  if (index === 0) {
    const anchor = firstAnchor(event, at)

    return after(anchor.at, at, anchor.after)
  }

  const previous = history
    .slice(0, index)
    .findLastIndex((attempt) => attempt.at !== null)

  return previous < 0
    ? null
    : after(history[previous].at!, at, `attempt ${previous + 1}`)
}

const toDiffers = (attempt: EventAttempt) => ({
  message: errorLine(attempt),
  stack: attempt.stack ? toBlock(attempt) : null
})

interface ItemContext {
  context: EventContext
  last: EventAttempt | null
  mixed: boolean
}

const isLastOf = (history: EventAttempt[], index: number) =>
  index === history.length - 1

/** No more retries follow a dead letter's last attempt, so it is "the last"; a retrying one's isn't. */
const toTitle = ({ state }: EventContext, index: number, isLast: boolean) =>
  `Attempt ${index + 1}${isLast && (state.deadLetter || state.purged) ? ', the last' : ''}`

const isSame = (attempt: EventAttempt, last: EventAttempt | null) =>
  last !== null && sameError(attempt, last)

/** Only a dead letter's newest failure ended it; every other one was retried. */
const toAttemptTone = (
  { state }: EventContext,
  isLast: boolean
): AttemptItem['tone'] => (isLast && state.deadLetter ? 'danger' : 'warning')

const toItem =
  ({ context, last, mixed }: ItemContext) =>
  (
    attempt: EventAttempt,
    index: number,
    history: EventAttempt[]
  ): AttemptItem => {
    const isLast = isLastOf(history, index)
    const same = isSame(attempt, last)

    return {
      title: toTitle(context, index, isLast),
      tone: toAttemptTone(context, isLast),
      clock: timeOf(attempt.at, context.times, toClockTime),
      gap: toGapText(context.event, history, index),
      differs: same ? null : toDiffers(attempt),
      sameAsLast: mixed && same && !isLast
    }
  }

const toItems = (context: EventContext): AttemptItem[] => {
  const history = context.event.attemptHistory
  const last = lastAttemptOf(context.event)
  const mixed =
    last !== null && history.some((attempt) => !sameError(attempt, last))

  return history.map(toItem({ context, last, mixed }))
}

const offersDeadLetter = ({ name, values }: BucketEntry['facts'][number]) =>
  name === 'status' &&
  (values ?? []).some(({ value }) => value === deadLetterStatus)

/** A list can show every event with one error only if it filters by both the status and the error's key. */
const filtersByError = (list: BucketEntry | null): boolean =>
  Boolean(
    list?.facts.some(({ name }) => name === errorKeyFact) &&
    list.facts.some(offersDeadLetter)
  )

const errorsText = (errorKey: string): string =>
  errorKey === noErrorKey
    ? 'Dead letters with no recorded error'
    : 'Events with this error'

/** Its own queue's dead letters with this error's key, as Top errors counts them. */
const toErrors = ({
  event: { errorKey },
  key,
  catalogue,
  ownList
}: EventContext): ErrorsLink | null => {
  if (!errorKey || !filtersByError(ownList)) {
    return null
  }

  const href = toEventsHref(catalogue, {
    service: toUrlService(key.service),
    box: key.box,
    filters: { status: deadLetterStatus, [errorKeyFact]: errorKey },
    clear: true
  })

  return href === null ? null : { text: errorsText(errorKey), href }
}

/** More attempts than allowed can't read as a share of them: the count alone, then. */
const countText = (made: number, count: AttemptCount | null) => {
  if (count === null) {
    return null
  }

  return made > count.allowed ? `${made}` : `${made} of ${count.allowed}`
}

const attemptStatuses = new Set([
  deadLetterStatus,
  'FAILED',
  'RESUBMITTED',
  'PURGED'
])

const errorOf = (event: EventDetail): string | null =>
  event.lastError && errorLine(event.lastError)

const toRedriven = (context: EventContext): AttemptsModel => {
  const { event, count, times, service } = context
  const redrive = event.lastRedrive!

  return {
    count: countText(0, count),
    errors: null,
    redriven: {
      at: timeOf(redrive.at, times),
      by: redrive.by,
      service,
      allowed: count?.allowed ?? null,
      error: errorOf(event)
    },
    lead: null,
    lastAt: null,
    block: null,
    items: [],
    noAttemptsSinceEdit: hasNoAttemptsSinceEdit(event)
  }
}

const toLead = (event: EventDetail): string | null => {
  if (allSame(event)) {
    return 'All failed with the same error'
  }

  if (event.attemptHistory.length) {
    return `The last error, from attempt ${event.attemptHistory.length}`
  }

  return event.lastError && 'The last error'
}

const toBlockOf = (event: EventDetail): string | null => {
  const last = lastAttemptOf(event)

  return last ? toBlock(last) : errorOf(event)
}

const lastErrorAt = (event: EventDetail): string | null =>
  event.lastError?.at ?? null

const lastAtOf = (event: EventDetail): string | null =>
  lastAttemptOf(event)?.at ?? lastErrorAt(event)

const madeOf = ({ event, count }: EventContext): number =>
  count?.made ?? event.attemptHistory.length

const toFailing = (context: EventContext): AttemptsModel => {
  const { event, count, times } = context

  return {
    count: countText(madeOf(context), count),
    errors: toErrors(context),
    redriven: null,
    lead: toLead(event),
    lastAt: timeOf(lastAtOf(event), times, toSecondsTime),
    block: toBlockOf(event),
    items: toItems(context),
    noAttemptsSinceEdit: hasNoAttemptsSinceEdit(event)
  }
}

/** Drawn while the event has failed, been redriven or purged. */
export const toAttempts = (context: EventContext): AttemptsModel | null => {
  if (!attemptStatuses.has(context.event.status)) {
    return null
  }

  return context.state.redrivenSinceAttempts && context.event.lastRedrive
    ? toRedriven(context)
    : toFailing(context)
}
