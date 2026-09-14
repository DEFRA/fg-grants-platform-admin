import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { toEventState } from './event-state.ts'

const failure = {
  at: '2026-06-16T10:08:00.000Z',
  name: 'E',
  message: 'boom',
  stack: null
}

const redrive = { at: '2026-06-16T11:00:00.000Z', by: 'Ada' }

const event = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  status: 'FAILED',
  statusLabel: 'Failed',
  statusRole: 'warning',
  statusRetrying: true,
  createdAt: '2026-06-16T10:00:00.000Z',
  attempts: '1/5',
  targetTopic: null,
  lastError: null,
  attemptHistory: [failure],
  payload: null,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  ...overrides
})

describe('toEventState', () => {
  test.each([
    [
      'a completed event',
      event({ status: 'COMPLETED', lastRedrive: redrive, attemptHistory: [] }),
      {
        completed: true,
        deadLetter: false,
        redrivenSinceAttempts: false,
        waiting: false
      }
    ],
    [
      'a dead letter',
      event({ status: 'DEAD_LETTER' }),
      {
        completed: false,
        deadLetter: true,
        redrivenSinceAttempts: false,
        waiting: true
      }
    ],
    [
      'an event still being retried',
      event(),
      {
        completed: false,
        deadLetter: false,
        redrivenSinceAttempts: false,
        waiting: true
      }
    ],
    [
      'a redriven event with no attempts since',
      event({
        status: 'RESUBMITTED',
        lastRedrive: redrive,
        attemptHistory: []
      }),
      {
        completed: false,
        deadLetter: false,
        redrivenSinceAttempts: true,
        waiting: false
      }
    ],
    [
      'a redriven event that has been attempted since',
      event({ lastRedrive: redrive }),
      {
        completed: false,
        deadLetter: false,
        redrivenSinceAttempts: false,
        waiting: true
      }
    ],
    [
      'an event with no history that was never redriven',
      event({ attemptHistory: [] }),
      {
        completed: false,
        deadLetter: false,
        redrivenSinceAttempts: false,
        waiting: true
      }
    ]
  ])('reads %s', (_name, detail, state) => {
    expect(toEventState(detail)).toEqual(state)
  })
})
