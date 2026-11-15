import type {
  ConfigFailed,
  DeadLetters,
  Overview,
  OverviewPart,
  OverviewSourceError,
  TokensExpiring,
  TopError,
  TopErrors
} from './get-overview.use-case.ts'
import overviewCounts from './overview-counts.json' with { type: 'json' }

const overviewAt = '2026-10-13T15:00:00.000Z'

const windowFrom = '2026-10-12T15:00:00.000Z'

const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0)

const half = (counts: number[]) => counts.length / 2

export const toDeadLetters = (
  service: 'gas' | 'cw',
  counts: number[]
): DeadLetters => ({
  count: sum(counts),
  capped: false,
  bars: counts.map((count) => ({ count })),
  lists: (['outbox', 'inbox'] as const).map((box, i) => ({
    box,
    count: sum(
      i === 0 ? counts.slice(0, half(counts)) : counts.slice(half(counts))
    ),
    capped: false,
    list: {
      path: `events/${service}/${box}`,
      query: { status: 'DEAD_LETTER', from: windowFrom, to: overviewAt }
    }
  }))
})

export const read = <T>(data: T): OverviewPart<T> => ({
  data,
  sourceError: null
})

export const failed = <T>(
  sourceError: OverviewSourceError
): OverviewPart<T> => ({ data: null, sourceError })

const topError = ({
  service,
  box,
  errorKey,
  event,
  count,
  lastAt
}: {
  service: 'gas' | 'cw'
  box: 'outbox' | 'inbox'
  errorKey: string | null
  event: string
  count: number
  lastAt: string
}): TopError => ({
  errorKey,
  event: { value: event, label: event },
  count,
  capped: false,
  lastAt,
  list: {
    path: `events/${service}/${box}`,
    query: {
      status: 'DEAD_LETTER',
      ...(errorKey === null ? {} : { error: errorKey }),
      event
    }
  }
})

export const gasTopErrors: TopErrors = {
  entries: [
    topError({
      service: 'gas',
      box: 'inbox',
      errorKey: 'Error: Application with clientRef <v> not found',
      event: 'AgreementStatusUpdated',
      count: 214,
      lastAt: '2026-10-13T14:53:00.000Z'
    }),
    topError({
      service: 'gas',
      box: 'outbox',
      errorKey: 'Grant <v> version <v> not found',
      event: 'CreateCase',
      count: 96,
      lastAt: '2026-10-13T14:41:00.000Z'
    }),
    topError({
      service: 'gas',
      box: 'outbox',
      errorKey: 'Request failed with status code <v>',
      event: 'CreateCase',
      count: 41,
      lastAt: '2026-10-12T16:02:00.000Z'
    }),
    topError({
      service: 'gas',
      box: 'outbox',
      errorKey: 'No error recorded',
      event: 'CreateCase',
      count: 23,
      lastAt: '2026-10-12T11:17:00.000Z'
    }),
    topError({
      service: 'gas',
      box: 'inbox',
      errorKey: 'data.status must be equal to one of the allowed values',
      event: 'CaseStatusUpdated',
      count: 14,
      lastAt: '2026-10-13T09:40:00.000Z'
    })
  ],
  more: true,
  complete: true
}

export const cwTopErrors: TopErrors = {
  entries: [
    topError({
      service: 'cw',
      box: 'inbox',
      errorKey: 'Status <v> is not a status of workflow <v>',
      event: 'UpdateCaseStatus',
      count: 18,
      lastAt: '2026-10-13T15:04:00.000Z'
    }),
    topError({
      service: 'cw',
      box: 'outbox',
      errorKey: 'Topic <v> not found',
      event: 'CaseStatusUpdated',
      count: 6,
      lastAt: '2026-10-12T16:10:00.000Z'
    })
  ],
  more: false,
  complete: true
}

export const gasConfigFailed: ConfigFailed = {
  versions: [
    {
      code: 'frps-private-beta',
      version: '1.11.0',
      definition: 'permanent_error',
      receivedAt: '2026-10-13T09:12:00.000Z'
    }
  ],
  more: false
}

export const cwConfigFailed: ConfigFailed = {
  versions: [
    {
      code: 'woodland',
      version: '2.1.0',
      definition: 'transient_error',
      receivedAt: null
    }
  ],
  more: false
}

const token = (
  clientId: string,
  status: 'ACTIVE' | 'EXPIRED',
  expiresAt: string
) => ({
  tokenId: `${clientId}-token`,
  clientId,
  tokenHint: 'ab12',
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'Ada Lovelace',
  expiresAt,
  revokedAt: null,
  revokedBy: null,
  inUse: false
})

export const gasTokensExpiring: TokensExpiring = {
  withinDays: 30,
  tokens: [token('grants-ui', 'ACTIVE', '2026-10-20T22:59:59.000Z')]
}

export const cwTokensExpiring: TokensExpiring = {
  withinDays: 30,
  tokens: [token('fg-gas-backend', 'EXPIRED', '2026-10-01T22:59:59.000Z')]
}

export const gasCounts = overviewCounts.gas

export const cwCounts = overviewCounts.cw

/** Something to look at in every part. */
export const needsAttention: Overview = {
  deadLetters: {
    gas: read(toDeadLetters('gas', gasCounts)),
    cw: read(toDeadLetters('cw', cwCounts))
  },
  topErrors: { gas: read(gasTopErrors), cw: read(cwTopErrors) },
  configFailed: { gas: read(gasConfigFailed), cw: read(cwConfigFailed) },
  tokensExpiring: { gas: read(gasTokensExpiring), cw: read(cwTokensExpiring) }
}

const zeros = Array.from({ length: 12 }, () => 0)

const noErrors: TopErrors = { entries: [], more: false, complete: true }

/** Every part read, and nothing to look at. */
export const allClear: Overview = {
  ...needsAttention,
  deadLetters: {
    gas: read(toDeadLetters('gas', zeros)),
    cw: read(toDeadLetters('cw', zeros))
  },
  topErrors: { gas: read(noErrors), cw: read(noErrors) },
  configFailed: {
    gas: read({ versions: [], more: false }),
    cw: read({ versions: [], more: false })
  },
  tokensExpiring: {
    gas: read({ withinDays: 30, tokens: [] }),
    cw: read({ withinDays: 30, tokens: [] })
  }
}
