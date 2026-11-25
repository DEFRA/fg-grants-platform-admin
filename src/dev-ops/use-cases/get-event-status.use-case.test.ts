import { logger } from '../../common/logger.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { findEventStatus } from '../repositories/events.repository.ts'
import { getEventStatusUseCase } from './get-event-status.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key: EventKey = {
  service: 'caseworking',
  box: 'inbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const status = (value: string, attemptsSinceRedrive = 0) =>
  vi.mocked(findEventStatus).mockResolvedValue({
    status: value,
    statusLabel: value,
    attemptsSinceRedrive,
    maxAttempts: 5
  })

describe('getEventStatusUseCase', () => {
  test('a delivered event has settled', async () => {
    status('COMPLETED', 1)

    await expect(getEventStatusUseCase(key)).resolves.toStrictEqual({
      settled: true,
      failed: 1,
      allowed: 5
    })
    expect(findEventStatus).toHaveBeenCalledExactlyOnceWith(key)
  })

  test('a dead letter again has settled', async () => {
    status('DEAD_LETTER', 5)

    await expect(getEventStatusUseCase(key)).resolves.toStrictEqual({
      settled: true,
      failed: 5,
      allowed: 5
    })
  })

  test('mid-retry has not, and says how many attempts have failed', async () => {
    status('FAILED', 2)

    await expect(getEventStatusUseCase(key)).resolves.toStrictEqual({
      settled: false,
      failed: 2,
      allowed: 5
    })
  })

  test('a read that fails is no answer, and is logged', async () => {
    vi.mocked(findEventStatus).mockRejectedValue(
      new Error('connect ECONNREFUSED')
    )

    await expect(getEventStatusUseCase(key)).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Could not read the status of event caseworking/inbox/665f1c2e9a1b2c3d4e5f6a7b from fg-gas-backend: Error: connect ECONNREFUSED'
    )
  })
})
