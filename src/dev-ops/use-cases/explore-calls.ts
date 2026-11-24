import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventService,
  ExploreAnswer,
  ExploreQuery,
  ExploreStream,
  QueryError,
  Vocabulary,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore,
  streamExploreQuery
} from '../repositories/explore.repository.ts'
import { toGasErrorBody, toGasFailure, toGasStatusCode } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  ExploreAnswer,
  ExploreCell,
  ExploreColumn,
  ExploreContext,
  ExploreDocNote,
  ExploreDownload,
  ExploreDownloadStop,
  ExploreObject,
  ExploreOpen,
  ExplorePrinted,
  ExploreRow,
  ExploreShow,
  ExploreSkipped,
  ExploreStart,
  ExploreSource,
  ExploreStreamEnd,
  ExploreStreamHeader,
  ExploreStreamLine,
  ExploreStreamRow,
  ExploreValue,
  EventBox,
  EventService,
  QueryError,
  Vocabulary,
  VocabularySource
} from '../repositories/explore.repository.ts'

export type ExploreService = EventService

/**
 * - `invalid`: the query broke a rule of the language, at a place in its text.
 * - `refused`: a service would not run it, with its reason when it gave one.
 * - `too-large`: what it found is more than one answer holds, with what to change.
 * - `too-slow`: a service stopped it at its deadline.
 * - `busy`: this person already has a query running.
 * - `full`: a service is running as many queries as it can.
 * - `unavailable`: a service can't run queries at all for now, whatever is asked.
 * - `no-answer`: a service didn't answer, or couldn't be reached, as `failure` says.
 * - `errored`: a service answered with an error.
 */
export type ExploreFailure =
  | { kind: 'invalid'; error: QueryError }
  | { kind: 'refused'; service: ExploreService; message: string | null }
  | { kind: 'too-large'; service: ExploreService; message: string | null }
  | { kind: 'too-slow'; service: ExploreService; message: string | null }
  | { kind: 'busy'; service: ExploreService }
  | { kind: 'full'; service: ExploreService }
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

const cwNotReached: ExploreFailure = {
  kind: 'no-answer',
  service: 'CW',
  failure: { kind: 'cw-not-reached' }
}

/** What GAS's 502 for Caseworking says went wrong there; any other reason is Caseworking answering with an error. */
const caseworkingReasons: Record<string, (body: Body) => ExploreFailure> = {
  UNREACHABLE: () => cwNotReached,
  TIMED_OUT: () => ({
    kind: 'no-answer',
    service: 'CW',
    failure: { kind: 'timed-out' }
  }),
  EXPLORE_QUERY_INVALID: (body) => ({
    kind: 'refused',
    service: 'CW',
    message: textOf(body.message)
  })
}

const gasErrored: ExploreFailure = { kind: 'errored', service: 'GAS' }
const cwErrored: ExploreFailure = { kind: 'errored', service: 'CW' }

/** GAS's 502 names the hop when it is Caseworking's failure; else it is GAS's own. */
const toBadGateway = (body: Body): ExploreFailure => {
  if (body.hop !== 'CW-BE') {
    return gasErrored
  }

  const reason = String(body.reason)

  return Object.hasOwn(caseworkingReasons, reason)
    ? caseworkingReasons[reason](body)
    : cwErrored
}

/** The service a body names as the one that refused or stopped the query; GAS unless it says Caseworking. */
const serviceOf = (body: Body): ExploreService =>
  body.service === 'CW' ? 'CW' : 'GAS'

const toRefused = (
  body: Body,
  kind: 'refused' | 'too-large' = 'refused'
): ExploreFailure => ({
  kind,
  service: serviceOf(body),
  message: textOf(body.message)
})

/** A rule of the language, or mongod failing on a stored value as it would in mongosh: both said at their place in the query. */
const isAtItsPlace = (body: Body): boolean =>
  body.reason === 'QUERY_INVALID' || body.refusal === 'MONGOD_ERROR'

/** The query ran, but what it found doesn't fit one answer: its cells, or Caseworking's answer. */
const tooLargeRefusals = new Set(['CELLS_TOO_LARGE', 'ANSWER_TOO_LARGE'])

const toBadRequest = (body: Body): ExploreFailure => {
  const error = isAtItsPlace(body) && toQueryError(body.error)

  if (error) {
    return { kind: 'invalid', error }
  }

  return toRefused(
    body,
    tooLargeRefusals.has(String(body.refusal)) ? 'too-large' : 'refused'
  )
}

/** What each status GAS answered with means; any other is GAS failing. */
const answers: Record<number, (body: Body) => ExploreFailure> = {
  [statusCodes.badRequest]: toBadRequest,
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

const outages = new Set<ExploreFailure['kind']>([
  'no-answer',
  'errored',
  'unavailable'
])

const isOutage = ({ kind }: ExploreFailure): boolean => outages.has(kind)

/** Never the query, its values or its positions: only the error's name and message. */
const logFailure = (what: string, failure: ExploreFailure, error: unknown) => {
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

export const runExplore = async (
  query: ExploreQuery
): Promise<ExploreReply<ExploreAnswer>> =>
  callExplore('run an Explore query', () =>
    toReply('run an Explore query', () => queryExplore(query))
  )

/** Download JSON: GAS's lines, once it has said it will answer; a refusal before them as any run's. */
export const streamExplore = async (
  query: ExploreQuery
): Promise<ExploreReply<ExploreStream>> =>
  callExplore('download an Explore query', async () => {
    try {
      return {
        result: { outcome: 'read', answer: await streamExploreQuery(query) },
        vocabulary: null
      }
    } catch (error) {
      return {
        result: toFailed('download an Explore query', error),
        vocabulary: vocabularyIn(toGasErrorBody(error))
      }
    }
  })

export const checkExploreQuery = async (
  query: string
): Promise<ExploreReply<{ ok: true }>> =>
  callExplore('check an Explore query', () =>
    toReply('check an Explore query', () => checkExplore(query))
  )

export const readExploreVocabulary = async (): Promise<Explored<Vocabulary>> =>
  callExplore('read the Explore vocabulary', () =>
    toExplored('read the Explore vocabulary', () => findVocabulary())
  )
