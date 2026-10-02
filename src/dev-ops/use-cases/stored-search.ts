import type { Request } from '@hapi/hapi'

/**
 * A searched ref is personal data, so it lives in the session rather than a
 * URL: the form posts it and is redirected to the list. The list reads it
 * back on every render. A render of the same search under the same filters
 * is a Back or a refresh, so it is audited as a repeat; a changed filter is
 * a new query, so it is fresh. So Back across a filter change re-runs the
 * earlier filters as fresh too.
 */
export interface StoredSearch {
  q: string
  /** The list's own URL for the filters the search last ran under. */
  listHref: string
  storedAt: number
  fresh: boolean
}

export type StoredSearchKey = 'applicationsSearch' | 'casesSearch'

const maxAgeMs = 15 * 60 * 1000

export interface SearchToRun {
  q: string
  repeat: boolean
}

export const storeSearch = (
  request: Request,
  key: StoredSearchKey,
  q: string,
  listHref: string
): void => {
  if (q === '') {
    request.yar.clear(key)
    return
  }

  request.yar.set(key, { q, listHref, storedAt: Date.now(), fresh: true })
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

const isExpired = ({ storedAt }: StoredSearch): boolean =>
  Date.now() - storedAt > maxAgeMs

/** The stored search for this render under these filters, or none once it is 15 minutes old. */
export const takeSearch = (
  request: Request,
  key: StoredSearchKey,
  listHref: string
): SearchToRun | null => {
  const stored = request.yar.get(key)

  if (!stored) {
    return null
  }

  if (isExpired(stored)) {
    request.yar.clear(key)
    return null
  }

  const repeat = !stored.fresh && stored.listHref === listHref

  request.yar.set(key, { ...stored, listHref, fresh: false })

  return { q: stored.q, repeat }
}
