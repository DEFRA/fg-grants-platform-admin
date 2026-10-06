import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  ApplicationRow,
  ApplicationsPage
} from '../use-cases/search-applications.use-case.ts'
import { searchApplicationsUseCase } from '../use-cases/search-applications.use-case.ts'

vi.mock(import('../use-cases/search-applications.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: {
    id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
    name: 'Ada Lovelace'
  },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-09-30T15:17:31.000Z')

const row = (
  clientRef: string,
  overrides: Partial<ApplicationRow> = {}
): ApplicationRow => ({
  ref: { clientRef, code: 'frps-private-beta' },
  position: {
    phase: 'PHASE_PRE_AWARD',
    stage: 'STAGE_ASSESSMENT',
    status: 'STATUS_APPLICATION_RECEIVED'
  },
  createdAt: '2026-09-30T15:10:31.000Z',
  replaced: false,
  ...overrides
})

const twenty = Array.from({ length: 20 }, (_, index) =>
  row(`ref-${String(index).padStart(2, '0')}`)
)

const givenPage = (overrides: Partial<ApplicationsPage> = {}) =>
  vi.mocked(searchApplicationsUseCase).mockResolvedValue({
    page: {
      rows: twenty,
      pagination: { endCursor: 'NEXT', hasNextPage: true },
      total: { count: 48, capped: false },
      codes: ['frps-private-beta', 'woodland'],
      sourceErrors: [],
      ...overrides
    },
    unavailable: false,
    refused: false
  })

const givenFailure = (failure: 'unavailable' | 'refused') =>
  vi.mocked(searchApplicationsUseCase).mockResolvedValue({
    page: {
      rows: [],
      pagination: { endCursor: null, hasNextPage: false },
      sourceErrors: []
    },
    unavailable: failure === 'unavailable',
    refused: failure === 'refused'
  })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

/** The session cookie a request carries, so a search posted earlier is read back. */
const withCookie = (cookie: string) => (cookie ? { cookie } : {})

const viewPage = async (url = '/dev-ops/applications', cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: withCookie(cookie)
  })

  return {
    $: load(result as unknown as string),
    statusCode,
    headers,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

const search = async (payload: Record<string, string>, cookie = '') => {
  const { statusCode, headers } = await server.inject({
    method: 'POST',
    url: '/dev-ops/applications',
    payload,
    auth: { strategy: 'session', credentials },
    headers: withCookie(cookie)
  })

  return {
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
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
  vi.setSystemTime(now)
  givenPage()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the applications list', () => {
  test('opens on the newest applications, asking GAS for a plain browse', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(searchApplicationsUseCase).toHaveBeenCalledTimes(1)
    expect(searchApplicationsUseCase).toHaveBeenCalledWith({}, false)
    expect(
      $('#applications-rows [data-testid="application-link"]')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual(
      twenty.map(
        ({ ref }) => `/dev-ops/applications/frps-private-beta/${ref.clientRef}`
      )
    )
  })

  test('heads its columns Reference, Grant, Status and Created', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="applications-head"] th')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    ).toEqual(['Reference', 'Grant', 'Status', 'Created'])
  })

  test('shares the width of the table evenly between its columns', async () => {
    const { $ } = await viewPage()

    expect(part($, 'applications-table').hasClass('table-fixed')).toBe(true)
    expect(
      $('[data-testid="applications-head"] th')
        .toArray()
        .map((cell) => $(cell).attr('class') ?? '')
    ).toEqual(['', '', '', 'text-right'])
  })

  test('wraps a long ref rather than letting it run out of its column', async () => {
    const { $ } = await viewPage()

    expect(part($, 'application-link').first().hasClass('break-all')).toBe(true)
  })

  test('draws a row as its ref, grant, humanised status and when it was made', async () => {
    givenPage({ rows: [row('f02-7d8-a61')] })

    const { $ } = await viewPage()
    const first = part($, 'application-row').first()

    expect(flatten(first.find('[data-testid="application-link"]').text())).toBe(
      'f02-7d8-a61, frps-private-beta'
    )
    expect(
      flatten(first.find('[data-testid="application-grant"]').text())
    ).toBe('frps-private-beta')
    expect(flatten(first.find('[data-testid="do-status-label"]').text())).toBe(
      'Application received'
    )
    expect(
      flatten(first.find('[data-testid="application-created-at"]').text())
    ).toContain('7m ago')
    expect(first.find('[data-testid="application-created-clock"]').text()).toBe(
      '16:10:31'
    )
  })

  test('titles the status with the whole position, and speaks it in full', async () => {
    givenPage({ rows: [row('f02-7d8-a61')] })

    const { $ } = await viewPage()
    const status = part($, 'application-status').first()

    expect(status.find('[data-testid="do-status-badge"]').attr('title')).toBe(
      'Pre award › Assessment › Application received'
    )
    expect(status.find('.sr-only').text()).toBe(
      'Pre award › Assessment › Application received'
    )
    expect(status.children().first().hasClass('relative')).toBe(true)
  })

  test('badges an application a later one in its series replaced', async () => {
    givenPage({
      rows: [row('f02-7d8-a61'), row('9d3-5b1-e08', { replaced: true })]
    })

    const { $ } = await viewPage()
    const rows = part($, 'application-row')

    expect(
      rows.eq(0).find('[data-testid="application-replaced"]')
    ).toHaveLength(0)
    expect(
      flatten(rows.eq(1).find('[data-testid="application-replaced"]').text())
    ).toBe('replaced')
  })

  test('draws the same rows as a list for a phone', async () => {
    const { $ } = await viewPage()

    expect(part($, 'applications-list').hasClass('sm:hidden')).toBe(true)
    expect($('#applications-list > li')).toHaveLength(20)
    expect(
      $('#applications-list [data-testid="application-item-created-at"]')
        .first()
        .is('time')
    ).toBe(true)
  })

  test.each([
    [{ count: 48, capped: false }, '48 applications'],
    [{ count: 1, capped: false }, '1 application'],
    [{ count: 10000, capped: true }, '10,000+ applications']
  ])('counts the whole result in the band: %o', async (total, label) => {
    givenPage({ total })

    const { $ } = await viewPage()

    expect(textOf($, 'applications-total')).toBe(label)
    expect(part($, 'applications-card-header').next().attr('data-testid')).toBe(
      'applications-scroller'
    )
  })

  test('says nothing was found, with no band, when nothing matches', async () => {
    givenPage({ rows: [], total: { count: 0, capped: false } })

    const { $ } = await viewPage()

    expect(textOf($, 'applications-empty')).toBe('No applications found.')
    expect(part($, 'applications-card-header')).toHaveLength(0)
  })

  test('says GAS could not be read, with no rows and no band', async () => {
    givenFailure('unavailable')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'applications-error')).toBe(
      'Applications could not be loaded from GAS.'
    )
    expect(part($, 'applications-card-header')).toHaveLength(0)
    expect(part($, 'application-row')).toHaveLength(0)
  })

  test('says GAS refused the link rather than painting an outage', async () => {
    givenFailure('refused')

    const { $ } = await viewPage()

    expect(part($, 'applications-refused')).toHaveLength(1)
    expect(part($, 'applications-error')).toHaveLength(0)
  })

  test('keeps the list out of shared caches but lets Back restore it', async () => {
    const { headers } = await viewPage()

    expect(headers['cache-control']).toBe('private, no-cache')
  })

  test('marks Applications as the area in the header nav', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-nav"] [aria-current="page"]').text()).toBe(
      'Applications'
    )
  })
})

