import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { ApplicationPage } from '../use-cases/get-application-page.use-case.ts'
import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import type { CasePage } from '../use-cases/get-case-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import type {
  GrantDefinition,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import {
  agreementDefinition,
  applicationsBucket,
  catalogue
} from '../use-cases/test-fixtures.ts'
import type { WorkflowVersionPage } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-application-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-application-page.use-case.ts')
  >('../use-cases/get-application-page.use-case.ts')),
  getApplicationPageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/get-case-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-case-page.use-case.ts')
  >('../use-cases/get-case-page.use-case.ts')),
  getCasePageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/get-grant-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-grant-page.use-case.ts')
  >('../use-cases/get-grant-page.use-case.ts')),
  getGrantPageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/get-grant-versions.use-case.ts'))
vi.mock(import('../use-cases/get-workflow-page.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-09-30T15:17:31.000Z')

const path = '/dev-ops/applications/frps-private-beta/a7c-2f1-9e4'

const header: ApplicationPage['header'] = {
  clientRef: 'a7c-2f1-9e4',
  code: 'frps-private-beta',
  position: {
    phase: 'PHASE_PRE_AWARD',
    stage: 'STAGE_ASSESSMENT',
    status: 'STATUS_IN_REVIEW'
  },
  counterpart: null,
  fetchedAt: now.toISOString()
}

const overview: NonNullable<ApplicationPage['overview']> = {
  code: 'frps-private-beta',
  originalConfigVersion: '1.4.0',
  currentConfigVersion: '1.4.2',
  submittedAt: '2026-09-22T09:14:37.000Z',
  createdAt: '2026-09-22T09:14:37.000Z',
  updatedAt: '2026-09-29T15:02:44.000Z',
  identifiers: { sbi: '999100482', frn: '9990004873', crn: '9990001593' },
  series: {
    latestRef: 'c41-8e2-7d0',
    refs: ['9d3-5b1-e08', 'a7c-2f1-9e4', 'c41-8e2-7d0'],
    members: [
      {
        clientRef: '9d3-5b1-e08',
        position: {
          phase: 'PHASE_PRE_AWARD',
          stage: 'STAGE_ASSESSMENT',
          status: 'STATUS_WITHDRAWN'
        },
        createdAt: '2026-09-20T08:01:02.000Z'
      },
      {
        clientRef: 'a7c-2f1-9e4',
        position: header.position,
        createdAt: '2026-09-22T09:14:37.000Z'
      },
      {
        clientRef: 'c41-8e2-7d0',
        position: { phase: null, stage: null, status: null },
        createdAt: '29/09/2026'
      }
    ]
  },
  storedBytes: 2458
}

const givenPage = (overrides: Partial<ApplicationPage> = {}) =>
  vi.mocked(getApplicationPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      overview,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const casePath = '/dev-ops/cases/woodland/f02-7d8-a61'

const caseHeader: CasePage['header'] = {
  caseRef: 'f02-7d8-a61',
  workflowCode: 'woodland',
  position: {
    phase: 'PHASE_POST_AGREEMENT',
    stage: 'STAGE_MONITORING',
    status: 'STATUS_ACTIVE'
  },
  closed: false,
  closedAt: null,
  counterpart: { exists: true },
  fetchedAt: now.toISOString()
}

const caseOverview: NonNullable<CasePage['overview']> = {
  workflowCode: 'woodland',
  originalConfigVersion: '1.3.5',
  currentConfigVersion: '1.4.2',
  createdAt: '2026-08-27T12:31:16.000Z',
  closed: false,
  closedAt: null,
  series: {
    latestRef: 'f02-7d8-a61',
    refs: ['9d3-5b1-e08', 'f02-7d8-a61'],
    members: [
      {
        caseRef: '9d3-5b1-e08',
        position: { phase: null, stage: null, status: 'STATUS_CLOSED' },
        createdAt: '2026-08-20T10:00:00.000Z',
        closedAt: '2026-08-27T12:00:00.000Z'
      },
      {
        caseRef: 'f02-7d8-a61',
        position: caseHeader.position,
        createdAt: '2026-08-27T12:31:16.000Z',
        closedAt: null
      }
    ]
  },
  storedBytes: 4096
}

const givenCase = (overrides: Partial<CasePage> = {}) =>
  vi.mocked(getCasePageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header: caseHeader,
      overview: caseOverview,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

/** What the shared record template draws alike for either record type. */
const recordTypes = [
  {
    itemId: 'application',
    path,
    source: 'GAS',
    given: (overrides: Partial<ApplicationPage>) => givenPage(overrides)
  },
  {
    itemId: 'case',
    path: casePath,
    source: 'CW',
    given: (overrides: Partial<CasePage>) => givenCase(overrides)
  }
]

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Anything after the row's link that is positioned or stacked sits over its stretched overlay and swallows the click. */
const liftedOver = ($: CheerioAPI, row: Cheerio<Element>) =>
  row
    .find('td *, li *')
    .toArray()
    .filter((node) => !$(node).is('a'))
    .filter((node) =>
      ($(node).attr('class') ?? '')
        .split(/\s+/)
        .some((name) => /^(relative|absolute|sticky|fixed|z-)/.test(name))
    )
    .map((node) => $(node).attr('data-testid') ?? node.tagName)

let server: Server

const viewPage = async (url = path) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode, headers }
}

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenPage()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the application page', () => {
  test('reads the Overview tab of the application in the URL', async () => {
    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      { code: 'frps-private-beta', clientRef: 'a7c-2f1-9e4' },
      'overview'
    )
  })

  test('heads the page with the title and the ref on one line', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'application-title')).toBe('Application a7c-2f1-9e4')
    expect(part($, 'application-ref').attr('class')).toContain('font-mono')
    expect($('title').text()).toContain('Application a7c-2f1-9e4')
  })

  test('says where the application is as a humanised trail', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'application-position')).toBe(
      'Pre award, Assessment, In review'
    )
    expect(
      part($, 'application-position-step').last().hasClass('font-semibold')
    ).toBe(true)
  })

  test('draws the chevrons between the steps as icons screen readers skip', async () => {
    const { $ } = await viewPage()
    const chevrons = part($, 'application-position').find(
      '[data-testid="do-icon-chevron-down"]'
    )

    expect(chevrons).toHaveLength(2)
    expect(chevrons.attr('aria-hidden')).toBe('true')
    expect(chevrons.attr('class')).toBe(
      'size-3.5 shrink-0 -rotate-90 text-base-content/50'
    )
  })

  test('links back to the first list when opened from no list', async () => {
    const { $ } = await viewPage()

    expect(part($, 'application-back').attr('href')).toBe(
      '/dev-ops/events/gas/outbox'
    )
    expect(textOf($, 'application-back')).toBe('Back to applications')
    expect($('[data-testid="do-nav"] [aria-current="page"]')).toHaveLength(0)
  })

  test('links back to the list it was opened from, on every tab, and sits under it in the navigation', async () => {
    const from = '/dev-ops/applications?grant=example-grant'
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(from)}`)

    expect(part($, 'application-back').attr('href')).toBe(from)
    expect(
      $('[data-testid="do-nav"] [aria-current="page"]').text().trim()
    ).toBe('Applications')
    expect(
      part($, 'application-tab')
        .toArray()
        .map((tab) => $(tab).attr('href'))
    ).toEqual([
      `${path}?back=${encodeURIComponent(from)}`,
      `${path}?tab=events&back=${encodeURIComponent(from)}`,
      `${path}?tab=raw&back=${encodeURIComponent(from)}`
    ])
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a path outside the admin', '/grant-ops'],
    ['a list hiding a protocol-relative url', '/dev-ops/cases?a=//b.com']
  ])('drops %s from the back link', async (_name, from) => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(from)}`)

    expect(part($, 'application-back').attr('href')).toBe(
      '/dev-ops/events/gas/outbox'
    )
  })

  test('keeps the scrollbar gutter, so the page does not shift beside the taller lists', async () => {
    const { $ } = await viewPage()

    expect($('html').attr('class')).toBe(
      '[scrollbar-gutter:stable] [--root-bg:var(--color-base-200)] scroll-pt-14 lg:scroll-pt-0'
    )
  })

  test('heads the page with the title and the trail alone', async () => {
    givenPage({ header: { ...header, counterpart: { exists: true } } })

    const { $ } = await viewPage()
    const pageHeader = part($, 'application-header')

    expect(pageHeader.find('nav')).toHaveLength(0)
    expect(
      pageHeader
        .children()
        .toArray()
        .map((child) => $(child).attr('data-testid'))
    ).toEqual(['application-title', 'application-position'])
    expect(pageHeader.find('a, nav')).toHaveLength(0)
  })

  test('shows no warning while GAS cannot say whether the case exists', async () => {
    const { $ } = await viewPage()

    expect($('[role="alert"]')).toHaveLength(0)
    expect(part($, 'application-fact-case')).toHaveLength(0)
  })

  test('offers Overview, Events and Raw, marking the open one', async () => {
    const { $ } = await viewPage(`${path}?tab=events`)

    expect(
      part($, 'application-tab')
        .toArray()
        .map((tab) => `${$(tab).text()} ${$(tab).attr('href')}`)
    ).toEqual([
      `Overview ${path}`,
      `Events ${path}?tab=events`,
      `Raw ${path}?tab=raw`
    ])
    expect(
      part($, 'application-tabs').find('[aria-current="page"]').text()
    ).toBe('Events')
  })

  test('is never stored, unlike the list', async () => {
    const { headers } = await viewPage()

    expect(headers['cache-control']).toBe('no-store')
  })

  test('refuses a tab it does not have', async () => {
    const { statusCode } = await viewPage(`${path}?tab=answers`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test("answers GPA's own 404 page for an application GAS does not have", async () => {
    vi.mocked(getApplicationPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
    expect($('body').text()).toContain('Page not found')
  })

  test.each([
    ['unavailable', 'This application could not be loaded from GAS.'],
    [
      'timed-out',
      'This application could not be loaded: GAS timed out waiting for it. Refresh to try again.'
    ]
  ] as const)('says so when GAS is %s', async (outcome, message) => {
    vi.mocked(getApplicationPageUseCase).mockResolvedValue({
      outcome,
      page: null
    })

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'application-error')).toBe(message)
    expect(part($, 'application-tabs')).toHaveLength(0)
  })
})

