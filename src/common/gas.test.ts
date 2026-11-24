import { config } from './config.ts'
import { asGasActor } from './gas-actor.ts'
import { Readable } from 'node:stream'

import {
  deleteFromGas,
  getFromGas,
  postToGas,
  putToGas,
  streamFromGas,
  toHeaderActor
} from './gas.ts'
import { wreck } from './wreck.ts'
import type { Upstream } from '../dev-ops/upstream.ts'
import { withUpstream } from '../dev-ops/upstream.ts'

vi.mock(import('./wreck.ts'), () => ({
  wreck: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    request: vi.fn()
  } as never
}))

describe('getFromGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.get).mockResolvedValue({ payload: { ok: true } } as never)
  })

  test('returns the payload', async () => {
    await expect(getFromGas('/grants/woodland')).resolves.toEqual({ ok: true })
  })

  test('asks fg-gas-backend for the given path', async () => {
    await getFromGas('/grants/woodland')

    expect(wreck.get).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grants/woodland`,
      expect.objectContaining({ json: true })
    )
  })

  test('gives up after the configured timeout', async () => {
    const configured = config.get('gas.timeoutMs')

    config.set('gas.timeoutMs', 1234)
    await getFromGas('/grants/woodland')
    config.set('gas.timeoutMs', configured)

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 1234 })
    )
  })

  test('presents the service token', async () => {
    await getFromGas('/grants/woodland')

    expect(wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })
})

describe('postToGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.post).mockResolvedValue({
      payload: { event: { status: 'RESUBMITTED' } }
    } as never)
  })

  test('returns the payload the backend answered with', async () => {
    await expect(
      postToGas('/grant-admin/events/gas/outbox/1/redrive')
    ).resolves.toEqual({ event: { status: 'RESUBMITTED' } })
  })

  test('gives up on a write after the configured timeout', async () => {
    const configured = config.get('gas.timeoutMs')

    config.set('gas.timeoutMs', 1234)
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')
    config.set('gas.timeoutMs', configured)

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 1234 })
    )
  })

  test('gives up after the timeout the call asks for', async () => {
    await postToGas('/grant-admin/explore/query', { timeoutMs: 12000 })

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 12000 })
    )
  })

  test('posts to the given path', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grant-admin/events/gas/outbox/1/redrive`,
      expect.objectContaining({ json: true })
    )
  })

  test('presents the service token', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })

  test('sends the json body it was given', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/park', {
      payload: { reason: 'duplicate key on a case that no longer exists' }
    })

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        payload: { reason: 'duplicate key on a case that no longer exists' }
      })
    )
  })

  // Every write is somebody's decision, and the token this app presents names
  // the app. `x-actor` is what puts a person in the backend's audit record.
  test('names the person who asked', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive', {
      actor: 'Ada Lovelace'
    })

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`,
          'x-actor': 'Ada Lovelace'
        }
      })
    )
  })

  // Node throws `ERR_INVALID_CHAR` on a header value carrying anything above
  // U+00FF, so an operator whose directory name is not Latin-1 could not
  // redrive at all: the throw never left this process and the page reported
  // it as "fg-gas-backend could not be reached".
  test.each([
    ['Łukasz', "UTF-8''%C5%81ukasz"],
    ['Ŵyn', "UTF-8''%C5%B4yn"],
    ['Ada Lovelace', 'Ada Lovelace'],
    // Latin-1 and below travels as itself: a header can hold it, and encoding
    // it would change what an already-deployed backend records.
    ['Ada Løvelace', 'Ada Løvelace']
  ])('sends %s as a header value a header can hold', async (actor, sent) => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive', { actor })

    expect(vi.mocked(wreck.post).mock.calls.at(-1)?.[1]?.headers).toMatchObject(
      { 'x-actor': sent }
    )
  })

  // Round-trips: what fg-gas-backend decodes is the name that was typed. The
  // two services can deploy in either order, because a name that needed no
  // encoding is sent exactly as it always was.
  test.each(['Łukasz', 'Ŵyn', 'Ada Lovelace', "O'Neill", 'Ada Løvelace'])(
    'round-trips %s through the header encoding',
    (actor) => {
      const sent = toHeaderActor(actor)
      const decoded = sent.startsWith("UTF-8''")
        ? decodeURIComponent(sent.slice("UTF-8''".length))
        : sent

      expect(decoded).toBe(actor)
      expect(sent).toMatch(/^[\u0020-\u00ff]*$/)
    }
  )

  // An absent actor sends no header at all: a blank `x-actor` would be a claim
  // that nobody asked, which is a different thing from not saying who did.
  test.each([
    ['no options at all', undefined],
    ['an actor nobody could be identified as', { actor: undefined }]
  ])('sends no actor header given %s', async (_name, options) => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive', options)

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { authorization: `Bearer ${config.get('gas.serviceToken')}` }
      })
    )
  })

  test('sends no body when the write has none', async () => {
    await postToGas('/grant-admin/events/gas/outbox/1/redrive')

    expect(wreck.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ payload: expect.anything() })
    )
  })

  // The status and the body both matter to the caller — a 409 names the status
  // that refused the write — so the Boom wreck throws is left exactly as it is.
  test('lets the backend failure through untouched', async () => {
    const failure = Object.assign(new Error('Response Error: 409 Conflict'), {
      output: { statusCode: 409 },
      data: { payload: { status: 'RESUBMITTED' } }
    })

    vi.mocked(wreck.post).mockRejectedValue(failure)

    await expect(
      postToGas('/grant-admin/events/gas/outbox/1/redrive')
    ).rejects.toBe(failure)
  })
})

describe('the operator on every call', () => {
  const operator = {
    name: 'Ada Lovelace',
    id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
  }

  const headersOf = (mock: ReturnType<typeof vi.fn>) =>
    (mock.mock.lastCall?.[1] as { headers: Record<string, string> }).headers

  beforeEach(() => {
    vi.mocked(wreck.get).mockResolvedValue({ payload: {} } as never)
    vi.mocked(wreck.post).mockResolvedValue({ payload: {} } as never)
  })

  test('names the operator on a read', async () => {
    await asGasActor(operator, () => getFromGas('/grant-admin/events/page'))

    expect(headersOf(vi.mocked(wreck.get))).toEqual({
      authorization: `Bearer ${config.get('gas.serviceToken')}`,
      'x-actor': 'Ada Lovelace',
      'x-actor-id': operator.id
    })
  })

  test('names the operator on a write, by id too', async () => {
    await asGasActor(operator, () =>
      postToGas('/grant-admin/events/gas/outbox/1/redrive')
    )

    expect(headersOf(vi.mocked(wreck.post))).toMatchObject({
      'x-actor': 'Ada Lovelace',
      'x-actor-id': operator.id
    })
  })

  test('encodes a name a header cannot carry', async () => {
    await asGasActor({ name: 'Łukasz', id: operator.id }, () =>
      getFromGas('/x')
    )

    expect(headersOf(vi.mocked(wreck.get))['x-actor']).toBe(
      "UTF-8''%C5%81ukasz"
    )
  })

  test('sends extra headers a call asks for', async () => {
    await asGasActor(operator, () =>
      postToGas('/grant-admin/applications/search', {
        headers: { 'x-search-repeat': '1' }
      })
    )

    expect(headersOf(vi.mocked(wreck.post))['x-search-repeat']).toBe('1')
  })

  test('names nobody outside a request', async () => {
    await getFromGas('/x')

    expect(headersOf(vi.mocked(wreck.get))).toEqual({
      authorization: `Bearer ${config.get('gas.serviceToken')}`
    })
  })
})

describe('putToGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.put).mockResolvedValue({
      payload: { id: 'entitlement-1' }
    } as never)
  })

  test('puts the json body to the given path with the service token', async () => {
    await expect(
      putToGas('/grant-admin/entitlements/1', { payload: { data: {} } })
    ).resolves.toEqual({ id: 'entitlement-1' })

    expect(wreck.put).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grant-admin/entitlements/1`,
      expect.objectContaining({
        json: true,
        payload: { data: {} },
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })

  test('names the person who asked', async () => {
    await putToGas('/grant-admin/entitlements/1', {
      payload: { data: {} },
      actor: 'Ada Lovelace'
    })

    expect(wreck.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-actor': 'Ada Lovelace' })
      })
    )
  })
})

