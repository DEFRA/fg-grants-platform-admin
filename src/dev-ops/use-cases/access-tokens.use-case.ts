import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  ApiToken,
  ClientService,
  Issued,
  KeepOld,
  ListedToken,
  TokenKey
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiry,
  deleteToken,
  issueToken,
  listTokens,
  revokeToken,
  rotateToken,
  toRefusalBody
} from '../repositories/clients.repository.ts'
import { generateToken } from './generate-token.ts'
import {
  cwNotReachedCode,
  toGasFailure,
  toGasWriteFailure
} from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type { ApiToken, ClientService, KeepOld, ListedToken, TokenKey }

/**
 * Why a write did not happen, as far as this app can tell.
 *
 * - `refused`: GAS (or Caseworking, through it) answered with a 4xx, so nothing changed.
 * - `not-offered`: GAS answered 404 with no error code: it has no token routes, so nothing changed.
 * - `unreachable`: no connection was made, so nothing changed. With an
 *   `errorCode`, GAS answered but could not reach Caseworking at all.
 * - `errored`: GAS answered with a 5xx of its own, or the call failed some other
 *   way: the change may or may not have been made.
 * - `unknown`: no answer in time: the change may or may not have been made.
 *   GAS's 504 is its own wait for Caseworking; `gasSilent` is GAS sending
 *   nothing (a timeout here, or a connection dropped mid-request).
 */
export type TokenFailure =
  | { outcome: 'refused'; statusCode: number; errorCode: string | null }
  | { outcome: 'not-offered' }
  | { outcome: 'unreachable'; errorCode?: string }
  | { outcome: 'errored' }
  | { outcome: 'unknown'; gasSilent?: true }

/** `unlisted`: GAS answered a write, but couldn't read the list to answer with it. */
export type ListFailure = TokenFailure | { outcome: 'unlisted' }

export type ListResult =
  | { outcome: 'done'; tokens: ListedToken[] }
  | ListFailure

/** The page a write is answered with is drawn from the list in the write's own answer. */
type Listed<T> = T & { list: ListResult }

export type WriteFailure = Listed<TokenFailure>

/** The raw token lives in this result and in the page rendered from it, nowhere else. */
export type IssueResult =
  | Listed<{ outcome: 'issued'; raw: string; token: ApiToken }>
  | WriteFailure

/** A new token's result: or, with nothing issued, the client's active tokens, said once in case a rotation was meant. */
export type NewTokenResult =
  | IssueResult
  | Listed<{ outcome: 'has-active'; active: number }>

export type WriteResult = { outcome: 'done' } | WriteFailure

export type ExpiryResult = { outcome: 'done'; token: ApiToken } | WriteFailure

type Attempt<T> = { outcome: 'done'; value: T } | WriteFailure

/** GAS refuses with a code for every token or client it hasn't got, so a bare 404 is a route it hasn't got. */
const toRefusal = (
  statusCode: number,
  errorCode: string | null
): TokenFailure =>
  statusCode === statusCodes.notFound && errorCode === null
    ? { outcome: 'not-offered' }
    : { outcome: 'refused', statusCode, errorCode }

const tokenFailures: {
  [K in GasFailure['kind']]: (
    failure: Extract<GasFailure, { kind: K }>
  ) => TokenFailure
} = {
  'not-connected': () => ({ outcome: 'unreachable' }),
  'cw-not-reached': () => ({
    outcome: 'unreachable',
    errorCode: cwNotReachedCode
  }),
  refused: ({ statusCode, errorCode }) => toRefusal(statusCode, errorCode),
  errored: () => ({ outcome: 'errored' }),
  'timed-out': () => ({ outcome: 'unknown' }),
  'no-answer': () => ({ outcome: 'unknown', gasSilent: true })
}

type ToGasFailure = typeof toGasFailure

const toFailure = (error: unknown, read: ToGasFailure): TokenFailure => {
  const failure = read(error)

  return (tokenFailures[failure.kind] as (failure: GasFailure) => TokenFailure)(
    failure
  )
}

const isNotOffered = (failure: TokenFailure): boolean =>
  failure.outcome === 'not-offered'

const logFailure = (
  what: string,
  failure: TokenFailure,
  error: unknown
): void => {
  if (failure.outcome === 'refused') {
    logger.warn(
      `Did not ${what}: ${failure.statusCode} ${failure.errorCode ?? 'with no error code'}`
    )
  } else if (isNotOffered(failure)) {
    logger.warn(`Did not ${what}: fg-gas-backend has no access token routes`)
  } else {
    logger.error(`Could not ${what} in fg-gas-backend: ${describeError(error)}`)
  }
}