describe('the Overview tab', () => {
  const factsOf = ($: CheerioAPI) =>
    part($, 'application-facts')
      .find('dt')
      .toArray()
      .map((label) => flatten($(label).text()))

  test('lists Grant, Case, Submitted, Created, Updated, SBI, FRN, CRN and Size', async () => {
    givenPage({ header: { ...header, counterpart: { exists: true } } })

    const { $ } = await viewPage()

    expect(factsOf($)).toEqual([
      'Grant',
      'Case',
      'Submitted',
      'Created',
      'Updated',
      'SBI',
      'FRN',
      'CRN',
      'Size'
    ])
  })

  test('links to the case as the second fact when it exists', async () => {
    givenPage({ header: { ...header, counterpart: { exists: true } } })

    const { $ } = await viewPage()
    const link = part($, 'application-case')

    expect(textOf($, 'application-fact-case')).toBe(
      'Case View case (opens in a new tab)'
    )
    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(
      '/dev-ops/cases/frps-private-beta/a7c-2f1-9e4'
    )
    expect(link.attr('class')).toContain('link')
    expect(link.attr('target')).toBe('_blank')
    expect(link.attr('rel')).toBe('noopener noreferrer')
    expect(link.find('.sr-only').text()).toBe(' (opens in a new tab)')
    expect(link.next().attr('data-testid')).toBe('do-icon-external-link')
  })

  test.each([
    ['does not exist', { exists: false }],
    ['is unknown', null]
  ])('leaves the Case fact out when the case %s', async (_, counterpart) => {
    givenPage({ header: { ...header, counterpart } })

    const { $ } = await viewPage()

    expect(part($, 'application-fact-case')).toHaveLength(0)
    expect(factsOf($)[1]).toBe('Submitted')
  })

  test('gives the grant its version, and where it started when that differs', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'application-grant')).toBe('frps-private-beta@1.4.2')
    expect(textOf($, 'application-grant-from')).toBe('from 1.4.0')
  })

  test('leaves out where it started when the version never moved', async () => {
    givenPage({ overview: { ...overview, originalConfigVersion: '1.4.2' } })

    const { $ } = await viewPage()

    expect(part($, 'application-grant-from')).toHaveLength(0)
  })

  test('links the grant to its version page, which leads back here', async () => {
    const from = '/dev-ops/applications?grant=frps-private-beta'
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(from)}`)

    const link = part($, 'application-grant')
    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(
      `/dev-ops/grants/frps-private-beta/1.4.2?back=${encodeURIComponent(`${path}?back=${encodeURIComponent(from)}`)}`
    )
    expect(link.attr('class')).toContain('link')
    expect(link.attr('target')).toBeUndefined()
    expect(textOf($, 'application-grant-from')).toBe('from 1.4.0')
  })

  test('leaves the grant unlinked when it has no version', async () => {
    givenPage({ overview: { ...overview, currentConfigVersion: null } })

    const { $ } = await viewPage()

    expect(part($, 'application-grant').is('span')).toBe(true)
    expect(textOf($, 'application-grant')).toBe('frps-private-beta')
  })

  test('spells each date out in UK time, as the event page does', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'application-submitted')).toBe('22 Sep 2026 10:14:37.000')
    expect(part($, 'application-updated').attr('datetime')).toBe(
      '2026-09-29T15:02:44Z'
    )
  })

  test('shows a date that is not an instant as stored, with no time to read', async () => {
    givenPage({
      overview: { ...overview, submittedAt: '16/06/2026', updatedAt: '' }
    })

    const { $ } = await viewPage()

    expect(textOf($, 'application-submitted')).toBe('16/06/2026')
    expect(part($, 'application-submitted').is('time')).toBe(false)
    expect(textOf($, 'application-updated')).toBe('""')
    expect(part($, 'application-updated').is('time')).toBe(false)
  })

  test('shows a date only a lenient parser would read as stored, not reformatted', async () => {
    givenPage({ overview: { ...overview, submittedAt: '2026-06-16 10:00' } })

    const { $ } = await viewPage()

    expect(textOf($, 'application-submitted')).toBe('2026-06-16 10:00')
    expect(part($, 'application-submitted').is('time')).toBe(false)
  })

  test('draws a dash for a date the application has not got', async () => {
    givenPage({ overview: { ...overview, submittedAt: null } })

    const { $ } = await viewPage()

    expect(textOf($, 'application-submitted')).toBe('—')
  })

  test('shows the identifiers and the stored size', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'application-sbi')).toBe('999100482')
    expect(textOf($, 'application-frn')).toBe('9990004873')
    expect(textOf($, 'application-crn')).toBe('9990001593')
    expect(textOf($, 'application-size')).toBe('2.4 KiB')
  })

  test('draws a dash for an identifier the application has not got', async () => {
    givenPage({
      overview: {
        ...overview,
        identifiers: { sbi: null, frn: null, crn: null }
      }
    })

    const { $ } = await viewPage()

    expect(textOf($, 'application-sbi')).toBe('—')
  })
})

describe('the Series card', () => {
  /** Each row's cells as seen, the spoken-only text left out and a time's two lines apart. */
  const seriesRows = ($: CheerioAPI, itemId = 'application') =>
    part($, `${itemId}-series-row`)
      .toArray()
      .map((row) =>
        $(row)
          .find('td')
          .toArray()
          .map((cell) => {
            const seen = $(cell).clone()

            seen.find('.sr-only').remove()
            seen.find('time').after(' ')

            return flatten(seen.text())
          })
          .join(' | ')
      )

  test('lists the whole series under the facts, oldest first, marking each replaced one', async () => {
    const { $ } = await viewPage()

    expect(flatten($('#application-series-title').text())).toBe('Series')
    expect(part($, 'application-overview').next().attr('data-testid')).toBe(
      'application-series'
    )
    expect(seriesRows($)).toEqual([
      '9d3-5b1-e08 replaced | Withdrawn | 10d ago 20 Sep 09:01',
      'a7c-2f1-9e4 replaced | In review | 8d ago 22 Sep 10:14',
      'c41-8e2-7d0 | — | 29/09/2026'
    ])
  })

  test('labels the card by its heading and heads its columns Reference, Status and Created', async () => {
    const { $ } = await viewPage()
    const card = part($, 'application-series')

    expect(card.is('section')).toBe(true)
    expect(card.attr('aria-labelledby')).toBe('application-series-title')
    expect($('#application-series-title').is('h2')).toBe(true)
    expect(card.children('.card-body').attr('class')).toBe(
      'card-body gap-3 p-5'
    )
    expect(part($, 'application-series-heading').attr('class')).toBe(
      'card-title text-base'
    )
    expect(
      part($, 'application-series-heading').parent().is('.card-body')
    ).toBe(true)
    expect(card.find('.border-b')).toHaveLength(0)
    expect(
      card
        .find('th')
        .toArray()
        .map((cell) => `${flatten($(cell).text())} ${$(cell).attr('scope')}`)
    ).toEqual(['Reference col', 'Status col', 'Created col'])
  })

  test('makes each other member a whole-row link under the same grant, as the lists do', async () => {
    const { $ } = await viewPage()
    const rows = $(
      '[data-testid="application-series-table"] [data-testid="application-series-row"]'
    )
    const links = rows.find('[data-testid="application-series-link"]')

    expect(links.toArray().map((link) => $(link).attr('href'))).toEqual([
      '/dev-ops/applications/frps-private-beta/9d3-5b1-e08',
      '/dev-ops/applications/frps-private-beta/c41-8e2-7d0'
    ])
    expect(links.first().hasClass('after:absolute')).toBe(true)
    expect(links.first().hasClass('after:inset-0')).toBe(true)
    expect(rows.eq(0).hasClass('cursor-pointer')).toBe(true)
    expect(rows.eq(0).hasClass('hover:bg-base-200')).toBe(true)
    expect(rows.eq(2).hasClass('hover:bg-base-200')).toBe(true)
  })

  test('marks this record as the page, with no link and no hover on its row', async () => {
    const { $ } = await viewPage()
    const row = $(
      '[data-testid="application-series-table"] [data-testid="application-series-row"]'
    ).eq(1)
    const current = row.find('[data-testid="application-series-current"]')

    expect(row.attr('class')).toBeUndefined()
    expect(row.find('a')).toHaveLength(0)
    expect(current.attr('aria-current')).toBe('page')
    expect(current.hasClass('font-semibold')).toBe(true)
    expect(flatten(current.text())).toBe('a7c-2f1-9e4, replaced')
  })

  test('speaks replaced in the link, and hides the badge, as the lists do', async () => {
    const { $ } = await viewPage()
    const first = $(
      '[data-testid="application-series-table"] [data-testid="application-series-row"]'
    ).first()

    expect(
      flatten(first.find('[data-testid="application-series-link"]').text())
    ).toBe('9d3-5b1-e08, replaced')
    expect(
      first
        .find('[data-testid="application-series-replaced"]')
        .attr('aria-hidden')
    ).toBe('true')
  })

  test('draws the same rows as a list for a phone, as the lists do', async () => {
    const { $ } = await viewPage()
    const items = part($, 'application-series-list').find(
      '[data-testid="application-series-item"]'
    )

    expect(part($, 'application-series-list').hasClass('sm:hidden')).toBe(true)
    expect(
      part($, 'application-series-table').parent().hasClass('hidden')
    ).toBe(true)
    expect(
      part($, 'application-series-table').parent().hasClass('sm:block')
    ).toBe(true)
    expect(items).toHaveLength(3)
    expect(items.eq(0).hasClass('hover:bg-base-200')).toBe(true)
    expect(items.eq(1).attr('class')).toBe('list-row')
    expect(items.eq(1).find('[aria-current="page"]')).toHaveLength(1)
  })

  test('shows each status as text alone, speaking the whole position', async () => {
    const { $ } = await viewPage()
    const status = part($, 'application-series-status').first()

    expect(part($, 'application-series').find('.status')).toHaveLength(0)
    expect(status.find('[aria-hidden="true"]').text()).toBe('Withdrawn')
    expect(status.find('.sr-only').text()).toBe(
      'Pre award › Assessment › Withdrawn'
    )
  })

  test('lifts nothing in a row over its link, so a click anywhere opens it', async () => {
    givenCase()

    const { $ } = await viewPage(casePath)

    for (const item of [
      ...part($, 'case-series-row').toArray(),
      ...part($, 'case-series-item').toArray()
    ]) {
      expect(liftedOver($, $(item))).toEqual([])
    }
  })

  test("draws each time with the lists' own cell, and one that is not an instant as stored", async () => {
    const { $ } = await viewPage()
    const created = part($, 'application-series-created-at')

    expect(created.eq(0).is('time')).toBe(true)
    expect(created.eq(0).attr('datetime')).toBe('2026-09-20T08:01:02Z')
    expect(created.eq(0).attr('title')).toBe('20 Sep 2026 09:01:02.000')
    expect(
      part($, 'application-series-created-clock').eq(0).attr('aria-hidden')
    ).toBe('true')
    expect(created.eq(2).is('time')).toBe(false)
    expect(flatten(created.eq(2).text())).toBe('29/09/2026')
    expect(part($, 'application-series-created-clock')).toHaveLength(2)
    expect(
      part($, 'application-series')
        .find('[data-testid$="-created-at"]')
        .closest('td')
        .attr('class')
    ).toBe('whitespace-nowrap text-right')
  })

  test.each([
    ['no series', null],
    [
      'a series of one',
      { latestRef: 'a7c-2f1-9e4', refs: ['a7c-2f1-9e4'], members: [] }
    ]
  ])('draws no card for %s', async (_, series) => {
    givenPage({ overview: { ...overview, series } })

    const { $ } = await viewPage()

    expect(part($, 'application-series')).toHaveLength(0)
    expect(part($, 'application-overview')).toHaveLength(1)
  })

  test('lists the refs and replaced markers alone when GAS sent no members', async () => {
    givenPage({
      overview: {
        ...overview,
        series: {
          latestRef: 'a7c-2f1-9e4',
          refs: ['9d3-5b1-e08', 'a7c-2f1-9e4']
        }
      }
    })

    const { $ } = await viewPage()

    expect(
      part($, 'application-series')
        .find('th')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    ).toEqual(['Reference'])
    expect(seriesRows($)).toEqual(['9d3-5b1-e08 replaced', 'a7c-2f1-9e4'])
  })

  test('keeps the row of a member GAS sent nothing for, with nothing known of it', async () => {
    givenPage({
      overview: {
        ...overview,
        series: {
          ...overview.series!,
          members: overview.series!.members!.slice(1)
        }
      }
    })

    const { $ } = await viewPage()

    expect(seriesRows($)).toEqual([
      '9d3-5b1-e08 replaced | — | —',
      'a7c-2f1-9e4 replaced | In review | 8d ago 22 Sep 10:14',
      'c41-8e2-7d0 | — | 29/09/2026'
    ])
  })

  test('is on the Overview tab alone', async () => {
    givenPage({ events: { rows: [], more: false } })

    const { $ } = await viewPage(`${path}?tab=events`)

    expect(part($, 'application-series')).toHaveLength(0)
  })

  test("gives a case's members a Closed column", async () => {
    givenCase()

    const { $ } = await viewPage(casePath)

    expect(
      part($, 'case-series')
        .find('th')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    ).toEqual(['Reference', 'Status', 'Closed', 'Created'])
    expect(seriesRows($, 'case')).toEqual([
      '9d3-5b1-e08 replaced | Closed | 34d ago 27 Aug 13:00 | 41d ago 20 Aug 11:00',
      'f02-7d8-a61 | Active | — | 34d ago 27 Aug 13:31'
    ])
    expect(part($, 'case-series-link').first().attr('href')).toBe(
      '/dev-ops/cases/woodland/9d3-5b1-e08'
    )
  })
})

describe('the Events tab', () => {
  const event = {
    service: 'gas' as const,
    box: 'inbox' as const,
    id: '665f1c2e9a1b2c3d4e5f6a7b',
    eventId: 'f95b057cf7865370c10fca61',
    type: 'ApplicationCreated',
    status: 'COMPLETED',
    statusLabel: 'Completed',
    statusRole: 'success' as const,
    statusRetrying: false,
    createdAt: '2026-09-22T09:14:37.000Z',
    latency: null,
    latencyTitle: 'Received to completed'
  }

  test('reads the Events tab of the application', async () => {
    givenPage({ overview: undefined, events: { rows: [event], more: false } })

    await viewPage(`${path}?tab=events`)

    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      expect.anything(),
      'events'
    )
  })

  test.each(recordTypes)(
    'draws the $itemId rows as the events list does',
    async ({ itemId, path: recordPath, given }) => {
      given({ overview: undefined, events: { rows: [event], more: false } })

      const { $ } = await viewPage(`${recordPath}?tab=events`)

      expect(
        part($, `${itemId}-events`).find('[data-testid="event-row"]')
      ).toHaveLength(1)
      expect(part($, 'event-link').attr('href')).toBe(
        `/dev-ops/events/gas/inbox/665f1c2e9a1b2c3d4e5f6a7b?back=${encodeURIComponent(`${recordPath}?tab=events`)}`
      )
      expect(part($, `${itemId}-events-more`)).toHaveLength(0)
      expect(
        part($, `${itemId}-events-table`)
          .find('thead th')
          .toArray()
          .map((th) => $(th).text())
      ).toEqual(['Event', 'Status', 'Created'])
      expect(part($, 'event-box')).toHaveLength(0)
      expect(
        part($, `${itemId}-events-table`)
          .find('colgroup col')
          .toArray()
          .map((col) => $(col).attr('class') ?? '')
      ).toEqual(['', 'w-[20%] xl:w-[18%]', 'w-[17%] xl:w-[13%]'])
      expect(part($, 'event-service')).toHaveLength(0)
      expect(part($, 'event-row').find('td')).toHaveLength(3)
    }
  )

  test('says so, with no link, when there are more than it shows', async () => {
    givenPage({ overview: undefined, events: { rows: [event], more: true } })

    const { $ } = await viewPage(`${path}?tab=events`)

    expect(textOf($, 'application-events-more')).toBe(
      'Showing the newest 50 from each GAS queue.'
    )
    expect(part($, 'application-events-more').find('a')).toHaveLength(0)
  })

  test('sends an event back to this tab, and on to the list the record was opened from', async () => {
    givenPage({ overview: undefined, events: { rows: [event], more: false } })

    const list = '/dev-ops/applications?grant=frps-private-beta'
    const tab = `${path}?tab=events&back=${encodeURIComponent(list)}`
    const { $ } = await viewPage(tab)

    expect(
      new URL(part($, 'event-link').attr('href')!, 'http://x').searchParams.get(
        'back'
      )
    ).toBe(tab)
  })

  test.each(recordTypes)(
    'draws nothing under the $itemId table but the table',
    async ({ itemId, path: recordPath, given }) => {
      given({ overview: undefined, events: { rows: [event], more: false } })

      const { $ } = await viewPage(`${recordPath}?tab=events`)

      expect(
        $(`[data-testid^="${itemId}-events-"]`)
          .toArray()
          .map((node) => $(node).attr('data-testid'))
      ).toEqual([`${itemId}-events-table`])
      expect($('body').text()).not.toMatch(/Application events|Case events/)
    }
  )

  test('says which event sources were missed', async () => {
    givenPage({
      overview: undefined,
      events: { rows: [event], more: false },
      sourceErrors: [{ hop: 'CW Inbox' }],
      header: { ...header, counterpart: { exists: false } }
    })

    const { $ } = await viewPage(`${path}?tab=events`)

    expect(textOf($, 'application-events-partial')).toBe(
      'Some event sources are unavailable: CW Inbox. Showing the rest.'
    )
  })

  test('says when there are no events', async () => {
    givenPage({ overview: undefined, events: { rows: [], more: false } })

    const { $ } = await viewPage(`${path}?tab=events`)

    expect(textOf($, 'application-events-empty')).toBe('No events found.')
  })

  test('says so when the events could not be read', async () => {
    givenPage({
      overview: undefined,
      events: null,
      sectionErrors: [
        { section: 'events', message: 'Events could not be loaded' }
      ]
    })

    const { $ } = await viewPage(`${path}?tab=events`)

    expect(textOf($, 'application-section-error')).toBe(
      'Events could not be loaded'
    )
  })
})

describe('a tab the source sent nothing for', () => {
  test.each(
    recordTypes.flatMap((type) =>
      ['', '?tab=events', '?tab=raw'].map((query) => ({
        ...type,
        url: `${type.path}${query}`
      }))
    )
  )(
    'says $source sent nothing on $url, rather than drawing a blank tab',
    async ({ itemId, url, source, given }) => {
      given({ overview: null, events: null, raw: null })

      const { $ } = await viewPage(url)

      expect(textOf($, `${itemId}-no-data`)).toBe(
        `${source} returned no data for this tab`
      )
      expect(part($, `${itemId}-no-data`).hasClass('alert')).toBe(true)
    }
  )
})

describe('the Raw tab', () => {
  test('shows the whole stored document in the folding viewer', async () => {
    givenPage({
      overview: undefined,
      raw: { clientRef: 'a7c-2f1-9e4', answers: { parcels: [1, 2] } },
      storedBytes: 2458
    })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(part($, 'application-raw').attr('aria-label')).toBe(
      'Application document'
    )
    expect(
      part($, 'application-raw-line')
        .toArray()
        .map((line) => $(line).find('code').text())
    ).toEqual(
      JSON.stringify(
        { clientRef: 'a7c-2f1-9e4', answers: { parcels: [1, 2] } },
        null,
        2
      ).split('\n')
    )
  })

  test.each(recordTypes)(
    'says the $itemId document is too large to show',
    async ({ itemId, path: recordPath, given }) => {
      given({
        overview: undefined,
        raw: null,
        storedBytes: 2_000_000,
        sectionErrors: [{ section: 'raw', message: 'too large to show' }]
      })

      const { $ } = await viewPage(`${recordPath}?tab=raw`)

      expect(textOf($, `${itemId}-raw-too-large`)).toBe('Too large to show')
      expect(part($, `${itemId}-raw`)).toHaveLength(0)
      expect(part($, `${itemId}-section-error`)).toHaveLength(0)
    }
  )

  test('says the document could not be read, rather than too large, on any other failure', async () => {
    givenPage({
      overview: undefined,
      raw: null,
      storedBytes: null,
      sectionErrors: [{ section: 'raw', message: 'Raw could not be loaded' }]
    })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(textOf($, 'application-section-error')).toBe(
      'Raw could not be loaded'
    )
    expect(part($, 'application-raw-too-large')).toHaveLength(0)
  })
})

describe('a tab whose document is too large to show', () => {
  test('says so in a warning, not as an error or as no data', async () => {
    givenPage({
      overview: null,
      sectionErrors: [{ section: 'overview', message: 'too large to show' }]
    })

    const { $ } = await viewPage()

    expect(textOf($, 'application-too-large')).toBe('Too large to show')
    expect(part($, 'application-too-large').hasClass('alert-warning')).toBe(
      true
    )
    expect(part($, 'application-section-error')).toHaveLength(0)
    expect(part($, 'application-no-data')).toHaveLength(0)
  })
})

describe('the case page', () => {
  beforeEach(() => {
    givenCase()
  })

  test('reads the case in the URL and heads the page with it', async () => {
    const { statusCode, $ } = await viewPage(casePath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getCasePageUseCase).toHaveBeenCalledWith(
      { workflowCode: 'woodland', caseRef: 'f02-7d8-a61' },
      'overview'
    )
    expect(textOf($, 'case-title')).toBe('Case f02-7d8-a61')
    expect(textOf($, 'case-position')).toBe(
      'Post agreement, Monitoring, Active'
    )
    expect(textOf($, 'case-back')).toBe('Back to cases')
    expect(part($, 'case-back').attr('href')).toBe('/dev-ops/events/gas/outbox')
  })

  test('links to the application as the second fact when it exists', async () => {
    const { $ } = await viewPage(casePath)

    expect(textOf($, 'case-fact-application')).toBe(
      'Application View application (opens in a new tab)'
    )
    expect(part($, 'case-application').attr('href')).toBe(
      '/dev-ops/applications/woodland/f02-7d8-a61'
    )
    expect(part($, 'case-header').find('a, nav')).toHaveLength(0)
  })

  test('shows no warning and no Application fact while GAS cannot say whether the application exists', async () => {
    givenCase({ header: { ...caseHeader, counterpart: null } })

    const { $ } = await viewPage(casePath)

    expect($('[role="alert"]')).toHaveLength(0)
    expect(part($, 'case-fact-application')).toHaveLength(0)
  })

  test('leaves the Application fact out when the application does not exist', async () => {
    givenCase({ header: { ...caseHeader, counterpart: { exists: false } } })

    const { $ } = await viewPage(casePath)

    expect(part($, 'case-fact-application')).toHaveLength(0)
  })

  test('names every missed source', async () => {
    givenCase({
      overview: undefined,
      events: { rows: [], more: false },
      sourceErrors: [{ hop: 'GAS Applications' }, { hop: 'GAS Inbox' }]
    })

    const { $ } = await viewPage(`${casePath}?tab=events`)

    expect(textOf($, 'case-events-partial')).toBe(
      'Some event sources are unavailable: GAS Applications, GAS Inbox. Showing the rest.'
    )
  })

  test('lists Workflow, Application, Created, Closed at and Size', async () => {
    const { $ } = await viewPage(casePath)

    expect(
      part($, 'case-facts')
        .find('dt')
        .toArray()
        .map((label) => flatten($(label).text()))
    ).toEqual(['Workflow', 'Application', 'Created', 'Closed at', 'Size'])
    expect(textOf($, 'case-fact-workflow')).toBe(
      'Workflow woodland@1.4.2 from 1.3.5'
    )
    expect(textOf($, 'case-closed-at')).toBe('—')
    expect(textOf($, 'case-size')).toBe('4 KiB')
  })

  test('links the workflow to its version page, which leads back here', async () => {
    const from = '/dev-ops/cases?workflow=woodland'
    const { $ } = await viewPage(`${casePath}?back=${encodeURIComponent(from)}`)

    const link = part($, 'case-workflow')
    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(
      `/dev-ops/workflows/woodland/1.4.2?back=${encodeURIComponent(`${casePath}?back=${encodeURIComponent(from)}`)}`
    )
    expect(link.attr('class')).toContain('link')
    expect(link.attr('target')).toBeUndefined()
    expect(textOf($, 'case-workflow-from')).toBe('from 1.3.5')
  })

  test('leaves the workflow unlinked when it has no version', async () => {
    givenCase({ overview: { ...caseOverview, currentConfigVersion: null } })

    const { $ } = await viewPage(casePath)

    expect(part($, 'case-workflow').is('span')).toBe(true)
    expect(textOf($, 'case-workflow')).toBe('woodland')
  })

  test('shows the stored closing date of a case not marked closed', async () => {
    givenCase({
      overview: { ...caseOverview, closedAt: '2026-09-29T15:02:44.000Z' }
    })

    const { $ } = await viewPage(casePath)

    expect(textOf($, 'case-closed-at')).toBe('29 Sep 2026 16:02:44.000')
  })

  test('says when a closed case closed', async () => {
    givenCase({
      overview: {
        ...caseOverview,
        closed: true,
        closedAt: '2026-09-29T15:02:44.000Z'
      }
    })

    const { $ } = await viewPage(casePath)

    expect(textOf($, 'case-closed-at')).toBe('29 Sep 2026 16:02:44.000')
  })

  test('shows the stored case in the viewer on Raw', async () => {
    givenCase({
      overview: undefined,
      raw: { caseRef: 'f02-7d8-a61' },
      storedBytes: 30
    })

    const { $ } = await viewPage(`${casePath}?tab=raw`)

    expect(part($, 'case-raw').attr('aria-label')).toBe('Case document')
    expect(part($, 'case-raw-line').eq(1).find('code').text()).toBe(
      '  "caseRef": "f02-7d8-a61"'
    )
  })

  test("answers GPA's own 404 page for a case CW does not have", async () => {
    vi.mocked(getCasePageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { statusCode, $ } = await viewPage(casePath)

    expect(statusCode).toBe(statusCodes.notFound)
    expect($('body').text()).toContain('Page not found')
  })

  test('says CW timed out rather than drawing a partial case', async () => {
    vi.mocked(getCasePageUseCase).mockResolvedValue({
      outcome: 'timed-out',
      page: null
    })

    const { $ } = await viewPage(casePath)

    expect(textOf($, 'case-error')).toBe(
      'This case could not be loaded: CW timed out waiting for it. Refresh to try again.'
    )
    expect(textOf($, 'case-title')).toBe('Case f02-7d8-a61')
    expect(part($, 'case-tabs')).toHaveLength(0)
  })

  test('is never stored', async () => {
    const { headers } = await viewPage(casePath)

    expect(headers['cache-control']).toBe('no-store')
  })
})

const grantPath = '/dev-ops/grants/woodland-creation/1.2.0'

const fetched = { stored: true, fetchStatus: 'fetched' } as const
const pending = { stored: false, fetchStatus: 'pending' } as const

const grantHeader: GrantVersionPage['header'] = {
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-09-10T15:25:00.000Z',
  files: { grant: fetched, agreement: fetched, payment: fetched },
  versions: [
    {
      version: '2.0.0',
      status: 'draft',
      receivedAt: '2026-09-15T09:04:00.000Z'
    },
    {
      version: '1.2.0',
      status: 'active',
      receivedAt: '2026-09-10T15:25:00.000Z'
    }
  ],
  counterpart: { exists: true }
}

const grantOverview: NonNullable<GrantVersionPage['overview']> = {
  description: 'Funding to plant new woodland on agricultural land.',
  startDate: '2026-04-01T00:00:00.000Z',
  adminRole: 'Grants.Example.Admin',
  storedBytes: 10035
}

const grantDefinition = {
  code: 'woodland-creation',
  version: '1.2.0',
  metadata: { description: 'Funding to plant new woodland.' },
  actions: [
    {
      name: 'parcels',
      method: 'GET',
      url: 'https://land-data.example/api/v2/parcels'
    }
  ]
}

const givenGrant = (overrides: Partial<GrantVersionPage> = {}) =>
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header: grantHeader,
      overview: grantOverview,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const nothingStored = {
  ...grantHeader,
  status: 'draft',
  files: { grant: pending, agreement: pending, payment: pending }
} as const

describe('the grant page', () => {
  beforeEach(() => {
    givenGrant()
  })

  test('reads the Overview tab of the grant version in the URL', async () => {
    const { statusCode } = await viewPage(grantPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'overview'
    )
  })

  test('heads the page with Grant and the code in mono', async () => {
    const { $ } = await viewPage(grantPath)

    expect(textOf($, 'grant-title')).toBe('Grant woodland-creation')
    expect(part($, 'grant-ref').attr('class')).toContain('font-mono')
    expect($('title').text()).toContain('Grant woodland-creation')
  })

  test('shows the status, then the version switcher, under the title', async () => {
    const { $ } = await viewPage(grantPath)
    const line = part($, 'grant-version')

    expect(
      line.children().first().find('[data-testid="do-status-label"]').text()
    ).toBe('Active')
    expect(
      line
        .children()
        .first()
        .find('[data-testid="do-status-dot"]')
        .attr('class')
    ).toBe('status status-success')
    expect(flatten(part($, 'grant-switcher-button').text())).toBe(
      'Version: 1.2.0'
    )
  })

  test('shows a draft as such', async () => {
    givenGrant({ header: { ...grantHeader, status: 'draft' } })

    const { $ } = await viewPage(grantPath)

    expect(
      part($, 'grant-version')
        .find('[data-testid="do-status-label"]')
        .first()
        .text()
    ).toBe('Draft')
  })

  test('switches version on a small plain trigger, never the active-filter one', async () => {
    const { $ } = await viewPage(grantPath)
    const button = part($, 'grant-switcher-button')

    expect(button.hasClass('btn-sm')).toBe(true)
    expect(button.hasClass('font-semibold')).toBe(false)
    expect(button.attr('popovertarget')).toBe('grant-switcher-panel')
  })

  test('lists every version newest first, with its status and when it was received, ticking this one', async () => {
    const { $ } = await viewPage(grantPath)
    const chips = part($, 'grant-switcher-chip').toArray()

    expect(
      chips.map((chip) =>
        $(chip)
          .children('span')
          .toArray()
          .map((piece) => flatten($(piece).text()))
      )
    ).toEqual([
      ['2.0.0', 'Draft', '15 Sep 10:04'],
      ['1.2.0', 'Active', '10 Sep 16:25']
    ])
    expect(chips.map((chip) => $(chip).attr('aria-current'))).toEqual([
      undefined,
      'page'
    ])
  })

  test('opens another version on the same tab, still going back to the list', async () => {
    const from = '/dev-ops/grants?status=draft'
    const { $ } = await viewPage(
      `${grantPath}?tab=raw&back=${encodeURIComponent(from)}`
    )

    expect(
      part($, 'grant-switcher-chip')
        .toArray()
        .map((chip) => $(chip).attr('href'))
    ).toEqual([
      `/dev-ops/grants/woodland-creation/2.0.0?tab=raw&back=${encodeURIComponent(from)}`,
      `/dev-ops/grants/woodland-creation/1.2.0?tab=raw&back=${encodeURIComponent(from)}`
    ])
  })

  test('offers Overview, Questions, Actions, Agreement, Payment, Events and Raw, keeping the list it was opened from', async () => {
    const from = '/dev-ops/grants'
    const { $ } = await viewPage(
      `${grantPath}?tab=raw&back=${encodeURIComponent(from)}`
    )

    expect(
      part($, 'grant-tab')
        .toArray()
        .map((tab) => `${$(tab).text()} ${$(tab).attr('href')}`)
    ).toEqual([
      `Overview ${grantPath}?back=${encodeURIComponent(from)}`,
      `Questions ${grantPath}?tab=questions&back=${encodeURIComponent(from)}`,
      `Actions ${grantPath}?tab=actions&back=${encodeURIComponent(from)}`,
      `Agreement ${grantPath}?tab=agreement&back=${encodeURIComponent(from)}`,
      `Payment ${grantPath}?tab=payment&back=${encodeURIComponent(from)}`,
      `Events ${grantPath}?tab=events&back=${encodeURIComponent(from)}`,
      `Raw ${grantPath}?tab=raw&back=${encodeURIComponent(from)}`
    ])
    expect(part($, 'grant-tabs').find('[aria-current="page"]').text()).toBe(
      'Raw'
    )
  })

  test('goes back to the grants list, and sits under it in the navigation', async () => {
    const from = '/dev-ops/grants?grant=woodland-creation'
    const { $ } = await viewPage(
      `${grantPath}?back=${encodeURIComponent(from)}`
    )

    expect(part($, 'grant-back').attr('href')).toBe(from)
    expect(textOf($, 'grant-back')).toBe('Back to grants')
    expect(
      $('[data-testid="do-nav"] [aria-current="page"]').text().trim()
    ).toBe('Grants')
  })

  test('refuses a tab it does not have', async () => {
    const { statusCode } = await viewPage(`${grantPath}?tab=answers`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test.each([
    ['a version with no patch', '/dev-ops/grants/woodland-creation/1.2'],
    ['a code with capitals', '/dev-ops/grants/Woodland/1.2.0']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('opens Overview in place of a tab for a file the version has not got', async () => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({
      outcome: 'hidden',
      page: null
    })

    const { statusCode, headers } = await viewPage(
      `${grantPath}?tab=raw&back=%2Fdev-ops%2Fgrants`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(`${grantPath}?back=%2Fdev-ops%2Fgrants`)
  })

  test("answers GPA's own 404 page for a version GAS does not have", async () => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { statusCode } = await viewPage(grantPath)

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test.each([
    ['unavailable', 'This grant could not be loaded from GAS.'],
    [
      'timed-out',
      'This grant could not be loaded: GAS timed out waiting for it. Refresh to try again.'
    ]
  ] as const)('names the code when GAS is %s', async (outcome, message) => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({ outcome, page: null })

    const { statusCode, $ } = await viewPage(grantPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'grant-error')).toBe(message)
    expect(textOf($, 'grant-title')).toBe('Grant woodland-creation')
    expect(part($, 'grant-version')).toHaveLength(0)
    expect(part($, 'grant-tabs')).toHaveLength(0)
  })

  test('is never stored', async () => {
    const { headers } = await viewPage(grantPath)

    expect(headers['cache-control']).toBe('no-store')
  })
})

describe('the not-stored banner', () => {
  test('is absent while every file is stored', async () => {
    givenGrant()

    const { $ } = await viewPage(grantPath)

    expect(part($, 'grant-banner')).toHaveLength(0)
  })

  test('names every file not stored, above the tabs, on every tab', async () => {
    givenGrant({ header: nothingStored, overview: null, definition: null })

    for (const query of ['', '?tab=raw']) {
      const { $ } = await viewPage(`${grantPath}${query}`)
      const banner = part($, 'grant-banner')

      expect(flatten(banner.children('span').text())).toBe(
        'Grant, agreement and payment definitions not stored.'
      )
      expect(banner.attr('role')).toBe('status')
      expect(banner.find('[data-testid="do-icon-info"]')).toHaveLength(1)
      expect(banner.next().attr('data-testid')).toBe('grant-tabs')
    }
  })

  test("says GAS won't use the version when a file not stored has failed for good", async () => {
    givenGrant({
      header: {
        ...grantHeader,
        files: {
          grant: fetched,
          payment: { stored: false, fetchStatus: 'permanent_error' }
        }
      }
    })

    const { $ } = await viewPage(grantPath)

    expect(flatten(part($, 'grant-banner').children('span').text())).toBe(
      "Payment definition not stored. GAS won't use this version."
    )
  })

  test('offers Fetch definitions, posting back to the same tab and list', async () => {
    const from = '/dev-ops/grants?status=draft'
    givenGrant({ header: nothingStored, definition: null })

    const { $ } = await viewPage(
      `${grantPath}?tab=raw&back=${encodeURIComponent(from)}`
    )
    const form = part($, 'grant-banner').find('form')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${grantPath}/fetch`)
    expect(
      form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([
      ['back', from],
      ['tab', 'raw']
    ])
    expect(textOf($, 'grant-fetch')).toBe('Fetch definitions')
    expect(part($, 'grant-fetch').attr('class')).toBe('btn btn-sm')
    expect(part($, 'grant-fetch').attr('type')).toBe('submit')
  })
})

