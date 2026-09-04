import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  EventBreakdownPage,
  EventCountsPage,
  EventDetail,
  EventsPage
} from './events.repository.ts'
import {
  findEvent,
  findEventBreakdown,
  findEventCounts,
  findEvents,
  redriveEvent
} from './events.repository.ts'

vi.mock(import('../../common/gas.ts'))

const page: EventsPage = {
  events: [
    {
      service: 'gas',
      box: 'outbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b',
      eventId: '3f2c1a0e-1111-2222-3333-444455556666',
      type: 'case.status.updated',
      fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
      source: null,
      target: 'gas__sns__update_case_status_fifo',
      segregationRef: 'GLD-9B2-BWS-grasslands',
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      createdAt: '2026-06-16T10:00:00.000Z',
      lastFailureAt: '2026-06-16T10:16:05.000Z',
      completedAt: null,
      lastError: {
        name: 'MongoServerError',
        message: 'E11000 duplicate key error collection: gas.events',
        at: '2026-06-16T10:16:05.000Z'
      }
    }
  ],
  pagination: {
    startCursor: 'START',
    endCursor: 'END',
    hasNextPage: true,
    hasPreviousPage: false
  },
  sourceErrors: []
}

describe('findEvents', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(page)
  })

  test('reads the events page from fg-gas-backend', async () => {
    await findEvents({ cursor: 'eyJ2IjoxfQ' })

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=eyJ2IjoxfQ'
    )
  })

  test('asks for the unfiltered page when given no parameters', async () => {
    await findEvents({})

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events')
  })

  test('forwards the cursor, direction, status and service', async () => {
    await findEvents({
      cursor: 'eyJ2IjoxfQ',
      direction: 'forward',
      status: 'DEAD_LETTER',
      service: 'gas'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=eyJ2IjoxfQ&direction=forward&status=DEAD_LETTER&service=gas'
    )
  })

  test('leaves out a parameter that was not given', async () => {
    await findEvents({ cursor: undefined, status: 'FAILED' })

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events?status=FAILED')
  })

  test('forwards a status the endpoint may reject', async () => {
    await findEvents({ status: 'BOGUS' })

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events?status=BOGUS')
  })

  test('escapes a cursor containing url characters', async () => {
    await findEvents({ cursor: 'a+b/c=' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=a%2Bb%2Fc%3D'
    )
  })

  test('escapes a status containing url characters', async () => {
    await findEvents({ status: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?status=a%26b%3Dc'
    )
  })

  test('forwards both ends of the range as the endpoint takes them', async () => {
    await findEvents({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('forwards one end of the range without inventing the other', async () => {
    await findEvents({ from: '2026-06-16T09:00:00.000Z' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?from=2026-06-16T09%3A00%3A00.000Z'
    )
  })

  test('returns the page the backend answers with', async () => {
    await expect(findEvents({})).resolves.toEqual(page)
  })
})

const countsPage: EventCountsPage = {
  counts: {
    PUBLISHED: 12,
    PROCESSING: 3,
    FAILED: 1,
    RESUBMITTED: 0,
    COMPLETED: 236196,
    DEAD_LETTER: 7064
  },
  sourceErrors: []
}

describe('findEventCounts', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(countsPage)
  })

  test('reads the dataset-wide counts from fg-gas-backend', async () => {
    await findEventCounts({})

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events/counts')
  })

  test('forwards the service, search and range', async () => {
    await findEventCounts({
      service: 'gas',
      q: 'gld-9b2',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/counts?service=gas&q=gld-9b2&from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('escapes a search containing url characters', async () => {
    await findEventCounts({ q: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/counts?q=a%26b%3Dc'
    )
  })

  test('returns the counts the backend answers with', async () => {
    await expect(findEventCounts({})).resolves.toEqual(countsPage)
  })
})

const detail: EventDetail = {
  ...page.events[0],
  attemptHistory: [
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events'
    }
  ],
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2' } },
  targetRaw:
    'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo',
  messageId: 'a0e1b2c3-4444-5555-6666-777788889999',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: '2026-06-16T10:16:00.000Z',
  claimExpiresAt: '2026-06-16T10:21:00.000Z',
  lastRedrive: null
}

const key = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

describe('findEvent', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(detail)
  })

  test('reads one event from fg-gas-backend', async () => {
    await findEvent(key)

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
  })

  test('returns the detail the backend answers with', async () => {
    await expect(findEvent(key)).resolves.toEqual(detail)
  })

  // The three segments are the endpoint's key for a message, and each is
  // escaped: a value the page has never heard of is still only one segment.
  test('escapes every segment of the path', async () => {
    await findEvent({ service: 'gas/../admin', box: 'in box', id: 'a?b' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas%2F..%2Fadmin/in%20box/a%3Fb'
    )
  })
})

describe('redriveEvent', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      event: { ...page.events[0], status: 'RESUBMITTED', attempts: 0 }
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
    expect(event.attempts).toBe(0)
  })

  test('escapes every segment of the path', async () => {
    await redriveEvent({ service: 'a/b', box: 'c d', id: 'e?f' })

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
describe('findEvents with a failure filter', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(page)
  })

  test('forwards the whole error message', async () => {
    await findEvents({
      status: 'DEAD_LETTER',
      error: 'E11000 duplicate key error collection: gas.events index: id_1'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?status=DEAD_LETTER&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+id_1'
    )
  })

  test('escapes a message containing url characters', async () => {
    await findEvents({ error: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?error=a%26b%3Dc'
    )
  })
})

// The counts respect the failure filter too: a page narrowed to one failure has
// to be counted as narrowly as it is listed, or the figure the `Redrive all N
// matching` button quotes is about a wider set than the one it would act on.
describe('findEventCounts with a failure filter', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(countsPage)
  })

  test('forwards the error alongside the other filters', async () => {
    await findEventCounts({ service: 'gas', error: 'boom' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/counts?service=gas&error=boom'
    )
  })

  // One block and its errors. `total` was the seven numbers in `counts` added
  // up and sent beside them, so it could only ever agree with them or be a
  // bug; the page adds them up. The two service-shaped blocks went before it.
  test('reports the counts block alone, with nothing derived from it', async () => {
    const page = await findEventCounts({ service: 'gas' })

    expect(page).not.toHaveProperty('total')
    expect(page).not.toHaveProperty('byService')
    expect(page).not.toHaveProperty('byKind')
  })
})

const breakdown: EventBreakdownPage = {
  groups: [
    {
      error: 'E11000 duplicate key error collection: gas.events index: id_1',
      type: 'case.status.updated',
      count: 4182,
      firstAt: '2026-06-15T10:00:00.000Z',
      lastAt: '2026-06-16T10:16:05.000Z'
    },
    {
      error: null,
      type: 'case.created',
      count: 12,
      firstAt: '2026-06-16T09:00:00.000Z',
      lastAt: '2026-06-16T09:30:00.000Z'
    }
  ],
  sourceErrors: []
}

describe('findEventBreakdown', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(breakdown)
  })

  test('reads the dead-letter breakdown from fg-gas-backend', async () => {
    await findEventBreakdown({})

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events/breakdown')
  })

  test('forwards the service, search and range', async () => {
    await findEventBreakdown({
      service: 'gas',
      q: 'gld-9b2',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/breakdown?service=gas&q=gld-9b2&from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('returns the groups the backend answers with, null errors and all', async () => {
    const { groups } = await findEventBreakdown({})

    expect(groups).toHaveLength(2)
    expect(groups[0].count).toBe(4182)
    expect(groups[1].error).toBeNull()
  })
})

describe('redriveEvent naming the operator', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      event: { ...page.events[0], status: 'RESUBMITTED', attempts: 0 }
    })
  })

  test('sends the actor with the write', async () => {
    await redriveEvent(key, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      actor: 'Ada Lovelace'
    })
  })
})
