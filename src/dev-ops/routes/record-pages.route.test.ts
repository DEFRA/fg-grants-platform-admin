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

  test('links back to the list', async () => {
    const { $ } = await viewPage()

    expect(part($, 'application-back').attr('href')).toBe(
      '/dev-ops/applications'
    )
    expect(textOf($, 'application-back')).toBe('Back to applications')
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
    const { $ } = await viewPage(`${path}?section=events`)

    expect(
      part($, 'application-tab')
        .toArray()
        .map((tab) => `${$(tab).text()} ${$(tab).attr('href')}`)
    ).toEqual([
      `Overview ${path}`,
      `Events ${path}?section=events`,
      `Raw ${path}?section=raw`
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
    const { statusCode } = await viewPage(`${path}?section=answers`)

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
    ).toBe('text-right')
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

    const { $ } = await viewPage(`${path}?section=events`)

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
    type: 'application.created',
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

    await viewPage(`${path}?section=events`)

    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      expect.anything(),
      'events'
    )
  })

  test.each(recordTypes)(
    'draws the $itemId rows as the events list does',
    async ({ itemId, path: recordPath, given }) => {
      given({ overview: undefined, events: { rows: [event], more: false } })

      const { $ } = await viewPage(`${recordPath}?section=events`)

      expect(
        part($, `${itemId}-events`).find('[data-testid="event-row"]')
      ).toHaveLength(1)
      expect(part($, 'event-link').attr('href')).toBe(
        '/dev-ops/events/gas/inbox/665f1c2e9a1b2c3d4e5f6a7b'
      )
      expect(part($, `${itemId}-events-more`)).toHaveLength(0)
    }
  )

  test('links on to the events search when there are more', async () => {
    givenPage({ overview: undefined, events: { rows: [event], more: true } })

    const { $ } = await viewPage(`${path}?section=events`)

    expect(textOf($, 'application-events-all')).toBe('All in Events')
    expect(part($, 'application-events-all').attr('href')).toBe(
      '/dev-ops/events?q=a7c-2f1-9e4'
    )
  })

  test('says which event sources were missed', async () => {
    givenPage({
      overview: undefined,
      events: { rows: [event], more: false },
      sourceErrors: [{ hop: 'CW Inbox' }],
      header: { ...header, counterpart: { exists: false } }
    })

    const { $ } = await viewPage(`${path}?section=events`)

    expect(textOf($, 'application-events-partial')).toBe(
      'Some event sources are unavailable: CW Inbox. Showing the rest.'
    )
  })

  test('says when there are no events', async () => {
    givenPage({ overview: undefined, events: { rows: [], more: false } })

    const { $ } = await viewPage(`${path}?section=events`)

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

    const { $ } = await viewPage(`${path}?section=events`)

    expect(textOf($, 'application-section-error')).toBe(
      'Events could not be loaded'
    )
  })
})

describe('a tab the source sent nothing for', () => {
  test.each(
    recordTypes.flatMap((type) =>
      ['', '?section=events', '?section=raw'].map((query) => ({
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

    const { $ } = await viewPage(`${path}?section=raw`)

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

      const { $ } = await viewPage(`${recordPath}?section=raw`)

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

    const { $ } = await viewPage(`${path}?section=raw`)

    expect(textOf($, 'application-section-error')).toBe(
      'Raw could not be loaded'
    )
    expect(part($, 'application-raw-too-large')).toHaveLength(0)
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
    expect(part($, 'case-back').attr('href')).toBe('/dev-ops/cases')
    expect(
      $('[data-testid="do-nav"] [aria-current="page"]').text().trim()
    ).toBe('Cases')
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

    const { $ } = await viewPage(`${casePath}?section=events`)

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

    const { $ } = await viewPage(`${casePath}?section=raw`)

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
