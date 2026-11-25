import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'
import type { PurgeFormError } from './purge-form.ts'
import { noteMaxLength, otherReason, purgeReasons } from './purge-form.ts'
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

interface DialogBase {
  id: string
  open: boolean
  closeHref: string
  action: string
  back: string
  /** The tab the write lands back on: empty for the Overview. */
  tab: string
  /** Production: the dialog says so first. */
  prod: boolean
}

interface Byline {
  by: string
  at: TimeText | null
}

export interface RedriveDialog extends DialogBase {
  service: string
  allowed: number | null
  /** Failing on the payload it failed with: the dialog says it will fail again. */
  unchanged: boolean
  edited: Byline | null
  purged: Byline | null
}

export interface PurgeDialog extends DialogBase {
  deletionDay: TimeText | null
  reasons: { value: string; text: string; checked: boolean }[]
  reasonError: string | null
  note: string
  noteError: string | null
  /** The reason sent back, which the note is required with when it is `otherReason`. */
  reasonCode: string
  otherReason: string
  noteMax: number
}

export interface DialogAsks {
  query: { confirm?: string }
  prod: boolean
  form?: PurgeFormNotice
}

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
  tab: context.tab === 'history' ? context.tab : '',
  prod: asks.prod
})

const isUnchanged = ({ event, state }: EventContext): boolean =>
  state.deadLetter && !isEditedSinceAttempts(event)

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
        unchanged: isUnchanged(context),
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

const reasonOf = (form: PurgeFormNotice | null) => form?.reasonCode ?? ''

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
        reasonCode: reasonOf(form),
        otherReason,
        noteMax: noteMaxLength
      }
    : null
}
