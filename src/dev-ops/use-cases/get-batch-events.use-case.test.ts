import { logger } from '../../common/logger.ts'
import type { EventDetail } from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { getBatchEventsUseCase } from './get-batch-events.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key = { service: 'gas', box: 'outbox', id: '665f1c2e9a1b2c3d4e5f6a7b' }
const other = { service: 'caseworking', box: 'inbox', id: 'b'.repeat(24) }

const detail = {
  service: 'gas',
  box: 'outbox',
  id: key.id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  fullType: null,
  source: null,
  target: null,
  segregationRef: null,
  status: 'DEAD_LETTER',
  attempts: 5,
  maxAttempts: 5,
  traceId: null,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: null,
  completedAt: null,
  lastError: null,
  attemptHistory: [],
  payload: null,
  targetRaw: null,
  messageId: null,
  traceparent: null,
  publicationDate: null,
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null
} as unknown as EventDetail

describe('getBatchEventsUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvent).mockResolvedValue(detail)
  })

  test('reads every selected event, in the order it was selected', async () => {
    await getBatchEventsUseCase([key, other])

    expect(findEvent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(findEvent).mock.calls.map(([given]) => given)).toEqual([
      key,
      other
    ])
  })

  test('answers with each key beside what was read for it', async () => {
    await expect(getBatchEventsUseCase([key])).resolves.toEqual([
      { key, event: detail }
    ])
  })

  // A row silently missing from a confirmation is a row nobody notices they
  // are about to redrive, so a read that failed is drawn rather than dropped.
  test('keeps an event it could not read, as an event it could not read', async () => {
    vi.mocked(findEvent).mockRejectedValueOnce(new Error('timeout'))

    const events = await getBatchEventsUseCase([key, other])

    expect(events).toEqual([
      { key, event: null },
      { key: other, event: detail }
    ])
  })

  test('logs one line naming the event it could not read', async () => {
    vi.mocked(findEvent).mockRejectedValue(new Error('timeout'))

    await getBatchEventsUseCase([key])

    expect(logger.error).toHaveBeenCalledWith(
      `Could not read event gas/outbox/${key.id} from fg-gas-backend: Error: timeout`
    )
  })

  test('reads nothing at all when nothing was selected', async () => {
    await expect(getBatchEventsUseCase([])).resolves.toEqual([])
    expect(findEvent).not.toHaveBeenCalled()
  })
})
