import type { EditOutcome } from '../use-cases/edit-payload.use-case.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type { PurgeOutcome } from '../use-cases/purge-event.use-case.ts'
import type { RedriveOutcome } from '../use-cases/redrive-event.use-case.ts'
import { toFailureText } from './failure-text.ts'

export type EventWriteAction = 'redrive' | 'purge' | 'edit'

interface RedriveNotice {
  outcome: RedriveOutcome
  status: string | null
  failure?: GasFailure | null
}

/** What a write left in the session for the page it returns to, spent on one render. */
export interface EventNotice {
  outcome: RedriveOutcome | PurgeOutcome | EditOutcome
  /** Only a conflict reports one. */
  status: string | null
  /** Only a refused edit reports one. */
  reason?: string | null
  /** Only a write that went unanswered or failed reports one. */
  failure?: GasFailure | null
  /** A flash the redirect never delivered must not surface on another event. */
  page: string
  /** A session written before purge existed names none: it can only be a redrive. */
  action?: EventWriteAction
  /** Save and redrive: the redrive that followed a saved edit. */
  redrive?: RedriveNotice | null
}

export interface Banner {
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  text: string
  /** Saved but not retried: the banner offers the redrive. */
  redriveNow: boolean
  /** Redriven: the page checks for the result, with a spinner for the banner's icon. */
  busy?: boolean
}

export interface Toast {
  tone: 'success' | 'info'
  text: string
}

/** What the page has just read about the event, for a banner that says where it now stands. */
export interface BannerContext {
  /** GAS or CW: the service that owns the event. */
  service: string
  /** The event's deletion date, as a day. */
  deletionDay: string | null
  canRedrive: boolean
}

type BannerFor = (notice: EventNotice, context: BannerContext) => Banner

const notRedriven = 'Not redriven.'
const notPurged = 'Not purged.'
const notSaved = 'Not saved.'

const banner = (
  tone: Banner['tone'],
  title: string,
  text: string,
  redriveNow = false
): Banner => ({ tone, title, text, redriveNow })

/** The status is the service's own word for it, so it is quoted, not translated. */
const cantNow = (status: string | null, cannot: string): string =>
  status === null
    ? `This event can’t be ${cannot} now.`
    : `This event is now ${status}, so it can’t be ${cannot}.`

const nowIs = (status: string | null, cannot: string): string =>
  `${cantNow(status, cannot)} Nothing has changed.`

const gone = ({ service }: BannerContext) =>
  `${service} no longer has this event. Nothing has changed.`

/** A flash another release wrote may name no failure: the outcome's own, then. */
const failureOf = ({ outcome, failure }: EventNotice): GasFailure =>
  failure ?? { kind: outcome === 'timed-out' ? 'timed-out' : 'errored' }

const failed = (notice: EventNotice, { service }: BannerContext) =>
  `${toFailureText(failureOf(notice), service)} Nothing has changed — try again in a moment.`

const unanswered = (notice: EventNotice, { service }: BannerContext) =>
  toFailureText(failureOf(notice), service)

/** Already in its waiting form, so it is announced once, with this text. */
const checking = (title: string): Banner => ({
  ...banner('success', title, 'Checking for the result…'),
  busy: true
})

const redriveBanners: Record<RedriveOutcome, BannerFor> = {
  redriven: () => checking('Redriven.'),
  conflict: ({ status }) =>
    banner('warning', notRedriven, nowIs(status, 'redriven')),
  'not-found': (_notice, context) =>
    banner('danger', notRedriven, gone(context)),
  'timed-out': (notice, context) =>
    banner(
      'warning',
      'Redrive status unknown.',
      `${unanswered(notice, context)} Refresh to see whether the event was queued before redriving it again.`
    ),
  unavailable: (notice, context) =>
    banner('danger', notRedriven, failed(notice, context))
}

const purgeBanners: Record<PurgeOutcome, BannerFor> = {
  purged: (_notice, { deletionDay }) =>
    banner(
      'info',
      'Purged.',
      deletionDay === null
        ? 'It won’t be retried. You can still redrive it.'
        : `It won’t be retried. You can still redrive it until ${deletionDay}.`
    ),
  conflict: ({ status }) =>
    banner('warning', notPurged, nowIs(status, 'purged')),
  'not-found': (_notice, context) => banner('danger', notPurged, gone(context)),
  rejected: (_notice, { service }) =>
    banner(
      'danger',
      notPurged,
      `${service} refused the request. Nothing has changed.`
    ),
  'timed-out': (notice, context) =>
    banner(
      'warning',
      'Purge status unknown.',
      `${unanswered(notice, context)} Refresh to see whether the event was purged before trying again.`
    ),
  unavailable: (notice, context) =>
    banner('danger', notPurged, failed(notice, context))
}

