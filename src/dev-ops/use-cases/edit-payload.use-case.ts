import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventDetail,
  EventKey,
  PayloadEdit,
  SaveRedrive
} from '../repositories/events.repository.ts'
import { editPayload } from '../repositories/events.repository.ts'
import {
  isUnanswered,
  toGasErrorBody,
  toGasErrorField,
  toGasFailure,
  toGasStatusCode
} from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'
import type { RedriveResult } from './redrive-event.use-case.ts'

/**
 * `conflict`: the event can no longer be edited, so the page names the state it is in.
 * `stale`: someone saved first; the revision this edit was made against is gone.
 * `refused`: the backend answered and would not take the payload, with its reason when it gave one.
 */
export type EditOutcome =
  | 'saved'
  | 'conflict'
  | 'stale'
  | 'refused'
  | 'not-found'
  | 'timed-out'
  | 'unavailable'

export interface EditResult {
  outcome: EditOutcome
  /** Only a conflict reports one. */
  status: string | null
  /** Only a refusal reports one, and only when the backend named it. */
  reason: string | null
  /** Only a save that went unanswered or failed reports one. */
  failure: GasFailure | null
  /** Save and redrive: the redrive that followed a save that landed. */
  redrive: RedriveResult | null
  /** Only a stale save reports one: the event as it is now, null when GAS couldn't read it again. */
  current: EventDetail | null
}

const unsaved = { redrive: null, current: null }

const failureOutcomes: Record<number, EditOutcome> = {
  [statusCodes.notFound]: 'not-found',
  [statusCodes.preconditionFailed]: 'stale',
  [statusCodes.unprocessableEntity]: 'refused'
}

const isClientError = (statusCode: number): boolean =>
  statusCode >= statusCodes.badRequest &&
  statusCode < statusCodes.internalServerError

/** Any other 4xx is still an answer, so it is never read as the backend being down. */
const toFailureOutcome = (statusCode: number | null): EditOutcome => {
  if (statusCode === null) {
    return 'unavailable'
  }

  return (
    failureOutcomes[statusCode] ??
    (isClientError(statusCode) ? 'refused' : 'unavailable')
  )
}

const toStatus = (error: unknown): string | null =>
  toGasErrorField(error, 'statusLabel') ?? toGasErrorField(error, 'status')

const toCurrent = (error: unknown): EventDetail | null => {
  const { event } = toGasErrorBody(error)

  return typeof event === 'object' && event !== null
    ? (event as EventDetail)
    : null
}

/** Any answer but a conflict: a refusal names its reason, a stale save the event as it is now. */
const toUnsaved = (
  error: unknown,
  failure: GasFailure,
  outcome: EditOutcome
): EditResult => ({
  outcome,
  status: null,
  reason: outcome === 'refused' ? toGasErrorField(error, 'reason') : null,
  failure: outcome === 'unavailable' ? failure : null,
  ...unsaved,
  current: outcome === 'stale' ? toCurrent(error) : null
})

/** The service answered: a conflict names the state the event is in, a refusal its reason. */
const toAnswered = (error: unknown, failure: GasFailure): EditResult => {
  const statusCode = toGasStatusCode(error)

  if (statusCode === statusCodes.conflict) {
    return {
      outcome: 'conflict',
      status: toStatus(error),
      reason: null,
      failure: null,
      ...unsaved
    }
  }

  return toUnsaved(error, failure, toFailureOutcome(statusCode))
}

/** A save nobody answered leaves its outcome unknown: the owning service may still have applied it. */
const toOutcome = (error: unknown): EditResult => {
  const failure = toGasFailure(error)

  return isUnanswered(failure)
    ? { outcome: 'timed-out', status: null, reason: null, failure, ...unsaved }
    : toAnswered(error, failure)
}

/** The backend answered: the event moved on, went away, was edited first or the payload was refused. */
const answeredOutcomes = new Set<EditOutcome>([
  'conflict',
  'stale',
  'refused',
  'not-found'
])

const toLevel = (outcome: EditOutcome): 'info' | 'warn' | 'error' => {
  if (outcome === 'saved') {
    return 'info'
  }

  return answeredOutcomes.has(outcome) ? 'warn' : 'error'
}

/**
 * One line whatever happened, naming the event and the outcome and nothing
 * else: the payload, the note, a parse message and the changed paths all
 * stay out of the log, and so does the error, whose body the backend wrote.
 */
const logOutcome = (key: EventKey, { outcome }: EditResult) => {
  logger[toLevel(outcome)](
    `Edited event ${key.service}/${key.box}/${key.id}: ${outcome}`
  )
}

const redriven: RedriveResult = {
  outcome: 'redriven',
  status: null,
  failure: null
}

/** GAS saved, then couldn't redrive: a redrive that failed, the save standing. */
const redriveFailed: RedriveResult = {
  outcome: 'unavailable',
  status: null,
  failure: { kind: 'errored' }
}

const settledRedrives = { redriven, failed: redriveFailed }

const toRedriveConflict = ({
  status,
  statusLabel
}: Extract<SaveRedrive, { outcome: 'conflict' }>): RedriveResult => ({
  outcome: 'conflict',
  status: statusLabel ?? status,
  failure: null
})

/** The redrive GAS made after the save, in the words a redrive of its own is reported in. */
const toRedrive = (redrive: SaveRedrive | null): RedriveResult | null => {
  if (redrive === null) {
    return null
  }

  return redrive.outcome === 'conflict'
    ? toRedriveConflict(redrive)
    : settledRedrives[redrive.outcome]
}

/** `actor` goes to the backend on `x-actor`, so `lastEdit` names a person. Save and redrive is one call: GAS redrives a save that landed. */
export const editPayloadUseCase = async (
  key: EventKey,
  edit: PayloadEdit,
  actor: string,
  redrive: boolean
): Promise<EditResult> => {
  const result = await editPayload(key, edit, actor, redrive).then(
    (saved): EditResult => ({
      outcome: 'saved',
      status: null,
      reason: null,
      failure: null,
      redrive: toRedrive(saved.redrive),
      current: null
    }),
    toOutcome
  )

  logOutcome(key, result)

  return result
}
