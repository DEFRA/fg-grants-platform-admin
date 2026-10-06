import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { ApplicationPage } from '../use-cases/get-application-page.use-case.ts'
import { caseCheckHop } from '../repositories/applications.repository.ts'
import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'

vi.mock(import('../use-cases/get-application-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-application-page.use-case.ts')
  >('../use-cases/get-application-page.use-case.ts')),
  getApplicationPageUseCase: vi.fn()
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
  series: { latestRef: 'a7c-2f1-9e4', refs: ['9d3-5b1-e08', 'a7c-2f1-9e4'] },
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

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

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
      '[scrollbar-gutter:stable] [--root-bg:var(--color-base-200)]'
    )
  })

  test('shows no related records while the case link is unknown to GAS', async () => {
    const { $ } = await viewPage()

    expect(part($, 'application-related')).toHaveLength(0)
    expect(part($, 'application-case-unknown')).toHaveLength(0)
  })

  test('links to the case when it exists', async () => {
    givenPage({ header: { ...header, counterpart: { exists: true } } })

    const { $ } = await viewPage()

    expect(part($, 'application-related').attr('aria-label')).toBe(
      'Related records'
    )
    expect(textOf($, 'application-view-case')).toBe('View case')
    expect(part($, 'application-view-case').attr('href')).toBe(
      '/dev-ops/cases/frps-private-beta/a7c-2f1-9e4'
    )
  })

  test('shows no related records when the case does not exist', async () => {
    givenPage({ header: { ...header, counterpart: { exists: false } } })

    const { $ } = await viewPage()

    expect(part($, 'application-related')).toHaveLength(0)
  })

  test('warns that the case link is unknown when the check failed', async () => {
    givenPage({ sourceErrors: [{ hop: caseCheckHop }] })

    const { $ } = await viewPage()

    expect(textOf($, 'application-case-unknown')).toBe(
      'CW unavailable. Case link unknown.'
    )
    expect(part($, 'application-related')).toHaveLength(0)
  })

  test('says nothing of the case when only an event source failed', async () => {
    givenPage({ sourceErrors: [{ hop: 'CW-BE Inbox' }] })

    const { $ } = await viewPage()

    expect(part($, 'application-case-unknown')).toHaveLength(0)
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

  test('lists Grant, Submitted, Created, Updated, SBI, FRN, CRN, Series and Size', async () => {
    const { $ } = await viewPage()

    expect(factsOf($)).toEqual([
      'Grant',
      'Submitted',
      'Created',
      'Updated',
      'SBI',
      'FRN',
      'CRN',
      'Series',
      'Size'
    ])
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

  test('links the rest of the series under the same grant, marking the latest', async () => {
    const { $ } = await viewPage()
    const refs = part($, 'application-series-ref')

    expect(refs.eq(0).attr('href')).toBe(
      '/dev-ops/applications/frps-private-beta/9d3-5b1-e08'
    )
    expect(refs.eq(1).is('a')).toBe(false)
    expect(textOf($, 'application-series')).toBe(
      '9d3-5b1-e08 a7c-2f1-9e4 latest'
    )
  })

  test('draws the arrow between the refs as an icon screen readers skip', async () => {
    const { $ } = await viewPage()
    const arrow = part($, 'application-series').find(
      '[data-testid="do-icon-arrow-right"]'
    )

    expect(arrow).toHaveLength(1)
    expect(arrow.attr('aria-hidden')).toBe('true')
    expect(arrow.attr('class')).toBe('size-3.5 shrink-0 text-base-content/50')
    expect(arrow.prev().attr('data-testid')).toBe('application-series-ref')
  })

  test('draws a dash for an application with no series', async () => {
    givenPage({ overview: { ...overview, series: null } })

    const { $ } = await viewPage()

    expect(textOf($, 'application-series-none')).toBe('—')
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

  test('reads the Events tab and draws its rows as the events list does', async () => {
    givenPage({ overview: undefined, events: { rows: [event], more: false } })

    const { $ } = await viewPage(`${path}?section=events`)

    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      expect.anything(),
      'events'
    )
    expect(part($, 'event-row')).toHaveLength(1)
    expect(part($, 'event-link').attr('href')).toBe(
      '/dev-ops/events/gas/inbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
    expect(part($, 'application-events-more')).toHaveLength(0)
  })

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

  test('leaves the case check out of the missed event sources', async () => {
    givenPage({
      overview: undefined,
      events: { rows: [event], more: false },
      sourceErrors: [{ hop: caseCheckHop }, { hop: 'CW-BE Inbox' }]
    })

    const { $ } = await viewPage(`${path}?section=events`)

    expect(textOf($, 'application-events-partial')).toBe(
      'Some event sources are unavailable: CW-BE Inbox. Showing the rest.'
    )
  })

  test('says no event source was missed when only the case check failed', async () => {
    givenPage({
      overview: undefined,
      events: { rows: [event], more: false },
      sourceErrors: [{ hop: caseCheckHop }]
    })

    const { $ } = await viewPage(`${path}?section=events`)

    expect(part($, 'application-events-partial')).toHaveLength(0)
    expect(part($, 'application-case-unknown')).toHaveLength(1)
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

describe('a tab GAS sent nothing for', () => {
  test.each([
    ['overview', path],
    ['events', `${path}?section=events`],
    ['raw', `${path}?section=raw`]
  ])('says so on %s, rather than drawing a blank tab', async (_, url) => {
    givenPage({ overview: null, events: null, raw: null })

    const { $ } = await viewPage(url)

    expect(textOf($, 'application-no-data')).toBe(
      'GAS returned no data for this tab'
    )
    expect(part($, 'application-no-data').hasClass('alert')).toBe(true)
  })
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
      'Stored document'
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

  test('says the document is too large to show', async () => {
    givenPage({
      overview: undefined,
      raw: null,
      storedBytes: 2_000_000,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${path}?section=raw`)

    expect(textOf($, 'application-raw-too-large')).toBe('Too large to show')
    expect(part($, 'application-raw')).toHaveLength(0)
    expect(part($, 'application-section-error')).toHaveLength(0)
  })

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
