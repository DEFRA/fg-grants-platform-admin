import {
  deleteFromGas,
  errorBodyOf,
  getFromGas,
  postToGas,
  putToGas
} from '../../common/gas.ts'

/** GPA only ever calls GAS: for `cw`, GAS forwards to Caseworking. */
export type ClientService = 'gas' | 'cw'

export type TokenStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED'

/** One `access_tokens` row as the owning service lists it. It never carries the hash. */
export interface ApiToken {
  tokenId: string
  /** Null on a row with no valid name. */
  clientId: string | null
  /** The raw token's last 4 characters; null on a row issued before hints. */
  tokenHint: string | null
  status: TokenStatus
  createdAt: string | null
  createdBy: string | null
  /** Null is never. */
  expiresAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  /** True only on the token the listing service was itself called with. */
  inUse: boolean
}

/** A token as the list answers it, with its row as stored. */
export interface ListedToken extends ApiToken {
  /**
   * Base64 of the `access_tokens` document's own BSON, every field under its
   * stored name and type. Its `id` is the hash's first and last 3
   * characters; the service masks it, so the whole hash never reaches GPA.
   */
  document: string
  /** GAS's rule, the one its Overview counts by. */
  expiringSoon: boolean
}

export interface TokenKey {
  service: ClientService
  clientId: string
  tokenId: string
}

/**
 * What GAS stores for a new token. There is no field for the raw value, so it
 * has no way into a request.
 */
export interface TokenHash {
  tokenHash: string
  tokenHint: string
}

export type KeepOld = 'none' | '24h' | '7d'

interface TokenList {
  tokens: ListedToken[]
}

interface OneToken {
  token: ApiToken
}

/** A new token, and the service's list after it: null when GAS couldn't read it. */
export interface Issued {
  token: ApiToken
  tokens: ListedToken[] | null
}

/**
 * What GAS's refusal of a token write carries: the list after it, null when
 * the answer has none, and on HAS_ACTIVE the client's active token count.
 */
export interface TokenRefusal {
  tokens: ListedToken[] | null
  active: number | null
}

const hasActiveCode = 'HAS_ACTIVE'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isListed = (token: unknown): boolean =>
  isRecord(token) &&
  typeof token.expiringSoon === 'boolean' &&
  typeof token.document === 'string'

const toListed = (tokens: unknown): ListedToken[] | null =>
  Array.isArray(tokens) && tokens.every(isListed)
    ? (tokens as unknown as ListedToken[])
    : null

const toActive = ({ code, active }: Record<string, unknown>): number | null =>
  code === hasActiveCode && Number.isInteger(active) ? (active as number) : null

export const toRefusalBody = (error: unknown): TokenRefusal => {
  const body = errorBodyOf(error)

  return isRecord(body)
    ? { tokens: toListed(body.tokens), active: toActive(body) }
    : { tokens: null, active: null }
}

const clientsPath = (service: ClientService): string =>
  `/grant-admin/clients/${encodeURIComponent(service)}`

const tokensPath = (service: ClientService, clientId: string): string =>
  `${clientsPath(service)}/${encodeURIComponent(clientId)}/tokens`

const tokenPath = ({ service, clientId, tokenId }: TokenKey): string =>
  `${tokensPath(service, clientId)}/${encodeURIComponent(tokenId)}`

export const listTokens = async (
  service: ClientService
): Promise<ListedToken[]> => {
  const { tokens } = await getFromGas<TokenList>(clientsPath(service))

  return tokens
}

/**
 * The owning service creates the client when it has no tokens. `confirmed`
 * is always sent: false refuses, issuing nothing, while the client has
 * active tokens.
 */
export const issueToken = async (
  service: ClientService,
  clientId: string,
  { tokenHash, tokenHint }: TokenHash,
  { expiresAt, confirmed }: { expiresAt: string | null; confirmed: boolean }
): Promise<Issued> => {
  const { token, tokens } = await postToGas<Issued>(
    tokensPath(service, clientId),
    { payload: { tokenHash, tokenHint, expiresAt, confirmed } }
  )

  return { token, tokens }
}

/** Answers the new token; the old one's expiry moves to the end of the overlap, which the service ends at 23:59:59 UK time on its day. */
export const rotateToken = async (
  key: TokenKey,
  { tokenHash, tokenHint }: TokenHash,
  keepOld: KeepOld
): Promise<Issued> => {
  const { token, tokens } = await postToGas<Issued>(
    `${tokenPath(key)}/rotate`,
    { payload: { tokenHash, tokenHint, keepOld } }
  )

  return { token, tokens }
}

export const changeTokenExpiry = async (
  key: TokenKey,
  expiresAt: string | null
): Promise<ApiToken> => {
  const { token } = await putToGas<OneToken>(`${tokenPath(key)}/expiry`, {
    payload: { expiresAt }
  })

  return token
}

/** GAS answers 204 with no body. */
export const revokeToken = async (key: TokenKey): Promise<void> => {
  await postToGas(`${tokenPath(key)}/revoke`)
}

/** GAS answers 204 with no body. */
export const deleteToken = async (key: TokenKey): Promise<void> => {
  await deleteFromGas(tokenPath(key))
}
