import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  ExploreAnswer,
  ExploreQuery,
  QueryError,
  Vocabulary,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore
} from '../repositories/explore.repository.ts'
import { toGasErrorBody, toGasFailure, toGasStatusCode } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  ExploreAnswer,
  ExploreCell,
  ExploreColumn,
  ExploreObject,
  ExploreOpen,
  ExploreSource,
  ExploreValue,
  QueryError,
  Vocabulary,
  VocabularySource
} from '../repositories/explore.repository.ts'

export type ExploreService = 'GAS' | 'CW'

/**
 * - `invalid`: the query broke a rule of the language, at a place in its text.
 * - `refused`: a service would not run it, or not for this person, with its reason when it gave one.
 * - `too-slow`: a service stopped it at its deadline.
 * - `busy`: this person already has a query running.
 * - `full`: a service is running as many queries as it can.
 * - `not-offered`: a service without Explore.
 * - `unavailable`: a service can't run queries at all for now, whatever is asked.
 * - `no-answer`: a service didn't answer, or couldn't be reached, as `failure` says.
 * - `errored`: a service answered with an error.
 */
export type ExploreFailure =
  | { kind: 'invalid'; error: QueryError }
  | { kind: 'refused'; service: ExploreService; message: string | null }
  | { kind: 'too-slow'; service: ExploreService; message: string | null }
  | { kind: 'busy'; service: ExploreService }
  | { kind: 'full'; service: ExploreService }
  | { kind: 'not-offered'; service: ExploreService }
  | { kind: 'unavailable'; service: ExploreService }
  | { kind: 'no-answer'; service: ExploreService; failure: GasFailure }
  | { kind: 'errored'; service: ExploreService }

export type Explored<T> =
  | { outcome: 'read'; answer: T }
  | { outcome: 'failed'; failure: ExploreFailure }

/** What a call read or how it failed, and the vocabulary its answer or refusal carried: null when it carried none. */
export interface ExploreReply<T> {
  result: Explored<T>
  vocabulary: Vocabulary | null
}

type Body = Record<string, unknown>

const textOf = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const isPlace = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0

const isQueryError = (value: Body): boolean =>
  typeof value.message === 'string' && isPlace(value.at) && isPlace(value.end)

const toQueryError = (value: unknown): QueryError | null => {
  const error = (value ?? {}) as Body

  return isQueryError(error)
    ? {
        message: String(error.message),
        at: Number(error.at),
        end: Number(error.end)
      }
    : null
}

const toNotOffered = (service: ExploreService): ExploreFailure => ({
  kind: 'not-offered',
  service
})

const cwNotReached: ExploreFailure = {
  kind: 'no-answer',
  service: 'CW',
  failure: { kind: 'cw-not-reached' }
}

/** What GAS's 502 for Caseworking says went wrong there; any other reason is Caseworking not answering. */
const caseworkingReasons: Record<string, (body: Body) => ExploreFailure> = {
  UNREACHABLE: () => cwNotReached,
  NOT_OFFERED: () => toNotOffered('CW'),
  EXPLORE_QUERY_INVALID: (body) => ({
    kind: 'refused',
    service: 'CW',
    message: textOf(body.message)
  }),
  ERRORED: () => ({ kind: 'errored', service: 'CW' })
}

const gasErrored: ExploreFailure = { kind: 'errored', service: 'GAS' }

/** GAS's 502 names the hop when it is Caseworking's failure; else it is GAS's own. */
const toBadGateway = (body: Body): ExploreFailure => {
  if (body.hop !== 'CW-BE') {
    return gasErrored
  }

  const reason = String(body.reason)

  return Object.hasOwn(caseworkingReasons, reason)
    ? caseworkingReasons[reason](body)
    : { kind: 'no-answer', service: 'CW', failure: { kind: 'timed-out' } }
}

/** The service a body names as the one that refused or stopped the query; GAS unless it says Caseworking. */
const serviceOf = (body: Body): ExploreService =>
  body.service === 'CW' ? 'CW' : 'GAS'

const toRefused = (body: Body): ExploreFailure => ({
  kind: 'refused',
  service: serviceOf(body),
  message: textOf(body.message)
})

const toBadRequest = (body: Body): ExploreFailure => {
  const error = body.reason === 'QUERY_INVALID' && toQueryError(body.error)

  return error ? { kind: 'invalid', error } : toRefused(body)
}

/** GAS refuses a source the person's roles don't allow, before it reads it. */
const toForbidden = (body: Body): ExploreFailure =>
  body.reason === 'SOURCE_FORBIDDEN' ? toRefused(body) : gasErrored

