import type {
  ClientService,
  ListFailure,
  TokenFailure
} from '../use-cases/access-tokens.use-case.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { cwNotReachedCode } from '../use-cases/gas-status.ts'
import { toExpiryDay } from './access-token-dates.ts'
import type { FormRefusal } from './access-token-forms.ts'
import type { ReadList } from './access-token-rows.ts'
import { serviceWords } from './access-token-services.ts'

export const accessTokenNoticeKey = 'accessTokenNotice' as const

export type TokenAction = 'issue' | 'rotate' | 'expiry' | 'revoke' | 'delete'

export interface TokenToast {
  tone: 'success' | 'info' | 'danger'
  text: string
}

export interface TokenAlert {
  tone: 'warning'
  title: string
  text: string
}

/**
 * How a write went, carried to the page it redirects to and spent on one
 * render: words only, never the token, its hash or its hint's neighbours.
 */
export interface TokenNotice {
  service: ClientService
  toast?: TokenToast
  alert?: TokenAlert
}

const hinted = (hint: string | null): string =>
  hint ? `Token …${hint}` : 'Token'

export const toRevokedToast = (hint: string | null): TokenToast => ({
  tone: 'success',
  text: `${hinted(hint)} revoked`
})

export const toExpiryToast = (expiresAt: string | null): TokenToast => ({
  tone: 'success',
  text: `Expiry changed to ${expiresAt === null ? 'never' : toExpiryDay(new Date(expiresAt))}`
})

export const deletedToast: TokenToast = {
  tone: 'info',
  text: 'Token record deleted'
}

const unknownTitles: Record<TokenAction, string> = {
  issue: 'New token status unknown.',
  rotate: 'Rotation status unknown.',
  expiry: 'Expiry change status unknown.',
  revoke: 'Revoke status unknown.',
  delete: 'Delete status unknown.'
}

const unknownChecks: Record<TokenAction, string> = {
  issue: 'whether the token was issued',
  rotate: 'whether the token was rotated',
  expiry: 'whether the expiry changed',
  revoke: 'whether the token was revoked',
  delete: 'whether the record was deleted'
}

const lostValue =
  ' If a token was issued, revoke it: its value can’t be shown again.'

export type UncertainFailure = Extract<
  TokenFailure,
  { outcome: 'unknown' | 'errored' }
>

export const isUncertain = (
  failure: TokenFailure
): failure is UncertainFailure =>
  failure.outcome === 'unknown' || failure.outcome === 'errored'

const notDone: Record<TokenAction, string> = {
  issue: 'Not issued.',
  rotate: 'Not rotated.',
  expiry: 'Expiry not changed.',
  revoke: 'Not revoked.',
  delete: 'Not deleted.'
}

const nothingChanged = 'Nothing has changed.'

/** The codes GAS and CW refuse with for a token or client they haven't got. */
const notFoundCodes = new Set(['API_TOKEN_NOT_FOUND', 'API_CLIENT_NOT_FOUND'])

/** GAS forwards CW's refusals with a code, so a 404 without one is GAS's own. */
const isGasRefusal = (failure: ListFailure): boolean =>
  failure.outcome === 'refused' &&
  failure.statusCode === statusCodes.notFound &&
  failure.errorCode === null

const isGasSilent = (failure: ListFailure): boolean =>
  failure.outcome === 'unknown' && failure.gasSilent === true

const isGasOwn = (failure: ListFailure): boolean =>
  failure.outcome === 'errored' || isGasSilent(failure) || isGasRefusal(failure)

/**
 * The service a failure names. Every write goes to GAS, which forwards CW's:
 * one never sent names GAS, unless GAS said it couldn't reach CW; an error
 * or refusal of GAS's own, or GAS sending nothing, names GAS; any other
 * answer is the token's own service's.
 */
const whoFailed = (failure: ListFailure, service: ClientService): string => {
  if (failure.outcome === 'unreachable') {
    return failure.errorCode === cwNotReachedCode
      ? serviceWords.cw.short
      : serviceWords.gas.short
  }

  return isGasOwn(failure)
    ? serviceWords.gas.short
    : serviceWords[service].short
}

const uncertainReasons: Record<
  UncertainFailure['outcome'],
  (failure: TokenFailure, service: ClientService) => string
> = {
  unknown: (failure, service) =>
    `${whoFailed(failure, service)} didn’t answer in time.`,
  errored: () => `${serviceWords.gas.short} answered with an error.`
}

