import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import type { EventResult } from './get-event.use-case.ts'
import { getEventUseCase } from './get-event.use-case.ts'
import { reviewPayloadUseCase } from './review-payload.use-case.ts'

vi.mock(import('./get-event.use-case.ts'))

const key: EventKey = {
  service: 'caseworking',
  box: 'inbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const event = (overrides: Partial<EventDetail> = {}): EventDetail =>
  ({
    status: 'DEAD_LETTER',
    statusLabel: 'Dead letter',
    payloadRevision: 3,
    payload: { data: { sbi: '1' } },
    attemptHistory: [],
    lastRedrive: null,
    ...overrides
  }) as EventDetail

const found = (detail: EventDetail): EventResult => ({
  outcome: 'found',
  event: detail,
  failure: null
})

const submission = (text: string, revision = 3) => ({
  text,
  revision,
  from: ''
})

describe('reviewPayloadUseCase', () => {
  test('reads the event the caller named, and gives the read back as it came', async () => {
    const read = found(event())

    vi.mocked(getEventUseCase).mockResolvedValue(read)

    const { result } = await reviewPayloadUseCase(key, submission('{}'))

    expect(getEventUseCase).toHaveBeenCalledWith(key)
    expect(result).toBe(read)
  })

  test('a changed payload goes on to the review', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue(found(event()))

    const { decision } = await reviewPayloadUseCase(
      key,
      submission('{"data":{"sbi":"2"}}')
    )

    expect(decision).toMatchObject({
      kind: 'step',
      step: { step: 'review', revision: 3 }
    })
  })

  test('an unchanged one goes back into the editor, saying so', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue(found(event()))

    const { decision } = await reviewPayloadUseCase(
      key,
      submission('{"data":{"sbi":"1"}}')
    )

    expect(decision).toMatchObject({
      kind: 'step',
      step: { step: 'edit', problem: { kind: 'unchanged' } }
    })
  })

  test('one made against a revision since replaced is the editor under the current one', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue(
      found(event({ payloadRevision: 4 }))
    )

    const { decision } = await reviewPayloadUseCase(
      key,
      submission('{"data":{"sbi":"2"}}')
    )

    expect(decision).toMatchObject({
      kind: 'step',
      step: { step: 'edit', revision: 4, problem: { kind: 'stale' } }
    })
  })

  test('an event that can no longer be edited is a conflict, in the service’s word for its state', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue(
      found(event({ status: 'COMPLETED', statusLabel: 'Completed' }))
    )

    const { decision } = await reviewPayloadUseCase(key, submission('{}'))

    expect(decision).toEqual({ kind: 'conflict', status: 'Completed' })
  })

  test('an event that couldn’t be read leaves the text unchecked', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue({
      outcome: 'unavailable',
      event: null,
      failure: { kind: 'not-connected' }
    })

    const { decision } = await reviewPayloadUseCase(key, submission('{}'))

    expect(decision).toEqual({ kind: 'unread' })
  })
})
