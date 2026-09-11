import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  Event,
  EventWithAttempts,
  EventDetail,
  EventDetailPage,
  EventKey,
  EventRow,
  EventsPage,
  EventsPageResponse,
  ServiceFilter,
  StatusFilter
} from './events.repository.ts'
import {
  findEvent,
  findEventsPage,
  redriveEvent,
  toEventKeyPath
} from './events.repository.ts'

vi.mock(import('../../common/gas.ts'))

/**
 * One message exactly as the endpoint sends it: every label already spelled,
 * and only the instants and the key left for the page to do anything with.
 * The list and the detail both build on this — the list adding `latency`, the
 * detail the attempt facts it is the only surface to draw.
 */
const base: Event = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  hop: 'GAS Outbox',
  queue: 'to Caseworking',
  queueValue: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    at: '2026-06-16T10:16:05.000Z'
  }
}

/** The single-row shape: what the detail and a redrive answer with. */
const withAttempts: EventWithAttempts = {
  ...base,
  attempts: '5/5',
  showAttempts: true,
  lastFailureAt: '2026-06-16T10:16:05.000Z'
}

const row: EventRow = {
  ...base,
  latency: null,
  latencyTitle: 'Queued to delivered to SNS'
}

const page: EventsPage = {
  events: [row],
  pagination: {
    startCursor: 'START',
    endCursor: 'END',
    hasNextPage: true,
    hasPreviousPage: false
  },
  sourceErrors: []
}

/** The words the toolbar's chips are drawn in, as the endpoint states them. */
const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Published',
    explainer: 'Queued, not yet claimed'
  },
  { value: 'PROCESSING', label: 'Processing', explainer: 'Claimed, in flight' },
  { value: 'FAILED', label: 'Failed', explainer: 'Awaiting automatic retry' },
  {
    value: 'RESUBMITTED',
    label: 'Resubmitted',
    explainer: 'Queued for another retry cycle'
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    explainer: 'Processed successfully'
  },
  {
    value: 'DEAD_LETTER',
    label: 'Dead letter',
    explainer: 'Failed all retry attempts; needs a redrive'
  }
]

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/** The whole page in one answer, as the composed endpoint sends it. */
const composed: EventsPageResponse = {
  ...page,
  statuses,
  services,
  counts: {
    PUBLISHED: 12,
    PROCESSING: 3,
    FAILED: 1,
    RESUBMITTED: 0,
    COMPLETED: 236196,
    DEAD_LETTER: 7064
  },
  breakdown: { groups: [], sourceErrors: [] },
  sectionErrors: []
}

