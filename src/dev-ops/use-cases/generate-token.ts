import { createHash, randomBytes } from 'node:crypto'

const tokenBytes = 32

/**
 * A new bearer token, made here so the raw value never leaves this app: GAS
 * and Caseworking are sent only the hash and the hint. 256 random bits as
 * base64url, hashed exactly as both services hash a presented token: SHA-256
 * of the UTF-8 string, as lowercase hex. The hint is the last 4 characters.
 */
export const generateToken = (): {
  raw: string
  hash: string
  hint: string
} => {
  const raw = randomBytes(tokenBytes).toString('base64url')

  return {
    raw,
    hash: createHash('sha256').update(raw, 'utf8').digest('hex'),
    hint: raw.slice(-4)
  }
}