/** A write that timed out or failed on the far side may or may not have happened: the list says which. */
export const toUnknownAlert = (
  action: TokenAction,
  service: ClientService,
  failure: UncertainFailure
): TokenAlert => ({
  tone: 'warning',
  title: unknownTitles[action],
  text: `${uncertainReasons[failure.outcome](failure, service)} Refresh to see ${unknownChecks[action]} before trying again.${action === 'issue' || action === 'rotate' ? lostValue : ''}`
})

const inUseReasons: Record<TokenAction, string> = {
  issue: '',
  rotate: 'Keep the old one valid until the new one is deployed.',
  expiry: 'Its expiry has to stay in the future.',
  revoke: 'Rotate it instead.',
  delete: ''
}

const refusalReasons: Record<
  string,
  (action: TokenAction, service: ClientService) => string
> = {
  // Expiry changes in any state: there the code only means the token changed under the write.
  API_TOKEN_NOT_ACTIVE: (action) =>
    action === 'expiry'
      ? 'The token changed while this was open. Refresh and try again.'
      : 'This token is no longer active.',
  API_TOKEN_ACTIVE: () => 'Only a revoked or expired token can be deleted.',
  API_TOKEN_DUPLICATE: () =>
    'The new token matched one already stored. Try again for a fresh one.',
  API_TOKEN_IN_USE: (action, service) =>
    `${serviceWords[service].inUse.calling} ${inUseReasons[action]}`.trim()
}

const codeReason = (
  action: TokenAction,
  errorCode: string | null,
  service: ClientService
): string | undefined => refusalReasons[errorCode ?? '']?.(action, service)

const refusedReason = (
  action: TokenAction,
  failure: Extract<TokenFailure, { outcome: 'refused' }>,
  service: ClientService
): string => {
  if (notFoundCodes.has(failure.errorCode ?? '')) {
    return `${serviceWords[service].short} no longer has this token.`
  }

  return (
    codeReason(action, failure.errorCode, service) ||
    `${whoFailed(failure, service)} refused the request.`
  )
}

/** A write that certainly didn't happen; an uncertain one goes back to the list instead. */
export type CertainFailure = Exclude<TokenFailure, UncertainFailure>

const toReason = (
  action: TokenAction,
  failure: CertainFailure,
  service: ClientService
): string =>
  failure.outcome === 'refused'
    ? refusedReason(action, failure, service)
    : `${whoFailed(failure, service)} couldn’t be reached.`

/** A write that didn't happen, said in the dialog it came from: what, why, and that nothing changed. */
export const toRefusal = (
  action: TokenAction,
  failure: CertainFailure,
  service: ClientService
): FormRefusal => ({
  title: notDone[action],
  text: `${toReason(action, failure, service)} ${nothingChanged}`
})

/** A dialog's own field errors, as its refusal, for when there's no dialog left to put them on. */
export const toFieldRefusal = (
  action: TokenAction,
  errors: Record<string, string>
): FormRefusal | null => {
  const reasons = Object.values(errors)

  return reasons.length
    ? { title: notDone[action], text: `${reasons.join(' ')} ${nothingChanged}` }
    : null
}

/** The same, as a toast, for a token the page no longer lists, so there's no dialog left to say it in. */
export const toRefusalToast = (refusal: FormRefusal): TokenToast => ({
  tone: 'danger',
  text: `${refusal.title} ${refusal.text}`
})

/** The tokens list couldn't be read: whoever didn't answer, GAS or CW behind it. */
const unavailableReasons: Record<ListFailure['outcome'], string> = {
  errored:
    'answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.',
  unknown:
    'didn’t answer in time. Nothing has changed — try again in a moment.',
  unreachable:
    'couldn’t be reached. Nothing has changed — try again in a moment.',
  refused: 'refused the request. Nothing has changed.',
  unlisted: 'couldn’t list the tokens. Try again in a moment.'
}

export interface UnavailableAlert {
  tone: 'danger'
  title: string
  text: string
}

/** The tokens list couldn't be read, said for how it failed, naming the service as `whoFailed` does. */
export const toUnavailableAlert = (
  failure: Exclude<ReadList, { outcome: 'done' }>,
  service: ClientService
): UnavailableAlert => ({
  tone: 'danger',
  title: 'The tokens list couldn’t be loaded.',
  text:
    failure.outcome === 'unreadable'
      ? `${serviceWords[service].short}’s tokens can’t be read.`
      : `${whoFailed(failure, service)} ${unavailableReasons[failure.outcome]}`
})

/** Null for a notice meant for the other service's page. */
export const toNoticeFor = (
  notice: TokenNotice | undefined,
  service: ClientService
): TokenNotice | null =>
  notice !== undefined && notice.service === service ? notice : null
