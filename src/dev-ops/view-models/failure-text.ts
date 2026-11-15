import { isUnanswered } from '../use-cases/gas-status.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'

type Answered = Exclude<GasFailure['kind'], 'timed-out' | 'no-answer'>

const answeredTexts: Record<Answered, string> = {
  'not-connected': 'GAS couldn’t be reached.',
  'cw-not-reached': 'CW couldn’t be reached.',
  refused: 'GAS answered with an error.',
  errored: 'GAS answered with an error.'
}

/** How a page says a service didn't answer, given the service. */
export type Unanswered = (service: string) => string

const didntAnswer: Unanswered = (service) => `${service} didn’t answer in time.`

export const timedOut: Unanswered = (service) => `${service} timed out.`

export const timedOutWaiting: Unanswered = (service) =>
  `${service} timed out waiting for it.`

const isUpstream = (failure: GasFailure): boolean =>
  failure.kind === 'errored' && failure.upstream === true

/**
 * What went wrong, in one sentence naming the service it is down to. The app
 * reaches every service through GAS, so only GAS's 504 is the owning service
 * not answering, its 502 the owning service failing, and its CW_UNREACHABLE
 * CW; the rest are GAS's.
 */
const answeredText = (failure: GasFailure, service: string): string =>
  isUpstream(failure)
    ? `${service} answered with an error.`
    : answeredTexts[failure.kind as Answered]

const unansweredBy = (failure: GasFailure, service: string): string =>
  failure.kind === 'timed-out' ? service : 'GAS'

export const toFailureText = (
  failure: GasFailure,
  service: string,
  unanswered: Unanswered = didntAnswer
): string =>
  isUnanswered(failure)
    ? unanswered(unansweredBy(failure, service))
    : answeredText(failure, service)
