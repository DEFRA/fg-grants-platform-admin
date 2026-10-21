import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'
import type { Schema } from 'joi'

import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import type { HiddenTab, RecordResult } from '../use-cases/record-reads.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationType } from '../view-models/applications-page.view-model.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { toBackBucket } from '../view-models/bucket-nav.ts'
import { toCasePage } from '../view-models/case-page.view-model.ts'
import { caseType } from '../view-models/cases-page.view-model.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { toGrantPage } from '../view-models/grant-page.view-model.ts'
import { grantType } from '../view-models/grants-page.view-model.ts'
import { recordPageCache } from '../view-models/list-filters.ts'
import {
  slugFilterSchema,
  versionSchema
} from '../view-models/record-filters.ts'
import { toTabHref } from '../view-models/record-page.view-model.ts'
import type { RecordPageModel } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'
import { toVersionPath } from '../view-models/version-header.ts'

interface RecordPageRoute<K, P, T extends string> {
  record: RecordType
  /** Each URL param after the record's path, in order, with its schema. */
  params: Record<keyof K & string, Schema>
  read: (key: K, tab: T) => Promise<RecordResult<P> | HiddenTab>
  toPage: (page: P, tab: T, from: string) => RecordPageModel
}

interface RecordPageQuery<T> {
  tab: T
  back?: string
}

/** The list a record's page sits under in the navigation: the one it goes back to. */
const toNavActive = async (from: string): Promise<string | null> =>
  toBackBucket(await getCatalogueUseCase(), from)?.id ?? null

/** Longer than any list link this app builds for itself, and still bounded. */
const fromMax = 2048

// Checked by `toSafeFrom`: a bad one falls back to the admin's root, not an error page.
const backSchema = Joi.string().allow('').max(fromMax)

const tabSchema = ({ tabs }: RecordType) =>
  Joi.string().valid(...tabs.map(({ id }) => id))

const toParamsSchema = (params: Record<string, Schema>) =>
  Joi.object(
    Object.fromEntries(
      Object.entries(params).map(([name, schema]) => [name, schema.required()])
    )
  )

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
const recordPageRoute = <K, P, T extends string>({
  record,
  params,
  read,
  toPage
}: RecordPageRoute<K, P, T>): ServerRoute => ({
  method: 'GET',
  path: [record.path, ...Object.keys(params).map((name) => `{${name}}`)].join(
    '/'
  ),
  options: {
    cache: recordPageCache,
    validate: {
      params: toParamsSchema(params),
      query: Joi.object({
        tab: tabSchema(record).default('overview'),
        back: backSchema
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back } = request.query as unknown as RecordPageQuery<T>
    const from = toSafeFrom(back)
    const { outcome, page } = await read(key, tab)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (outcome === 'hidden') {
      return h.redirect(toTabHref(request.path, 'overview', from))
    }

    const navActive = await toNavActive(from)

    if (page === null) {
      return unavailableView(h, record, request.params[record.titleParam], {
        from,
        navActive,
        outcome
      })
    }

    return h.view(record.view, {
      pageTitle: record.title,
      ...toPage(page, tab, from),
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
      params: toParamsSchema({ code }),
      query: Joi.object({
        tab: tabSchema(record).default('overview'),
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
        navActive: await toNavActive(from),
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
  toPage: toApplicationPage
})

export const viewCaseRoute = recordPageRoute({
  record: caseType,
  params: { workflowCode: slugFilterSchema, caseRef: slugFilterSchema },
  read: getCasePageUseCase,
  toPage: toCasePage
})

export const viewGrantRoute = recordPageRoute({
  record: grantType,
  params: { code: slugFilterSchema, version: versionSchema },
  read: getGrantPageUseCase,
  toPage: toGrantPage
})

export const viewCurrentGrantRoute = currentVersionRoute({
  record: grantType,
  code: slugFilterSchema,
  read: getGrantVersionsUseCase
})