describe('the grant Overview tab', () => {
  test('lists the definition facts on the left and the links out on the right', async () => {
    givenGrant()

    const { $ } = await viewPage(grantPath)

    expect(
      part($, 'grant-facts')
        .find('dl')
        .toArray()
        .map((column) =>
          $(column)
            .find('dt')
            .toArray()
            .map((label) => $(label).text())
        )
    ).toEqual([
      ['Description', 'Start date', 'Received', 'Admin role'],
      ['Workflow', 'Applications', 'Who can apply', 'Versions', 'Size']
    ])
    expect(textOf($, 'grant-description')).toBe(
      'Funding to plant new woodland on agricultural land.'
    )
    expect(textOf($, 'grant-start-date')).toBe('1 Apr 2026 01:00:00.000')
    expect(part($, 'grant-received').attr('datetime')).toBe(
      '2026-09-10T15:25:00Z'
    )
    expect(textOf($, 'grant-admin-role')).toBe('Grants.Example.Admin')
    expect(part($, 'grant-admin-role').attr('class')).toContain('font-mono')
    expect(textOf($, 'grant-versions')).toBe('2')
    expect(textOf($, 'grant-size')).toBe('9.8 KiB')
  })

  test('links to the workflow of the same code and version, in a new tab', async () => {
    givenGrant()

    const { $ } = await viewPage(grantPath)
    const link = part($, 'grant-workflow')

    expect(link.attr('href')).toBe('/dev-ops/workflows/woodland-creation/1.2.0')
    expect(link.attr('target')).toBe('_blank')
    expect(flatten(link.text())).toBe('View workflow (opens in a new tab)')
  })

  test('says None when CW has no workflow of that version', async () => {
    givenGrant({ header: { ...grantHeader, counterpart: { exists: false } } })

    const { $ } = await viewPage(grantPath)

    expect(textOf($, 'grant-workflow')).toBe('None')
    expect(part($, 'grant-workflow').attr('href')).toBeUndefined()
  })

  test('leaves the Workflow fact out when CW could not say', async () => {
    givenGrant({ header: { ...grantHeader, counterpart: null } })

    const { $ } = await viewPage(grantPath)

    expect(part($, 'grant-fact-workflow')).toHaveLength(0)
    expect(part($, 'grant-fact-applications')).toHaveLength(1)
  })

  test("links to the applications on this version, as the catalogue spells the list's filters", async () => {
    givenGrant()

    const { $ } = await viewPage(grantPath)

    expect(part($, 'grant-applications').attr('href')).toBe(
      '/dev-ops/applications?grant=woodland-creation&version=1.2.0'
    )
    expect(textOf($, 'grant-applications')).toBe(
      'View applications (opens in a new tab)'
    )
  })

  test.each([
    [
      'does not filter applications by version',
      {
        ...catalogue,
        buckets: [
          {
            ...applicationsBucket,
            facts: applicationsBucket.facts.filter(
              ({ name }) => name !== 'currentConfigVersion'
            )
          }
        ]
      }
    ],
    ['has no applications list', { ...catalogue, buckets: [] }],
    ['could not be read', null]
  ])(
    'reads a dash for Applications when the catalogue %s',
    async (_, answer) => {
      givenGrant()
      vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(answer)

      const { $ } = await viewPage(grantPath)

      expect(textOf($, 'grant-applications')).toBe('—')
      expect(part($, 'grant-applications').attr('href')).toBeUndefined()
    }
  )

  test('opens the allow list on its Who can apply tab', async () => {
    givenGrant()

    const { $ } = await viewPage(grantPath)

    expect(part($, 'grant-who-can-apply').attr('href')).toBe(
      '/grant-ops/grants/woodland-creation/admin#who-can-apply'
    )
    expect(textOf($, 'grant-who-can-apply')).toBe(
      'Allow list (opens in a new tab)'
    )
  })

  test('shows the version facts, and a dash for each definition fact, while nothing is stored', async () => {
    givenGrant({
      header: nothingStored,
      overview: {
        description: null,
        startDate: null,
        adminRole: null,
        storedBytes: null
      }
    })

    const { $ } = await viewPage(grantPath)

    expect(part($, 'grant-not-stored')).toHaveLength(0)
    expect(
      ['description', 'start-date', 'admin-role', 'size'].map((id) =>
        textOf($, `grant-${id}`)
      )
    ).toEqual(['—', '—', '—', '—'])
    expect(part($, 'grant-received').attr('datetime')).toBe(
      '2026-09-10T15:25:00Z'
    )
    expect(
      ['workflow', 'applications', 'who-can-apply'].map((id) =>
        part($, `grant-${id}`).attr('href')
      )
    ).toEqual([
      '/dev-ops/workflows/woodland-creation/1.2.0',
      '/dev-ops/applications?grant=woodland-creation&version=1.2.0',
      '/grant-ops/grants/woodland-creation/admin#who-can-apply'
    ])
  })

  test('says the overview could not be read in place of the facts', async () => {
    givenGrant({
      overview: null,
      sectionErrors: [
        { section: 'overview', message: 'Overview could not be loaded' }
      ]
    })

    const { $ } = await viewPage(grantPath)

    expect(textOf($, 'grant-section-error')).toBe(
      'Overview could not be loaded'
    )
    expect(part($, 'grant-facts')).toHaveLength(0)
  })
})