/** A bare 404 is a GAS without Explore; one with a reason is GAS failing. */
const toNotFound = (body: Body): ExploreFailure =>
  body.reason === undefined && body.errorCode === undefined
    ? toNotOffered('GAS')
    : gasErrored

/** What each status GAS answered with means; any other is GAS failing. */
const answers: Record<number, (body: Body) => ExploreFailure> = {
  [statusCodes.badRequest]: toBadRequest,
  [statusCodes.forbidden]: toForbidden,
  [statusCodes.notFound]: toNotFound,
  [statusCodes.requestTimeout]: (body) => ({
    kind: 'too-slow',
    service: serviceOf(body),
    message: textOf(body.message)
  }),
  [statusCodes.tooManyRequests]: (body) => ({
    kind: body.refusal === 'FULL' ? 'full' : 'busy',
    service: serviceOf(body)
  }),
  [statusCodes.badGateway]: toBadGateway,
  [statusCodes.serviceUnavailable]: (body) => ({
    kind: 'unavailable',
    service: serviceOf(body)
  })
}

const toAnswered = (error: unknown): ExploreFailure =>
  answers[toGasStatusCode(error) ?? 0]?.(toGasErrorBody(error)) ?? gasErrored

const failureKinds: Partial<
  Record<GasFailure['kind'], (error: unknown) => ExploreFailure>
> = {
  refused: toAnswered,
  errored: toAnswered,
  'cw-not-reached': () => cwNotReached
}

const toExploreFailure = (error: unknown): ExploreFailure => {
  const failure = toGasFailure(error)

  return (
    failureKinds[failure.kind]?.(error) ?? {
      kind: 'no-answer',
      service: 'GAS',
      failure
    }
  )
}

const isNotOffered = (failure: ExploreFailure): boolean =>
  failure.kind === 'not-offered' && failure.service === 'GAS'

const outages = new Set<ExploreFailure['kind']>([
  'no-answer',
  'errored',
  'unavailable'
])

const isOutage = ({ kind }: ExploreFailure): boolean => outages.has(kind)

/** Never the query, its values or its positions: only the error's name and message. */
const logFailure = (what: string, failure: ExploreFailure, error: unknown) => {
  if (isNotOffered(failure)) {
    logger.warn('fg-gas-backend has no Explore route')
  }

  if (isOutage(failure)) {
    logger.warn(`Could not ${what} in fg-gas-backend: ${describeError(error)}`)
  }
}

const toFailed = (what: string, error: unknown): Explored<never> => {
  const failure = toExploreFailure(error)

  logFailure(what, failure, error)

  return { outcome: 'failed', failure }
}

const toExplored = async <T>(
  what: string,
  call: () => Promise<T>
): Promise<Explored<T>> => {
  try {
    return { outcome: 'read', answer: await call() }
  } catch (error) {
    return toFailed(what, error)
  }
}

const vocabularyIn = (body: Record<string, unknown>): Vocabulary | null =>
  typeof body.vocabulary === 'object' ? (body.vocabulary as Vocabulary) : null

const toReply = async <T>(
  what: string,
  call: () => Promise<T & WithVocabulary>
): Promise<ExploreReply<T>> => {
  try {
    const { vocabulary, ...answer } = await call()

    return {
      result: { outcome: 'read', answer: answer as T },
      vocabulary: vocabulary ?? null
    }
  } catch (error) {
    return {
      result: toFailed(what, error),
      vocabulary: vocabularyIn(toGasErrorBody(error))
    }
  }
}

/** One call to GAS's Explore; a failure is GAS's to say, so it is a warning here. */
const callExplore = async <T>(
  what: string,
  call: () => Promise<T>
): Promise<T> => {
  logger.info(`Asking fg-gas-backend to ${what}`)

  const called = await call()

  logger.info(`Finished: Asking fg-gas-backend to ${what}`)

  return called
}

/** Each call names the person's roles, so GAS refuses a source they may not query before reading it. */
export const runExplore = async (
  query: ExploreQuery,
  roles: string[]
): Promise<ExploreReply<ExploreAnswer>> =>
  callExplore('run an Explore query', () =>
    toReply('run an Explore query', () => queryExplore(query, roles))
  )

export const checkExploreQuery = async (
  query: string,
  roles: string[]
): Promise<ExploreReply<{ ok: true }>> =>
  callExplore('check an Explore query', () =>
    toReply('check an Explore query', () => checkExplore(query, roles))
  )

export const readExploreVocabulary = async (
  roles: string[]
): Promise<Explored<Vocabulary>> =>
  callExplore('read the Explore vocabulary', () =>
    toExplored('read the Explore vocabulary', () => findVocabulary(roles))
  )
