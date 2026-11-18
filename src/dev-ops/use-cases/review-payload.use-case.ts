import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import type { PayloadEditStep, PayloadSubmission } from './edit-payload-step.ts'
import { toSubmittedStep } from './edit-payload-step.ts'
import { canEditEvent, toEventState } from './event-state.ts'
import type { EventResult } from './get-event.use-case.ts'
import { getEventUseCase } from './get-event.use-case.ts'

/**
 * `unread`: the event couldn't be read, so the text couldn't be checked against it.
 * `conflict`: the event can no longer be edited; `status` is the service's word for the state it is in.
 */
export type PayloadDecision =
  | { kind: 'unread' }
  | { kind: 'conflict'; status: string }
  | { kind: 'step'; step: PayloadEditStep }

export interface PayloadReviewResult {
  result: EventResult
  decision: PayloadDecision
}

/** Where a posted text leaves the operator: the editor, the review, or no edit at all. */
export const toPayloadDecision = (
  event: EventDetail | null,
  submission: PayloadSubmission
): PayloadDecision => {
  if (event === null) {
    return { kind: 'unread' }
  }

  if (!canEditEvent(event, toEventState(event))) {
    return { kind: 'conflict', status: event.statusLabel }
  }

  return { kind: 'step', step: toSubmittedStep(event, submission) }
}

/** Review changes, Back to editing, and a save that comes back to the page: the event as it is now, and the posted text set against it. */
export const reviewPayloadUseCase = async (
  key: EventKey,
  submission: PayloadSubmission
): Promise<PayloadReviewResult> => {
  const result = await getEventUseCase(key)

  return { result, decision: toPayloadDecision(result.event, submission) }
}
