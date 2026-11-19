import type {
  ApiToken,
  ListedToken
} from '../use-cases/access-tokens.use-case.ts'
import type { ServiceWords } from './access-token-services.ts'
import { toDayTime, toTimes } from './times.ts'
import type { TimeText } from './times.ts'

/** What the page calls a token's state: the service's status, with GAS's "expiring soon" split out of active. */
export type TokenState = 'active' | 'expiring' | 'expired' | 'revoked'

export const toTokenState = (token: ListedToken): TokenState => {
  if (token.status === 'REVOKED') {
    return 'revoked'
  }

  if (token.status === 'EXPIRED') {
    return 'expired'
  }

  return token.expiringSoon ? 'expiring' : 'active'
}

/** A fixed set of states, so each has its own tone. */
export const tokenStates: Record<TokenState, { text: string; tone: string }> = {
  active: { text: 'Active', tone: 'success' },
  expiring: { text: 'Expiring soon', tone: 'warning' },
  expired: { text: 'Expired', tone: 'neutral' },
  revoked: { text: 'Revoked', tone: 'danger' }
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
export const toCompareTokens = (a: ListedToken, b: ListedToken): number =>
  compareClients(a, b) ||
  stateRank[toTokenState(a)] - stateRank[toTokenState(b)] ||
  createdMs(b) - createdMs(a)

/**
 * The actions each state has. The services rotate and revoke only an active
 * token and delete only one that isn't; an expiry can change in any state,
 * but a revoked token offers Delete alone, as the design does. A row with no
 * valid name can be addressed by no route, so it has none.
 */
export interface TokenActions {
  rotate: boolean
  expiry: boolean
  revoke: boolean
  delete: boolean
}

const none: TokenActions = {
  rotate: false,
  expiry: false,
  revoke: false,
  delete: false
}

const stateActions: Record<TokenState, TokenActions> = {
  active: { rotate: true, expiry: true, revoke: true, delete: false },
  expiring: { rotate: true, expiry: true, revoke: true, delete: false },
  expired: { rotate: false, expiry: true, revoke: false, delete: true },
  revoked: { ...none, delete: true }
}

export const toActions = (token: ApiToken, state: TokenState): TokenActions =>
  token.clientId === null ? none : stateActions[state]

export interface TokenRow {
  tokenId: string
  clientId: string | null
  hint: string | null
  state: TokenState
  status: { text: string; tone: string }
  /** Null is never. */
  expires: TimeText | null
  expiresAt: string | null
  inUse: boolean
  document: string
  actions: TokenActions
  /** Why Revoke is off: the token in use is never revoked. */
  revokeOff: string | null
}

/** An expiry is a UK day by rule (it ends at 23:59:59 UK time), so it is written as one whatever Times says; its title names the zone. */
const ukTimes = toTimes('uk')

const toRow = (token: ListedToken, words: ServiceWords): TokenRow => {
  const state = toTokenState(token)

  return {
    tokenId: token.tokenId,
    clientId: token.clientId,
    hint: token.tokenHint,
    state,
    status: tokenStates[state],
    expires:
      token.expiresAt === null
        ? null
        : toDayTime(new Date(token.expiresAt), ukTimes),
    expiresAt: token.expiresAt,
    inUse: token.inUse,
    document: JSON.stringify(token.stored, null, 2),
    actions: toActions(token, state),
    revokeOff: token.inUse ? `${words.inUse.calling} Rotate it instead.` : null
  }
}

export const toTokenRows = (
  tokens: ListedToken[],
  words: ServiceWords
): TokenRow[] =>
  tokens.toSorted(toCompareTokens).map((token) => toRow(token, words))
