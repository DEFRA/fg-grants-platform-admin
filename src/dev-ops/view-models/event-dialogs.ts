import { canEditEvent } from '../use-cases/event-state.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { allSame, timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'
import type { PurgeFormError } from './purge-form.ts'
import { noteMaxLength, purgeReasons } from './purge-form.ts'
import { isEditedSinceAttempts, isEditedSinceRedrive } from './payload-edit.ts'
import { toDayTime } from './times.ts'
import type { TimeText } from './times.ts'

const redriveDialogId = 'redrive-dialog'

const purgeDialogId = 'purge-dialog'

/** What the operator sent back, so a rejected form is never retyped. */
export interface PurgeFormNotice {
  page: string
  reasonCode: string
  note: string
  error: PurgeFormError | null
}

interface ShortName {
  name: string
  id: string
}

interface DialogBase {
  id: string
  open: boolean
  closeHref: string
  action: string
  back: string
  /** Production: the dialog says so first. */
  prod: boolean
  short: ShortName
}

interface Byline {
  by: string
  at: TimeText | null
}

export interface RedriveDialog extends DialogBase {
  service: string
  allowed: number | null
  futile: { count: number; editHref: string | null } | null
  edited: Byline | null
  purged: Byline | null
}

export interface PurgeDialog extends DialogBase {
  deletionDay: TimeText | null
  reasons: { value: string; text: string; checked: boolean }[]
  reasonError: string | null
  note: string
  noteError: string | null
  noteMax: number
}

export interface DialogAsks {
  query: { confirm?: string }
  prod: boolean
  form?: PurgeFormNotice
}

const shortIdHead = 8
const shortIdTail = 4

/** The first 8 and the last 4 of the id, as the dialogs name the event. */
const shortId = (id: string): string =>
  id.length > shortIdHead + shortIdTail
    ? `${id.slice(0, shortIdHead)}…${id.slice(-shortIdTail)}`
    : id

const toBase = (
  context: EventContext,
  asks: DialogAsks,
  id: string,
  write: string
): DialogBase => ({
  id,
  open: asks.query.confirm === write,
  closeHref: toSelfHref(context),
  action: `${toEventHref(context.key)}/${write}`,
  back: context.from,
  prod: asks.prod,
  short: {
    name: context.event.eventType ?? context.event.type,
    id: shortId(context.event.eventId)
  }
})

/** Every attempt failed as the last did and nothing has changed since, so a redrive would fail the same way. */
const isFutile = ({ event, state }: EventContext): boolean =>
  state.deadLetter && allSame(event) && !isEditedSinceAttempts(event)

const editInstead = (context: EventContext): string | null =>
  canEditEvent(context.event, context.state)
    ? toSelfHref(context, ['edit', 'payload'])
    : null

const toFutile = (context: EventContext) =>
  isFutile(context)
    ? {
        count: context.event.attemptHistory.length,
        editHref: editInstead(context)
      }
    : null

const toEdited = ({ event, times }: EventContext): Byline | null =>
  event.lastEdit && isEditedSinceRedrive(event)
    ? { by: event.lastEdit.by, at: timeOf(event.lastEdit.at, times) }
    : null

/** Redriving a purged event reverses a decision somebody made, so the dialog names it first. */
const toPurged = ({ event, state, times }: EventContext): Byline | null =>
  state.purged && event.lastPurge
    ? {
        by: event.lastPurge.by,
        at: timeOf(event.lastPurge.at, times, toDayTime)
      }
    : null

export const toRedriveDialog = (
  context: EventContext,
  asks: DialogAsks
): RedriveDialog | null =>
  context.state.redrivable
    ? {
        ...toBase(context, asks, redriveDialogId, 'redrive'),
        service: context.service,
        allowed: context.count?.allowed ?? null,
        futile: toFutile(context),
        edited: toEdited(context),
        purged: toPurged(context)
      }
    : null

/** A flash the redirect never delivered must not refill the form on another event. */
const formFor = (context: EventContext, form?: PurgeFormNotice) =>
  form?.page === context.eventHref ? form : null

const fieldError = (form: PurgeFormNotice | null, field: string) =>
  form?.error?.field === field ? form.error.message : null

const toReasons = (form: PurgeFormNotice | null) =>
  purgeReasons.map(({ value, label }) => ({
    value,
    text: label,
    checked: form?.reasonCode === value
  }))

const deletionOf = ({ event, times }: EventContext) =>
  timeOf((event as EventDetail).purgeDeletionDate, times, toDayTime)

export const toPurgeDialog = (
  context: EventContext,
  asks: DialogAsks
): PurgeDialog | null => {
  const form = formFor(context, asks.form)

  return context.state.purgeable
    ? {
        ...toBase(context, asks, purgeDialogId, 'purge'),
        deletionDay: deletionOf(context),
        reasons: toReasons(form),
        reasonError: fieldError(form, 'reason'),
        note: form?.note ?? '',
        noteError: fieldError(form, 'note'),
        noteMax: noteMaxLength
      }
    : null
}
