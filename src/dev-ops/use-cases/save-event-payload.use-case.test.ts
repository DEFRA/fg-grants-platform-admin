import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import type { EditResult } from './edit-payload.use-case.ts'
import { editPayloadUseCase } from './edit-payload.use-case.ts'
import { saveEventPayloadUseCase } from './save-event-payload.use-case.ts'

vi.mock(import('./edit-payload.use-case.ts'))

const key: EventKey = {
  service: 'caseworking',
  box: 'inbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const edit = { payload: { data: {} }, note: 'fixed the code', revision: 3 }

const submission = {
  text: '{"data":{"a":1}}',
  revision: 3,
  from: '',
  note: 'fixed the code'
}

const asked = (redrive: boolean) => ({
  key,
  edit,
  actor: 'Ada Lovelace',
  submission,
  redrive
})

const edited = (
  outcome: EditResult['outcome'],
  overrides: Partial<EditResult> = {}
): EditResult => ({
  outcome,
  status: null,
  reason: null,
  failure: null,
  redrive: null,
  current: null,
  ...overrides
})

const current = {
  id: key.id,
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  payload: { data: {} },
  payloadRevision: 4,
  attemptHistory: [],
  lastRedrive: null
} as unknown as EventDetail

describe('saveEventPayloadUseCase', () => {
  test.each([true, false])(
    'saves the edit as the actor, asking GAS to redrive it: %s',
    async (redrive) => {
      vi.mocked(editPayloadUseCase).mockResolvedValue(edited('saved'))

      await saveEventPayloadUseCase(asked(redrive))

      expect(editPayloadUseCase).toHaveBeenCalledExactlyOnceWith(
        key,
        edit,
        'Ada Lovelace',
        redrive
      )
    }
  )

  test('a save that landed is answered, with the redrive GAS made after it', async () => {
    const saved = edited('saved', {
      redrive: { outcome: 'redriven', status: null, failure: null }
    })

    vi.mocked(editPayloadUseCase).mockResolvedValue(saved)

    await expect(saveEventPayloadUseCase(asked(true))).resolves.toEqual({
      kind: 'answered',
      edit: saved
    })
  })

  test.each<EditResult['outcome']>(['conflict', 'refused', 'not-found'])(
    'a save the service refused is answered: %s',
    async (outcome) => {
      vi.mocked(editPayloadUseCase).mockResolvedValue(edited(outcome))

      await expect(saveEventPayloadUseCase(asked(true))).resolves.toEqual({
        kind: 'answered',
        edit: edited(outcome)
      })
    }
  )

  test('a stale save is set against the event GAS answered with, as stale', async () => {
    vi.mocked(editPayloadUseCase).mockResolvedValue(
      edited('stale', { current })
    )

    await expect(saveEventPayloadUseCase(asked(true))).resolves.toEqual({
      kind: 'stale',
      review: {
        result: { outcome: 'found', event: current, failure: null },
        decision: {
          kind: 'step',
          step: expect.objectContaining({
            step: 'edit',
            revision: 4,
            problem: { kind: 'stale' }
          })
        }
      }
    })
  })

  test('a stale save GAS couldn’t read the event again for keeps the text, the event unread', async () => {
    vi.mocked(editPayloadUseCase).mockResolvedValue(edited('stale'))

    await expect(saveEventPayloadUseCase(asked(false))).resolves.toEqual({
      kind: 'stale',
      review: {
        result: {
          outcome: 'unavailable',
          event: null,
          failure: { kind: 'errored' }
        },
        decision: { kind: 'unread' }
      }
    })
  })

  test.each([
    ['timed-out' as const, { kind: 'timed-out' as const }],
    ['unavailable' as const, { kind: 'not-connected' as const }]
  ])(
    'a save that is %s is held, naming the failure, with nothing read',
    async (outcome, failure) => {
      vi.mocked(editPayloadUseCase).mockResolvedValue(
        edited(outcome, { failure })
      )

      await expect(saveEventPayloadUseCase(asked(true))).resolves.toEqual({
        kind: 'held',
        failure
      })
    }
  )
})
