import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  EventCounts,
  EventFacets
} from '../use-cases/get-events.use-case.ts'
import { getEventCountsUseCase } from '../use-cases/get-events.use-case.ts'
import type { RedriveQueryResult } from '../use-cases/redrive-query.use-case.ts'
import { redriveQueryUseCase } from '../use-cases/redrive-query.use-case.ts'

vi.mock(import('../use-cases/get-events.use-case.ts'))
vi.mock(import('../use-cases/redrive-query.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const confirmPath = '/dev-ops/events/redrive-query-confirm'
const writePath = '/dev-ops/events/redrive-query'

const counts = (overrides: Partial<EventCounts> = {}): EventCounts => ({
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 236196,
  DEAD_LETTER: 7064,
  PARKED: 4,
  ...overrides
})

/**
 * The whole of what the counts endpoint answers with. This page reads one
 * figure out of it — the dead letters behind the filters it was handed — and
 * the two facets beside it are the toolbar's business, not this page's.
 */
const facets = (overrides: Partial<EventCounts> = {}): EventFacets => ({
  counts: counts(overrides)
})

const result = (
  overrides: Partial<RedriveQueryResult> = {}
): RedriveQueryResult => ({
  matched: 7064,
  processed: 500,
  redriven: 498,
  conflicts: 1,
  failures: 1,
  perSource: [
    {
      service: 'gas',
      box: 'outbox',
      matched: 7000,
      processed: 480,
      redriven: 478,
      conflicts: 1,
      failures: 1
    },
    { service: 'caseworking', box: 'inbox', matched: 64, processed: 20 }
  ],
  sourceErrors: [],
  ...overrides
})

const givenResult = (overrides: Partial<RedriveQueryResult> = {}) =>
  vi.mocked(redriveQueryUseCase).mockResolvedValue({
    result: result(overrides),
    unavailable: false
  })

const givenWriteUnavailable = () =>
  vi
    .mocked(redriveQueryUseCase)
    .mockResolvedValue({ result: null, unavailable: true })

const confirm = async (url = confirmPath) => {
  const { result: body, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(body as unknown as string), statusCode }
}

const write = async (payload: Record<string, string> = {}) => {
  const { result: body, statusCode } = await server.inject({
    method: 'POST',
    url: writePath,
    payload,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(body as unknown as string), statusCode }
}

const textOf = ($: CheerioAPI, testId: string) =>
  $(`[data-testid="${testId}"]`).text().replace(/\s+/g, ' ').trim()

const xss = '<script>alert(1)</script>'

let server: Server

describe('redriveQueryConfirmRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    vi.mocked(getEventCountsUseCase).mockResolvedValue(facets())
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: confirmPath
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: confirmPath,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  // The figure is read here rather than trusted from the link that arrived: a
  // count on a query string is a count anybody can edit.
  test('counts the filters it was given, for itself', async () => {
    await confirm(`${confirmPath}?service=gas&q=gld-9b2&error=boom`)

    expect(getEventCountsUseCase).toHaveBeenCalledTimes(1)
    expect(getEventCountsUseCase).toHaveBeenCalledWith({
      service: 'gas',
      q: 'gld-9b2',
      error: 'boom',
      from: undefined,
      to: undefined
    })
  })

  test('says how many match, and how many a run will reach', async () => {
    const { $, statusCode } = await confirm()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'events-redrive-query-title')).toBe(
      'Redrive all 7,064 matching events?'
    )
    expect(textOf($, 'events-redrive-query-count')).toBe('7,064')
    expect(textOf($, 'events-redrive-query-limit')).toBe('500')
  })

  test('warns that the write is audited', async () => {
    const { $ } = await confirm()

    expect(textOf($, 'events-redrive-query-warning')).toContain('audited')
  })

  // The confirmation quotes the window back as a filter line, and quotes it
  // without a zone: every instant this app draws is UTC and none says so.
  test('writes no UTC label on the confirmation or its results', async () => {
    const { $ } = await confirm(
      `${confirmPath}?from=2026-06-16T09:00:00.000Z&to=2026-06-16T10:00:00.000Z`
    )

    expect($('main').html()).not.toContain('UTC')

    const { $: results } = await write({ service: 'gas' })

    expect(results('main').html()).not.toContain('UTC')
  })

  test('states the filters in the toolbar own words', async () => {
    const { $ } = await confirm(
      `${confirmPath}?status=DEAD_LETTER&service=gas&q=gld-9b2&error=boom`
    )

    const lines = $('[data-testid="events-redrive-query-filter"]')
      .toArray()
      .map((line) => textOf(load($(line).html() ?? ''), '') || $(line).text())
      .map((line) => line.replace(/\s+/g, ' ').trim())

    expect(lines).toEqual([
      'Status Dead letter',
      'Service GAS',
      'Search gld-9b2',
      'Error boom'
    ])
  })

  test('says plainly when nothing narrows the write', async () => {
    const { $ } = await confirm()

    expect(textOf($, 'events-redrive-query-no-filters')).toContain(
      'every dead letter'
    )
  })

  // Every filter restated as a hidden field, so the write asks exactly the
  // question the count above the button was read under. `status` is not among
  // them: the endpoint redrives dead letters and nothing else.
  test('carries every filter into the write, and no status', async () => {
    const { $ } = await confirm(
      `${confirmPath}?status=DEAD_LETTER&service=gas&error=boom`
    )

    const fields = $('[data-testid="events-redrive-query-field"]')
      .toArray()
      .map((field) => [$(field).attr('name'), $(field).attr('value')])

    expect(fields).toEqual([
      ['service', 'gas'],
      ['error', 'boom']
    ])
    expect($('[data-testid="events-redrive-query-form"]').attr('action')).toBe(
      writePath
    )
  })

  test('links back to the list it came from', async () => {
    const { $ } = await confirm(`${confirmPath}?status=DEAD_LETTER&service=gas`)

    expect($('[data-testid="events-redrive-query-cancel"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas'
    )
  })

  // The write is still offered — the backend counts it again for itself — but
  // the page does not invent a figure it could not obtain.
  test('offers the write without a figure when the count could not be read', async () => {
    vi.mocked(getEventCountsUseCase).mockResolvedValue(null)

    const { $ } = await confirm()

    expect(textOf($, 'events-redrive-query-count-unknown')).toContain(
      'could not be counted'
    )
    expect(textOf($, 'events-redrive-query-title')).toBe(
      'Redrive all matching events?'
    )
    expect($('[data-testid="events-redrive-query-confirm"]')).toHaveLength(1)
  })

  test('renders a hostile filter as text', async () => {
    const { $ } = await confirm(
      `${confirmPath}?error=${encodeURIComponent(xss)}`
    )

    const value = $('[data-testid="events-redrive-query-filter-value"]')

    expect(value.find('script')).toHaveLength(0)
    expect(value.text()).toContain(xss)
  })
})

describe('redriveQueryRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenResult()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: writePath,
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(redriveQueryUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: writePath,
      payload: {},
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(redriveQueryUseCase).not.toHaveBeenCalled()
  })

  // The filters the operator confirmed, the cap this app applies, and the name
  // of the person who pressed it.
  test('writes with the confirmed filters, capped, naming who asked', async () => {
    await write({ service: 'gas', error: 'boom' })

    expect(redriveQueryUseCase).toHaveBeenCalledTimes(1)
    expect(redriveQueryUseCase).toHaveBeenCalledWith(
      {
        service: 'gas',
        error: 'boom',
        q: undefined,
        from: undefined,
        to: undefined,
        limit: '500'
      },
      'Ada Lovelace'
    )
  })

  test('reports every figure the run came to', async () => {
    const { $, statusCode } = await write()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'events-redrive-query-results-title')).toBe(
      'Redrove 498 of 7,064 matching events'
    )
    expect(textOf($, 'events-redrive-query-matched')).toBe('Matched 7,064')
    expect(textOf($, 'events-redrive-query-processed')).toBe('Processed 500')
    expect(textOf($, 'events-redrive-query-redriven')).toBe('Redriven 498')
    expect(textOf($, 'events-redrive-query-conflicts')).toBe('Conflicts 1')
    expect(textOf($, 'events-redrive-query-failures')).toBe('Failures 1')
  })

  test('reports each source separately', async () => {
    const { $ } = await write()

    const rows = $('[data-testid="events-redrive-query-source-row"]')
      .toArray()
      .map((row) => $(row).text().replace(/\s+/g, ' ').trim())

    expect(rows).toEqual([
      'GAS · Outbox 7,000 480 478 1 1',
      'CW · Inbox 64 20 0 0 0'
    ])
  })

  // More matched than one run could reach, so there is more to do — and the
  // way to do it is the confirmation again, not a second write from here.
  test('offers another run when it did not reach everything it matched', async () => {
    const { $ } = await write({ service: 'gas' })

    expect(
      $('[data-testid="events-redrive-query-run-again"]').attr('href')
    ).toBe(
      '/dev-ops/events/redrive-query-confirm?service=gas&status=DEAD_LETTER'
    )
  })

  test('offers no second run once everything matched was processed', async () => {
    givenResult({ matched: 12, processed: 12, redriven: 12 })

    const { $ } = await write()

    expect($('[data-testid="events-redrive-query-run-again"]')).toHaveLength(0)
  })

  test('names the sources that could not be written to', async () => {
    givenResult({
      sourceErrors: [
        { service: 'caseworking', box: 'inbox', message: 'timeout' }
      ]
    })

    const { $ } = await write()

    expect(textOf($, 'events-redrive-query-partial')).toContain('CW · Inbox')
  })

  test('says nothing was redriven when the write could not be made', async () => {
    givenWriteUnavailable()

    const { $ } = await write()

    expect(textOf($, 'events-redrive-query-error')).toContain(
      'Nothing has been redriven'
    )
    expect($('[data-testid="events-redrive-query-summary"]')).toHaveLength(0)
  })

  test('links back to the list the flow started on', async () => {
    const { $ } = await write({ service: 'gas' })

    expect(
      $('[data-testid="events-redrive-query-results-back"]').attr('href')
    ).toBe('/dev-ops/events?service=gas&status=DEAD_LETTER')
  })
})
