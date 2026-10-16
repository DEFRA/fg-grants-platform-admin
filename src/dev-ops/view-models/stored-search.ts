import { randomUUID } from 'node:crypto'
import type { Request } from '@hapi/hapi'

/** The first page last shown, a browse or a search: the ref lives here, not in a URL, and a render of it again is a repeat. */
export interface StoredSearch {
  /** Empty for a browse. */
  q: string
  /** Names this search in its later pages' links, so a page never continues another. */
  id: string
  /** The list's own URL for the filters it last ran under. */
  listHref: string
  storedAt: number
  fresh: boolean
}

export type StoredSearchKey = `bucketSearch:${string}`

export const toSearchKey = (bucketId: string): StoredSearchKey =>
  `bucketSearch:${bucketId}`

const maxAgeMs = 15 * 60 * 1000

export interface SearchToRun {
  q: string
  repeat: boolean
  id: string
}

/** A posted search, or an empty one that clears it: a new query either way. */
export const storeSearch = (
  request: Request,
  key: StoredSearchKey,
  q: string,
  listHref: string
): void => {
  request.yar.set(key, {
    q,
    id: randomUUID(),
    listHref,
    storedAt: Date.now(),
    fresh: true
  })
}

export const clearSearch = (request: Request, key: StoredSearchKey): void => {
  request.yar.clear(key)
}

/** A search GAS refused would only fail again, so it is not kept to run. */
export const forgetRefused = (
  request: Request,
  key: StoredSearchKey,
  search: SearchToRun | null,
  refused: boolean
): void => {
  if (search !== null && refused) {
    clearSearch(request, key)
  }
}

const isLive = (stored: StoredSearch | null): stored is StoredSearch =>
  stored?.storedAt !== undefined && Date.now() - stored.storedAt <= maxAgeMs

/** Nothing shown yet, or not for 15 minutes: a browse, and a new one. */
const toLive = (stored: StoredSearch | null): StoredSearch =>
  isLive(stored)
    ? stored
    : {
        q: '',
        id: randomUUID(),
        listHref: '',
        storedAt: Date.now(),
        fresh: true
      }

/** The search for this first page; a repeat when the last first page shown was this one. */
export const takeSearch = (
  request: Request,
  key: StoredSearchKey,
  listHref: string
): SearchToRun => {
  const live = toLive(request.yar.get(key))
  const repeat = !live.fresh && live.listHref === listHref

  request.yar.set(key, { ...live, listHref, fresh: false })

  return { q: live.q, repeat, id: live.id }
}

/** The search a later page continues, left as it is; null when it is no longer the one held. */
export const peekSearch = (
  request: Request,
  key: StoredSearchKey,
  id: string
): SearchToRun | null => {
  const stored = request.yar.get(key)

  return isLive(stored) && stored.q !== '' && stored.id === id
    ? { q: stored.q, repeat: false, id }
    : null
}
