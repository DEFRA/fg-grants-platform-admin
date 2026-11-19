import { statusCodes } from '../../common/status-codes.ts'
import type { Catalogue } from '../repositories/buckets.repository.ts'
import type {
  PayloadEditStep,
  PayloadSubmission
} from '../use-cases/edit-payload-step.ts'
import { toEventState } from '../use-cases/event-state.ts'
import { isQueueAddress } from '../use-cases/list-bucket.use-case.ts'
import { isUnanswered } from '../use-cases/gas-status.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import type { PayloadReviewResult } from '../use-cases/review-payload.use-case.ts'
import { toAttemptCount } from './attempt-count.ts'
import {
  devOpsPath,
  isEventList,
  toBackBucket,
  toListAt
} from './bucket-nav.ts'
import { toTone } from './catalogue-presentation.ts'
import type { Tone } from './catalogue-presentation.ts'
import { toUrlService } from './event-address.ts'
import { toAttempts } from './event-attempts.ts'
import type { AttemptsModel } from './event-attempts.ts'
import { toBanner, toToasts } from './event-banners.ts'
import type { Banner, EventNotice, Toast } from './event-banners.ts'
import { serviceNames, timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toPurgeDialog, toRedriveDialog } from './event-dialogs.ts'
import type {
  PurgeDialog,
  PurgeFormNotice,
  RedriveDialog
} from './event-dialogs.ts'
import { toFacts } from './event-facts.ts'
import type { Fact } from './event-facts.ts'
import { toEventHref } from './event-formats.ts'
import {
  eventsPresentationId,
  toEventsEntry,
  toEventsPageHref
} from './events-list.ts'
import { toPayload, toUnknownTitle } from './event-payload.ts'
import type { HeldSave, PayloadModel, SaveError } from './event-payload.ts'
import { timedOutWaiting, toFailureText } from './failure-text.ts'
import { toBackLabel, toFittingBack } from './record-filters.ts'
import { toDayTime } from './times.ts'
import type { Times } from './times.ts'

export type { PurgeFormNotice }

const unsafeInPath = /\/\/|\\/

/** A page is opened from a list or a record's page of this admin, and goes back to it. */
const isOwnPage = (from: string): boolean => from.startsWith(`${devOpsPath}/`)