describe('the grant Raw tab', () => {
  test('reads the stored definition', async () => {
    givenGrant({ overview: undefined, definition: grantDefinition })

    await viewPage(`${grantPath}?tab=raw`)

    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'raw'
    )
  })

  test('shows the whole stored grant document in the folding viewer', async () => {
    givenGrant({ overview: undefined, definition: grantDefinition })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(part($, 'grant-raw').attr('aria-label')).toBe('Grant document')
    expect(
      part($, 'grant-raw-line')
        .toArray()
        .map((line) => $(line).find('code').text())
    ).toEqual(JSON.stringify(grantDefinition, null, 2).split('\n'))
  })

  test('is offered on a version with no agreement or payment file', async () => {
    givenGrant({
      header: { ...grantHeader, files: { grant: fetched } },
      overview: undefined,
      definition: grantDefinition
    })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(part($, 'grant-tab').last().text()).toBe('Raw')
    expect(part($, 'grant-raw')).toHaveLength(1)
  })

  test('says the grant definition is not stored, and nothing else', async () => {
    givenGrant({ header: nothingStored, overview: undefined, definition: null })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(textOf($, 'grant-not-stored')).toBe('Grant definition not stored.')
    expect(part($, 'grant-raw')).toHaveLength(0)
    expect(part($, 'grant-raw-too-large')).toHaveLength(0)
    expect(part($, 'grant-section-error')).toHaveLength(0)
    expect(part($, 'grant-no-data')).toHaveLength(0)
  })

  test("says a stored document over GAS's cap is too large to show", async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [{ section: 'definition', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(textOf($, 'grant-raw-too-large')).toBe('Too large to show')
    expect(part($, 'grant-raw')).toHaveLength(0)
    expect(part($, 'grant-section-error')).toHaveLength(0)
    expect(part($, 'grant-too-large')).toHaveLength(0)
  })

  test('takes too large only from the definition read', async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(part($, 'grant-raw-too-large')).toHaveLength(0)
    expect(textOf($, 'grant-no-data')).toBe('GAS returned no data for this tab')
  })

  test('says the definition could not be read on any other failure', async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(`${grantPath}?tab=raw`)

    expect(textOf($, 'grant-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(part($, 'grant-raw-too-large')).toHaveLength(0)
  })
})

