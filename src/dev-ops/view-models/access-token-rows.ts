import type {
  ApiToken,
  ListedToken
} from '../use-cases/access-tokens.use-case.ts'
import { dayMs, toExpiryDay } from './access-token-dates.ts'

/** An active token is "expiring soon" with less than this left. */
export const expiringSoonMs = 14 * dayMs

/** What the page calls a token's state: the service's status, with "expiring soon" split out of active. */
export type TokenState = 'active' | 'expiring' | 'expired' | 'revoked'

const isExpiringSoon = (expiresAt: string | null, now: Date): boolean =>
  expiresAt !== null && Date.parse(expiresAt) - now.getTime() < expiringSoonMs

export const toTokenState = (token: ApiToken, now: Date): TokenState => {
  if (token.status === 'REVOKED') {
    return 'revoked'
  }

  if (token.status === 'EXPIRED') {
    return 'expired'
  }

  return isExpiringSoon(token.expiresAt, now) ? 'expiring' : 'active'
}

/** Named by meaning: the classes are in status-badge/template.njk. */
const stateBadges: Record<TokenState, { label: string; role: string }> = {
  active: { label: 'Active', role: 'success' },
  expiring: { label: 'Expiring soon', role: 'warning' },
  expired: { label: 'Expired', role: 'neutral' },
  revoked: { label: 'Revoked', role: 'error' }
}

const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0
  }

  return a < b ? -1 : 1
}

/** Rows with no valid name go last. */
const compareClients = (a: ApiToken, b: ApiToken): number =>
  Number(a.clientId === null) - Number(b.clientId === null) ||
  compareText(a.clientId ?? '', b.clientId ?? '')

/** Tokens that need attention soonest first: expiring, then working, then dead. */
const stateRank: Record<TokenState, number> = {
  expiring: 0,
  active: 1,
  expired: 2,
  revoked: 2
}

/** Undated rows, made before `createdAt` was kept, count as oldest. */
const createdMs = ({ createdAt }: ApiToken): number =>
  createdAt === null ? 0 : Date.parse(createdAt)

/** By client ID, then expiring, working and dead tokens in that order, then newest first. */
export const toCompareTokens =
  (now: Date) =>
  (a: ApiToken, b: ApiToken): number =>
    compareClients(a, b) ||
    stateRank[toTokenState(a, now)] - stateRank[toTokenState(b, now)] ||
    createdMs(b) - createdMs(a)

export const toOpenLabel = ({ clientId }: ApiToken) =>
  clientId ? `Open token for ${clientId}` : 'Open token with no client ID'

export interface DateText {
  text: string
  instant: string | null
}

const toExpiresCell = (expiresAt: string | null): DateText =>
  expiresAt === null
    ? { text: 'Never', instant: null }
    : { text: toExpiryDay(new Date(expiresAt)), instant: expiresAt }

export interface TokenFact {
  id: string
  label: string
  text: string | null
  instant?: string | null
  hint?: string | null
}

const toExpiresFact = (expiresAt: string | null): TokenFact =>
  expiresAt === null
    ? { id: 'expires', label: 'Expires', text: 'Never' }
    : {
        id: 'expires',
        label: 'Expires',
        text: toExpiryDay(new Date(expiresAt)),
        instant: expiresAt
      }

const toFacts = (token: ApiToken): TokenFact[] => [
  { id: 'client', label: 'Client ID', text: token.clientId },
  toExpiresFact(token.expiresAt),
  { id: 'token', label: 'Token', text: null, hint: token.tokenHint }
]

export interface TokenActions {
  rotate: boolean
  /** Rotate is drawn but can't be pressed: a token that no longer works can't be rotated. */
  rotateLocked: boolean
  expiry: boolean
  revoke: boolean
  delete: boolean
}

/**
 * A row with no valid name can be addressed by no route. Revoke is for a
 * working token other than the one in use, which the service refuses to
 * revoke anyway; Delete for one that already can't call, so never the token
 * in use either.
 */
export const toActions = (token: ApiToken): TokenActions => {
  const named = token.clientId !== null
  const ended = token.status !== 'ACTIVE'

  return {
    rotate: named,
    rotateLocked: ended,
    expiry: named,
    revoke: named && !ended && !token.inUse,
    delete: named && ended
  }
}

/** Why an action is missing, for a token with no name or one that no longer works. */
const toActionNote = (token: ApiToken): string | null => {
  if (token.clientId === null) {
    return "This token has no valid client ID, so it can't be changed here."
  }

  return token.status === 'ACTIVE'
    ? null
    : 'This token no longer works. Change its expiry to bring it back, or delete it.'
}

export interface TokenRow {
  tokenId: string
  clientId: string | null
  hint: string | null
  inUse: boolean
  state: TokenState
  badge: { label: string; role: string }
  expires: DateText
  openLabel: string
  facts: TokenFact[]
  document: string
  actions: TokenActions
  actionNote: string | null
  /** Deleting it takes the client off the list and frees its name. */
  lastToken: boolean
}

const isOnlyToken = (token: ApiToken, tokens: ApiToken[]): boolean =>
  tokens.filter(({ clientId }) => clientId === token.clientId).length === 1

const toRow = (
  token: ListedToken,
  tokens: ListedToken[],
  now: Date
): TokenRow => {
  const state = toTokenState(token, now)

  return {
    tokenId: token.tokenId,
    clientId: token.clientId,
    hint: token.tokenHint,
    inUse: token.inUse,
    state,
    badge: stateBadges[state],
    expires: toExpiresCell(token.expiresAt),
    openLabel: toOpenLabel(token),
    facts: toFacts(token),
    document: JSON.stringify(token.stored, null, 2),
    actions: toActions(token),
    actionNote: toActionNote(token),
    lastToken: isOnlyToken(token, tokens)
  }
}

export const toTokenRows = (tokens: ListedToken[], now: Date): TokenRow[] =>
  tokens
    .toSorted(toCompareTokens(now))
    .map((token) => toRow(token, tokens, now))
