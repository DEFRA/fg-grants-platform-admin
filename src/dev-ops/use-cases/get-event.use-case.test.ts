import { logger } from '../../common/logger.ts'
import type {
  EventDetail,
  EventDetailPage,
  EventKey,
  JourneyHop
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { getEventUseCase } from './get-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

/** One hop of the journey, as the endpoint composes it. */
const hop = (overrides: Partial<JourneyHop> = {}): JourneyHop => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  hop: 'GAS Outbox',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  startedAt: '2026-06-16T10:00:01.000Z',
  took: null,
  ...overrides
})

/**
 * One outbox message in full. It carries none of the three inbox-only facts —
 * something this service published has no reference to segregate by and no
 * trace of its own — so those keys are absent rather than null.
 */
const detail: EventDetail = {
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
  attempts: '5/5',
  showAttempts: true,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { data: { caseRef: 'GLD-9B2' } },
  typeTitle: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  occurredAt: null,
  messageGroupId: 'GLD-9B2',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastRedrive: null
}

/** The detail as the endpoint composes it: the event, its hops, the services. */
const composed = (
  overrides: Partial<EventDetailPage> = {}
): EventDetailPage => ({
  ...detail,
  journey: [hop()],
  sectionErrors: [],
  ...overrides
})

/**
 * A failure as `@hapi/wreck` raises one: a Boom carrying the upstream status
 * and, where the endpoint sent one, its response body.
 */
const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('getEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvent).mockResolvedValue(composed())
  })

  test('reads the event the caller asked for', async () => {
    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
    expect(findEvent).toHaveBeenCalledWith(key)
  })

  test('returns the event it read', async () => {
    const { outcome, event } = await getEventUseCase(key)

    expect(outcome).toBe('found')
    expect(event).toEqual(detail)
  })

  // One call, not two: the endpoint composes the page.
  test('reads the event and its journey in a single call', async () => {
    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test('returns every hop the endpoint composed', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      composed({
        journey: [hop(), hop({ id: 'other', box: 'inbox', hop: 'GAS Inbox' })]
      })
    )

    const { journey } = await getEventUseCase(key)

    expect(journey).toHaveLength(2)
  })

  // The event is not part of the journey section: an event whose hops the
  // endpoint could not read is still an event on a page.
  test('keeps the journey off the event it hands back', async () => {
    const { event } = await getEventUseCase(key)

    expect(event).toEqual(detail)
    expect(event).not.toHaveProperty('journey')
    expect(event).not.toHaveProperty('services')
    expect(event).not.toHaveProperty('sectionErrors')
  })

  // One section the page cannot draw is not worth losing the event over, and
  // a null journey is drawn as the empty table it has always been drawn as.
  test('keeps the event when only the journey could not be read', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      composed({
        journey: null,
        sectionErrors: [{ section: 'journey', message: 'Bad Gateway' }]
      })
    )

    const { outcome, event, journey } = await getEventUseCase(key)

    expect(outcome).toBe('found')
    expect(event).toEqual(detail)
    expect(journey).toEqual([])
  })

  // A null section is never silent: the endpoint names it and says why.
  test('logs one line naming the section that could not be read', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      composed({
        journey: null,
        sectionErrors: [{ section: 'journey', message: 'Bad Gateway' }]
      })
    )

    await getEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      'fg-gas-backend could not read the journey for event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b: Bad Gateway'
    )
  })

  // A 404 is a page of its own: the link was stale, and that is not an error.
  test('reports an event the endpoint does not have as not found', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'not-found',
      event: null,
      journey: []
    })
  })

  test('makes no second call for an event that does not exist', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test('reports a backend that could not be reached as unavailable', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(502))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'unavailable',
      event: null,
      journey: []
    })
  })

  test('reports a rejected address as unavailable rather than missing', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(400))

    const { outcome } = await getEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

  // A timeout carries no status at all, and is still not a 404.
  test('reports a failure with no status as unavailable', async () => {
    vi.mocked(findEvent).mockRejectedValue(new Error('socket hang up'))

    const { outcome } = await getEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(502))

    await getEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b from fg-gas-backend: Error: Response Error: 502'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(findEvent).mockRejectedValue(
      responseError(500, { message: 'mongo connection string' })
    )

    await getEventUseCase(key)

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(String(line)).not.toContain('mongo')
  })
})