describe('the grant Questions tab', () => {
  const questionsPath = `${grantPath}?tab=questions`

  const preAward = {
    type: 'object',
    additionalProperties: false,
    required: ['hectares'],
    properties: {
      hectares: { type: 'number', title: 'Area to plant (ha)', minimum: 0.5 },
      hasWoodlandPlan: { type: 'boolean', default: false }
    }
  }

  const givenPhases = (...phases: unknown[]) => {
    const definition = { ...grantDefinition, phases }

    givenGrant({ overview: undefined, definition })
  }

  const cards = ($: CheerioAPI) => part($, 'grant-questions-phase')

  test('sits after Overview and before Raw, and reads the stored definition', async () => {
    givenPhases({ code: 'PRE_AWARD', questions: preAward })

    const { $ } = await viewPage(questionsPath)

    expect(
      part($, 'grant-tab')
        .toArray()
        .map((tab) => $(tab).text())
    ).toEqual([
      'Overview',
      'Questions',
      'Actions',
      'Agreement',
      'Payment',
      'Events',
      'Raw'
    ])
    expect(part($, 'grant-tabs').find('[aria-current="page"]').text()).toBe(
      'Questions'
    )
    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'questions'
    )
  })

  test('gives each phase with questions a card titled by its code, badging every phase after the first', async () => {
    givenPhases(
      { code: 'PRE_AWARD', questions: preAward },
      { code: 'POST_AWARD', questions: { type: 'object', properties: {} } },
      { code: 'CLAIM' }
    )

    const { $ } = await viewPage(questionsPath)
    const titles = cards($).find('h2')

    expect(titles.toArray().map((title) => flatten($(title).text()))).toEqual([
      'PRE_AWARD',
      'POST_AWARD Not used by GAS'
    ])
    expect(titles.first().find('.font-mono').text()).toBe('PRE_AWARD')
    expect(titles.first().find('[data-testid="do-status-badge"]')).toHaveLength(
      0
    )
    expect(
      titles.eq(1).find('[data-testid="do-status-dot"]').attr('class')
    ).toBe('status bg-base-content/80')
  })

  test('draws the schema tree of a phase', async () => {
    givenPhases({ code: 'PRE_AWARD', questions: preAward })

    const { $ } = await viewPage(questionsPath)

    expect(
      part($, 'grant-questions-tree-name')
        .toArray()
        .map((name) => $(name).text())
    ).toEqual(['hectares', 'hasWoodlandPlan'])
  })

  test('lists the rules that apply beyond single fields, in a scrolling table', async () => {
    givenPhases({ code: 'PRE_AWARD', questions: preAward })

    const { $ } = await viewPage(questionsPath)
    const rules = part($, 'grant-questions-rules')

    expect(rules.parent().prev('h3').text()).toBe('Rules')
    expect(rules.parent().attr('class')).toContain('w-full overflow-x-auto')
    expect(
      rules
        .find('th')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual(['Applies to', 'Rule'])
    expect(
      rules
        .find('tbody tr')
        .toArray()
        .map((row) =>
          $(row)
            .find('td')
            .toArray()
            .map((cell) => flatten($(cell).text()))
        )
    ).toEqual([
      ['(root)', 'Undeclared fields are removed on submission'],
      ['hasWoodlandPlan', 'Default false filled in when missing']
    ])
  })

  test('has no Rules heading when no rule applies', async () => {
    givenPhases({
      code: 'PRE_AWARD',
      questions: { properties: { sbi: { type: 'string' } } }
    })

    const { $ } = await viewPage(questionsPath)

    expect(cards($).find('h3')).toHaveLength(0)
    expect(part($, 'grant-questions-rules')).toHaveLength(0)
  })

  test('says a schema with no properties has none', async () => {
    givenPhases({ code: 'PRE_AWARD', questions: { type: 'object' } })

    const { $ } = await viewPage(questionsPath)

    expect(textOf($, 'grant-questions-empty')).toBe('No properties.')
    expect(part($, 'grant-questions-tree')).toHaveLength(0)
  })

  test.each([
    [
      'without questions',
      { code: 'PRE_AWARD' },
      'No questions: every submission throws.'
    ],
    [
      'whose questions reject every answer',
      { code: 'PRE_AWARD', questions: false },
      'Every answer is rejected.'
    ],
    [
      'whose questions are not a schema',
      { code: 'PRE_AWARD', questions: 'object' },
      'Questions are not a JSON Schema object.'
    ],
    ['that is not an object', 'PRE_AWARD', 'This phase is not an object.']
  ])(
    'shows an error alert for a first phase %s',
    async (_name, phase, text) => {
      givenPhases(phase)

      const { $ } = await viewPage(questionsPath)
      const alert = cards($).find('[role="alert"]')

      expect(flatten(alert.text())).toBe(text)
      expect(alert.attr('class')).toContain('alert-error')
    }
  )

  test('says questions that are true accept any answer, with no alert', async () => {
    givenPhases({ code: 'PRE_AWARD', questions: true })

    const { $ } = await viewPage(questionsPath)

    expect(textOf($, 'grant-questions-any')).toBe('Any answers accepted.')
    expect(cards($).find('[role="alert"]')).toHaveLength(0)
  })

  test('titles a phase with no code by its place, says so, and still shows its questions', async () => {
    givenPhases({ questions: preAward })

    const { $ } = await viewPage(questionsPath)

    expect(flatten(cards($).find('h2').text())).toBe('Phase 1')
    expect(flatten(cards($).find('[role="alert"]').text())).toBe(
      'This phase has no code.'
    )
    expect(part($, 'grant-questions-tree-row')).toHaveLength(2)
  })

  test('says a definition with no phases makes every submission throw', async () => {
    givenPhases()

    const { $, statusCode } = await viewPage(questionsPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'grant-questions-no-phases')).toBe(
      'The grant definition has no phases: every submission throws.'
    )
    expect(cards($)).toHaveLength(0)
  })

  test('says the grant definition is not stored, and nothing else', async () => {
    givenGrant({ header: nothingStored, overview: undefined, definition: null })

    const { $ } = await viewPage(questionsPath)

    expect(textOf($, 'grant-not-stored')).toBe('Grant definition not stored.')
    expect(cards($)).toHaveLength(0)
    expect(part($, 'grant-questions-no-phases')).toHaveLength(0)
  })

  test('says a definition over GAS cap is too large to show, in place of the tab', async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [{ section: 'definition', message: 'too large to show' }]
    })

    const { $ } = await viewPage(questionsPath)

    expect(textOf($, 'grant-too-large')).toBe('Too large to show')
    expect(cards($)).toHaveLength(0)
    expect(part($, 'grant-questions-no-phases')).toHaveLength(0)
  })

  test('says the definition could not be read, in place of the tab', async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(questionsPath)

    expect(textOf($, 'grant-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(cards($)).toHaveLength(0)
  })
})