describe('deleteFromGas', () => {
  beforeEach(() => {
    vi.mocked(wreck.delete).mockResolvedValue({ payload: null } as never)
  })

  test('sends a DELETE to the given path, presenting the service token', async () => {
    await deleteFromGas('/grant-admin/clients/gas/grants-ui/tokens/1')

    expect(wreck.delete).toHaveBeenCalledWith(
      `${config.get('gas.apiUrl')}/grant-admin/clients/gas/grants-ui/tokens/1`,
      expect.objectContaining({
        json: true,
        timeout: config.get('gas.timeoutMs'),
        headers: {
          authorization: `Bearer ${config.get('gas.serviceToken')}`
        }
      })
    )
  })

  test('sends no body', async () => {
    await deleteFromGas('/grant-admin/clients/gas/grants-ui/tokens/1')

    expect(vi.mocked(wreck.delete).mock.calls[0][1]).not.toHaveProperty(
      'payload'
    )
  })
})

describe('the calls a Dev Ops request makes', () => {
  const shell = { catalogue: { buckets: [], sourceErrors: [] } }

  const inRequest = async (work: () => Promise<unknown>) => {
    const request = { app: {} } as Parameters<typeof withUpstream>[0]

    await withUpstream(request, work).catch(() => undefined)

    return request.app.upstream as Upstream
  }

  test('counts each call, reads and writes alike', async () => {
    vi.mocked(wreck.get).mockResolvedValue({ payload: {} } as never)
    vi.mocked(wreck.post).mockResolvedValue({ payload: {} } as never)

    const upstream = await inRequest(async () => {
      await getFromGas('/grant-admin/shell')
      await postToGas('/grant-admin/events/gas/outbox/1/redrive')
    })

    expect(upstream).toEqual({ calls: 2, shell: null })
  })

  test('keeps the shell an answer carries', async () => {
    vi.mocked(wreck.get).mockResolvedValue({ payload: { shell } } as never)

    const upstream = await inRequest(() => getFromGas('/grant-admin/shell'))

    expect(upstream).toEqual({ calls: 1, shell })
  })

  test('keeps the shell a refusal carries, and still rejects with it', async () => {
    const refusal = Object.assign(new Error('Response Error: 404'), {
      data: { payload: { reason: 'NOT_FOUND', shell } }
    })
    vi.mocked(wreck.put).mockRejectedValue(refusal)
    let rejected: unknown

    const upstream = await inRequest(() =>
      putToGas('/grant-admin/clients/gas/a/tokens/1/expiry').catch(
        (error: unknown) => {
          rejected = error
        }
      )
    )

    expect(upstream).toEqual({ calls: 1, shell })
    expect(rejected).toBe(refusal)
  })

  test('counts a call that had no answer, keeping no shell', async () => {
    vi.mocked(wreck.delete).mockRejectedValue(
      new Error('Client request timeout')
    )

    const upstream = await inRequest(() =>
      deleteFromGas('/grant-admin/clients/gas/a/tokens/1')
    )

    expect(upstream).toEqual({ calls: 1, shell: null })
  })

  test('keeps an earlier shell when a later answer carries none', async () => {
    vi.mocked(wreck.get)
      .mockResolvedValueOnce({ payload: { shell } } as never)
      .mockResolvedValueOnce({ payload: { shell: null } } as never)

    const upstream = await inRequest(async () => {
      await getFromGas('/grant-admin/shell')
      await getFromGas('/grant-admin/clients/gas')
    })

    expect(upstream).toEqual({ calls: 2, shell })
  })
})

