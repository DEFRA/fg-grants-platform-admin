import type {
  EventDetail,
  EventKey,
  PayloadEdit
} from '../repositories/events.repository.ts'
import type { PayloadSubmission } from './edit-payload-step.ts'
import type { EditResult } from './edit-payload.use-case.ts'
import { editPayloadUseCase } from './edit-payload.use-case.ts'
import type { GasFailure } from './gas-status.ts'
import type { EventResult } from './get-event.use-case.ts'
import type { PayloadReviewResult } from './review-payload.use-case.ts'
import { toPayloadDecision } from './review-payload.use-case.ts'

export interface PayloadSave {
  key: EventKey
  edit: PayloadEdit
  actor: string
  /** The text as posted, set against the event GAS answers a stale save with. */
  submission: PayloadSubmission
  /** Save and redrive. */
  redrive: boolean
}

/**
 * `answered`: the service answered the save, and the redrive that followed
 * it, if asked for, is in `edit`. `stale`: someone saved first, so the editor
 * again, over the event GAS read again. `held`: the save went unanswered or
 * failed, so the changes are held for the page.
 */
export type SaveResult =
  | { kind: 'answered'; edit: EditResult }
  | { kind: 'stale'; review: PayloadReviewResult }
  | { kind: 'held'; failure: GasFailure }

/** GAS answers a stale save with the event as it is now, or none when it couldn't read it again. */
const toCurrentResult = (event: EventDetail | null): EventResult =>
  event === null
    ? { outcome: 'unavailable', event: null, failure: { kind: 'errored' } }
    : { outcome: 'found', event, failure: null }

/** One call: GAS saves, and redrives the save that landed when asked to. */
export const saveEventPayloadUseCase = async ({
  key,
  edit,
  actor,
  submission,
  redrive
}: PayloadSave): Promise<SaveResult> => {
  const saved = await editPayloadUseCase(key, edit, actor, redrive)

  if (saved.outcome === 'stale') {
    return {
      kind: 'stale',
      review: {
        result: toCurrentResult(saved.current),
        decision: toPayloadDecision(saved.current, {
          ...submission,
          stale: true
        })
      }
    }
  }

  return saved.failure === null
    ? { kind: 'answered', edit: saved }
    : { kind: 'held', failure: saved.failure }
}
