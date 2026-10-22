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
import { toBackBucket } from '../view-models/bucket-nav.ts'
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
  statusSchema,
  versionSchema,
  workflowCodeSchema
} from '../view-models/record-filters.ts'
import { toTabHref } from '../view-models/record-page.view-model.ts'
import type { RecordPageModel } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { toVersionPath } from '../view-models/version-header.ts'
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

/** Taken before the read, so it is spent on this render whatever the read then says. */
const takeNotice = <N>(
  request: Request,
  key: keyof YarFlashes | undefined
): N | undefined =>
  key ? (request.yar.flash(key) as unknown as N[])[0] : undefined

const unavailableView = (
  h: ResponseToolkit,
  record: RecordType,
  ref: string,
  {
    from,
    navActive,
    outcome
  }: { from: string; navActive: string | null; outcome: string }
) =>
  h.view(record.view, {
    pageTitle: record.title,
    record,
    ref,
    backHref: from,
    navActive,
    unavailable: true,
    timedOut: outcome === 'timed-out'
  })

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
  noticeKey
}: RecordPageRoute<K, P, T, N, Q>): ServerRoute => ({
  method: 'GET',
  path: [record.path, ...Object.keys(params).map((name) => `{${name}}`)].join(
    '/'
  ),
  options: {
    cache: recordPageCache,
    validate: {
      params: recordParamsSchema(params),
      query: Joi.object({
        tab: recordTabSchema(record).default('overview'),
        back: backSchema,
        ...query
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back, ...extra } = request.query as RecordPageQuery<T>
    const from = toSafeFrom(back)
    const notice = takeNotice<N>(request, noticeKey)
    const { outcome, page } = await read(key, tab)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (outcome === 'hidden') {
      return h.redirect(toTabHref(request.path, 'overview', from))
    }

    const catalogue = await getCatalogueUseCase()
    const navActive = toNavActive(catalogue, from)

    if (page === null) {
      return unavailableView(h, record, request.params[record.titleParam], {
        from,
        navActive,
        outcome
      })
    }

    return h.view(record.view, {
      pageTitle: record.title,
      ...toPage(page, tab, from, {
        notice,
        query: extra as Q,
        catalogue
      }),
      navActive
    })
  }
})

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
      query: Joi.object({
        tab: recordTabSchema(record).default('overview'),
        back: backSchema
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code: asked } = request.params
    const { tab, back } = request.query as unknown as RecordPageQuery<string>
    const from = toSafeFrom(back)
    const { outcome, page } = await read(asked)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return unavailableView(h, record, asked, {
        from,
        navActive: toNavActive(await getCatalogueUseCase(), from),
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
        from
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
