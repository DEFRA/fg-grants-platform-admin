import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import type { YarFlashes } from '@hapi/yar'
import Joi from 'joi'
import type { Schema } from 'joi'

import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowVersionsUseCase } from '../use-cases/get-workflow-versions.use-case.ts'
import type { HiddenTab, RecordResult } from '../use-cases/record-reads.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationType } from '../view-models/applications-page.view-model.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { toBackBucket, toListAt } from '../view-models/bucket-nav.ts'
import { toCasePage } from '../view-models/case-page.view-model.ts'
import { caseType } from '../view-models/cases-page.view-model.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { definitionFetchNoticeKey } from '../view-models/definition-fetch.ts'
import { toGrantPage } from '../view-models/grant-page.view-model.ts'
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
import type { RecordPageModel } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { toVersionPath } from '../view-models/record-type.ts'
import { toWorkflowPage } from '../view-models/workflow-page.view-model.ts'
import { workflowType } from '../view-models/workflows-page.view-model.ts'

interface RecordPageRoute<K, P, T extends string, N, Q> {
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
    options: { notice?: N; query: Q; catalogue: Catalogue | null }
  ) => RecordPageModel
  /** Where a write leaves its outcome for the one render after it. */
  noticeKey?: keyof YarFlashes
  /** Its URL names a config version, so a version the service has not got keeps the page's shell. */
  versioned?: boolean
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
    ownListLabel: labelAt(catalogue, record.path) ?? record.listId
  })

/** Without a list to go back to, a record sits under its own. */
const withNav = <M extends { navActive: string | null }>(
  model: M,
  navActive: string | null
): M => ({ ...model, navActive: navActive ?? model.navActive })

const notFound = 404

/** Taken before the read, so it is spent on this render whatever the read then says. */
const takeNotice = <N>(
  request: Request,
  key: keyof YarFlashes | undefined
): N | undefined =>
  key ? (request.yar.flash(key) as unknown as N[])[0] : undefined

/** A record that could not be read keeps its shell; with no `back` it goes back to, and sits under, its own list. */
const unavailableView = (
  h: ResponseToolkit,
  record: RecordType,
  ref: string,
  {
    from,
    catalogue,
    outcome
  }: { from: string; catalogue: Catalogue | null; outcome: string }
) =>
  h.view(record.view, {
    pageTitle: record.title,
    record,
    ref,
    backHref: from || record.path,
    backLabel: toRecordBackLabel(catalogue, record, from),
    navActive: toNavActive(catalogue, from || record.path),
    unavailable: true,
    timedOut: outcome === 'timed-out'
  })

/** `tab` and `back` on every record page, then whatever else its tabs read. */
const toQuerySchema = (
  record: RecordType,
  query: Record<string, Schema> = {}
) =>
  Joi.object({
    tab: recordTabSchema(record).default('overview'),
    back: backSchema,
    ...query
  })

/** A version the service has no record of keeps the record's shell, and says where a rejected one went. */
const missingVersionView = async (
  h: ResponseToolkit,
  record: RecordType,
  { code, version }: { code: string; version: string },
  from: string
) => {
  const catalogue = await getCatalogueUseCase()

  return h
    .view(record.view, {
      pageTitle: record.title,
      record,
      ref: code,
      backHref: from || record.path,
      backLabel: toRecordBackLabel(catalogue, record, from),
      navActive: toNavActive(catalogue, from || record.path),
      missingVersion: { source: record.source, code, version }
    })
    .code(notFound)
}

/** A version the service has not got keeps the shell; any other record is GPA's own 404. */
const notFoundView = (
  h: ResponseToolkit,
  record: RecordType,
  versioned: boolean,
  request: Request,
  from: string
) => {
  if (!versioned) {
    throw Boom.notFound()
  }

  return missingVersionView(
    h,
    record,
    request.params as { code: string; version: string },
    from
  )
}

/**
 * One tab of one record per render. A record GAS has not got is GPA's own 404
 * page; any other failure keeps the page, with the reason in place of the tab.
 */
const recordPageRoute = <K, P, T extends string, N = never, Q = object>({
  record,
  params,
  query,
  read,
  toPage,
  noticeKey,
  versioned = false
}: RecordPageRoute<K, P, T, N, Q>): ServerRoute => ({
  method: 'GET',
  path: [record.path, ...Object.keys(params).map((name) => `{${name}}`)].join(
    '/'
  ),
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema(params),
      query: toQuerySchema(record, query)
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back, ...extra } = request.query as RecordPageQuery<T>
    const from = toSafeFrom(back)
    const notice = takeNotice<N>(request, noticeKey)
    const { outcome, page } = await read(key, tab)

    if (outcome === 'not-found') {
      return notFoundView(h, record, versioned, request, from)
    }

    if (outcome === 'hidden') {
      return h.redirect(toTabHref(request.path, 'overview', from))
    }

    const catalogue = await getCatalogueUseCase()

    if (page === null) {
      return unavailableView(h, record, request.params[record.titleParam], {
        from,
        catalogue,
        outcome
      })
    }

    const model = toPage(page, tab, from, {
      notice,
      query: extra as Q,
      catalogue
    })

    return h.view(record.view, {
      pageTitle: record.title,
      ...withNav(model, toNavActive(catalogue, from)),
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
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code: asked } = request.params
    const { tab, back, status } =
      request.query as unknown as RecordPageQuery<string>
    const from = toSafeFrom(back)
    const { outcome, page } = await read(asked)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return unavailableView(h, record, asked, {
        from,
        catalogue: await getCatalogueUseCase(),
        outcome
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
  toPage: (page, tab, from) => toApplicationPage(page, tab, from)
})

export const viewCaseRoute = recordPageRoute({
  record: caseType,
  params: { workflowCode: slugFilterSchema, caseRef: slugFilterSchema },
  read: getCasePageUseCase,
  toPage: (page, tab, from) => toCasePage(page, tab, from)
})

export const viewGrantRoute = recordPageRoute({
  record: grantType,
  params: { code: slugFilterSchema, version: versionSchema },
  query: { status: statusSchema },
  read: getGrantPageUseCase,
  toPage: toGrantPage,
  noticeKey: definitionFetchNoticeKey,
  versioned: true
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
  noticeKey: definitionFetchNoticeKey,
  versioned: true
})

export const viewCurrentWorkflowRoute = currentVersionRoute({
  record: workflowType,
  code: workflowCodeSchema,
  read: getWorkflowVersionsUseCase
})
