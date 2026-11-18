import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import type { YarFlashes } from '@hapi/yar'
import Joi from 'joi'
import type { Schema } from 'joi'

import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import type {
  GrantPage,
  GrantVersionRef
} from '../use-cases/get-grant-page.use-case.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowVersionsUseCase } from '../use-cases/get-workflow-versions.use-case.ts'
import type { HiddenTab, RecordResult } from '../use-cases/record-reads.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationType } from '../view-models/applications-page.view-model.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { Catalogue } from '../use-cases/shell-catalogue.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import { toBackBucket, toListAt } from '../view-models/bucket-nav.ts'
import { toCasePage } from '../view-models/case-page.view-model.ts'
import { caseType } from '../view-models/cases-page.view-model.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { definitionFetchNoticeKey } from '../view-models/definition-fetch.ts'
import type { DefinitionFetchFlash } from '../view-models/definition-fetch.ts'
import { toGrantPage } from '../view-models/grant-page.view-model.ts'
import type {
  GrantPageModel,
  GrantPageQuery
} from '../view-models/grant-page.view-model.ts'
import { grantType } from '../view-models/grants-page.view-model.ts'
import { recordPageCache } from '../view-models/list-filters.ts'
import {
  backSchema,
  recordParamsSchema,
  recordTabSchema,
  slugFilterSchema,
  toBackLabel,
  statusSchema,
  versionSchema,
  workflowCodeSchema
} from '../view-models/record-filters.ts'
import { toTabHref } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { toBackHref } from '../view-models/record-view.ts'
import { toVersionPath } from '../view-models/record-type.ts'
import { toWorkflowPage } from '../view-models/workflow-page.view-model.ts'
import { shellQuery, timesOf, withoutShellKeys } from '../view-models/times.ts'
import type { Times } from '../view-models/times.ts'
import {
  missingStatusCodes,
  toRecordMissing
} from '../view-models/record-missing.ts'
import type { MissingState } from '../view-models/record-missing.ts'
import type { Zone } from '../view-models/zoned-clock.ts'
import { workflowType } from '../view-models/workflows-page.view-model.ts'

interface RecordPageRoute<
  K,
  P,
  T extends string,
  N,
  Q,
  M extends { navActive: string | null }
> {
  record: RecordType
  /** Each URL param after the record's path, in order, with its schema. */
  params: Record<keyof K & string, Schema>
  /** Query params the record's tabs read, besides `tab` and `back`. */
  query?: Record<keyof Q & string, Schema>
  read: (key: K, tab: T) => Promise<RecordResult<P> | HiddenTab>
  toPage: (
    page: P,
    tab: T,
    from: string,
    options: {
      notice?: N
      query: Q
      catalogue: Catalogue | null
      zone: Zone
      times: Times
    }
  ) => M
  /** Where a write leaves its outcome for the one render after it. */
  noticeKey?: keyof YarFlashes
}

type RecordPageQuery<T> = {
  tab: T
  back?: string
} & Record<string, unknown>

/** The list a record's page sits under in the navigation: the one it goes back to. */
const toNavActive = (
  catalogue: Catalogue | null,
  from: string
): string | null => toBackBucket(catalogue, from)?.id ?? null

/** Opened from no list, a record sits under its own. */
const toRecordNav = (
  catalogue: Catalogue | null,
  record: RecordType,
  from: string
): string | null => toNavActive(catalogue, toBackHref(record, from))

const capitalised = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** What the Back link says: where `back` leads, else the record's own list. */
const labelAt = (catalogue: Catalogue | null, href: string): string | null =>
  toListAt(catalogue, href)?.label ?? null

const toRecordBackLabel = (
  catalogue: Catalogue | null,
  record: RecordType,
  from: string
): string =>
  toBackLabel(from, {
    listLabel: labelAt(catalogue, from),
    ownListLabel: labelAt(catalogue, record.path) ?? capitalised(record.listId)
  })

/** Without a list to go back to, a record sits under its own. */
const withNav = <M extends { navActive: string | null }>(
  model: M,
  navActive: string | null
): M => ({ ...model, navActive: navActive ?? model.navActive })

/** Taken before the read, so it is spent on this render whatever the read then says. */
const takeNotice = <N>(
  request: Request,
  key: keyof YarFlashes | undefined
): N | undefined =>
  key ? (request.yar.flash(key) as unknown as N[])[0] : undefined

/** The record's page with the reason in place of the record; with no `back` it goes back to, and sits under, its own list. */
const missingView = (
  request: Request,
  h: ResponseToolkit,
  record: RecordType,
  {
    from,
    catalogue,
    state,
    failure
  }: {
    from: string
    catalogue: Catalogue | null
    state: MissingState
    failure?: GasFailure
  }
) => {
  const missing = toRecordMissing(
    record,
    request.params,
    state,
    request,
    failure
  )

  return h
    .view('record-missing', {
      pageTitle: missing.pageTitle,
      missing,
      backHref: toBackHref(record, from),
      backLabel: toRecordBackLabel(catalogue, record, from),
      navActive: toNavActive(catalogue, toBackHref(record, from))
    })
    .code(missingStatusCodes[state])
}

const toMissingState = (outcome: string): MissingState =>
  outcome === 'timed-out' ? 'timed-out' : 'unavailable'

/** `tab` and `back` on every record page, then whatever else its tabs read. */
const toQuerySchema = (
  record: RecordType,
  query: Record<string, Schema> = {}
) =>
  Joi.object({
    tab: recordTabSchema(record)
      .valid(...(record.retiredTabs ?? []))
      .default('overview'),
    back: backSchema,
    ...query,
    ...shellQuery
  })