const refusals: Record<string, string> = {
  TOO_LARGE: 'The payload is over 256 KiB once formatted.',
  UNCHANGED: 'The payload is the same as the one stored.',
  NOT_AN_OBJECT: 'The payload must be a JSON object.',
  DOLLAR_KEY: 'A key starts with $, which can’t be stored.'
}

/** A reason this release has no sentence for still reads as a refusal, never as an outage. */
const toRefusal = (reason: string | null | undefined, service: string) => {
  const refusal = refusals[reason ?? ''] ?? `${service} refused the change.`

  return `${refusal} Nothing has changed.`
}

const stored = 'The edited payload is stored'
const savedNotRedriven = 'Payload saved. Not redriven.'

/** Save and redrive, where the save went through: the save stands, so no banner says nothing has changed. */
const savedThenRedrive: Record<
  RedriveOutcome,
  (redrive: RedriveNotice, context: BannerContext) => Banner
> = {
  redriven: () => checking('Payload saved and redriven.'),
  conflict: ({ status }) =>
    banner(
      'warning',
      savedNotRedriven,
      `${stored}. ${cantNow(status, 'redriven')}`
    ),
  'not-found': (_redrive, { service }) =>
    banner(
      'danger',
      savedNotRedriven,
      `${stored}, but ${service} no longer had the event to redrive.`
    ),
  'timed-out': (redrive, context) =>
    banner(
      'warning',
      'Payload saved. Redrive status unknown.',
      `${stored}. ${unanswered({ ...redrive, page: '' }, context)} Refresh to see whether the event was queued before redriving it again.`
    ),
  unavailable: (_redrive, context) =>
    banner(
      'danger',
      savedNotRedriven,
      `${stored}, but the redrive didn’t go through. You can try the redrive again.`,
      context.canRedrive
    )
}

/** A stale or unanswered save comes back as the editor or the held changes, never as a flash. */
const editBanners: Record<
  Exclude<EditOutcome, 'stale' | 'timed-out' | 'unavailable'>,
  BannerFor
> = {
  saved: ({ redrive }, context) =>
    redrive
      ? savedThenRedrive[redrive.outcome](redrive, context)
      : banner(
          'info',
          'Payload saved.',
          'It hasn’t been retried yet — redrive it to process the edited payload.',
          context.canRedrive
        ),
  conflict: ({ status }) =>
    banner('warning', notSaved, nowIs(status, 'edited')),
  refused: ({ reason }, { service }) =>
    banner('danger', notSaved, toRefusal(reason, service)),
  'not-found': (_notice, context) => banner('danger', notSaved, gone(context))
}

const banners: Partial<Record<string, Record<string, BannerFor>>> = {
  redrive: redriveBanners,
  purge: purgeBanners,
  edit: editBanners
}

const actionOf = (notice: EventNotice): EventWriteAction =>
  notice.action ?? 'redrive'

const bannerFor = (notice: EventNotice): BannerFor | undefined =>
  banners[actionOf(notice)]?.[notice.outcome]

/** The action and the outcome both come off a session flash, which another release may have written. */
export const toBanner = (
  notice: EventNotice | null,
  context: BannerContext
): Banner | null => {
  const toNoticeBanner = notice && bannerFor(notice)

  return toNoticeBanner ? toNoticeBanner(notice, context) : null
}

/** A save that was redriven has the banner checking for its result, which says it. */
const savedToast = ({ redrive }: EventNotice): Toast[] =>
  redrive?.outcome === 'redriven'
    ? []
    : [{ tone: 'success', text: 'Payload saved' }]

export const purgedToast: Toast = { tone: 'info', text: 'Event purged' }

/** The outcome that went through, by action, and what its toast says. */
/** Partial: a flash another release wrote may name an action this one hasn't. */
const toasts: Partial<
  Record<string, [string, (notice: EventNotice) => Toast[]]>
> = {
  purge: ['purged', () => [purgedToast]],
  edit: ['saved', savedToast]
}

const toastFor = (notice: EventNotice) => {
  const [outcome, toast] = toasts[actionOf(notice)] ?? []

  return toast && notice.outcome === outcome ? toast(notice) : []
}

/** A write that went through is also said in a toast, but for a redrive: its banner says it while checking for the result. */
export const toToasts = (notice: EventNotice | null): Toast[] =>
  notice ? toastFor(notice) : []