describe('the Grant menu', () => {
  test('offers All and each grant GAS listed, and filters as it is clicked', async () => {
    const { $ } = await viewPage()

    expect(
      part($, 'applications-filter-grant-chip')
        .toArray()
        .map((chip) => `${flatten($(chip).text())} ${$(chip).attr('href')}`)
    ).toEqual([
      'All /dev-ops/applications',
      'frps-private-beta /dev-ops/applications?code=frps-private-beta',
      'woodland /dev-ops/applications?code=woodland'
    ])
    expect(textOf($, 'applications-filter-grant-button')).toBe('Grant: All')
  })

  test('asks GAS for the chosen grant, names it on the button and in a note', async () => {
    const { $ } = await viewPage('/dev-ops/applications?code=woodland')

    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { code: 'woodland' },
      false
    )
    expect(textOf($, 'applications-filter-grant-button')).toBe(
      'Grant: woodland'
    )
    expect(textOf($, 'applications-note-grant')).toBe('Grant: "woodland"')
    expect(part($, 'applications-note-grant-clear').attr('href')).toBe(
      '/dev-ops/applications'
    )
  })

  test('keeps the chosen grant on a later page that lists no grants', async () => {
    givenPage({ codes: undefined })

    const { $ } = await viewPage(
      '/dev-ops/applications?code=woodland&cursor=NEXT'
    )

    expect(
      part($, 'applications-filter-grant-chip')
        .toArray()
        .map((chip) => flatten($(chip).text()))
    ).toEqual(['All', 'woodland'])
  })

  test('refuses a code GAS could not hold', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/applications?code=Wood%20Land'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(searchApplicationsUseCase).not.toHaveBeenCalled()
  })
})

