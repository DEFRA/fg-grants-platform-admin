import { statusCodes } from '../../common/status-codes.ts'
import {
  isCompletedStatus,
  isDeadLetterStatus,
  isPurgedStatus
} from '../use-cases/event-state.ts'
import type {
  EventDetail,
  EventHistoryEntry
} from '../use-cases/get-event.use-case.ts'
import type { Banner, Toast } from './event-banners.ts'
import { sameError, toEventQuery, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'

/** What the page the redrive returned needs to check for its result, and to say how it went. */
export interface WatchModel {
  statusHref: string
  resultHref: string
  waiting: Banner
  /** Without a script nothing checks, so it says how to find out. */
  noScript: Banner & { reloadHref: string }
  /** Still retrying is drawn with the counts the last check gave. */
  stopped: { notRetried: Banner; title: string; againHref: string }
}

/** What a settled redrive came to; anything still on its way is no result yet. */
export type WatchOutcome = 'delivered' | 'failed' | 'purged' | 'waiting'

const stillBanner = (title: string, text: string): Banner => ({
  tone: 'success',
  title,
  text,
  redriveNow: false
})

export const toWatch = (context: EventContext, waiting: Banner): WatchModel => {
  const href = toEventHref(context.key)
  const self = toSelfHref(context)

  return {
    statusHref: `${href}/status`,
    resultHref: `${href}/result${toEventQuery(context.from, context.tab)}`,
    waiting,
    noScript: {
      ...stillBanner(waiting.title, 'Reload the page to see how it went.'),
      reloadHref: self
    },
    stopped: {
      notRetried: stillBanner(
        waiting.title,
        'Not retried yet. Stopped checking after 30 seconds.'
      ),
      title: waiting.title,
      againHref: self
    }
  }
}

export const toWatchOutcome = (status: string): WatchOutcome => {
  if (isCompletedStatus(status)) {
    return 'delivered'
  }

  if (isDeadLetterStatus(status)) {
    return 'failed'
  }

  return isPurgedStatus(status) ? 'purged' : 'waiting'
}

type Attempt = Extract<EventHistoryEntry, { kind: 'attempt' }>

const isAttempt = (entry: EventHistoryEntry): entry is Attempt =>
  entry.kind === 'attempt'

/** The newest error since the last redrive against the newest before it; null with either missing. */
export const toSameError = ({ history = [] }: EventDetail): boolean | null => {
  const redriven = history.findIndex(({ kind }) => kind === 'redriven')
  const since = history.slice(0, Math.max(redriven, 0)).find(isAttempt)
  const before = history.slice(redriven + 1).find(isAttempt)

  return redriven === -1 || !since || !before ? null : sameError(since, before)
}

const failedTexts = {
  same: 'It’s a dead letter again, with the same error.',
  different:
    'It’s a dead letter again, with a different error. History shows it.',
  unknown: 'It’s a dead letter again. History shows the error.'
}

const failedText = (same: boolean | null): string => {
  if (same === null) {
    return failedTexts.unknown
  }

  return same ? failedTexts.same : failedTexts.different
}

/** Failing again is a warning, not an error: the redrive worked, the event didn't. */
export const toFailedAgain = (event: EventDetail): Banner => ({
  tone: 'warning',
  title: 'Failed again.',
  text: failedText(toSameError(event)),
  redriveNow: false
})

export const deliveredToast: Toast = {
  tone: 'success',
  text: 'Event delivered'
}

/** A check or a result that couldn't be read: the page asks again at its next check. */
export const noAnswerCode = statusCodes.badGateway