describe('the grant Actions tab', () => {
  const actionsPath = `${grantPath}?tab=actions`

  const givenActions = (actions: GrantDefinition['actions']) =>
    givenGrant({
      overview: undefined,
      definition: { ...grantDefinition, actions }
    })

  const cellsOf = ($: CheerioAPI) =>
    part($, 'grant-action')
      .toArray()
      .map((row) =>
        $(row)
          .find('td')
          .toArray()
          .map((cell) => flatten($(cell).text()))
      )

  test('sits after Overview and before Raw, and reads the stored definition', async () => {
    givenActions(grantDefinition.actions)

    const { $ } = await viewPage(actionsPath)

    expect(
      part($, 'grant-tab')
        .toArray()
        .map((tab) => $(tab).text())
    ).toEqual([
      'Overview',
      'Questions',
      'Actions',
      'Agreement',
      'Payment',
      'Events',
      'Raw'
    ])
    expect(part($, 'grant-tabs').find('[aria-current="page"]').text()).toBe(
      'Actions'
    )
    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'actions'
    )
  })

  test('lists each declared action by name, method and URL, in order', async () => {
    givenActions([
      {
        name: 'calculate-payment',
        method: 'POST',
        url: 'https://land-data.example/api/v2/payments/calculate'
      },
      {
        name: 'parcels',
        method: 'GET',
        url: 'https://land-data.example/api/v2/parcels'
      }
    ])

    const { $ } = await viewPage(actionsPath)
    const table = part($, 'grant-actions-table')

    expect(
      table
        .find('th')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual(['Name', 'Method', 'URL'])
    expect(cellsOf($)).toEqual([
      [
        'calculate-payment',
        'POST',
        'https://land-data.example/api/v2/payments/calculate'
      ],
      ['parcels', 'GET', 'https://land-data.example/api/v2/parcels']
    ])
    expect(
      part($, 'grant-action')
        .find('td > span')
        .toArray()
        .every((cell) => $(cell).hasClass('font-mono'))
    ).toBe(true)
  })

  test('shows only the scheme, host and path of a URL', async () => {
    givenActions([
      {
        name: 'parcels',
        method: 'GET',
        url: 'https://user:secret@land-data.%ENVIRONMENT%.example/parcels/$sbi?key=x#top'
      }
    ])

    const { $ } = await viewPage(actionsPath)

    expect(cellsOf($)).toEqual([
      ['parcels', 'GET', 'https://land-data.%ENVIRONMENT%.example/parcels/$sbi']
    ])
  })

  test('escapes markup in a declared action', async () => {
    givenActions([
      { name: '<b>parcels</b>', method: 'GET', url: 'https://a.example' }
    ])

    const { $ } = await viewPage(actionsPath)

    expect(part($, 'grant-action').find('b')).toHaveLength(0)
    expect(cellsOf($)[0][0]).toBe('<b>parcels</b>')
  })

  test('wraps long values rather than scrolling the page sideways', async () => {
    givenActions(grantDefinition.actions)

    const { $ } = await viewPage(actionsPath)

    expect(part($, 'grant-actions-table').parent().attr('class')).toContain(
      'w-full overflow-x-auto'
    )
    expect(
      part($, 'grant-action').find('td > span').last().attr('class')
    ).toContain('break-words')
  })

  test('says a grant with no actions has none', async () => {
    givenActions([])

    const { $ } = await viewPage(actionsPath)

    expect(textOf($, 'grant-actions-empty')).toBe('No actions.')
    expect(part($, 'grant-actions-table')).toHaveLength(0)
  })

  test('says the grant definition is not stored, and nothing else', async () => {
    givenGrant({ header: nothingStored, overview: undefined, definition: null })

    const { $ } = await viewPage(actionsPath)

    expect(textOf($, 'grant-not-stored')).toBe('Grant definition not stored.')
    expect(part($, 'grant-actions')).toHaveLength(0)
    expect(part($, 'grant-no-data')).toHaveLength(0)
  })

  test("says a stored document over GAS's cap is too large to show", async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [{ section: 'definition', message: 'too large to show' }]
    })

    const { $ } = await viewPage(actionsPath)

    expect(textOf($, 'grant-too-large')).toBe('Too large to show')
    expect(part($, 'grant-section-error')).toHaveLength(0)
    expect(part($, 'grant-actions')).toHaveLength(0)
  })

  test('says the definition could not be read on any other failure', async () => {
    givenGrant({
      overview: undefined,
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(actionsPath)

    expect(textOf($, 'grant-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(part($, 'grant-actions')).toHaveLength(0)
  })
})

/** GAS `compose/seed/pigs-might-fly/1.0.0/gas/payment.json`. */
const pigsMightFlyPayment = {
  code: 'pigs-might-fly',
  sbi: '$.agreement.identifiers.sbi',
  frn: '$.agreement.identifiers.frn',
  originalInvoiceNumber: '',
  scheme: 'SFI',
  sourceSystem: 'FPTT',
  deliveryBody: 'RP00',
  fesCode: 'FALS_FPTT',
  ledger: 'AP',
  totalAmountPence: '$.agreement.totalAmountPence',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: {
    itemsRef: '$.agreement.paymentSchedule.instalments',
    items: {
      dueDate: '@.dueDate',
      totalAmountPence: '@.totalAmountPence',
      invoiceLines: {
        itemsRef: '@.lineItems',
        items: {
          schemeCode: 'CMOR1',
          description: 'jsonata:@.description',
          amountPence: '@.amountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP00',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      }
    }
  }
}

/** GAS `compose/seed/woodland/1.39.1/gas/payment.json`, trimmed. */
const woodlandPayment = {
  code: 'woodland',
  sbi: '$.claim.sbi',
  payments: [
    {
      dueDate: 'jsonata:$substring($.execution.executedAt, 0, 10)',
      totalAmountPence: '$.claim.totalAmountPence',
      invoiceLines: [
        {
          schemeCode: 'WMP',
          description: 'Woodland Management Plan Payment',
          amountPence: '$.claim.totalAmountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP10',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      ]
    }
  ]
}

const paymentPath = `${grantPath}?tab=payment`

const givenPayment = (payment: object | null, overrides = {}) =>
  givenGrant({ overview: undefined, payment, ...overrides })

const cellsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((row) =>
      $(row)
        .children('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    )

describe('the grant Payment tab', () => {
  test("reads GAS's payment read", async () => {
    givenPayment(pigsMightFlyPayment)

    await viewPage(paymentPath)

    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'payment'
    )
  })

  test('lists every request field with its value and kind, without code or payments', async () => {
    givenPayment(pigsMightFlyPayment)

    const { $ } = await viewPage(paymentPath)

    expect(
      textOf($, 'grant-payment-request').startsWith('Payment request')
    ).toBe(true)
    expect(cellsOf($, 'grant-payment-field')).toEqual([
      ['sbi', '$.agreement.identifiers.sbi', 'reference'],
      ['frn', '$.agreement.identifiers.frn', 'reference'],
      ['originalInvoiceNumber', '""', 'literal'],
      ['scheme', 'SFI', 'literal'],
      ['sourceSystem', 'FPTT', 'literal'],
      ['deliveryBody', 'RP00', 'literal'],
      ['fesCode', 'FALS_FPTT', 'literal'],
      ['ledger', 'AP', 'literal'],
      ['totalAmountPence', '$.agreement.totalAmountPence', 'reference'],
      ['currency', 'GBP', 'literal'],
      [
        'marketingYear',
        'jsonata:$substring($.execution.executedAt, 0, 4)',
        'expression'
      ]
    ])
  })

  test('shows the empty string muted, and every other value in mono', async () => {
    givenPayment(pigsMightFlyPayment)

    const { $ } = await viewPage(paymentPath)
    const [sbi, , empty] = part($, 'grant-payment-field').toArray()

    expect($(sbi).find('td').eq(1).children().attr('class')).toBe(
      'font-mono text-sm leading-none break-words'
    )
    expect($(empty).find('td').eq(1).children().attr('class')).toContain(
      'text-base-content/70'
    )
  })

  test('gives a collection of due payments one card, saying what it repeats for', async () => {
    givenPayment(pigsMightFlyPayment)

    const { $ } = await viewPage(paymentPath)
    const due = part($, 'grant-payment-due')

    expect(due).toHaveLength(1)
    expect(flatten(due.find('h2').text())).toBe('Due payments')
    expect(textOf($, 'grant-payment-due-fact-for-each')).toBe(
      'For each $.agreement.paymentSchedule.instalments'
    )
    expect(textOf($, 'grant-payment-due-fact-due-date')).toBe(
      'Due date @.dueDate'
    )
    expect(textOf($, 'grant-payment-due-fact-total')).toBe(
      'Total (pence) @.totalAmountPence'
    )
    expect(textOf($, 'grant-payment-for-each')).toBe(
      'One line per row of @.lineItems'
    )
    expect(cellsOf($, 'grant-payment-line')).toEqual([
      [
        'CMOR1',
        'jsonata:@.description',
        '@.amountPence',
        'SOS710',
        'DRD10',
        'RP00',
        'jsonata:$substring($.execution.executedAt, 0, 4)'
      ]
    ])
    expect(
      part($, 'grant-payment-line').find('td').eq(1).children().attr('class')
    ).toContain('font-mono')
  })

  test('gives each due payment of an array a numbered card, with a literal description as plain text', async () => {
    givenPayment(woodlandPayment)

    const { $ } = await viewPage(paymentPath)

    expect(flatten(part($, 'grant-payment-due').find('h2').text())).toBe(
      'Due payment 1'
    )
    expect(part($, 'grant-payment-due-fact-for-each')).toHaveLength(0)
    expect(part($, 'grant-payment-for-each')).toHaveLength(0)
    expect(
      part($, 'grant-payment-line')
        .find('td')
        .eq(1)
        .contents()
        .toArray()
        .map((node) => node.type)
    ).toEqual(['text'])
    expect(textOf($, 'grant-payment-line')).toContain(
      'Woodland Management Plan Payment'
    )
  })

  test('labels each card by its heading, and heads each table column', async () => {
    givenPayment(woodlandPayment)

    const { $ } = await viewPage(paymentPath)

    for (const testId of ['grant-payment-request', 'grant-payment-due']) {
      const card = part($, testId)

      expect($(`#${card.attr('aria-labelledby')}`).is('h2')).toBe(true)
    }
    expect(
      part($, 'grant-payment-lines')
        .find('th')
        .toArray()
        .map((head) => `${$(head).attr('scope')} ${$(head).text()}`)
    ).toEqual([
      'col Scheme',
      'col Description',
      'col Amount (pence)',
      'col Account',
      'col Fund',
      'col Delivery body',
      'col Marketing year'
    ])
  })

  test('says where due payments given as one mapping come from', async () => {
    givenPayment({ code: 'woodland', payments: '$.agreement.payments' })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-payment-from')).toBe(
      'From $.agreement.payments reference'
    )
    expect(part($, 'grant-payment-lines')).toHaveLength(0)
  })

  test('says where invoice lines given as one mapping, or one line given as a mapping, come from', async () => {
    givenPayment({
      code: 'woodland',
      payments: [
        { dueDate: '@.dueDate', invoiceLines: '@.lines' },
        { dueDate: '@.dueDate', invoiceLines: ['@.line'] }
      ]
    })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-payment-lines-from')).toBe(
      'Invoice lines from @.lines'
    )
    expect(textOf($, 'grant-payment-line-from')).toBe(
      'Line from @.line reference'
    )
    expect(
      part($, 'grant-payment-line-from').children('td').attr('colspan')
    ).toBe('7')
  })

  test('shows a dash for each key a due payment has not got', async () => {
    givenPayment({ code: 'woodland', payments: [{ invoiceLines: [] }] })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-payment-due-fact-due-date')).toBe('Due date —')
    expect(textOf($, 'grant-payment-due-fact-total')).toBe('Total (pence) —')
  })

  test('says when there are no due payments', async () => {
    givenPayment({ code: 'woodland', payments: [] })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-payment-no-due')).toBe('No due payments.')
    expect(part($, 'grant-payment-due')).toHaveLength(0)
  })

  test('says when a due payment has no invoice lines, with no table', async () => {
    givenPayment({
      code: 'woodland',
      payments: [{ dueDate: '@.dueDate', invoiceLines: [] }]
    })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-payment-no-lines')).toBe('No invoice lines.')
    expect(part($, 'grant-payment-lines')).toHaveLength(0)
  })

  test('ends with the stored definition in a closed Raw panel', async () => {
    givenPayment(woodlandPayment)

    const { $ } = await viewPage(paymentPath)
    const details = part($, 'grant-payment-raw-details')

    expect(details.is('details')).toBe(true)
    expect(details.attr('open')).toBeUndefined()
    expect(details.prev().attr('data-testid')).toBe('grant-payment')
    expect(textOf($, 'grant-payment-raw-summary')).toBe('Raw')
    expect(part($, 'grant-payment-raw').attr('aria-label')).toBe(
      'Payment definition'
    )
    expect(
      part($, 'grant-payment-raw-line')
        .toArray()
        .map((line) => $(line).find('code').text())
    ).toEqual(JSON.stringify(woodlandPayment, null, 2).split('\n'))
  })

  test('says the payment definition is not stored, and nothing else', async () => {
    givenPayment(null, {
      header: { ...grantHeader, files: { grant: fetched, payment: pending } }
    })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-not-stored')).toBe('Payment definition not stored.')
    expect(part($, 'grant-payment')).toHaveLength(0)
    expect(part($, 'grant-no-data')).toHaveLength(0)
  })

  test("says a stored definition over GAS's cap is too large to show", async () => {
    givenPayment(null, {
      sectionErrors: [{ section: 'payment', message: 'too large to show' }]
    })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-too-large')).toBe('Too large to show')
    expect(part($, 'grant-payment')).toHaveLength(0)
    expect(part($, 'grant-section-error')).toHaveLength(0)
  })

  test('says the definition could not be read on any other failure', async () => {
    givenPayment(null, {
      sectionErrors: [
        { section: 'payment', message: 'Payment could not be loaded' }
      ]
    })

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-section-error')).toBe('Payment could not be loaded')
    expect(part($, 'grant-payment')).toHaveLength(0)
  })

  test('says GAS sent nothing for a stored definition', async () => {
    givenPayment(null)

    const { $ } = await viewPage(paymentPath)

    expect(textOf($, 'grant-no-data')).toBe('GAS returned no data for this tab')
  })

  test('opens Overview when GAS says the version has no payment file', async () => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({
      outcome: 'hidden',
      page: null
    })

    const { statusCode, headers } = await viewPage(paymentPath)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(grantPath)
  })

  test('is not offered on a version with no payment file', async () => {
    givenGrant({ header: { ...grantHeader, files: { grant: fetched } } })

    const { $ } = await viewPage(grantPath)

    expect(
      part($, 'grant-tab')
        .toArray()
        .map((tab) => $(tab).text())
    ).toEqual(['Overview', 'Questions', 'Actions', 'Events', 'Raw'])
  })
})

const agreementPath = `${grantPath}?tab=agreement`

const landData = {
  process: 'GENERATE_OFFER',
  service: 'LAND_DATA',
  url: 'https://land-data.example/api/v2/parcels/{sbi}'
}

const givenAgreement = (
  agreement: GrantVersionPage['agreement'],
  overrides: Partial<GrantVersionPage> = {}
) => givenGrant({ overview: undefined, agreement, ...overrides })

const agreementProblem = 'Agreement definition code "other" does not match'

describe('the grant Agreement tab', () => {
  test("reads GAS's agreement read", async () => {
    givenAgreement(null)

    await viewPage(agreementPath)

    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'agreement'
    )
  })

  test('draws the facts, States, Pages and Processes cards', async () => {
    givenAgreement({
      definition: agreementDefinition,
      addresses: [landData],
      problem: null
    })

    const { $ } = await viewPage(agreementPath)

    expect(part($, 'grant-agreement-overview').attr('aria-label')).toBe(
      'Agreement'
    )
    expect(textOf($, 'grant-agreement-fact-code')).toBe(
      'Code woodland-creation'
    )
    expect(part($, 'grant-agreement-state-row')).toHaveLength(7)
    expect(part($, 'grant-agreement-page-row')).toHaveLength(3)
    expect(
      part($, 'grant-agreement-process-url')
        .toArray()
        .map((url) => $(url).text())
    ).toEqual([landData.url])
    expect(textOf($, 'grant-agreement-process-not-configured')).toBe(
      'Not configured'
    )
  })

  test('ends with the stored definition in a closed Raw panel', async () => {
    givenAgreement({
      definition: agreementDefinition,
      addresses: [landData],
      problem: null
    })

    const { $ } = await viewPage(agreementPath)
    const details = part($, 'grant-agreement-raw-details')

    expect(details.attr('open')).toBeUndefined()
    expect(details.prev().attr('data-testid')).toBe('grant-agreement')
    expect(textOf($, 'grant-agreement-raw-summary')).toBe('Raw')
    expect(part($, 'grant-agreement-raw').attr('aria-label')).toBe(
      'Agreement definition'
    )
    expect(
      part($, 'grant-agreement-raw-line')
        .toArray()
        .map((line) => $(line).find('code').text())
    ).toEqual(JSON.stringify(agreementDefinition, null, 2).split('\n'))
  })

  test('says why GAS cannot load a definition, then shows it as stored, and draws no cards', async () => {
    const definition = { ...agreementDefinition, code: 'other' }
    givenAgreement({ definition, addresses: [], problem: agreementProblem })

    const { $ } = await viewPage(agreementPath)

    expect(textOf($, 'grant-agreement-problem')).toBe(
      `GAS cannot load this agreement definition: ${agreementProblem}`
    )
    expect(part($, 'grant-agreement-states')).toHaveLength(0)
    expect(part($, 'grant-agreement-raw-details')).toHaveLength(1)
    expect(part($, 'grant-section-error')).toHaveLength(0)
  })

  test('says the agreement definition is not stored, and nothing else', async () => {
    givenAgreement(null, {
      header: { ...grantHeader, files: { grant: fetched, agreement: pending } }
    })

    const { $ } = await viewPage(agreementPath)

    expect(textOf($, 'grant-not-stored')).toBe(
      'Agreement definition not stored.'
    )
    expect(part($, 'grant-agreement')).toHaveLength(0)
    expect(part($, 'grant-no-data')).toHaveLength(0)
  })

  test("says a stored definition over GAS's cap is too large to show", async () => {
    givenAgreement(null, {
      sectionErrors: [{ section: 'agreement', message: 'too large to show' }]
    })

    const { $ } = await viewPage(agreementPath)

    expect(textOf($, 'grant-too-large')).toBe('Too large to show')
    expect(part($, 'grant-agreement')).toHaveLength(0)
    expect(part($, 'grant-section-error')).toHaveLength(0)
  })

  test("shows GAS's message when the read fails", async () => {
    givenAgreement(null, {
      sectionErrors: [
        { section: 'agreement', message: 'Agreement could not be loaded' }
      ]
    })

    const { $ } = await viewPage(agreementPath)

    expect(textOf($, 'grant-section-error')).toBe(
      'Agreement could not be loaded'
    )
    expect(part($, 'grant-agreement')).toHaveLength(0)
  })

  test('opens Overview when GAS says the version has no agreement file', async () => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({
      outcome: 'hidden',
      page: null
    })

    const { statusCode, headers } = await viewPage(agreementPath)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(grantPath)
  })

  test('is not offered on a version with no agreement file', async () => {
    givenGrant({
      header: { ...grantHeader, files: { grant: fetched, payment: fetched } }
    })

    const { $ } = await viewPage(grantPath)

    expect(
      part($, 'grant-tab')
        .toArray()
        .map((tab) => $(tab).text())
    ).toEqual(['Overview', 'Questions', 'Actions', 'Payment', 'Events', 'Raw'])
  })
})