describe('the time range', () => {
  test('offers All and the six presets, titled for applications', async () => {
    const { $ } = await viewPage()

    expect(
      part($, 'applications-range-preset')
        .toArray()
        .map((preset) => $(preset).attr('title'))
    ).toEqual([
      'Applications created in the last 15m',
      'Applications created in the last 1h',
      'Applications created in the last 6h',
      'Applications created in the last 24h',
      'Applications created in the last 7d',
      'Applications created in the last 30d'
    ])
  })

  test('asks GAS for the window, leaving the preset key in the URL', async () => {
    const { $ } = await viewPage(
      '/dev-ops/applications?from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    )

    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { from: '2026-09-29T15:17:31.000Z' },
      false
    )
    expect(textOf($, 'applications-range-button')).toBe('Time: Last 24h')
  })

  test('reads a Custom box in UK time, the first pass of the repeated autumn hour', async () => {
    await viewPage('/dev-ops/applications?from=2026-10-25T01%3A30')

    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { from: '2026-10-25T00:30:00.000Z' },
      false
    )
  })
})

describe('infinite scroll', () => {
  test('links the next page with every filter, for the element and for no script', async () => {
    const { $ } = await viewPage(
      '/dev-ops/applications?code=woodland&from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    )
    const more = part($, 'applications-load-more')

    expect(more.attr('data-next-page')).toBe(
      '/dev-ops/applications?cursor=NEXT&code=woodland&from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    )
    expect(more.attr('data-rows')).toBe('applications-rows applications-list')
    expect(more.attr('data-noun-many')).toBe('applications')
    expect(textOf($, 'applications-load-more-link')).toBe('More applications')
  })

  test('says there are no more once the last page is in', async () => {
    givenPage({ pagination: { endCursor: null, hasNextPage: false } })

    const { $ } = await viewPage()

    expect(
      part($, 'applications-load-more').attr('data-next-page')
    ).toBeUndefined()
    expect(textOf($, 'applications-load-more-end')).toBe('No more applications')
  })

  test('passes the cursor on, as a browse of a new page', async () => {
    await viewPage('/dev-ops/applications?cursor=NEXT')

    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { cursor: 'NEXT' },
      false
    )
  })
})

describe('a browse', () => {
  test('tells GAS a refresh of the same first page is a repeat', async () => {
    const first = await viewPage('/dev-ops/applications?code=woodland')

    await viewPage('/dev-ops/applications?code=woodland', first.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { code: 'woodland' },
      true
    )
  })

  test('is fresh under changed filters', async () => {
    const first = await viewPage('/dev-ops/applications?code=woodland')

    await viewPage('/dev-ops/applications', first.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith({}, false)
  })

  test('never tells GAS a later page is a repeat', async () => {
    const first = await viewPage('/dev-ops/applications')
    const next = await viewPage(
      '/dev-ops/applications?cursor=NEXT',
      first.cookie
    )

    await viewPage('/dev-ops/applications?cursor=NEXT', next.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { cursor: 'NEXT' },
      false
    )
  })

  test('is fresh after a search is cleared on the same filters', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    const searched = await viewPage('/dev-ops/applications', posted.cookie)
    const cleared = await search({ q: '' }, searched.cookie)

    await viewPage('/dev-ops/applications', cleared.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith({}, false)
  })
})

describe('a search by reference', () => {
  test('is posted, kept out of the URL, and answered with the list it filtered', async () => {
    const { statusCode, location } = await search({
      q: '  9D3-5B1-E08 ',
      code: 'woodland',
      from: '2026-09-29T15:17:31.000Z',
      range: '24h'
    })

    expect(statusCode).toBe(303)
    expect(location).toBe(
      '/dev-ops/applications?code=woodland&from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    )
    expect(location).not.toContain('9d3')
    expect(searchApplicationsUseCase).not.toHaveBeenCalled()
  })

  test('runs once, fresh, on the page it redirects to', async () => {
    const { cookie } = await search({ q: '9d3-5b1-e08' })

    const { $ } = await viewPage('/dev-ops/applications', cookie)

    expect(searchApplicationsUseCase).toHaveBeenCalledTimes(1)
    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { ref: '9d3-5b1-e08' },
      false
    )
    expect(part($, 'applications-search-input').attr('value')).toBe(
      '9d3-5b1-e08'
    )
    expect(textOf($, 'applications-note-search')).toBe('Matching "9d3-5b1-e08"')
  })

  test('tells GAS that a refresh or Back is a repeat', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    const first = await viewPage('/dev-ops/applications', posted.cookie)

    await viewPage('/dev-ops/applications', first.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { ref: '9d3-5b1-e08' },
      true
    )
  })

  test('is fresh again under a new filter, and a repeat only on a refresh of it', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    const first = await viewPage('/dev-ops/applications', posted.cookie)
    const grant = await viewPage(
      '/dev-ops/applications?code=woodland',
      first.cookie
    )

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { code: 'woodland', ref: '9d3-5b1-e08' },
      false
    )

    await viewPage('/dev-ops/applications?code=woodland', grant.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { code: 'woodland', ref: '9d3-5b1-e08' },
      true
    )
  })

  test('refuses a ref GAS could not hold, says why beside the box, and stores nothing', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/dev-ops/applications',
      payload: { q: '9d3 5b1!', code: 'woodland' },
      auth: { strategy: 'session', credentials }
    })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { code: 'woodland' },
      false
    )
    expect(textOf($, 'applications-search-error')).toBe(
      'Enter a reference using only letters, numbers and hyphens.'
    )
    expect(part($, 'applications-search-input').attr('value')).toBe('9d3 5b1!')
    expect(part($, 'applications-search-input').attr('aria-invalid')).toBe(
      'true'
    )
    expect(part($, 'applications-note-search')).toHaveLength(0)
    expect(part($, 'applications-toolbar').hasClass('items-start')).toBe(true)
  })

  test('forgets the earlier search on a ref it refused, so the next render browses', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    const refused = await search({ q: 'not a ref!' }, posted.cookie)

    await viewPage('/dev-ops/applications', refused.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith({}, false)
  })

  test('tells GAS a refresh of a time preset is a repeat', async () => {
    const preset =
      '/dev-ops/applications?from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    const posted = await search({
      q: '9d3-5b1-e08',
      from: '2026-09-29T15:17:31.000Z',
      range: '24h'
    })
    const first = await viewPage(preset, posted.cookie)

    await viewPage(preset, first.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { from: '2026-09-29T15:17:31.000Z', ref: '9d3-5b1-e08' },
      true
    )
  })

  // Two tabs share one session, so a second tab on the same filters is a repeat. That is intended.
  test('tells GAS a second tab on the same filters is a repeat', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })

    await viewPage('/dev-ops/applications', posted.cookie)
    await viewPage('/dev-ops/applications', posted.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith(
      { ref: '9d3-5b1-e08' },
      true
    )
  })

  test('forgets a search GAS refused, so the next render browses', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    givenFailure('refused')
    const refused = await viewPage('/dev-ops/applications', posted.cookie)

    givenPage()
    await viewPage('/dev-ops/applications', refused.cookie)

    expect(searchApplicationsUseCase).toHaveBeenLastCalledWith({}, false)
  })

  test('is forgotten after 15 minutes, and the list browses again', async () => {
    const { cookie } = await search({ q: '9d3-5b1-e08' })

    vi.setSystemTime(new Date(now.getTime() + 15 * 60 * 1000 + 1))
    const { $ } = await viewPage('/dev-ops/applications', cookie)

    expect(searchApplicationsUseCase).toHaveBeenCalledWith({}, false)
    expect(part($, 'applications-note-search')).toHaveLength(0)
  })

  test('is cleared by an empty search', async () => {
    const posted = await search({ q: '9d3-5b1-e08' })
    const cleared = await search({ q: '' }, posted.cookie)

    await viewPage('/dev-ops/applications', cleared.cookie)

    expect(searchApplicationsUseCase).toHaveBeenCalledWith({}, false)
  })

  test('is left out of a later page, which is a browse', async () => {
    const { cookie } = await search({ q: '9d3-5b1-e08' })

    await viewPage('/dev-ops/applications?cursor=NEXT', cookie)

    expect(searchApplicationsUseCase).toHaveBeenCalledWith(
      { cursor: 'NEXT' },
      false
    )
  })

  test('says no application matched, with a way to clear it', async () => {
    givenPage({ rows: [], total: { count: 0, capped: false } })
    const { cookie } = await search({ q: 'nope' })

    const { $ } = await viewPage('/dev-ops/applications', cookie)
    const clear = part($, 'applications-empty-clear')

    expect(textOf($, 'applications-empty')).toBe(
      'No applications match "nope". Clear search'
    )
    expect(clear.closest('form').attr('method')).toBe('post')
    expect(clear.closest('form').find('input[name="q"]').attr('value')).toBe('')
  })

  test('keeps the grant and window on the search form', async () => {
    const { $ } = await viewPage(
      '/dev-ops/applications?code=woodland&from=2026-09-29T15%3A17%3A31.000Z&range=24h'
    )

    expect(
      part($, 'applications-search')
        .find('input[type="hidden"]')
        .toArray()
        .map((field) => `${$(field).attr('name')}=${$(field).attr('value')}`)
    ).toEqual(['code=woodland', 'from=2026-09-29T15:17:31.000Z', 'range=24h'])
  })
})