describe('streamFromGas', () => {
  const responseOf = (statusCode: number, body: string) =>
    Object.assign(Readable.from([body]), {
      statusCode,
      headers: {},
      setTimeout: vi.fn()
    })

  test('posts the payload as JSON and answers the response to read as it comes', async () => {
    const response = responseOf(200, 'line\n')
    vi.mocked(wreck.request).mockResolvedValue(response as never)

    await expect(
      streamFromGas('/grant-admin/explore/query', {
        payload: { query: 'q' },
        timeoutMs: 4321,
        idleMs: 99
      })
    ).resolves.toBe(response)
    expect(wreck.request).toHaveBeenCalledWith(
      'POST',
      `${config.get('gas.apiUrl')}/grant-admin/explore/query`,
      expect.objectContaining({
        payload: '{"query":"q"}',
        timeout: 4321,
        headers: expect.objectContaining({
          authorization: `Bearer ${config.get('gas.serviceToken')}`,
          'content-type': 'application/json'
        })
      })
    )
  })

  test('rejects a non-2xx as wreck does, with GAS’s status and body', async () => {
    vi.mocked(wreck.request).mockResolvedValue(
      responseOf(400, '{"reason":"QUERY_REFUSED"}') as never
    )

    await expect(
      streamFromGas('/grant-admin/explore/query', { payload: {}, idleMs: 99 })
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      data: { isResponseError: true, payload: { reason: 'QUERY_REFUSED' } }
    })
  })

  test('lets go of a body that sends nothing for its idle time, so its reader sees it break', async () => {
    const response = responseOf(200, '')
    vi.mocked(wreck.request).mockResolvedValue(response as never)

    await streamFromGas('/grant-admin/explore/query', {
      payload: {},
      idleMs: 99
    })
    const [[idleMs, onIdle]] = response.setTimeout.mock.calls as [
      [number, () => void]
    ]
    const broken = new Promise((resolve) => response.on('error', resolve))

    onIdle()

    expect(idleMs).toBe(99)
    await expect(broken).resolves.toMatchObject({
      name: 'GasStreamIdleError'
    })
  })

  test('reads no more than a refusal holds of a 4xx body', async () => {
    vi.mocked(wreck.request).mockResolvedValue(
      responseOf(400, `{"reason":"${'x'.repeat(2 * 1024 * 1024)}"}`) as never
    )

    await expect(
      streamFromGas('/grant-admin/explore/query', { payload: {}, idleMs: 99 })
    ).rejects.toMatchObject({
      output: { statusCode: 400 },
      data: { payload: null }
    })
  })

  test('counts the call against the request it is made in', async () => {
    vi.mocked(wreck.request).mockResolvedValue(responseOf(200, '') as never)
    const upstream: Upstream = { calls: 0, shell: null }

    await withUpstream({ app: { upstream } } as never, () =>
      streamFromGas('/grant-admin/explore/query', { payload: {}, idleMs: 99 })
    )

    expect(upstream.calls).toBe(1)
  })
})
