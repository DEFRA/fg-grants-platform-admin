import type { Request } from '@hapi/hapi'

import {
  isSetAside,
  storeSearch,
  noteErrorParam,
  toSearchKey
} from './stored-search.ts'
import type { StoredSearch } from './stored-search.ts'

const now = new Date('2026-11-19T12:00:00.000Z')

const to = toSearchKey('events/gas')
const listHref = '/dev-ops/events/gas?queue=inbox'

/** A session as yar keeps one, by key. */
const sessionOf = (held: Record<string, StoredSearch> = {}) => {
  const store = new Map(Object.entries(held))
  const request = {
    yar: {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: StoredSearch) => store.set(key, value),
      clear: (key: string) => store.delete(key)
    }
  } as unknown as Request

  return { request, store }
}

const stored = (overrides: Partial<StoredSearch> = {}): StoredSearch => ({
  q: 'ref:abc-123',
  id: '0b7c1d1e-0000-4000-8000-000000000001',
  listHref: '/dev-ops/events/gas',
  storedAt: now.getTime() - 60_000,
  fresh: false,
  ...overrides
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('noteErrorParam', () => {
  test('keeps the key the list takes its error under on the search shown, and then sets that search aside while the address sets the error', () => {
    const { request, store } = sessionOf({ [to]: stored() })
    const withError = { error: 'Error: Boom' }

    expect(isSetAside(request, to, withError)).toBe(false)

    noteErrorParam(request, to, 'error')

    expect(store.get(to)).toEqual(stored({ errorParam: 'error' }))
    expect(isSetAside(request, to, withError)).toBe(true)
    expect(isSetAside(request, to, {})).toBe(false)
    expect(isSetAside(request, to, { status: 'DEAD_LETTER' })).toBe(false)
  })

  test('writes nothing when no search is held', () => {
    const { request, store } = sessionOf()

    noteErrorParam(request, to, 'error')

    expect(store.size).toBe(0)
  })
})

test('a search stored with the key its list takes the error under is set aside by that error before any draw', () => {
  const { request } = sessionOf()

  storeSearch(request, to, 'ref:abc-123', listHref, 'error')

  expect(isSetAside(request, to, { error: 'Error: Boom' })).toBe(true)

  storeSearch(request, to, 'ref:abc-123', listHref)

  expect(isSetAside(request, to, { error: 'Error: Boom' })).toBe(false)
})