/** A queue's own address is no page, so nothing goes back to it. */
const isQueuePage = (from: string): boolean =>
  isQueueAddress(
    from
      .slice(devOpsPath.length + 1)
      .split(/[?#]/)[0]
      .split('/')
      .filter(Boolean)
      .join('/')
  )

const isBackable = (from: string): boolean =>
  isOwnPage(from) && !unsafeInPath.test(from) && !isQueuePage(from)

/** Open-redirect guard: only a list's or a record's own path and query, and `//` or `\` could leave it; one too long to go back to, or a queue's own address, is none. */
export const toSafeFrom = (from: string | undefined | null): string =>
  typeof from === 'string' && isBackable(from) ? toFittingBack(from) : ''

/** Both writes leave their outcome here, under the redrive's key so a session in flight across a deploy still finds its message. */
export const redriveNoticeKey = 'redriveOutcome'

export const purgeFormKey = 'purgeForm'

/**
 * The page can hold an editor with a revision in it. `no-cache`, hapi's
 * default, still lets Back show a copy from before a save, whose revision is
 * spent; `no-store` makes Back read the event again.
 */
export const eventPageCache = { otherwise: 'no-store' }

/** Where a write's redirect lands, so the banner it takes focus to is in view. */
export const eventBannerId = 'event-banner'

export interface EventPageQuery {
  back?: string
  confirm?: string
  edit?: string
}

/** What a request hands the page beside the event it reads. */
export interface EventPageAsks {
  query: EventPageQuery
  notice?: EventNotice
  form?: PurgeFormNotice
  edit?: PayloadEditStep
  held?: HeldSave
  saveError?: SaveError
  /** Posted changes the page couldn't check, because the event couldn't be read: shown, so nothing typed is lost. */
  kept?: { text: string; note?: string; failure?: GasFailure }
}

export interface EventPageInput extends EventPageAsks {
  result: EventResult
  key: EventKey
  times: Times
  catalogue: Catalogue | null
  /** The production environment, where every dialog that changes something says so. */
  prod: boolean
}

export interface MissingEvent {
  state: 'unavailable' | 'timed-out' | 'not-found'
  title: string
  text: string
  /** A post with its changes kept lands here, unless what it held says first whether they were saved. */
  landing: boolean
}

export interface EventPageModel {
  pageTitle: string
  navActive: string | null
  /** This very page again, keeping where it was opened from. */
  retryHref: string
  back: { href: string; text: string }
  missing: MissingEvent | null
  kept: {
    text: string
    note: string | null
    said: string
    /** A save that went unanswered: it may have been made, which the page says first. */
    held: { title: string; text: string } | null
  } | null
  title: string
  titleMono: boolean
  status: { text: string; tone: Tone }
  eventId: string
  purgeHref: string | null
  redriveHref: string | null
  banner: (Banner & { redriveHref: string | null }) | null
  toasts: Toast[]
  facts: Fact[]
  attempts: AttemptsModel | null
  payload: PayloadModel | null
  redriveDialog: RedriveDialog | null
  purgeDialog: PurgeDialog | null
}

/** The production environment's label, as CDP gives it. */
export const isProduction = (environment: string): boolean =>
  environment === 'prod'

const toOwnList = (catalogue: Catalogue | null, key: EventKey) =>
  toEventsEntry(catalogue, toUrlService(key.service))

/** The service's Events page, whether or not the catalogue lists it now. */
const toOwnListHref = (key: EventKey): string =>
  toEventsPageHref(toUrlService(key.service))

/** Back where it came from: a record by its name, any event list as Events. */
const toBack = (
  catalogue: Catalogue | null,
  key: EventKey,
  from: string
): { href: string; text: string } => {
  const list = toListAt(catalogue, from)

  return {
    href: from || toOwnListHref(key),
    text: toBackLabel(from, {
      listLabel: list && !isEventList(list) ? list.label : null,
      ownListLabel: 'Events'
    })
  }
}

const toStatus = ({ event, key }: EventContext) => ({
  text: event.statusLabel,
  tone: toTone(
    { id: eventsPresentationId(toUrlService(key.service)) },
    'status',
    event.status,
    event.statusRole
  )
})

const noticeFor = (context: EventContext, notice?: EventNotice) =>
  notice?.page === context.eventHref ? notice : null

const actionHref = (
  context: EventContext,
  can: boolean,
  confirm: string
): string | null => (can ? toSelfHref(context, ['confirm', confirm]) : null)

const deletionDayOf = ({ event, times }: EventContext): string | null =>
  timeOf(event.expiresAt, times, toDayTime)?.text ?? null

const allowedOf = ({ count }: EventContext): number | null =>
  count?.allowed ?? null

const toBannerModel = (context: EventContext, notice: EventNotice | null) => {
  const banner = toBanner(notice, {
    service: context.service,
    allowed: allowedOf(context),
    deletionDay: deletionDayOf(context),
    canRedrive: context.state.redrivable
  })

  return (
    banner && {
      ...banner,
      redriveHref: actionHref(context, banner.redriveNow, 'redrive')
    }
  )
}

const navActiveOf = (
  catalogue: Catalogue | null,
  key: EventKey,
  from: string
): string | null =>
  (toBackBucket(catalogue, from) ?? toOwnList(catalogue, key))?.id ?? null

const toContext = (
  input: EventPageInput,
  event: EventDetail
): EventContext => ({
  event,
  key: input.key,
  state: toEventState(event),
  count: toAttemptCount(event.attempts),
  times: input.times,
  service: serviceNames[input.key.service],
  from: toSafeFrom(input.query.back),
  eventHref: toEventHref(input.key),
  catalogue: input.catalogue,
  ownList: toOwnList(input.catalogue, input.key)
})

const toFound = (input: EventPageInput, event: EventDetail): EventPageModel => {
  const context = toContext(input, event)
  const notice = noticeFor(context, input.notice)
  const title = event.eventType ?? event.eventId

  return {
    pageTitle: `${title} – ${context.service} event`,
    navActive: navActiveOf(input.catalogue, input.key, context.from),
    retryHref: toSelfHref(context),
    back: toBack(input.catalogue, input.key, context.from),
    missing: null,
    kept: null,
    title,
    titleMono: event.eventType === null,
    status: toStatus(context),
    eventId: event.eventId,
    purgeHref: actionHref(context, context.state.purgeable, 'purge'),
    redriveHref: actionHref(context, context.state.redrivable, 'redrive'),
    banner: toBannerModel(context, notice),
    toasts: toToasts(notice),
    facts: toFacts(context),
    attempts: toAttempts(context),
    payload: toPayload(context, input),
    redriveDialog: toRedriveDialog(context, input),
    purgeDialog: toPurgeDialog(context, input)
  }
}

/** A read that failed names the service it is down to; only GAS's 404 is an event it hasn't got. */
const missingCopy = (
  { failure }: EventResult,
  service: string
): Pick<MissingEvent, 'title' | 'text'> =>
  failure === null
    ? {
        title: `No ${service} event has this ID.`,
        text: 'It may have passed its deletion date, or the ID may be from the other service. Check the ID, or search for it from Events.'
      }
    : {
        title: 'This event couldn’t be loaded.',
        text: `${toFailureText(failure, service, timedOutWaiting)} Nothing has changed — try again in a moment.`
      }

const missingStateOf = ({ outcome }: EventResult): MissingEvent['state'] =>
  outcome === 'found' ? 'unavailable' : outcome

/** A save that went unanswered may have gone through, so the page says only what is certain. */
const keptHeld = (service: string, failure: GasFailure | undefined) =>
  failure && isUnanswered(failure)
    ? {
        title: toUnknownTitle(service, failure),
        text: 'It may not have been saved: copy your changes before you leave this page, then try again once the event can be read.'
      }
    : null

const toKept = ({ kept }: EventPageAsks, service: string) =>
  kept
    ? {
        text: kept.text,
        note: kept.note || null,
        said: 'They haven’t been saved. Copy them before you leave this page, then try again.',
        held: keptHeld(service, kept.failure)
      }
    : null

/** The event's address names it, so the page keeps its header with the reason in place of the event. */
const toMissing = (input: EventPageInput): EventPageModel => {
  const { key, catalogue } = input
  const from = toSafeFrom(input.query.back)
  const service = serviceNames[key.service]
  const state = missingStateOf(input.result)
  const kept = toKept(input, service)

  return {
    pageTitle: `${state === 'not-found' ? 'Not found – ' : ''}${service} event ${key.id}`,
    navActive: navActiveOf(catalogue, key, from),
    retryHref: toSelfHref({ key, from }),
    back: toBack(catalogue, key, from),
    missing: {
      state,
      ...missingCopy(input.result, service),
      landing: kept !== null && kept.held === null
    },
    kept,
    title: key.id,
    titleMono: true,
    status: { text: '', tone: 'neutral' },
    eventId: key.id,
    purgeHref: null,
    redriveHref: null,
    banner: null,
    toasts: [],
    facts: [],
    attempts: null,
    payload: null,
    redriveDialog: null,
    purgeDialog: null
  }
}

export const toEventPage = (input: EventPageInput): EventPageModel =>
  input.result.event === null
    ? toMissing(input)
    : toFound(input, input.result.event)

const missingCodes: Record<MissingEvent['state'], number> = {
  'not-found': statusCodes.notFound,
  'timed-out': statusCodes.gatewayTimeout,
  unavailable: statusCodes.serviceUnavailable
}

/** An event the service couldn't give is no page of it: the status says why. */
export const toEventStatusCode = ({ missing }: EventPageModel): number =>
  missing ? missingCodes[missing.state] : statusCodes.ok

/** An event that can no longer be edited says so, as the save would have. */
const toConflict = (key: EventKey, status: string): EventNotice => ({
  outcome: 'conflict',
  status,
  page: toEventHref(key),
  action: 'edit'
})

/**
 * What a review or a save hands the page: the editor or the review the
 * decision names, or the conflict's banner; the text itself when the event
 * couldn't be read to check it against.
 */
export const toSubmissionAsks = (
  { decision }: PayloadReviewResult,
  key: EventKey,
  submission: PayloadSubmission,
  extras: Pick<EventPageAsks, 'saveError'> = {}
): EventPageAsks => {
  const query = { back: toSafeFrom(submission.from) }

  if (decision.kind === 'unread') {
    return { query, kept: submission }
  }

  return decision.kind === 'conflict'
    ? { query, notice: toConflict(key, decision.status) }
    : { query, edit: decision.step, ...extras }
}

/**
 * What a save the service didn't answer left for this page: its changes held
 * over the event as it is now, or kept when the event can't be read.
 */
export const toHeldAsks = (
  held: HeldSave | null,
  { event }: EventResult
): Pick<EventPageAsks, 'held' | 'kept'> => {
  if (held === null) {
    return {}
  }

  return event === null ? { kept: held } : { held }
}
