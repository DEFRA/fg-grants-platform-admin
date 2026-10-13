import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  Event,
  EventWithAttempts,
  EventDetail,
  EventKey
} from './events.repository.ts'
import {
  editPayload,
  findEvent,
  purgeEvent,
  redriveEvent,
  toEventKeyPath
} from './events.repository.ts'

vi.mock(import('../../common/gas.ts'))

const base: Event = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z'
}

const withAttempts: EventWithAttempts = {
  ...base,
  attempts: '5/5',
  targetTopic: 'gas__sns__update_case_status_fifo',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    at: '2026-06-16T10:16:05.000Z'
  }
}

const detail: EventDetail = {
  ...withAttempts,
  eventType: 'CaseStatusUpdated',
  attemptHistory: [
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events',
      stack: null
    }
  ],
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2' } },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null
}

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

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
    vi.mocked(getFromGas).mockResolvedValue(detail)
  })

  test('reads one event from fg-gas-backend', async () => {
    await findEvent(key)

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
  })

  test('returns every section the backend composed', async () => {
    await expect(findEvent(key)).resolves.toEqual(detail)
  })

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
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('posts the redrive to fg-gas-backend', async () => {
    await redriveEvent(key)

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/redrive',
      { actor: undefined }
    )
  })

  test('resolves with nothing on the empty 204 the backend answers with', async () => {
    await expect(redriveEvent(key)).resolves.toBeUndefined()
  })

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

describe('purgeEvent', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('posts the reason and the note to fg-gas-backend, naming the operator', async () => {
    await purgeEvent(
      key,
      { reasonCode: 'BROKEN_PAYLOAD', note: 'sheetId is a number' },
      'Ada Lovelace'
    )

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/purge',
      {
        payload: {
          reasonCode: 'BROKEN_PAYLOAD',
          note: 'sheetId is a number'
        },
        actor: 'Ada Lovelace'
      }
    )
  })

  test('leaves an empty note out of the body altogether', async () => {
    await purgeEvent(key, { reasonCode: 'SENT_IN_ERROR', note: '' })

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      payload: { reasonCode: 'SENT_IN_ERROR' },
      actor: undefined
    })
  })

  test('resolves with nothing, reading nothing out of the answer', async () => {
    await expect(
      purgeEvent(key, { reasonCode: 'OTHER', note: 'why' })
    ).resolves.toBeUndefined()
  })

  test('escapes every segment of the path', async () => {
    await purgeEvent(
      { service: 'a/b', box: 'c d', id: 'e?f' } as unknown as EventKey,
      { reasonCode: 'OTHER', note: 'why' }
    )

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/purge',
      expect.any(Object)
    )
  })
})

describe('editPayload', () => {
  const edit = {
    payload: { sheetId: '12345' },
    note: 'sheetId arrives as a number',
    revision: 2
  }

  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue({
      payloadRevision: 3,
      changedPaths: ['/sheetId'],
      changedPathsTruncated: false
    })
  })

  test('posts the payload, the note and the revision it was made against, naming the operator', async () => {
    await editPayload(key, edit, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledTimes(1)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b/payload',
      {
        payload: {
          payload: { sheetId: '12345' },
          note: 'sheetId arrives as a number',
          revision: 2
        },
        actor: 'Ada Lovelace'
      }
    )
  })

  test('resolves with nothing, reading nothing out of the answer', async () => {
    await expect(
      editPayload(key, edit, 'Ada Lovelace')
    ).resolves.toBeUndefined()
  })

  test('escapes every segment of the path', async () => {
    await editPayload(
      { service: 'a/b', box: 'c d', id: 'e?f' } as unknown as EventKey,
      edit,
      'Ada Lovelace'
    )

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/events/a%2Fb/c%20d/e%3Ff/payload',
      expect.any(Object)
    )
  })
})

describe('redriveEvent naming the operator', () => {
  beforeEach(() => {
    vi.mocked(postToGas).mockResolvedValue(Buffer.alloc(0))
  })

  test('sends the actor with the write', async () => {
    await redriveEvent(key, 'Ada Lovelace')

    expect(postToGas).toHaveBeenCalledWith(expect.any(String), {
      actor: 'Ada Lovelace'
    })
  })
})
