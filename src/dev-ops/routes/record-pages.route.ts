import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import { recordTabs } from '../use-cases/record-reads.ts'
import type { RecordResult, RecordTab } from '../use-cases/record-reads.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationType } from '../view-models/applications-page.view-model.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { toBackBucket } from '../view-models/bucket-nav.ts'
import { toCasePage } from '../view-models/case-page.view-model.ts'
import { caseType } from '../view-models/cases-page.view-model.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { recordPageCache } from '../view-models/list-filters.ts'
import { slugFilterSchema, fromMax } from '../view-models/record-filters.ts'
import type { RecordPageModel } from '../view-models/record-page.view-model.ts'
import type { RecordType } from '../view-models/record-type.ts'

interface RecordPageRoute<K, P> {
  record: RecordType
  /** The code and the ref, as the URL names them, e.g. `['code', 'clientRef']`. */
  params: [keyof K & string, keyof K & string]
  read: (key: K, tab: RecordTab) => Promise<RecordResult<P>>
  toPage: (page: P, tab: RecordTab, from: string) => RecordPageModel
}

interface RecordPageQuery {
  tab: RecordTab
  back?: string
}

/** The list a record's page sits under in the navigation: the one it goes back to. */
const toNavActive = async (from: string): Promise<string | null> =>
  toBackBucket(await getCatalogueUseCase(), from)?.id ?? null

/**
 * One tab of one record per render. A record GAS has not got is GPA's own 404
 * page; any other failure keeps the page, with the reason in place of the tab.
 */
const recordPageRoute = <K, P>({
  record,
  params: [codeParam, refParam],
  read,
  toPage
}: RecordPageRoute<K, P>): ServerRoute => ({
  method: 'GET',
  path: `${record.path}/{${codeParam}}/{${refParam}}`,
  options: {
    cache: recordPageCache,
    validate: {
      params: Joi.object({
        [codeParam]: slugFilterSchema.required(),
        [refParam]: slugFilterSchema.required()
      }),
      query: Joi.object({
        tab: Joi.string()
          .valid(...recordTabs)
          .default('overview'),
        // Checked by `toSafeFrom`: a bad one falls back to the admin's root, not an error page.
        back: Joi.string().allow('').max(fromMax)
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as K
    const { tab, back } = request.query as unknown as RecordPageQuery
    const from = toSafeFrom(back)
    const { outcome, page } = await read(key, tab)
    const navActive = await toNavActive(from)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return h.view('record', {
        pageTitle: record.title,
        record,
        ref: request.params[refParam],
        backHref: from,
        navActive,
        unavailable: true,
        timedOut: outcome === 'timed-out'
      })
    }

    return h.view('record', {
      pageTitle: record.title,
      ...toPage(page, tab, from),
      navActive
    })
  }
})

export const viewApplicationRoute = recordPageRoute({
  record: applicationType,
  params: ['code', 'clientRef'],
  read: getApplicationPageUseCase,
  toPage: toApplicationPage
})

export const viewCaseRoute = recordPageRoute({
  record: caseType,
  params: ['workflowCode', 'caseRef'],
  read: getCasePageUseCase,
  toPage: toCasePage
})