describe('the bare grant URL', () => {
  const versions = {
    code: 'woodland-creation',
    current: '1.2.0',
    versions: grantHeader.versions
  }

  test('opens the current version on the tab asked for, keeping the list it came from', async () => {
    vi.mocked(getGrantVersionsUseCase).mockResolvedValue({
      outcome: 'found',
      page: versions
    })

    const { statusCode, headers } = await viewPage(
      '/dev-ops/grants/woodland-creation?tab=raw&back=%2Fdev-ops%2Fgrants'
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(
      `${grantPath}?tab=raw&back=%2Fdev-ops%2Fgrants`
    )
    expect(getGrantVersionsUseCase).toHaveBeenCalledWith('woodland-creation')
  })

  test('opens Overview when no tab is asked for', async () => {
    vi.mocked(getGrantVersionsUseCase).mockResolvedValue({
      outcome: 'found',
      page: versions
    })

    const { headers } = await viewPage('/dev-ops/grants/woodland-creation')

    expect(headers.location).toBe(grantPath)
  })

  test.each([
    ['a code GAS has not got', { outcome: 'not-found', page: null }],
    [
      'a code with no active version',
      { outcome: 'found', page: { ...versions, current: null } }
    ]
  ] as const)("answers GPA's own 404 page for %s", async (_name, result) => {
    vi.mocked(getGrantVersionsUseCase).mockResolvedValue(result)

    const { statusCode } = await viewPage('/dev-ops/grants/woodland-creation')

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('says GAS timed out, naming the code', async () => {
    vi.mocked(getGrantVersionsUseCase).mockResolvedValue({
      outcome: 'timed-out',
      page: null
    })

    const { statusCode, $ } = await viewPage(
      '/dev-ops/grants/woodland-creation'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'grant-error')).toBe(
      'This grant could not be loaded: GAS timed out waiting for it. Refresh to try again.'
    )
    expect(textOf($, 'grant-title')).toBe('Grant woodland-creation')
  })

  test('refuses a tab the grant page has not got', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/grants/woodland-creation?tab=answers'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})

describe("the version pages' Events tab", () => {
  const workflowPath = '/dev-ops/workflows/Woodland-Creation/1.2.0'
  const listed = '/dev-ops/grants?grant=woodland-creation'

  const workflowHeader: WorkflowVersionPage['header'] = {
    code: 'Woodland-Creation',
    version: '1.2.0',
    status: 'active',
    receivedAt: '2026-09-10T15:25:00.000Z',
    files: { workflow: fetched },
    versions: grantHeader.versions,
    counterpart: null
  }

  const givenWorkflow = (overrides: Partial<WorkflowVersionPage>) =>
    vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
      outcome: 'found',
      page: {
        header: workflowHeader,
        sourceErrors: [],
        sectionErrors: [],
        ...overrides
      }
    })

  const configEvent = (service: 'gas' | 'caseworking') => ({
    service,
    box: 'inbox' as const,
    id: '6716a9c2e4b0a1f2c3d4e5f6',
    eventId: '7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8',
    type: 'ConfigVersionUpdated',
    status: 'COMPLETED',
    statusLabel: 'Completed',
    statusRole: 'success' as const,
    statusRetrying: false,
    createdAt: '2026-09-22T09:14:37.000Z',
    latency: 'took 2s',
    latencyTitle: 'Received to completed'
  })

  const rejected = (service: 'gas' | 'caseworking') => ({
    ...configEvent(service),
    id: '6716a9c2e4b0a1f2c3d4e5f7',
    status: 'DEAD_LETTER',
    statusLabel: 'Dead letter',
    statusRole: 'error' as const,
    latency: null
  })

  const versionPages = [
    {
      itemId: 'grant',
      path: grantPath,
      ref: { code: 'woodland-creation', version: '1.2.0' },
      service: 'gas' as const,
      inbox: '/dev-ops/events/gas/inbox',
      source: 'GAS',
      hop: 'GAS inbox',
      twin: { itemId: 'application', path },
      read: getGrantPageUseCase,
      given: (overrides: Partial<GrantVersionPage>) =>
        givenGrant({ overview: undefined, ...overrides })
    },
    {
      itemId: 'workflow',
      path: workflowPath,
      ref: { code: 'Woodland-Creation', version: '1.2.0' },
      service: 'caseworking' as const,
      inbox: '/dev-ops/events/cw/inbox',
      source: 'CW',
      hop: 'CW-BE',
      twin: { itemId: 'case', path: casePath },
      read: getWorkflowPageUseCase,
      given: givenWorkflow
    }
  ]

  /** The events card with its page's own names taken out, so two pages' cards can be compared. */
  const eventsCard = ($: CheerioAPI, itemId: string, recordPath: string) =>
    $.html(part($, `${itemId}-events`))
      .replaceAll(`${itemId}-events`, 'record-events')
      .replaceAll(encodeURIComponent(recordPath), 'RECORD')

  test.each(versionPages)(
    "reads the $itemId version's Events tab",
    async ({ path: pagePath, ref, read, given }) => {
      given({ events: { rows: [], more: false } })

      await viewPage(`${pagePath}?tab=events`)

      expect(read).toHaveBeenCalledWith(ref, 'events')
    }
  )

  test.each(versionPages)(
    'draws the $itemId events exactly as the $twin.itemId page draws its own',
    async ({ itemId, path: pagePath, service, twin, given }) => {
      const events = {
        rows: [configEvent(service), rejected(service)],
        more: true
      }
      given({ events })
      givenPage({ overview: undefined, events })
      vi.mocked(getCasePageUseCase).mockResolvedValue({
        outcome: 'found',
        page: {
          header: caseHeader,
          events,
          sourceErrors: [],
          sectionErrors: []
        }
      })

      const { $ } = await viewPage(`${pagePath}?tab=events`)
      const { $: record } = await viewPage(`${twin.path}?tab=events`)

      expect(eventsCard($, itemId, pagePath)).toBe(
        eventsCard(record, twin.itemId, twin.path)
      )
      expect(part($, 'event-row')).toHaveLength(2)
    }
  )

  test.each(versionPages)(
    'links each $itemId event to its page, coming back to this tab',
    async ({ path: pagePath, service, inbox, given }) => {
      given({ events: { rows: [configEvent(service)], more: false } })

      const tab = `${pagePath}?tab=events&back=${encodeURIComponent(listed)}`
      const { $ } = await viewPage(tab)

      expect(part($, 'event-link').attr('href')).toBe(
        `${inbox}/6716a9c2e4b0a1f2c3d4e5f6?back=${encodeURIComponent(tab)}`
      )
    }
  )

  test.each(versionPages)(
    'shows a rejected $itemId event as a dead letter',
    async ({ path: pagePath, service, given }) => {
      given({ events: { rows: [rejected(service)], more: false } })

      const { $ } = await viewPage(`${pagePath}?tab=events`)

      expect(part($, 'event-row').attr('class')).toContain('bg-error/5')
      expect(flatten(part($, 'event-row').find('td').eq(1).text())).toBe(
        'Dead letter'
      )
    }
  )

  test.each(versionPages)(
    'says the $itemId tab shows the newest 50 from each $source queue',
    async ({ itemId, path: pagePath, service, source, given }) => {
      given({ events: { rows: [configEvent(service)], more: true } })

      const { $ } = await viewPage(`${pagePath}?tab=events`)

      expect(textOf($, `${itemId}-events-more`)).toBe(
        `Showing the newest 50 from each ${source} queue.`
      )
    }
  )

  test.each(versionPages)(
    'says when the $itemId code has no events',
    async ({ itemId, path: pagePath, given }) => {
      given({ events: { rows: [], more: false } })

      const { $ } = await viewPage(`${pagePath}?tab=events`)

      expect(textOf($, `${itemId}-events-empty`)).toBe('No events found.')
    }
  )

  test.each(versionPages)(
    'says $hop could not be read, and shows the rest',
    async ({ itemId, path: pagePath, hop, given }) => {
      given({ events: { rows: [], more: false }, sourceErrors: [{ hop }] })

      const { $ } = await viewPage(`${pagePath}?tab=events`)

      expect(textOf($, `${itemId}-events-partial`)).toBe(
        `Some event sources are unavailable: ${hop}. Showing the rest.`
      )
      expect(textOf($, `${itemId}-events-empty`)).toBe('No events found.')
    }
  )

  test.each(versionPages)(
    'says so when the $itemId events could not be read',
    async ({ itemId, path: pagePath, given }) => {
      given({
        events: null,
        sectionErrors: [
          { section: 'events', message: 'Events could not be loaded' }
        ]
      })

      const { $ } = await viewPage(`${pagePath}?tab=events`)

      expect(textOf($, `${itemId}-section-error`)).toBe(
        'Events could not be loaded'
      )
    }
  )

  test('lists the events of a grant whose definitions are not stored, under the banner', async () => {
    givenGrant({
      header: nothingStored,
      overview: undefined,
      events: { rows: [configEvent('gas')], more: false }
    })

    const { $ } = await viewPage(`${grantPath}?tab=events`)

    expect(part($, 'grant-banner')).toHaveLength(1)
    expect(part($, 'grant-not-stored')).toHaveLength(0)
    expect(part($, 'event-row')).toHaveLength(1)
  })
})