/** An old link to a tab the page no longer has opens its Overview, keeping where it goes back to. */
const toRetiredTabRedirect =
  ({ retiredTabs = [] }: RecordType) =>
  (request: Request, h: ResponseToolkit) => {
    const { tab, back } = request.query as RecordPageQuery<string>

    return retiredTabs.includes(tab)
      ? h
          .redirect(toTabHref(request.path, 'overview', toSafeFrom(back)))
          .takeover()
      : h.continue
  }

/**
 * One tab of one record per render. A record the service has not got, or
 * could not read, is its page with the reason in place of the record.
 */
const recordPageRoute = <
  K,
  P,
  T extends string,
  N = never,
  Q = object,
  M extends { navActive: string | null } = { navActive: string | null }
>({
  record,
  params,
  query,
  read,
  toPage,
  noticeKey
}: RecordPageRoute<K, P, T, N, Q, M>): ServerRoute => ({
  method: 'GET',
  path: [record.path, ...Object.keys(params).map((name) => `{${name}}`)].join(
    '/'
  ),
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema(params),
      query: toQuerySchema(record, query)
    },
    pre: [{ method: toRetiredTabRedirect(record) }]
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back, ...extra } = withoutShellKeys(
      request.query as RecordPageQuery<T>
    )
    const from = toSafeFrom(back)
    const notice = takeNotice<N>(request, noticeKey)
    const { outcome, page, failure } = await read(key, tab)

    if (outcome === 'not-found') {
      return missingView(request, h, record, {
        from,
        catalogue: shellCatalogue(request),
        state: 'not-found'
      })
    }

    if (outcome === 'hidden') {
      return h.redirect(toTabHref(request.path, 'overview', from))
    }

    const catalogue = shellCatalogue(request)

    if (page === null) {
      return missingView(request, h, record, {
        from,
        catalogue,
        state: toMissingState(outcome),
        failure
      })
    }

    const times = timesOf(request)
    const model = toPage(page, tab, from, {
      notice,
      query: extra as Q,
      catalogue,
      zone: times.zone,
      times
    })

    return h.view(record.view, {
      pageTitle: record.title,
      ...withNav(model, toRecordNav(catalogue, record, from)),
      backLabel: toRecordBackLabel(catalogue, record, from)
    })
  }
})

/** The status a Phases link asked for, carried on to the version it opens. */
const toStatusQuery = (status: unknown): Record<string, string> | undefined =>
  status ? { status: String(status) } : undefined

interface CurrentVersionRoute {
  record: RecordType
  code: Schema
  read: (code: string) => Promise<RecordResult<{ current: string | null }>>
}

/** A code alone opens its current version, on the tab asked for; a code with none is not found. */
const currentVersionRoute = ({
  record,
  code,
  read
}: CurrentVersionRoute): ServerRoute => ({
  method: 'GET',
  path: `${record.path}/{code}`,
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema({ code }),
      query: toQuerySchema(record, { status: statusSchema })
    },
    pre: [{ method: toRetiredTabRedirect(record) }]
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code: asked } = request.params
    const { tab, back, status } =
      request.query as unknown as RecordPageQuery<string>
    const from = toSafeFrom(back)
    const { outcome, page, failure } = await read(asked)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return missingView(request, h, record, {
        from,
        catalogue: shellCatalogue(request),
        state: toMissingState(outcome),
        failure
      })
    }

    if (page.current === null) {
      throw Boom.notFound()
    }

    return h.redirect(
      toTabHref(
        toVersionPath(record, { code: asked, version: page.current }),
        tab,
        from,
        toStatusQuery(status)
      )
    )
  }
})

export const viewApplicationRoute = recordPageRoute({
  record: applicationType,
  params: { code: slugFilterSchema, clientRef: slugFilterSchema },
  read: getApplicationPageUseCase,
  toPage: (page, tab, from, { times, catalogue }) =>
    toApplicationPage(page, tab, { from, times, catalogue })
})

export const viewCaseRoute = recordPageRoute({
  record: caseType,
  params: { workflowCode: slugFilterSchema, caseRef: slugFilterSchema },
  read: getCasePageUseCase,
  toPage: (page, tab, from, { times, catalogue }) =>
    toCasePage(page, tab, { from, times, catalogue })
})

export const viewGrantRoute = recordPageRoute<
  GrantVersionRef,
  GrantPage,
  GrantTabId,
  DefinitionFetchFlash,
  GrantPageQuery,
  GrantPageModel
>({
  record: grantType,
  params: { code: slugFilterSchema, version: versionSchema },
  query: { status: statusSchema },
  read: getGrantPageUseCase,
  toPage: toGrantPage,
  noticeKey: definitionFetchNoticeKey
})

export const viewCurrentGrantRoute = currentVersionRoute({
  record: grantType,
  code: slugFilterSchema,
  read: getGrantVersionsUseCase
})

export const viewWorkflowRoute = recordPageRoute({
  record: workflowType,
  params: { code: workflowCodeSchema, version: versionSchema },
  query: { status: statusSchema },
  read: getWorkflowPageUseCase,
  toPage: toWorkflowPage,
  noticeKey: definitionFetchNoticeKey
})

export const viewCurrentWorkflowRoute = currentVersionRoute({
  record: workflowType,
  code: workflowCodeSchema,
  read: getWorkflowVersionsUseCase
})