describe('findEventsPage query building', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  test('reads the composed page from fg-gas-backend', async () => {
    await findEventsPage({ cursor: 'eyJ2IjoxfQ' })

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=eyJ2IjoxfQ'
    )
  })

  test('asks for the unfiltered page when given no parameters', async () => {
    await findEventsPage({})

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events/page')
  })

  // No direction: the list only pages forward, fg-gas-backend's default.
  test('forwards the cursor, status and service', async () => {
    await findEventsPage({
      cursor: 'eyJ2IjoxfQ',
      status: 'DEAD_LETTER',
      service: 'gas'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=eyJ2IjoxfQ&status=DEAD_LETTER&service=gas'
    )
  })

  test('leaves out a parameter that was not given', async () => {
    await findEventsPage({ cursor: undefined, status: 'FAILED' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=FAILED'
    )
  })

  test('forwards a status the endpoint may reject', async () => {
    await findEventsPage({ status: 'BOGUS' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=BOGUS'
    )
  })

  test('escapes a cursor containing url characters', async () => {
    await findEventsPage({ cursor: 'a+b/c=' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?cursor=a%2Bb%2Fc%3D'
    )
  })

  test('escapes a status containing url characters', async () => {
    await findEventsPage({ status: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=a%26b%3Dc'
    )
  })

  test('forwards both ends of the range as the endpoint takes them', async () => {
    await findEventsPage({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('forwards one end of the range without inventing the other', async () => {
    await findEventsPage({ from: '2026-06-16T09:00:00.000Z' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?from=2026-06-16T09%3A00%3A00.000Z'
    )
  })

  test('returns the rows the backend answers with', async () => {
    const { events, pagination } = await findEventsPage({})

    expect({ events, pagination }).toEqual({
      events: page.events,
      pagination: page.pagination
    })
  })
})

describe('findEventsPage', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  // Every filter the page holds travels on one query string, unsplit: which
  // of them each section respects is the endpoint's business now.
  test('forwards every filter the page is holding', async () => {
    await findEventsPage({
      cursor: 'eyJ2IjoxfQ',
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      error: 'boom',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    const [url] = vi.mocked(getFromGas).mock.calls[0]

    expect(url).toContain('/grant-admin/events/page?')
    for (const part of [
      'cursor=eyJ2IjoxfQ',
      'status=DEAD_LETTER',
      'service=gas',
      'q=gld-9b2',
      'error=boom',
      'from=2026-06-16T09%3A00%3A00.000Z',
      'to=2026-06-16T10%3A00%3A00.000Z'
    ]) {
      expect(url).toContain(part)
    }
  })

  test('returns every section the backend composed', async () => {
    await expect(findEventsPage({})).resolves.toEqual(composed)
  })

  // The two aggregations are nullable and the rows are not: the degradation
  // contract, as the wire states it.
  test('carries a null section and the reason it is null', async () => {
    vi.mocked(getFromGas).mockResolvedValue({
      ...composed,
      counts: null,
      sectionErrors: [{ section: 'counts', message: 'Bad Gateway' }]
    })

    const { counts, sectionErrors } = await findEventsPage({})

    expect(counts).toBeNull()
    expect(sectionErrors).toEqual([
      { section: 'counts', message: 'Bad Gateway' }
    ])
  })
})

/**
 * The same row in full. An outbox message carries none of the three inbox-only
 * facts, so the keys are absent rather than null: nothing this service
 * published has a reference to segregate by or a trace of its own.
 */
const detail: EventDetail = {
  ...withAttempts,
  attemptHistory: [
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events',
      stack: null
    }
  ],
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2' } },
  typeTitle: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  occurredAt: null,
  messageGroupId: 'GLD-9B2',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: '2026-06-16T10:16:00.000Z',
  claimExpiresAt: '2026-06-16T10:21:00.000Z',
  lastRedrive: null
}

/** The detail page in one answer: the event, its hops, and the vocabulary. */
const detailPage: EventDetailPage = {
  ...detail,
  journey: [
    {
      service: 'gas',
      box: 'outbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b',
      hop: 'GAS Outbox',
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter',
      statusRole: 'error',
      statusRetrying: false,
      startedAt: '2026-06-16T10:00:01.000Z',
      took: null
    }
  ],
  sectionErrors: []
}

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

// Both spellings of an event's address are built from this, so it is pinned
// here rather than only through the two callers: the escaping is the whole
// point of it.
describe('toEventKeyPath', () => {
  test('joins the three segments, escaping each one', () => {
    expect(toEventKeyPath(key)).toBe('gas/outbox/665f1c2e9a1b2c3d4e5f6a7b')
  })

  test('leaves a hostile value as a single segment', () => {
    expect(
      toEventKeyPath({
        service: 'gas/../admin',
        box: 'in box',
        id: 'a?b'
      } as unknown as EventKey)
    ).toBe('gas%2F..%2Fadmin/in%20box/a%3Fb')
  })
})

describe('findEvent', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(detailPage)
  })

  test('reads one event from fg-gas-backend', async () => {
    await findEvent(key)

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
  })

  test('returns every section the backend composed', async () => {
    await expect(findEvent(key)).resolves.toEqual(detailPage)
  })

  // The three segments are the endpoint's key for a message, and each is
  // escaped: a value the page has never heard of is still only one segment.
  //
  // `EventKey` now narrows service and box to the two values each admits, so
  // these are cast past it deliberately: the escaping is defence in depth for
  // a value that reached here from outside the type system, and the guard is
  // worth keeping whether or not the compiler can still reach it.
  test('escapes every segment of the path', async () => {
    await findEvent({
      service: 'gas/../admin',
      box: 'in box',
      id: 'a?b'
    } as unknown as EventKey)

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas%2F..%2Fadmin/in%20box/a%3Fb'
    )
  })
})

describe('redriveEvent', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      event: {
        ...base,
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        statusRole: 'warning',
        statusRetrying: true,
        attempts: '0/5',
        showAttempts: false
      }
    })
  })

  test('posts the redrive to fg-gas-backend', async () => {
    await redriveEvent(key)

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/redrive',
      { actor: undefined }
    )
  })

  test('returns the row the backend answers with', async () => {
    const { event } = await redriveEvent(key)

    expect(event.status).toBe('RESUBMITTED')
    expect(event.statusLabel).toBe('Resubmitted')
    expect(event.attempts).toBe('0/5')
  })

  // Cast past `EventKey` for the same reason as the read above: the escaping
  // is defence in depth for a value that arrived from outside the types.
  test('escapes every segment of the path', async () => {
    await redriveEvent({
      service: 'a/b',
      box: 'c d',
      id: 'e?f'
    } as unknown as EventKey)

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/redrive',
      { actor: undefined }
    )
  })
})

// The narrowest filter the list has: the whole of a stored failure message,
// matched exactly. It travels like any other parameter, and is escaped like
// any other parameter — a message is arbitrary text and routinely contains the
// characters a query string is made of.
describe('findEventsPage with a failure filter', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(composed)
  })

  test('forwards the whole error message', async () => {
    await findEventsPage({
      status: 'DEAD_LETTER',
      error: 'E11000 duplicate key error collection: gas.events index: id_1'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?status=DEAD_LETTER&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+id_1'
    )
  })

  test('escapes a message containing url characters', async () => {
    await findEventsPage({ error: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/page?error=a%26b%3Dc'
    )
  })
})

// The counts respect the failure filter too: a page narrowed to one failure
// has to be counted as narrowly as it is listed.
describe('redriveEvent naming the operator', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      event: {
        ...base,
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        statusRole: 'warning',
        statusRetrying: true,
        attempts: '0/5',
        showAttempts: false
      }
    })
  })

  test('sends the actor with the write', async () => {
    await redriveEvent(key, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      actor: 'Ada Lovelace'
    })
  })
})
