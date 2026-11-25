import { toEditText } from '../use-cases/edit-payload-command.ts'
import type { PayloadEditStep } from '../use-cases/edit-payload-step.ts'
import { toOpenedStep, toStoredJson } from '../use-cases/edit-payload-step.ts'
import { canEditEvent } from '../use-cases/event-state.ts'
import { isUnanswered } from '../use-cases/gas-status.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type { EventDetail, EventKey } from '../use-cases/get-event.use-case.ts'
import { timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'
import { timedOut, toFailureText } from './failure-text.ts'
import { isNotPlainJson, toEditorState, toReviewState } from './payload-edit.ts'
import type { EditorState, ReviewState } from './payload-edit.ts'
import type { TimeText } from './times.ts'

/** A save the service didn't answer or failed: the changes are held on the page, to try again. */
export interface HeldSave {
  /** How the save went unanswered or failed: one unanswered may have gone through. */
  failure: GasFailure
  text: string
  revision: number
  note: string
  /** `redrive` for Redrive, which Try again repeats. */
  then: string
}

export interface SaveError {
  title: string
  text: string
}

export interface PayloadAsks {
  query: { edit?: string; confirm?: string }
  /** Handed over by a review or a save, in place of the editor the link opens. */
  edit?: PayloadEditStep
  held?: HeldSave
  saveError?: SaveError
}

interface PayloadView {
  mode: 'view'
  text: string
  edited: boolean
  editHref: string | null
  original: string | null
}

type PayloadEditor = {
  mode: 'edit'
  /** What a post lands on and focuses: the editor itself when null. */
  landing: 'unchanged' | 'stale' | 'error' | null
  action: string
  discardHref: string
  back: string
  current: { text: string; by: string | null; at: TimeText | null } | null
  notPlainJson: boolean
} & EditorState

type PayloadReview = {
  mode: 'review'
  /** What a post lands on and focuses: the review itself when null. */
  landing: 'save-error' | 'note' | null
  action: string
  reviewAction: string
  back: string
  before: string
  notPlainJson: boolean
  saveError: SaveError | null
} & ReviewState

type PayloadHeld = {
  mode: 'held'
  action: string
  cancelHref: string
  back: string
  before: string
  title: string
  body: string
  canRetry: boolean
} & HeldSave

export type PayloadModel =
  | PayloadView
  | PayloadEditor
  | PayloadReview
  | PayloadHeld

const toOriginal = (event: EventDetail): string | null =>
  event.lastEdit && event.originalPayload != null
    ? JSON.stringify(event.originalPayload, null, 2)
    : null

const editHrefOf = (context: EventContext): string | null =>
  canEditEvent(context.event, context.state)
    ? toSelfHref(context, ['edit', 'payload'])
    : null

const toView = (context: EventContext): PayloadView => ({
  mode: 'view',
  text: toStoredJson(context.event),
  edited: Boolean(context.event.lastEdit),
  editHref: editHrefOf(context),
  original: toOriginal(context.event)
})

const reviewAction = (key: EventKey) =>
  `${toEventHref(key)}/payload/review#payload`

/**
 * The editor opens, and Back from the review returns to it, at no fragment:
 * a browser skips `autofocus` on a page that arrives at one, and focusing the
 * box brings it into view.
 */
const backAction = (key: EventKey) => `${toEventHref(key)}/payload/review`

const saveAction = (key: EventKey) => `${toEventHref(key)}/payload#payload`

/** Someone else's edit, set beside the operator's own once theirs has gone stale. */
const toCurrent = ({ event, times }: EventContext) => ({
  text: toStoredJson(event),
  by: event.lastEdit?.by ?? null,
  at: timeOf(event.lastEdit?.at, times)
})

const editorLanding = ({
  unchanged,
  stale,
  error
}: EditorState): PayloadEditor['landing'] => {
  if (unchanged) {
    return 'unchanged'
  }

  if (stale) {
    return 'stale'
  }

  return error ? 'error' : null
}

const reviewLanding = (
  { noteError }: ReviewState,
  saveError: SaveError | null
): PayloadReview['landing'] => {
  if (saveError) {
    return 'save-error'
  }

  return noteError ? 'note' : null
}

const toEditor = (
  context: EventContext,
  step: Extract<PayloadEditStep, { step: 'edit' }>
): PayloadEditor => {
  const editor = toEditorState(step)

  return {
    mode: 'edit',
    landing: editorLanding(editor),
    action: reviewAction(context.key),
    discardHref: toSelfHref(context),
    back: context.from,
    current: editor.stale ? toCurrent(context) : null,
    notPlainJson: isNotPlainJson(context.event),
    ...editor
  }
}

const toReview = (
  context: EventContext,
  step: Extract<PayloadEditStep, { step: 'review' }>,
  saveError: SaveError | null
): PayloadReview => {
  const state = toReviewState(step)
  const before = toStoredJson(context.event)

  return {
    mode: 'review',
    landing: reviewLanding(state, saveError),
    action: saveAction(context.key),
    reviewAction: backAction(context.key),
    back: context.from,
    before,
    notPlainJson: isNotPlainJson(context.event),
    saveError,
    ...state
  }
}

const toHeldTitle = (service: string, failure: GasFailure): string =>
  `Not saved: ${toFailureText(failure, service, timedOut)}`

/** An unanswered save may have gone through. */
export const toUnknownTitle = (service: string, failure: GasFailure): string =>
  `Save status unknown — ${toFailureText(failure, service, timedOut)}`

const movedTitle = (service: string, failure: GasFailure): string =>
  isUnanswered(failure)
    ? toUnknownTitle(service, failure)
    : toHeldTitle(service, failure)

/** Another edit since: the held changes are set against the payload as it is now, which may be this save itself. */
const movedBody = (failure: GasFailure, canRetry: boolean): string => {
  const said = isUnanswered(failure)
    ? 'It may have been saved, but the payload has changed since: your payload and note are below, against the payload as it is now.'
    : 'Nothing you sent was saved, but the payload has changed since: your payload and note are below, against the payload as it is now.'

  return canRetry
    ? `${said} Trying again opens them in the editor over it.`
    : said
}

const heldBody = (failure: GasFailure, canRetry: boolean): string => {
  if (!isUnanswered(failure)) {
    return 'Nothing has changed on the event. Your payload and note are below.'
  }

  return canRetry
    ? 'It may not have been saved. Your payload and note are below; trying again is safe: if it was saved, you’ll see the payload as it is now.'
    : 'It may not have been saved. Your payload and note are below.'
}

const isRevisionMoved = (event: EventDetail, { revision }: HeldSave): boolean =>
  (event.payloadRevision ?? 0) !== revision

/** An event that moved on since can't take the save again, so the page says why in place of Try again. */
const heldCopy = (context: EventContext, held: HeldSave) => {
  const canRetry = canEditEvent(context.event, context.state)
  const moved = isRevisionMoved(context.event, held)
  const body = moved
    ? movedBody(held.failure, canRetry)
    : heldBody(held.failure, canRetry)

  return {
    title: moved
      ? movedTitle(context.service, held.failure)
      : toHeldTitle(context.service, held.failure),
    body: canRetry
      ? body
      : `${body} This event is now ${context.event.statusLabel}, so it can’t be edited again.`,
    canRetry
  }
}

/** A timed-out save may have been made, so the page says only what is certain. */
const toHeld = (context: EventContext, held: HeldSave): PayloadHeld => {
  const before = toStoredJson(context.event)
  const text = toEditText(held.text)

  return {
    mode: 'held',
    action: saveAction(context.key),
    cancelHref: toSelfHref(context),
    back: context.from,
    before,
    ...heldCopy(context, held),
    ...held,
    text
  }
}

/** Opened by its link, never over a dialog the address also asks for. */
const openedStep = (
  { event }: EventContext,
  { edit, confirm }: PayloadAsks['query']
): PayloadEditStep | null =>
  edit === 'payload' && confirm === undefined ? toOpenedStep(event) : null

const stepOf = (context: EventContext, asks: PayloadAsks) =>
  canEditEvent(context.event, context.state)
    ? (asks.edit ?? openedStep(context, asks.query))
    : null

const toStepModel = (
  context: EventContext,
  step: PayloadEditStep,
  asks: PayloadAsks
): PayloadModel =>
  step.step === 'edit'
    ? toEditor(context, step)
    : toReview(context, step, asks.saveError ?? null)

export const toPayload = (
  context: EventContext,
  asks: PayloadAsks
): PayloadModel => {
  if (asks.held) {
    return toHeld(context, asks.held)
  }

  const step = stepOf(context, asks)

  return step ? toStepModel(context, step, asks) : toView(context)
}
