import type {
  ClientService,
  TokenFailure
} from '../use-cases/access-tokens.use-case.ts'
import { toExpiryDay } from './access-token-dates.ts'
import { serviceWords } from './access-token-services.ts'
import type { ServiceWords } from './access-token-services.ts'

export const accessTokenNoticeKey = 'accessTokenNotice' as const

export type NoticeAction = 'issue' | 'rotate' | 'expiry' | 'revoke' | 'delete'

export type NoticeOutcome =
  | 'done'
  | 'refused'
  | 'not-found'
  | 'rejected'
  | 'unreachable'
  | 'unknown'
  | 'unchecked'

/**
 * How a write went, carried to the page it redirects to and spent on one
 * render. It names the token by its id and hint, never by its value or hash.
 */
export interface TokenNotice {
  service: ClientService
  action: NoticeAction
  outcome: NoticeOutcome
  errorCode: string | null
  tokenId: string
  clientId: string
  hint: string | null
  expiresAt: string | null
}

/** The hint is drawn masked, so it is kept apart from the words around it. */
export type ToastPart = { text: string } | { hint: string }

export interface Toast {
  role: 'success' | 'warning' | 'error'
  parts: ToastPart[]
}

const notFound = 404

/**
 * The refusals the operator can act on from where they are: shown in the
 * dialog the write came from, not as a toast. Any other refusal is
 * "refused the request".
 */
export const inlineRefusals = new Set([
  'API_TOKEN_NOT_ACTIVE',
  'API_TOKEN_IN_USE',
  'API_TOKEN_ACTIVE',
  'API_TOKEN_DUPLICATE'
])

const toRefusalOutcome = (
  statusCode: number,
  errorCode: string | null
): NoticeOutcome => {
  if (statusCode === notFound) {
    return 'not-found'
  }

  return inlineRefusals.has(errorCode ?? '') ? 'refused' : 'rejected'
}

export const toFailureOutcome = (
  failure: TokenFailure
): { outcome: NoticeOutcome; errorCode: string | null } =>
  failure.outcome === 'refused'
    ? {
        outcome: toRefusalOutcome(failure.statusCode, failure.errorCode),
        errorCode: failure.errorCode
      }
    : {
        outcome: failure.outcome,
        errorCode:
          failure.outcome === 'unreachable' ? (failure.errorCode ?? null) : null
      }

const done: Record<NoticeAction, string> = {
  issue: 'issued',
  rotate: 'rotated',
  expiry: 'changed',
  revoke: 'revoked',
  delete: 'deleted'
}

const unknownLeads: Record<NoticeAction, string> = {
  issue:
    'New token status unknown — refresh to check. If it was issued, revoke it: its value is gone.',
  rotate:
    'Rotation status unknown — refresh to check. If a new token was issued, revoke it: its value is gone.',
  expiry: 'Expiry change status unknown — refresh to check.',
  revoke: 'Revoke status unknown — refresh to check.',
  delete: 'Delete status unknown — refresh to check.'
}

const nothingChanged = ' Nothing has changed.'

const inUseRefusal = (
  { action }: TokenNotice,
  words: ServiceWords
): string | null =>
  action === 'rotate' || action === 'expiry' || action === 'revoke'
    ? words.inUse[action]
    : null

const refusalWords: Record<
  string,
  (notice: TokenNotice, words: ServiceWords) => string | null
> = {
  API_TOKEN_NOT_ACTIVE: () => 'this token is no longer active.',
  // Said with no reason: the dialog is the token's own, which the operator can see works again.
  API_TOKEN_ACTIVE: () => '',
  API_TOKEN_DUPLICATE: () =>
    'the new token matched one already stored. Try again for a fresh one.',
  API_TOKEN_IN_USE: inUseRefusal
}

const notDone = (notice: TokenNotice, reason: string): string =>
  `Not ${done[notice.action]} — ${reason}${nothingChanged}`

const reasonFor = (notice: TokenNotice, words: ServiceWords): string =>
  refusalWords[notice.errorCode ?? '']?.(notice, words) ??
  `${words.owner} refused the request.`

const toRefusalText = (notice: TokenNotice, words: ServiceWords): string => {
  const reason = reasonFor(notice, words)

  return reason === ''
    ? `Not ${done[notice.action]}.${nothingChanged}`
    : notDone(notice, reason)
}

/** Whoever could not be reached: GAS itself, or Caseworking behind it. */
const unreachableOwner = ({ errorCode }: TokenNotice, words: ServiceWords) =>
  errorCode === null ? serviceWords.gas.owner : words.owner

const failureTexts: Record<
  string,
  (notice: TokenNotice, words: ServiceWords) => string
> = {
  refused: toRefusalText,
  rejected: (notice, words) =>
    notDone(notice, `${words.owner} refused the request.`),
  'not-found': (notice, words) =>
    notDone(notice, `${words.owner} no longer has this token.`),
  unreachable: (notice, words) =>
    notDone(notice, `${unreachableOwner(notice, words)} could not be reached.`),
  unknown: (notice) => unknownLeads[notice.action],
  unchecked: (notice, words) =>
    notDone(
      notice,
      `${words.owner} could not list the tokens to check this client.`
    )
}

const deletedParts = ({ clientId, hint }: TokenNotice): ToastPart[] => [
  { text: `Token deleted — ${clientId}` },
  ...(hint ? [{ text: ' ' }, { hint }] : [])
]

/** As the canvas words them; an issue's and a rotation's are said once the reveal is done with. */
const successParts: Record<NoticeAction, (notice: TokenNotice) => ToastPart[]> =
  {
    issue: ({ clientId }) => [{ text: `Token for ${clientId} is live` }],
    rotate: ({ clientId }) => [{ text: `Token for ${clientId} is live` }],
    expiry: ({ expiresAt }) => [
      {
        text:
          expiresAt === null
            ? 'Expiry updated — never expires'
            : `Expiry updated — expires ${toExpiryDay(new Date(expiresAt))}`
      }
    ],
    revoke: ({ clientId }) => [
      { text: `Token revoked — ${clientId} gets 401 from now on` }
    ],
    delete: deletedParts
  }

const toFailure = (notice: TokenNotice): Toast => ({
  role: notice.outcome === 'unknown' ? 'warning' : 'error',
  parts: [
    {
      text: failureTexts[notice.outcome](notice, serviceWords[notice.service])
    }
  ]
})

/** Null for a notice meant for the other service's page. */
export const toToast = (
  notice: TokenNotice | undefined,
  service: ClientService
): Toast | null => {
  if (notice === undefined || notice.service !== service) {
    return null
  }

  return notice.outcome === 'done'
    ? { role: 'success', parts: successParts[notice.action](notice) }
    : toFailure(notice)
}

/** A refusal in the words a toast would use, for the dialog it is shown in instead. */
export const toRefusalMessage = (notice: TokenNotice): string =>
  failureTexts[notice.outcome](notice, serviceWords[notice.service])
