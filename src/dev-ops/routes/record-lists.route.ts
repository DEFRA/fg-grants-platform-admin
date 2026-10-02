import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { searchApplicationsUseCase } from '../use-cases/search-applications.use-case.ts'
import { searchCasesUseCase } from '../use-cases/search-cases.use-case.ts'
import {
  clearSearch,
  forgetRefused,
  storeSearch,
  takeSearch
} from '../use-cases/stored-search.ts'
import type {
  SearchToRun,
  StoredSearchKey
} from '../use-cases/stored-search.ts'
import {
  applicationsPath,
  toApplicationsPage
} from '../view-models/applications-page.view-model.ts'
import { casesPath, toCasesPage } from '../view-models/cases-page.view-model.ts'
import { listPageCache, present } from '../view-models/list-filters.ts'
import {
  codeFilter,
  searchedRef,
  searchedRefError
} from '../view-models/record-filters.ts'
import { toListHref } from '../view-models/record-list.view-model.ts'
import type {
  RecordListModel,
  RecordListQuery
} from '../view-models/record-list.view-model.ts'
import {
  timeRangeFilters,
  toRangeInstants
} from '../view-models/time-range.view-model.ts'

/** What GAS is asked for: the URL's filters less the preset key, and the stored ref. */
interface RecordListSearch {
  ref?: string
  code?: string
  from?: string
  to?: string
  cursor?: string
}

interface RecordListRoutes<R> {
  path: string
  pageTitle: string
  searchKey: StoredSearchKey
  read: (search: RecordListSearch, repeat: boolean) => Promise<R>
  toPage: (
    result: R,
    query: RecordListQuery,
    search: SearchToRun | null
  ) => RecordListModel
}

/** Spelled out here because a route may not reach into common/status-codes.ts. */
const seeOther = 303

const badRequest = 400

const cursorMax = 512

const filtersSchema = {
  code: codeFilter.allow(''),
  ...timeRangeFilters
}

const toQuery = ({
  code,
  from,
  to,
  range,
  cursor
}: RecordListQuery): RecordListQuery => ({
  ...present('code', code),
  ...toRangeInstants({ from, to }),
  ...present('range', range),
  ...present('cursor', cursor)
})

const toSearch = (
  { range, ...filters }: RecordListQuery,
  search: SearchToRun | null
): RecordListSearch => ({ ...filters, ...present('ref', search?.q) })

/**
 * A list and the search that narrows it. The search runs nothing: it keeps
 * the ref out of the URL, and the list it redirects to reads it back. A ref
 * GAS would refuse is never stored: the list is drawn again, as it was, with
 * the reason beside the box.
 */
const recordListRoutes = <R>({
  path,
  pageTitle,
  searchKey,
  read,
  toPage
}: RecordListRoutes<R>): [ServerRoute, ServerRoute] => {
  const readList = async (
    query: RecordListQuery,
    search: SearchToRun | null
  ): Promise<RecordListModel> =>
    toPage(
      await read(toSearch(query, search), search?.repeat === true),
      query,
      search
    )

  /** A later page is a browse's next page, read as a new page, never a repeat. */
  const takeFor = (
    request: Request,
    query: RecordListQuery
  ): SearchToRun | null =>
    query.cursor
      ? null
      : takeSearch(request, searchKey, toListHref(path, query))

  return [
    {
      method: 'GET',
      path,
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
        const query = toQuery(request.query as RecordListQuery)
        const search = takeFor(request, query)
        const page = await readList(query, search)

        forgetRefused(request, searchKey, search, page.refused)

        return h.view('record-list', { pageTitle, ...page })
      }
    },
    {
      method: 'POST',
      path,
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
        const { q: typed, ...filters } = request.payload as RecordListQuery & {
          q: string
        }
        const { value: q, error } = searchedRef.validate(typed)
        const query = toQuery(filters)

        if (error) {
          clearSearch(request, searchKey)

          return h
            .view('record-list', {
              pageTitle,
              ...(await readList(query, null)),
              searchValue: typed,
              searchError: searchedRefError
            })
            .code(badRequest)
        }

        const href = toListHref(path, query)

        storeSearch(request, searchKey, q as string, href)

        return h.redirect(href).code(seeOther)
      }
    }
  ]
}

export const [viewApplicationsRoute, searchApplicationsRoute] =
  recordListRoutes({
    path: applicationsPath,
    pageTitle: 'Applications',
    searchKey: 'applicationsSearch',
    read: searchApplicationsUseCase,
    toPage: toApplicationsPage
  })

export const [viewCasesRoute, searchCasesRoute] = recordListRoutes({
  path: casesPath,
  pageTitle: 'Cases',
  searchKey: 'casesSearch',
  read: ({ code, ...search }, repeat) =>
    searchCasesUseCase({ ...search, ...present('workflowCode', code) }, repeat),
  toPage: toCasesPage
})
