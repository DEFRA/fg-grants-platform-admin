import {
  deleteFromGas,
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

/**
 * The `access_tokens` document exactly as the owning service stores it, every
 * field under its stored name, in relaxed Extended JSON (`{ $oid }`,
 * `{ $date }`). Its `id` is the hash's first and last 3 characters; the
 * service masks it, so the whole hash never reaches GPA.
 */
export type StoredToken = Record<string, unknown>

/** A token as the list answers it, with its row as stored. */
export interface ListedToken extends ApiToken {
  stored: StoredToken
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

/** `newClient` is sent only when set: GAS defaults it to false. */
export const issueToken = async (
  service: ClientService,
  clientId: string,
  { tokenHash, tokenHint }: TokenHash,
  { expiresAt, newClient }: { expiresAt: string | null; newClient: boolean }
): Promise<ApiToken> => {
  const { token } = await postToGas<OneToken>(tokensPath(service, clientId), {
    payload: {
      tokenHash,
      tokenHint,
      expiresAt,
      ...(newClient ? { newClient } : {})
    }
  })

  return token
}

/** Answers the new token; the old one's expiry moves to the end of the overlap, which the service ends at 23:59:59 UK time on its day. */
export const rotateToken = async (
  key: TokenKey,
  { tokenHash, tokenHint }: TokenHash,
  keepOld: KeepOld
): Promise<ApiToken> => {
  const { token } = await postToGas<OneToken>(`${tokenPath(key)}/rotate`, {
    payload: { tokenHash, tokenHint, keepOld }
  })

  return token
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
