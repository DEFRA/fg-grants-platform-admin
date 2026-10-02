import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { searchApplicationsUseCase } from '../use-cases/search-applications.use-case.ts'
import {
  clearSearch,
  forgetRefused,
  storeSearch,
  takeSearch
} from '../use-cases/stored-search.ts'
import type { SearchToRun } from '../use-cases/stored-search.ts'
import type { ApplicationsPageQuery } from '../view-models/applications-page.view-model.ts'
import {
  applicationsPath,
  toApplicationsHref,
  toApplicationsPage
} from '../view-models/applications-page.view-model.ts'
import { listPageCache, present } from '../view-models/list-filters.ts'
import {
  codeFilter,
  searchedRef,
  searchedRefError
} from '../view-models/record-filters.ts'
import {
  timeRangeFilters,
  toRangeInstants
} from '../view-models/time-range.view-model.ts'

const searchKey = 'applicationsSearch'

/** Spelled out here because a route may not reach into common/status-codes.ts. */
const seeOther = 303

const badRequest = 400

const cursorMax = 512

const toQuery = ({
  code,
  from,
  to,
  range,
  cursor
}: ApplicationsPageQuery): ApplicationsPageQuery => ({
  ...present('code', code),
  ...toRangeInstants({ from, to }),
  ...present('range', range),
  ...present('cursor', cursor)
})

/** A later page is a browse's next page, read as a new page, never a repeat. */
const toSearch = (
  request: Request,
  query: ApplicationsPageQuery
): SearchToRun | null =>
  query.cursor
    ? null
    : takeSearch(request, searchKey, toApplicationsHref(query))

const toGasSearch = (
  { range, ...filters }: ApplicationsPageQuery,
  search: SearchToRun | null
) => ({ ...filters, ...present('ref', search?.q) })

const readList = async (
  query: ApplicationsPageQuery,
  search: SearchToRun | null
) =>
  toApplicationsPage(
    await searchApplicationsUseCase(
      toGasSearch(query, search),
      search?.repeat === true
    ),
    query,
    search
  )

const filtersSchema = {
  code: codeFilter.allow(''),
  ...timeRangeFilters
}

export const viewApplicationsRoute: ServerRoute = {
  method: 'GET',
  path: applicationsPath,
  options: {
    cache: listPageCache,
    validate: {
      query: Joi.object({
        cursor: Joi.string().max(cursorMax),
        ...filtersSchema
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = toQuery(request.query as ApplicationsPageQuery)
    const search = toSearch(request, query)
    const page = await readList(query, search)

    forgetRefused(request, searchKey, search, page.refused)

    return h.view('applications', { pageTitle: 'Applications', ...page })
  }
}

interface PostedSearch extends ApplicationsPageQuery {
  q: string
}

/**
 * Runs nothing: it keeps the ref out of the URL, and the list it returns to
 * reads it once. A ref GAS would refuse is never stored: the list is drawn
 * again, as it was, with the reason beside the box.
 */
export const searchApplicationsRoute: ServerRoute = {
  method: 'POST',
  path: applicationsPath,
  options: {
    validate: {
      payload: Joi.object({
        q: Joi.string().allow('').default(''),
        ...filtersSchema
      })
        .empty(null)
        .default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { q: typed, ...filters } = request.payload as PostedSearch
    const { value: q, error } = searchedRef.validate(typed)

    if (error) {
      const query = toQuery(filters)

      clearSearch(request, searchKey)

      return h
        .view('applications', {
          pageTitle: 'Applications',
          ...(await readList(query, null)),
          searchValue: typed,
          searchError: searchedRefError
        })
        .code(badRequest)
    }

    const href = toApplicationsHref(toQuery(filters))

    storeSearch(request, searchKey, q as string, href)

    return h.redirect(href).code(seeOther)
  }
}
