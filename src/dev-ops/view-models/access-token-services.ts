import type { ClientService } from '../use-cases/access-tokens.use-case.ts'

export const clientServices: ClientService[] = ['gas', 'cw']

/**
 * Everything the pages say differently per service. Nothing here is keyed on
 * a client's name: the in-use copy follows the token's `inUse` flag, which
 * each service sets on the token it was itself called with.
 */
export interface ServiceWords {
  short: string
  /** Who answers for this service's tokens, in a refusal. */
  owner: string
  /** Who turns a revoked token away. */
  rejecter: string
  /** Completes "Not rotated — ", "Not changed — " and "Not revoked — ". */
  inUse: { rotate: string; expiry: string; revoke: string }
}

export const serviceWords: Record<ClientService, ServiceWords> = {
  gas: {
    short: 'GAS',
    owner: 'fg-gas-backend',
    rejecter: 'GAS',
    inUse: {
      rotate:
        'this is the token GPA is calling with. Choose Keep valid until end of tomorrow or Keep valid for 7 days, to end of day.',
      expiry: "this is the token GPA is calling with, so it can't expire now.",
      revoke:
        'Grants Platform Admin is calling GAS with this token. Rotate it instead.'
    }
  },
  cw: {
    short: 'CW',
    owner: 'CW-BE',
    rejecter: 'CW',
    inUse: {
      rotate:
        'this is the token GAS is calling CW-BE with. Choose Keep valid until end of tomorrow or Keep valid for 7 days, to end of day.',
      expiry:
        "this is the token GAS is calling CW-BE with, so it can't expire now.",
      revoke:
        'fg-gas-backend is calling CW-BE with this token. Rotate it instead.'
    }
  }
}

export const toNavActive = (service: ClientService): string =>
  `clients-${service}`

export const toClientsPath = (service: ClientService): string =>
  `/dev-ops/clients/${service}`