/** Names the token by its address alone: no hash, hint or raw value is ever logged. */
const failed = (
  what: string,
  error: unknown,
  read: ToGasFailure
): TokenFailure => {
  const failure = toFailure(error, read)

  logFailure(what, failure, error)

  return failure
}

const toList = (tokens: ListedToken[] | null): ListResult =>
  tokens === null ? { outcome: 'unlisted' } : { outcome: 'done', tokens }

/**
 * A refusal carries the list, or null when GAS couldn't read it; an answer
 * with no list says why itself, as GAS not reached, or CW not reached
 * behind it.
 */
const listAfter = (failure: TokenFailure, error: unknown): ListResult => {
  const { tokens } = toRefusalBody(error)

  return tokens !== null || failure.outcome === 'refused'
    ? toList(tokens)
    : failure
}

/** A write's refusal names its reason in `code`, null on a 5xx. */
const toWriteFailure = (what: string, error: unknown): WriteFailure => {
  const failure = failed(what, error, toGasWriteFailure)

  return { ...failure, list: listAfter(failure, error) }
}

const attempt = async <T>(
  what: string,
  write: () => Promise<T>
): Promise<Attempt<T>> => {
  try {
    return { outcome: 'done', value: await write() }
  } catch (error) {
    return toWriteFailure(what, error)
  }
}

const toWhere = ({ service, clientId, tokenId }: TokenKey): string =>
  `${service}/${clientId}/${tokenId}`

/** The failure says who didn't answer: GAS, or CW behind it. */
export const listAccessTokensUseCase = async (
  service: ClientService
): Promise<ListResult> => {
  try {
    return { outcome: 'done', tokens: await listTokens(service) }
  } catch (error) {
    return failed(`list ${service} access tokens`, error, toGasFailure)
  }
}

const toIssued = (raw: string, { token, tokens }: Issued): IssueResult => ({
  outcome: 'issued',
  raw,
  token,
  list: toList(tokens)
})

/**
 * The owning service creates the client when no token has its name yet. A
 * client that already has active tokens most likely wants a rotation, so
 * unless `confirmed`, the service answers with their count and nothing is
 * issued.
 */
export const issueAccessTokenUseCase = async (
  service: ClientService,
  clientId: string,
  { expiresAt, confirmed }: { expiresAt: string | null; confirmed: boolean }
): Promise<NewTokenResult> => {
  const { raw, hash, hint } = generateToken()

  try {
    return toIssued(
      raw,
      await issueToken(
        service,
        clientId,
        { tokenHash: hash, tokenHint: hint },
        { expiresAt, confirmed }
      )
    )
  } catch (error) {
    const { active, tokens } = toRefusalBody(error)

    return active === null
      ? toWriteFailure(`issue a token for ${service}/${clientId}`, error)
      : { outcome: 'has-active', active, list: toList(tokens) }
  }
}

export const rotateAccessTokenUseCase = async (
  key: TokenKey,
  keepOld: KeepOld
): Promise<IssueResult> => {
  const { raw, hash, hint } = generateToken()
  const result = await attempt(`rotate token ${toWhere(key)}`, () =>
    rotateToken(key, { tokenHash: hash, tokenHint: hint }, keepOld)
  )

  return result.outcome === 'done' ? toIssued(raw, result.value) : result
}

export const changeTokenExpiryUseCase = async (
  key: TokenKey,
  expiresAt: string | null
): Promise<ExpiryResult> => {
  const result = await attempt(
    `change the expiry of token ${toWhere(key)}`,
    () => changeTokenExpiry(key, expiresAt)
  )

  return result.outcome === 'done'
    ? { outcome: 'done', token: result.value }
    : result
}

const toWriteResult = (result: Attempt<void>): WriteResult =>
  result.outcome === 'done' ? { outcome: 'done' } : result

export const revokeAccessTokenUseCase = async (
  key: TokenKey
): Promise<WriteResult> =>
  toWriteResult(
    await attempt(`revoke token ${toWhere(key)}`, () => revokeToken(key))
  )

export const deleteAccessTokenUseCase = async (
  key: TokenKey
): Promise<WriteResult> =>
  toWriteResult(
    await attempt(`delete token ${toWhere(key)}`, () => deleteToken(key))
  )
