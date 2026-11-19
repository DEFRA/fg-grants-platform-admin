import Boom from '@hapi/boom'
import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'
import type {
  ListAnswer,
  ListPages,
  ListQuery
} from '../repositories/lists.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import {
  closeHrefOf,
  expectTablesStyled,
  isOpenWithoutScript,
  styleNonceOf,
  tableStyles
} from '../test-utils.ts'
import {
  fullCatalogue,
  outboxBucket,
  pagedInbox
} from '../use-cases/test-fixtures.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { Catalogue } from '../use-cases/shell-catalogue.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/lists.repository.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:20:00.000Z')

const outboxPath = '/dev-ops/events/gas/outbox'

const eventRow = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: '66f000000000000000000001',
  time: '2026-10-13T14:53:00.000Z',
  title: 'UpdateCaseStatus',
  subtitle: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  cells: { status: 'DEAD_LETTER', completedAt: null },
  link: {
    kind: 'event',
    service: 'gas',
    box: 'outbox',
    id: '66f000000000000000000001'
  },
  ...overrides
})

const exact = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'gas.outbox',
  plan: {
    kind: 'exact',
    index: ['status'],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [eventRow()],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  ...overrides
})

const bounded = (page: Partial<BucketResult['page']>, rows: BucketRow[] = []) =>
  exact({
    plan: { ...exact().plan, kind: 'bounded' },
    rows,
    page: {
      next: null,
      keepLooking: null,
      searchedTo: null,
      complete: false,
      ...page
    }
  })

/** How the fake GAS answers one ask, once it has found the list at the path. */
type Reply = (ask: ListQuery) => Promise<ListAnswer>

let held: Catalogue

let replies: Reply[]

const entryAt = (path: string) =>
  held.buckets.find((bucket) => bucket.path === path)

const toPages = (
  pages: BucketResult[],
  overrides: Partial<ListPages> = {}
): ListPages => ({
  ...pages[pages.length - 1],
  rows: pages.flatMap(({ rows }) => rows),
  total: pages[0].total,
  pageRows: pages.map(({ rows }) => rows.length),
  stopped: null,
  refusedSearch: null,
  ...overrides
})

/** Every page read, joined as GAS joins them. */
const restored =
  (pages: BucketResult[], overrides: Partial<ListPages> = {}): Reply =>
  async (ask) => ({
    shell: { catalogue: held },
    bucket: entryAt(ask.path)?.id ?? pages[0].bucket,
    list: toPages(pages, overrides)
  })

const answered = (
  page: BucketResult = exact(),
  overrides: Partial<ListPages> = {}
): Reply => restored([page], overrides)

/** As @hapi/wreck rejects for GAS's answer, carrying its body. */
const gasAnswer = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: {
      isResponseError: true,
      payload: { statusCode, ...body, shell: { catalogue: held } }
    }
  })

const rejecting =
  (error: () => unknown): Reply =>
  async () => {
    throw error()
  }

/** A failure GAS answered carries the shell; one it never answered carries none, so the page has no lists. */
const failures: Record<GasFailure['kind'], () => unknown> = {
  'timed-out': () => gasAnswer(statusCodes.gatewayTimeout),
  errored: () => gasAnswer(statusCodes.internalServerError),
  'cw-not-reached': () =>
    gasAnswer(statusCodes.serviceUnavailable, { errorCode: 'CW_UNREACHABLE' }),
  refused: () => gasAnswer(statusCodes.conflict),
  'no-answer': () => {
    vi.mocked(shellCatalogue).mockReturnValue(null)

    return Boom.gatewayTimeout('Client request timeout')
  },
  'not-connected': () => {
    vi.mocked(shellCatalogue).mockReturnValue(null)

    return Boom.badGateway(
      'Client request error',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )
  }
}

const failed = ({ kind }: GasFailure): Reply => rejecting(failures[kind])

const refused: Reply = rejecting(() =>
  gasAnswer(statusCodes.badRequest, {
    message: '"ref-value" must be at most 100 characters'
  })
)

const addressRefused: Reply = rejecting(() =>
  gasAnswer(statusCodes.badRequest, {
    code: 'ADDRESS_REFUSED',
    problems: { unknownKeys: [], repeatedKeys: [], unknownValues: [] },
    bucket: 'gas.outbox'
  })
)

const given = (...queued: Reply[]) => {
  replies.push(...queued)
}

const isCwMissing = () => held.sourceErrors.some(({ hop }) => hop === 'CW-BE')

/** GAS: the list at the path, else why there is none, then the answer queued for it. */
const noListAt = () =>
  isCwMissing()
    ? gasAnswer(statusCodes.serviceUnavailable, { code: 'CW_UNREACHABLE' })
    : gasAnswer(statusCodes.notFound, { code: 'LIST_NOT_FOUND' })

const fakeGas = async (ask: ListQuery): Promise<ListAnswer> => {
  const entry = entryAt(ask.path)

  if (entry === undefined) {
    throw noListAt()
  }

  const reply = replies.shift()

  if (reply) {
    return reply(ask)
  }

  return ask.read === false
    ? { shell: { catalogue: held }, bucket: entry.id, list: null }
    : answered()(ask)
}

const withCatalogue = (catalogue: Catalogue) => {
  held = catalogue
  vi.mocked(shellCatalogue).mockReturnValue(catalogue)
}

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

/** Times in UTC unless the test sets them. */
const withTimes = (cookie: string) =>
  cookie.includes('dev-ops-times')
    ? cookie
    : [cookie, 'dev-ops-times=utc'].filter(Boolean).join('; ')

const view = async (url = outboxPath, cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: { cookie: withTimes(cookie) }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return {
    $,
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie,
    csp: headers['content-security-policy']
  }
}

const post = async (
  payload: Record<string, string>,
  cookie = '',
  url = outboxPath
) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: { cookie, 'sec-fetch-site': 'same-origin' }
  })

  return {
    $: load(result as unknown as string),
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

/** Searches, then opens the list it redirects to, with the session the search set. */
const searched = async (kind: string, value: string) => {
  const posted = await post({ 'ref-kind': kind, 'ref-value': value })

  return view(posted.location, posted.cookie)
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) => flat(by($, testId).text())

const headers = ($: CheerioAPI) =>
  by($, 'list-table')
    .find('th')
    .toArray()
    .map((th) => flat($(th).text()))

const firstRowCells = ($: CheerioAPI) =>
  by($, 'list-row')
    .first()
    .find('td')
    .toArray()
    .map((td) => flat($(td).text()))

const chipItems = ($: CheerioAPI, fact: string) =>
  by($, `list-chip-${fact}`)
    .find('.gpa-menuitem')
    .toArray()
    .map((item) => ({
      text: flat($(item).find('.gpa-menuitem-label').text()),
      value: $(item).find('input[type="checkbox"]').attr('value'),
      checked: $(item).find('input[type="checkbox"]').is('[checked]')
    }))

const chipForm = ($: CheerioAPI, fact: string) =>
  by($, `list-chip-${fact}`).find('form')

const keptBy = ($: CheerioAPI, fact: string) =>
  chipForm($, fact)
    .find('input[type="hidden"]')
    .toArray()
    .map((input) => `${$(input).attr('name')}=${$(input).attr('value')}`)

const clearOf = ($: CheerioAPI, fact: string) =>
  by($, `list-chip-${fact}`).find('.gpa-menu-actions a').attr('href')

/** What a browser sends for a chip's form with no script: its hidden fields, then the boxes ticked. */
const applied = (
  $: CheerioAPI,
  fact: string,
  ticks: (value: string) => boolean
): string => {
  const form = chipForm($, fact)
  const params = new URLSearchParams()

  form.find('input').each((_i, input) => {
    const field = $(input)
    const isBox = field.attr('type') === 'checkbox'

    if (!isBox || ticks(String(field.attr('value')))) {
      params.append(String(field.attr('name')), String(field.attr('value')))
    }
  })

  return `${form.attr('action')}?${params}`
}

const totalOf = ($: CheerioAPI) => $('.gpa-filterbar-row .gpa-filterbar-total')

const tags = ($: CheerioAPI) =>
  by($, 'list-applied')
    .find('.gpa-tag')
    .toArray()
    .map((tag) => flat($(tag).find('.gpa-tag-label').text()))

const alertOf = ($: CheerioAPI) => ({
  tone: (by($, 'list-alert').attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
  title: flat(by($, 'list-alert').find('.gpa-alert-title').text()),
  body: flat(by($, 'list-alert').find('.gpa-alert-body > div').first().text())
})

/** What GAS was asked for on the latest read. */
const asked = () => vi.mocked(queryList).mock.calls.at(-1)?.[0]

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.setSystemTime(now)
  withCatalogue(fullCatalogue)
  replies = []
  vi.mocked(queryList).mockReset()
  vi.mocked(queryList).mockImplementation(fakeGas)
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('Loaded', () => {
  test('GAS outbox: title, service, the Outbox tab, the prototype’s columns and a row that opens the event', async () => {
    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'list-title')).toBe('Events')
    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(
      by($, 'list-tabs')
        .find('a')
        .toArray()
        .map((a) => [
          flat($(a).text()),
          $(a).attr('href'),
          $(a).attr('aria-current')
        ])
    ).toEqual([
      ['Outbox', outboxPath, 'page'],
      ['Inbox', '/dev-ops/events/gas/inbox', undefined]
    ])
    expect(by($, 'list-tabs').attr('aria-label')).toBe('Queue')
    expect(headers($)).toEqual(['Event', 'Event ID', 'Status', 'Created'])
    expect(firstRowCells($)).toEqual([
      'UpdateCaseStatus',
      '5208709c-e2d5-4870-b6ae-ff168bf65726',
      'Dead letter',
      '13 Oct 2026 14:53',
      ''
    ])
    expect(by($, 'list-row').find('.gpa-rowlink').attr('href')).toBe(
      '/dev-ops/events/gas/outbox/66f000000000000000000001?back=%2Fdev-ops%2Fevents%2Fgas%2Foutbox%3Fthrough%3D1%23row-1-1'
    )
    expect(by($, 'list-row').find('td').eq(1).attr('class')).toBe(
      'gpa-cell-mono'
    )
    expect(by($, 'list-row').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(by($, 'list-row').find('time').attr('title')).toBe(
      '13 Oct 2026 14:53:00 UTC'
    )
    expect(by($, 'list-footer')).toHaveLength(0)
  })

  test('the columns keep the prototype’s widths, and the time sits on the right', async () => {
    const { $ } = await view()

    expect($('gpa-data-table').attr('data-cols')).toBe(
      'minmax(220px, 1fr) 336px 128px var(--size-column-date) var(--size-column-chevron)'
    )
    expect(by($, 'list-row').find('td').eq(3).attr('class')).toBe('gpa-right')
  })

  test('the widths are in a <style> the response’s policy allows, so every browser draws them on load', async () => {
    const first = await view()
    const second = await view()

    expect(tableStyles(first.$, first.csp)).toEqual([
      { label: 'Events', nonced: true, widths: true }
    ])
    expect(first.$('style[nonce]').text()).toContain(
      '--gpa-cols:minmax(220px, 1fr) 336px 128px var(--size-column-date) var(--size-column-chevron);'
    )
    expect(styleNonceOf(second.csp)).not.toBe(styleNonceOf(first.csp))
    expect(second.$('style[nonce]').attr('nonce')).toBe(
      styleNonceOf(second.csp)
    )
  })

  test('the prototype’s tones: Queued is info, Failed danger', async () => {
    given(
      answered(
        exact({
          rows: [
            eventRow({ cells: { status: 'PUBLISHED' } }),
            eventRow({ cells: { status: 'FAILED' } }),
            eventRow({ cells: { status: 'COMPLETED' } })
          ]
        })
      )
    )

    const { $ } = await view()

    expect(
      by($, 'list-row')
        .find('.gpa-dot')
        .toArray()
        .map((dot) => $(dot).attr('class'))
    ).toEqual([
      'gpa-dot gpa-dot-info',
      'gpa-dot gpa-dot-danger',
      'gpa-dot gpa-dot-success'
    ])
  })

  test('Inbox: the inbox is current, its time is Created as on the outbox, and it has no audit switch', async () => {
    given(answered(exact({ bucket: 'gas.inbox' })))

    const { $ } = await view('/dev-ops/events/gas/inbox')

    expect(by($, 'list-tabs').find('[aria-current="page"]').text()).toBe(
      'Inbox'
    )
    expect(headers($).at(-1)).toBe('Created')
    expect(by($, 'list-range').find('.gpa-chip-label').text()).toBe('Created:')
    expect(chipItems($, 'eventType').map(({ text }) => text)).toEqual([
      'AgreementStatusUpdated',
      'CaseStatusUpdated'
    ])
  })

  test('Outbox dead letters: the Inbox tab opens the inbox on the same filter', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(
      by($, 'list-tabs')
        .find('a')
        .toArray()
        .map((a) => $(a).attr('href'))
    ).toEqual([
      `${outboxPath}?status=DEAD_LETTER`,
      '/dev-ops/events/gas/inbox?status=DEAD_LETTER'
    ])
  })

  test('CW: the service is Caseworking', async () => {
    const { $ } = await view('/dev-ops/events/cw/outbox')

    expect(flat($('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(by($, 'list-tabs').find('a').first().attr('href')).toBe(
      '/dev-ops/events/cw/outbox'
    )
  })

  test('the browser tab names the queue, and the sidebar marks Events', async () => {
    const { $ } = await view()

    expect($('title').text()).toBe('GAS outbox – Grants Platform')
    expect($('[data-testid="shell-nav-gas.outbox"]').attr('aria-current')).toBe(
      'page'
    )
  })

  test('the page loads only the components’ stylesheet', async () => {
    const { $ } = await view()

    expect(
      $('link[rel="stylesheet"]')
        .map((_i, link) => $(link).attr('href'))
        .get()
    ).toEqual(['/public/src/dev-ops/views/components/index.css'])
  })
})

describe('filters', () => {
  test('Status: every value a box to tick, with no counts beside them or total', async () => {
    const { $ } = await view()
    const box = (text: string, value: string) => ({
      text,
      value,
      checked: false
    })

    expect(chipItems($, 'status')).toEqual([
      box('Queued', 'PUBLISHED'),
      box('Processing', 'PROCESSING'),
      box('Failed', 'FAILED'),
      box('Resubmitted', 'RESUBMITTED'),
      box('Completed', 'COMPLETED'),
      box('Dead letter', 'DEAD_LETTER'),
      box('Purged', 'PURGED')
    ])
    expect(
      by($, 'list-chip-status').find('input[type="checkbox"][name="status"]')
    ).toHaveLength(7)
    expect(by($, 'list-chip-status').find('.gpa-menuitem-meta')).toHaveLength(0)
  })

  test('no value set: the chip reads All, Apply sends the list’s other filters only, and Clear is off', async () => {
    const { $ } = await view()

    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe('All')
    expect(chipForm($, 'status').attr('method')).toBe('get')
    expect(chipForm($, 'status').attr('action')).toBe(outboxPath)
    expect(keptBy($, 'status')).toEqual([])
    expect(clearOf($, 'status')).toBeUndefined()
    expect(
      by($, 'list-chip-status')
        .find('.gpa-menu-actions a')
        .attr('aria-disabled')
    ).toBe('true')
  })

  test('a chosen value: the chip names it and ticks it, the other chip’s Apply keeps it, and its tag removes it', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe(
      'Dead letter'
    )
    expect(
      chipItems($, 'status')
        .filter(({ checked }) => checked)
        .map(({ value }) => value)
    ).toEqual(['DEAD_LETTER'])
    expect(keptBy($, 'status')).toEqual([])
    expect(keptBy($, 'eventType')).toEqual(['status=DEAD_LETTER'])
    expect(clearOf($, 'status')).toBe(outboxPath)
    expect(tags($)).toEqual(['Status is Dead letter'])
    expect(by($, 'list-applied').find('.gpa-tag a').attr('href')).toBe(
      outboxPath
    )
    expect($('.gpa-chip-clear')).toHaveLength(0)
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
    expect(asked()?.params).toEqual({ status: 'DEAD_LETTER' })
  })

  test('Times opens from the address over a filtered list, which keeps its filters', async () => {
    const page = `${outboxPath}?status=DEAD_LETTER`
    const { $, statusCode } = await view(`${page}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(closeHrefOf($, 'times-dialog')).toBe(page)
    expect(asked()?.params).toEqual({ status: 'DEAD_LETTER' })
  })

  test('two statuses: the chip says 2 selected, each is ticked, and each has its own tag', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER&status=FAILED`)

    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe(
      '2 selected'
    )
    expect(
      chipItems($, 'status')
        .filter(({ checked }) => checked)
        .map(({ text }) => text)
    ).toEqual(['Failed', 'Dead letter'])
    expect(tags($)).toEqual(['Status is Failed', 'Status is Dead letter'])
    expect(
      by($, 'list-applied')
        .find('.gpa-tag a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual([
      `${outboxPath}?status=DEAD_LETTER`,
      `${outboxPath}?status=FAILED`
    ])
    expect(clearOf($, 'status')).toBe(outboxPath)
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
    expect(asked()?.params).toEqual({ status: ['DEAD_LETTER', 'FAILED'] })
  })

  test('two statuses travel with every other form: the next chip’s Apply, the time range and the search', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER&status=FAILED`)
    const fieldsOf = (form: ReturnType<CheerioAPI>) =>
      form
        .find('input[type="hidden"][name="status"]')
        .toArray()
        .map((input) => $(input).attr('value'))

    expect(fieldsOf(chipForm($, 'eventType'))).toEqual([
      'DEAD_LETTER',
      'FAILED'
    ])
    expect(fieldsOf(by($, 'list-range').find('form'))).toEqual([
      'DEAD_LETTER',
      'FAILED'
    ])
    expect(fieldsOf(by($, 'list-search').find('form'))).toEqual([
      'DEAD_LETTER',
      'FAILED'
    ])
  })

  test('Clear drops only its own chip’s values, keeping the other filters and the time range', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&status=FAILED&event=CreateCase&from=2026-11-03&to=2026-11-09`
    )

    expect(clearOf($, 'status')).toBe(
      `${outboxPath}?event=CreateCase&from=2026-11-03&to=2026-11-09`
    )
    expect(clearOf($, 'eventType')).toBe(
      `${outboxPath}?status=DEAD_LETTER&status=FAILED&from=2026-11-03&to=2026-11-09`
    )
  })

  test('two filters: a tag for each value, and Clear all goes to the bare list', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&event=UpdateCaseStatus`
    )

    expect(tags($)).toEqual([
      'Event is UpdateCaseStatus',
      'Status is Dead letter'
    ])
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
  })

  test('the row goes Created, Event, Status, then the search', async () => {
    const { $ } = await view()

    expect(
      $('.gpa-filterbar-row')
        .children()
        .toArray()
        .map((child) =>
          $(child).is('[data-testid="list-search"]')
            ? 'search'
            : flat($(child).find('.gpa-chip-label').first().text())
        )
        .filter(Boolean)
    ).toEqual(['Created:', 'Event:', 'Status:', 'search'])
  })

  test('no filter set: no tag and no Clear all', async () => {
    const { $ } = await view()

    expect(tags($)).toEqual([])
    expect(by($, 'list-clear-all')).toHaveLength(0)
  })

  test('Audit is one more Event type, listed last, and none ticked filters by no type', async () => {
    const { $ } = await view()

    expect(chipItems($, 'eventType').map(({ text }) => text)).toEqual([
      'CreateCase',
      'UpdateCaseStatus',
      'Audit'
    ])
    expect(asked()?.params).toEqual({})
  })

  test('Event is Audit: picked as any type is', async () => {
    const { $ } = await view(`${outboxPath}?event=Audit`)

    expect(tags($)).toEqual(['Event is Audit'])
    expect(asked()?.params).toEqual({ event: 'Audit' })
  })

  test('an old link with the audit switch on goes to the same list without it, every other filter kept', async () => {
    const { statusCode, location } = await view(
      `${outboxPath}?status=DEAD_LETTER&audit=on&event=CreateCase&from=2026-11-03&to=2026-11-09`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(
      `${outboxPath}?status=DEAD_LETTER&event=CreateCase&from=2026-11-03&to=2026-11-09`
    )
    expect(queryList).not.toHaveBeenCalled()
  })

  test('an old audit link with a key the list doesn’t declare goes there without the switch, where GAS refuses it as any such address', async () => {
    const { statusCode, location } = await view(`${outboxPath}?audit=on&nope=1`)

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(`${outboxPath}?nope=1`)
    expect(queryList).not.toHaveBeenCalled()

    given(addressRefused)
    const refusedPage = await view(location)

    expect(refusedPage.statusCode).toBe(statusCodes.badRequest)
    expect(asked()?.params).toEqual({ nope: '1' })
  })

  test('the interim error filter: Error name is …, in code, with its remove link', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&errorname=MongoServerError`
    )

    expect(tags($)).toEqual([
      'Status is Dead letter',
      'Error name is MongoServerError'
    ])
    expect(
      by($, 'list-applied').find('.gpa-tag').eq(1).find('strong').attr('class')
    ).toBe('gpa-mono')
    expect(by($, 'list-applied').find('.gpa-tag a').eq(1).attr('href')).toBe(
      `${outboxPath}?status=DEAD_LETTER`
    )
    expect(asked()?.params).toEqual({
      status: 'DEAD_LETTER',
      errorname: 'MongoServerError'
    })
  })

  test('the Overview error filter: Error is …, in code', async () => {
    const { $ } = await view(`${outboxPath}?error=abc123`)

    expect(tags($)).toEqual(['Error is abc123'])
  })

  test('the Overview error filter on a thrown Error: the message, as the Overview row shows it', async () => {
    const { $ } = await view(
      `${outboxPath}?error=${encodeURIComponent('Error: Invalid status transition')}`
    )

    expect(tags($)).toEqual(['Error is Invalid status transition'])
    expect(asked()?.params).toEqual({
      error: 'Error: Invalid status transition'
    })
  })

  test('Created: quick ranges are links that keep the other filters, and Any time is first', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    const presets = by($, 'list-range')
      .find('.gpa-range-presets a')
      .toArray()
      .map((a) => [flat($(a).text()), $(a).attr('href')])

    expect(presets).toEqual([
      ['Any time', `${outboxPath}?status=DEAD_LETTER`],
      [
        'Last hour',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-13T14%3A20%3A00.000Z&range=1h`
      ],
      [
        'Last 24 hours',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-12T15%3A20%3A00.000Z&range=24h`
      ],
      [
        'Last 7 days',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-06T15%3A20%3A00.000Z&range=7d`
      ],
      [
        'Last 30 days',
        `${outboxPath}?status=DEAD_LETTER&from=2026-09-13T15%3A20%3A00.000Z&range=30d`
      ]
    ])
    expect(
      by($, 'list-range')
        .find('form input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([['status', 'DEAD_LETTER']])
    expect(by($, 'list-range').attr('data-max')).toBe('2026-10-13')
  })

  test('Created, a quick range: the chip and its tag name it', async () => {
    const { $ } = await view(
      `${outboxPath}?from=2026-10-12T15%3A20%3A00.000Z&range=24h`
    )

    expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
      'Last 24 hours'
    )
    expect(tags($)).toEqual(['Created is Last 24 hours'])
    expect(by($, 'list-applied').find('.gpa-tag a').attr('href')).toBe(
      outboxPath
    )
    expect(asked()?.from).toBe('2026-10-12T15:20:00.000Z')
  })

  test('Created, a quick range from an old link: still the last 24 hours, as its chip says', async () => {
    const { $ } = await view(
      `${outboxPath}?from=2026-10-10T15%3A20%3A00.000Z&range=24h`
    )

    expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
      'Last 24 hours'
    )
    expect(asked()?.from).toBe('2026-10-12T15:20:00.000Z')
  })

  test('Created, a quick range shown more of later: the next page keeps the start its first page read from', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const { $ } = await view(
      `${outboxPath}?from=2026-10-13T14%3A00%3A00.000Z&range=1h`
    )
    const next = String(by($, 'list-footer').find('a').attr('href'))

    expect(asked()).toMatchObject({ from: '2026-10-13T14:20:00.000Z' })
    expect(next).toBe(
      `${outboxPath}?cursor=c2&page=2&from=2026-10-13T14%3A20%3A00.000Z&range=1h`
    )

    vi.setSystemTime(new Date(now.getTime() + 20 * 60 * 1000))
    const later = await view(next)

    expect(asked()).toMatchObject({
      from: '2026-10-13T14:20:00.000Z',
      cursor: 'c2'
    })
    expect(by(later.$, 'list-range').find('.gpa-chip-value').text()).toBe(
      'Last hour'
    )
  })

  test('Created, from the calendar: whole days in the chosen zone, "Created is 3–9 Nov 2026"', async () => {
    const { $ } = await view(`${outboxPath}?from=2026-11-03&to=2026-11-09`)

    expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
      '3–9 Nov 2026'
    )
    expect(tags($)).toEqual(['Created is 3–9 Nov 2026'])
    expect(by($, 'list-range').find('input[name="from"]').attr('value')).toBe(
      '2026-11-03'
    )
    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-11-03T00:00:00.000Z',
        to: '2026-11-09T23:59:59.999Z'
      })
    )
  })

  test('Created, from the calendar in UK time: the day’s edges are UK midnight', async () => {
    await view(
      `${outboxPath}?from=2026-10-01&to=2026-10-02`,
      'dev-ops-times=uk'
    )

    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-09-30T23:00:00.000Z',
        to: '2026-10-02T22:59:59.999Z'
      })
    )
  })

  test('a day that doesn’t exist is a bad link', async () => {
    const { statusCode } = await view(`${outboxPath}?from=2026-02-30`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})

describe('a chip’s Apply, with no script', () => {
  test('the boxes are real checkboxes in a GET form, Apply its submit, ready without a script', async () => {
    const { $ } = await view()
    const chip = by($, 'list-chip-status')
    const apply = chipForm($, 'status').find('button[type="submit"]')

    expect(flat(apply.text())).toBe('Apply')
    expect(apply.is('[disabled]')).toBe(false)
    expect(apply.attr('form')).toBeUndefined()
    expect(chip.find('[popovertarget]').attr('aria-haspopup')).toBe('dialog')
    expect(chipForm($, 'status').attr('role')).toBe('dialog')
    expect(chipForm($, 'status').attr('aria-label')).toBe('Status')
    expect(
      chipForm($, 'status').find('[role="group"]').attr('aria-label')
    ).toBeUndefined()
    expect(chip.find('[role="menuitemcheckbox"]')).toHaveLength(0)
    expect(chip.find('a[href*="status="]')).toHaveLength(0)
  })

  test.each([
    ['none', [] as string[], {}, 'All'],
    ['one', ['FAILED'], { status: 'FAILED' }, 'Failed'],
    [
      'several',
      ['FAILED', 'DEAD_LETTER'],
      { status: ['FAILED', 'DEAD_LETTER'] },
      '2 selected'
    ]
  ])(
    '%s ticked: one request, the field repeated per value, read as a list',
    async (_name, ticks, params, chipText) => {
      const first = await view(`${outboxPath}?event=CreateCase`)
      vi.mocked(queryList).mockClear()

      const { $, statusCode } = await view(
        applied(first.$, 'status', (value) => ticks.includes(value)),
        first.cookie
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(queryList).toHaveBeenCalledTimes(1)
      expect(asked()?.params).toEqual({ ...params, event: 'CreateCase' })
      expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe(
        chipText
      )
      expect(
        chipItems($, 'status')
          .filter(({ checked }) => checked)
          .map(({ value }) => value)
      ).toEqual(ticks)
    }
  )

  test('unticking every value but one of several applies the one left', async () => {
    const first = await view(`${outboxPath}?status=FAILED&status=DEAD_LETTER`)

    await view(
      applied(first.$, 'status', (value) => value === 'DEAD_LETTER'),
      first.cookie
    )

    expect(asked()?.params).toEqual({ status: 'DEAD_LETTER' })
  })

  test('Clear reads the list without the chip’s values, the other filters kept', async () => {
    const first = await view(
      `${outboxPath}?status=FAILED&status=DEAD_LETTER&event=CreateCase`
    )

    const { $ } = await view(String(clearOf(first.$, 'status')), first.cookie)

    expect(asked()?.params).toEqual({ event: 'CreateCase' })
    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe('All')
  })
})

describe('the time range in links', () => {
  test('every chip’s Apply, a set chip’s Clear and every tag link carry the range as days, as the range chip does', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&from=2026-10-01&to=2026-10-31`
    )
    const range = 'from=2026-10-01&to=2026-10-31'
    const links = [
      clearOf($, 'status'),
      by($, 'list-applied').find('.gpa-tag a').eq(1).attr('href')
    ]

    expect(links.every((href) => href?.includes(range))).toBe(true)
    expect(keptBy($, 'status')).toEqual(['from=2026-10-01', 'to=2026-10-31'])
    expect(keptBy($, 'eventType')).toEqual([
      'status=DEAD_LETTER',
      'from=2026-10-01',
      'to=2026-10-31'
    ])
    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.999Z'
      })
    )
  })
})

describe('a value its fact doesn’t offer', () => {
  test.each(['status=BOGUS', 'status=FAILED&status=BOGUS', 'event=Nope'])(
    '%s, refused by GAS as an address the list can’t read, is said so',
    async (query) => {
      given(addressRefused)

      const { $, statusCode } = await view(`${outboxPath}?${query}`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(alertOf($).title).toBe(
        'This address has a filter the list doesn’t have.'
      )
      expect(queryList).toHaveBeenCalledTimes(1)
    }
  )

  test.each([
    ['status=BOGUS', []],
    ['status=FAILED&status=BOGUS', ['Status is Failed']]
  ])(
    '%s: the value it doesn’t offer is never shown as chosen',
    async (query, shown) => {
      given(addressRefused)

      const { $ } = await view(`${outboxPath}?${query}`)

      expect(tags($)).toEqual(shown)
      expect(flat(by($, 'list-chip-status').text())).not.toContain('BOGUS')
    }
  )

  test('a code a version sits within is read even with no rows yet, as a version page links to it', async () => {
    const { statusCode } = await view(
      '/dev-ops/applications?grant=new-grant&version=1.0.0'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(asked()?.params).toEqual({
      grant: 'new-grant',
      version: '1.0.0'
    })
  })
})

describe('a time range the list can’t read', () => {
  test.each([
    ['a start that isn’t a date', 'from=yesterday'],
    ['a start after its end', 'from=2026-11-14&to=2026-11-01']
  ])(
    '%s is refused in words, GAS only checking the address, and isn’t shown as chosen',
    async (_name, query) => {
      const { $, statusCode } = await view(
        `${outboxPath}?status=DEAD_LETTER&${query}`
      )

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(alertOf($)).toEqual({
        tone: 'warning',
        title: 'This address has a time range the list can’t read.',
        body: 'Its start and end must be dates, the start no later than the end. Nothing was read. Start again to see the list.'
      })
      expect(by($, 'list-alert').find('code')).toHaveLength(0)
      expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
        'Any time'
      )
      expect(tags($)).toEqual(['Status is Dead letter'])
      expect(queryList).toHaveBeenCalledTimes(1)
      expect(asked()).toMatchObject({ read: false })
      expect(asked()).not.toHaveProperty('from')
    }
  )

  test('GAS refusing the range itself is said the same way', async () => {
    given(
      rejecting(() =>
        gasAnswer(statusCodes.badRequest, {
          code: 'RANGE_REFUSED',
          bucket: 'gas.outbox'
        })
      )
    )

    const { $, statusCode } = await view(`${outboxPath}?from=2026-11-01`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe(
      'This address has a time range the list can’t read.'
    )
  })

  test('an address GAS refuses before the range is refused as an address', async () => {
    given(addressRefused)

    const { $ } = await view(`${outboxPath}?nope=1&from=yesterday`)

    expect(alertOf($).title).toBe(
      'This address has a filter the list doesn’t have.'
    )
    expect(asked()).toMatchObject({ read: false })
  })
})

describe('a key that takes one value, given twice', () => {
  test.each(['error=A&error=B', 'errorname=A&errorname=B'])(
    '%s, refused by GAS as an address the list can’t read, is said so',
    async (query) => {
      given(addressRefused)

      const { $, statusCode } = await view(`${outboxPath}?${query}`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(alertOf($).title).toBe(
        'This address has a filter the list doesn’t have.'
      )
      expect(queryList).toHaveBeenCalledTimes(1)
    }
  )

  test('a search posted as a form with it twice is stored and redirected to, and GAS refuses the address there', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: outboxPath,
      payload: 'error=A&error=B&ref-kind=id&ref-value=abc-123',
      auth: { strategy: 'session', credentials },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin'
      }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${outboxPath}?error=A&error=B`)
    expect(queryList).not.toHaveBeenCalled()
  })
})

describe('the total', () => {
  test.each([
    [{ count: 12456, capped: false }, '12,456 events'],
    [{ count: 10000, capped: true }, '10,000+ events'],
    [{ count: 1, capped: false }, '1 event'],
    [{ count: 0, capped: false }, '0 events']
  ])('%j: "%s" at the end of the filter row', async (total, text) => {
    given(answered(exact({ total })))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat(totalOf($).text())).toBe(text)
    expect(totalOf($).attr('role')).toBe('status')
    expect($('.gpa-filterbar-row').children().last().is(totalOf($))).toBe(true)
  })

  test('a search is counted too', async () => {
    given(answered(exact({ total: { count: 1, capped: false } })))

    const { $ } = await searched('id', 'abc-123')

    expect(tags($)).toEqual(['Event ID is abc-123'])
    expect(flat(totalOf($).text())).toBe('1 event')
  })

  test('drawn with no filter applied, when there is no applied row', async () => {
    given(answered(exact({ total: { count: 3, capped: false } })))

    const { $ } = await view()

    expect(flat(totalOf($).text())).toBe('3 events')
    expect(by($, 'list-applied')).toHaveLength(0)
  })

  test('the list’s own noun: "4 applications"', async () => {
    given(answered(exact({ rows: [], total: { count: 4, capped: false } })))

    const { $ } = await view('/dev-ops/applications')

    expect(flat(totalOf($).text())).toBe('4 applications')
  })

  test.each([
    [
      'on a bounded read',
      answered({
        ...bounded({
          keepLooking: 'k1',
          searchedTo: '2026-10-06T14:00:00.000Z'
        }),
        total: null
      })
    ],
    ['from a service that doesn’t count yet', answered(exact())],
    ['when the list couldn’t be read', failed({ kind: 'errored' })]
  ])('none %s', async (_why, read) => {
    given(read)

    const { $ } = await view()

    expect(totalOf($)).toHaveLength(0)
  })
})

describe('search', () => {
  test('the kinds are the catalogue’s, in its order, posted to the list with the other filters', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    const form = by($, 'list-search').find('form')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(outboxPath)
    expect(
      form
        .find('select[name="ref-kind"] option')
        .toArray()
        .map((option) => [$(option).attr('value'), $(option).text()])
    ).toEqual([
      ['ref', 'Reference'],
      ['trace', 'Trace ID'],
      ['id', 'Event ID']
    ])
    expect(form.find('input[type="hidden"][name="status"]').val()).toBe(
      'DEAD_LETTER'
    )
    expect(form.find('input[name="ref-value"]')).toHaveLength(1)
  })

  test('one kind only: no picker, and the form carries its kind, so posting it as drawn searches by it', async () => {
    withCatalogue({ buckets: [pagedInbox], sourceErrors: [] })

    const { $ } = await view('/dev-ops/events/gas/inbox')
    const form = by($, 'list-search').find('form')
    const fields = Object.fromEntries(
      form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).val()])
    )

    expect(form.find('select')).toHaveLength(0)
    expect(fields).toEqual({ 'ref-kind': 'trace' })
    expect(form.find('input[name="ref-kind"]')).toHaveLength(1)

    const posted = await post(
      { ...fields, 'ref-value': '0b7c1d1e' },
      '',
      '/dev-ops/events/gas/inbox'
    )

    expect(posted.statusCode).toBe(statusCodes.seeOther)

    await view(posted.location, posted.cookie)

    expect(asked()?.search).toBe('trace:0b7c1d1e')
  })

  test('both kind pickers are drawn, so CSS picks one by scripting and nothing swaps on load', async () => {
    const { $ } = await view()
    const picker = by($, 'list-search').find('gpa-search-kind')
    const menu = picker.children('gpa-dropdown[data-gpa-picker]')

    expect(
      picker.children('select.gpa-search-kind-native').is('[hidden]')
    ).toBe(false)
    expect(menu.is('[hidden]')).toBe(false)
    expect(
      menu
        .find('.gpa-menuitem')
        .toArray()
        .map((item) => [$(item).attr('data-value'), flat($(item).text())])
    ).toEqual([
      ['ref', 'Reference'],
      ['trace', 'Trace ID'],
      ['id', 'Event ID']
    ])
  })

  test('a search is kept out of the address: the list reads it back and tags it, in code', async () => {
    const posted = await post({ 'ref-kind': 'id', 'ref-value': 'abc-123' })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(outboxPath)

    const { $ } = await view(posted.location, posted.cookie)

    expect(asked()?.search).toBe('id:abc-123')
    expect(tags($)).toEqual(['Event ID is abc-123'])
    expect(by($, 'list-search-input').find('input').attr('value')).toBe(
      'abc-123'
    )
  })

  test('a search posted as a form keeps two statuses, sent as two fields', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: outboxPath,
      payload: 'status=DEAD_LETTER&status=FAILED&ref-kind=id&ref-value=abc-123',
      auth: { strategy: 'session', credentials },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin'
      }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      `${outboxPath}?status=DEAD_LETTER&status=FAILED`
    )
  })

  test('the search tag clears it with a post, as it was set', async () => {
    const { $ } = await searched('id', 'abc-123')

    const remove = by($, 'list-applied').find('.gpa-tag button')
    const form = $(`#${remove.attr('form')}`)

    expect(remove.attr('name')).toBe('ref-value')
    expect(remove.attr('value')).toBe('')
    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(outboxPath)
    expect(form.find('input[name="ref-value"]')).toHaveLength(0)
  })

  test('Clear all drops the stored search too', async () => {
    const { $, cookie } = await searched('id', 'abc-123')
    const clearAll = by($, 'list-clear-all')

    expect(clearAll.attr('href')).toBe(`${outboxPath}?clear=all`)

    const withStatus = await view(`${outboxPath}?status=DEAD_LETTER`, cookie)
    const href = by(withStatus.$, 'list-clear-all').attr('href')

    expect(href).toBe(`${outboxPath}?clear=all`)

    const cleared = await view(href, withStatus.cookie)

    expect(cleared.statusCode).toBe(statusCodes.found)
    expect(cleared.location).toBe(outboxPath)

    await view(cleared.location, cleared.cookie)

    expect(asked()?.search).toBeNull()
  })

  test('bad characters: the box says why, with what was typed, and nothing is stored', async () => {
    const { $, statusCode, cookie } = await post({
      'ref-kind': 'ref',
      'ref-value': 'a b'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(textOf($, 'list-search-error')).toBe(
      'Enter an identifier using only letters, numbers and . _ : @ -'
    )
    expect(by($, 'list-search-input').find('input').attr('value')).toBe('a b')
    expect(queryList).toHaveBeenCalledTimes(1)
    expect(asked()).toMatchObject({ search: null, params: {} })

    await view(outboxPath, cookie)

    expect(asked()?.search).toBeNull()
  })
})

describe('a search posted', () => {
  test('is stored and redirected to without asking GAS, the filters posted kept', async () => {
    const posted = await post({
      'ref-kind': 'id',
      'ref-value': 'abc-123',
      status: 'DEAD_LETTER',
      from: '2026-11-01'
    })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(
      `${outboxPath}?status=DEAD_LETTER&from=2026-11-01`
    )
    expect(queryList).not.toHaveBeenCalled()
  })

  test('of a kind the list hasn’t got is stored too: GAS refuses it on the list, which then forgets it', async () => {
    const posted = await post({ 'ref-kind': 'nothing', 'ref-value': 'x' })

    expect(posted.statusCode).toBe(statusCodes.seeOther)

    given(answered(exact(), { refusedSearch: { refusal: null } }))
    const refusedPage = await view(posted.location, posted.cookie)

    expect(asked()?.search).toBe('nothing:x')
    expect(alertOf(refusedPage.$).title).toBe('GAS refused this search.')

    await view(posted.location, refusedPage.cookie)

    expect(asked()?.search).toBeNull()
  })

  test('to the list’s address with a trailing slash is stored under its path, as the list reads it', async () => {
    const posted = await post(
      { 'ref-kind': 'id', 'ref-value': 'abc-123' },
      '',
      `${outboxPath}/`
    )

    expect(posted.location).toBe(outboxPath)

    await view(outboxPath, posted.cookie)

    expect(asked()).toMatchObject({
      path: 'events/gas/outbox',
      search: 'id:abc-123'
    })
  })

  test('to a path no list could have is not found, and GAS isn’t asked for it', async () => {
    const posted = await post(
      { 'ref-kind': 'id', 'ref-value': 'abc-123' },
      '',
      '/dev-ops/events/gas/out%20box'
    )

    expect(posted.statusCode).toBe(statusCodes.notFound)
    expect(queryList).not.toHaveBeenCalled()
  })

  test.each<Record<string, string>>([
    { q: 'rev' },
    { search: 'rev' },
    { ref: 'rev' },
    { kind: 'id' },
    { cursor: 'c1', page: '2', searched: 'x', through: '3' },
    { clear: 'all', expired: '1' }
  ])('carries only the list’s filters, never %j', async (stray) => {
    const posted = await post({
      'ref-kind': 'id',
      'ref-value': 'abc-123',
      status: 'DEAD_LETTER',
      ...stray
    })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(`${outboxPath}?status=DEAD_LETTER`)
  })

  test.each(['ref-junk', 'q[]', 'a b'])(
    'with a field no filter could be, %s, is refused, and redirects nowhere',
    async (junk) => {
      const posted = await post({
        'ref-kind': 'id',
        'ref-value': 'abc-123',
        [junk]: 'rev'
      })

      expect(posted.statusCode).toBe(statusCodes.badRequest)
      expect(posted.location).toBeUndefined()
    }
  )

  test.each([
    '/dev-ops/explore/values',
    '/dev-ops/clients',
    '/dev-ops/clients/gas/nothing',
    '/dev-ops/times/zone',
    '/dev-ops/events',
    '/dev-ops/events/gas',
    '/dev-ops/events/gas/outbox/abc',
    '/dev-ops/events/gas/outbox/abc/nothing',
    '/dev-ops/applications/APP-1',
    '/dev-ops/cases/CASE-1/nothing',
    '/dev-ops/grants/code/1',
    '/dev-ops/workflows/code'
  ])(
    'to %s, which another route owns, is not found, and redirects nowhere',
    async (url) => {
      const posted = await post({ 'ref-kind': 'id', q: 'rev' }, '', url)

      expect(posted.statusCode).toBe(statusCodes.notFound)
      expect(posted.location).toBeUndefined()
      expect(queryList).not.toHaveBeenCalled()
    }
  )

  test.each([
    '/dev-ops/applications',
    '/dev-ops/cases',
    '/dev-ops/grants',
    '/dev-ops/workflows',
    '/dev-ops/events/cw/inbox'
  ])('to the list at %s is still a list’s search', async (url) => {
    const posted = await post(
      { 'ref-kind': 'id', 'ref-value': 'abc-123' },
      '',
      url
    )

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(url)
  })

  test('to a list GAS hasn’t got, with a box it couldn’t take: the list is read to draw it, and is not found', async () => {
    const posted = await post(
      { 'ref-kind': 'id', 'ref-value': 'a b' },
      '',
      '/dev-ops/nothing/here'
    )

    expect(posted.statusCode).toBe(statusCodes.notFound)
    expect(queryList).toHaveBeenCalledTimes(1)
  })
})

describe('the stored search', () => {
  const later = () =>
    vi.setSystemTime(new Date(now.getTime() + 15 * 60 * 1000 + 1))

  /** Whether the latest read told GAS it was a repeat. */
  const repeated = () => asked()?.repeat

  test('is forgotten after 15 minutes, and the list browses again', async () => {
    const posted = await post({ 'ref-kind': 'ref', 'ref-value': 'abc-123' })

    later()
    const { $ } = await view(posted.location, posted.cookie)

    expect(asked()?.search).toBeNull()
    expect(repeated()).toBe(false)
    expect(tags($)).toEqual([])
  })

  test('a later page of a search older than 15 minutes goes back to the first page, and GAS isn’t asked', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const { $, cookie } = await searched('ref', 'abc-123')
    const next = by($, 'list-footer').find('a').attr('href') ?? ''

    expect(next).toMatch(/searched=/)

    later()
    vi.mocked(queryList).mockClear()
    const { statusCode, location } = await view(next, cookie)

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(`${outboxPath}?expired=1`)
    expect(queryList).not.toHaveBeenCalled()
  })

  test('keeps each list’s search apart from another list’s', async () => {
    const posted = await post({ 'ref-kind': 'ref', 'ref-value': 'abc-123' })

    await view('/dev-ops/events/gas/inbox', posted.cookie)

    expect(asked()?.search).toBeNull()

    await view(posted.location, posted.cookie)

    expect(asked()?.search).toBe('ref:abc-123')
  })

  test('a reload of the same first page is a repeat; the first render after a search or a filter change is not', async () => {
    const posted = await post({ 'ref-kind': 'ref', 'ref-value': 'abc-123' })

    await view(posted.location, posted.cookie)
    expect(repeated()).toBe(false)

    await view(posted.location, posted.cookie)
    expect(repeated()).toBe(true)

    await view(`${outboxPath}?status=DEAD_LETTER`, posted.cookie)
    expect(repeated()).toBe(false)

    await view(`${outboxPath}?status=DEAD_LETTER`, posted.cookie)
    expect(repeated()).toBe(true)
    expect(asked()?.search).toBe('ref:abc-123')
  })

  test('a browse is a repeat on reload too, and a later page never is', async () => {
    const first = await view()

    expect(repeated()).toBe(false)

    await view(outboxPath, first.cookie)
    expect(repeated()).toBe(true)

    await view(`${outboxPath}?cursor=c2`, first.cookie)
    expect(repeated()).toBe(false)
  })

  test('a search posted from another origin is refused with 403, and nothing is stored', async () => {
    const first = await view()
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: outboxPath,
      payload: { 'ref-kind': 'ref', 'ref-value': 'abc-123' },
      auth: { strategy: 'session', credentials },
      headers: { cookie: first.cookie, 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)

    await view(outboxPath, cookieOf(headers['set-cookie']) || first.cookie)

    expect(asked()?.search).toBeNull()
  })
})

describe('No matches', () => {
  test('filters on: the prototype’s empty state, and the tags stay', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&event=CreateCase`
    )

    expect(flat($('.gpa-empty-title').text())).toBe('No events match')
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Nothing created in this time range has this status and event.'
    )
    expect(tags($)).toHaveLength(2)
  })

  test('only a search on: the search names what had no match', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await searched('trace', 'abc')

    expect(flat($('.gpa-empty-body').text())).toBe(
      'No events have this trace ID.'
    )
  })

  test('a search with filters on: the search names what had no match under them', async () => {
    given(answered(exact({ rows: [] })), answered(exact({ rows: [] })))

    const { cookie } = await searched('id', 'abc-123')
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`, cookie)

    expect(flat($('.gpa-empty-title').text())).toBe('No events match')
    expect(flat($('.gpa-empty-body').text())).toBe(
      'No events with these filters have this event ID.'
    )
  })

  test('nothing on: the queue is empty, and says what would be here', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await view()

    expect(flat($('.gpa-empty-title').text())).toBe('No events yet')
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Events GAS sends appear here.'
    )
  })
})

describe('paging', () => {
  test('a next page: Show more links to it, and the element loads it in place', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(by($, 'list-footer').parent().is('gpa-load-more')).toBe(true)
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c2&page=2&status=DEAD_LETTER`
    )
    expect(flat(by($, 'list-footer').text())).toBe('Show more events')
    expect($('tbody#list-rows')).toHaveLength(1)
  })

  test('a later page is that page’s rows, read from its cursor, with no empty state', async () => {
    given(answered(exact({ rows: [] })))

    const { $, statusCode } = await view(`${outboxPath}?cursor=c2`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(asked()?.cursor).toBe('c2')
    expect($('.gpa-empty')).toHaveLength(0)
  })

  test('a row on a later page goes back to every page through its own, landing on the row, so Back finds it again with or without a script', async () => {
    given(answered(exact({ rows: [eventRow(), eventRow({ id: 'r2' })] })))

    const { $ } = await view(
      `${outboxPath}?cursor=c3&page=3&status=DEAD_LETTER`
    )

    expect(
      by($, 'list-row')
        .toArray()
        .map((row) => $(row).attr('id'))
    ).toEqual(['row-3-1', 'row-3-2'])
    expect(by($, 'list-row').eq(1).find('a').first().attr('href')).toBe(
      `${outboxPath}/66f000000000000000000001?back=${encodeURIComponent(
        `${outboxPath}?through=3&status=DEAD_LETTER#row-3-2`
      )}`
    )
  })

  test('Searched, keep looking: where the read stopped, and the way on', async () => {
    given(
      answered(
        bounded({ keepLooking: 'k1', searchedTo: '2026-10-06T14:00:00.000Z' }, [
          eventRow()
        ])
      )
    )

    const { $ } = await searched('ref', 'abc')
    const id = asked()

    expect(id?.search).toBe('ref:abc')
    expect(flat(by($, 'list-footer').find('span').first().text())).toBe(
      'Searched back to 6 Oct 2026 14:00.'
    )
    expect(flat(by($, 'list-footer').find('a').text())).toBe('Keep looking')
    expect(by($, 'list-footer').find('a').attr('href')).toMatch(
      /^\/dev-ops\/events\/gas\/outbox\?cursor=k1&searched=[0-9a-f-]{36}&page=2$/
    )
  })

  test('Searched, keep looking, nothing yet: the empty state says so and the footer stays', async () => {
    given(
      answered(
        bounded({ keepLooking: 'k1', searchedTo: '2026-10-06T14:00:00.000Z' })
      )
    )

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat($('.gpa-empty-title').text())).toBe('No matches so far')
    expect(by($, 'list-footer')).toHaveLength(1)
  })

  test('Searched everything: a bounded read that reached the end says so', async () => {
    given(answered(bounded({ complete: true }, [eventRow()])))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat(by($, 'list-footer').text())).toBe('Searched everything.')
  })

  test('an exact read that reached the end says nothing more', async () => {
    const { $ } = await view()

    expect(by($, 'list-footer')).toHaveLength(0)
  })

  test('Load more failed: the page, no rows, and a retry of the same page; the element sees the failure', async () => {
    given(failed({ kind: 'errored' }))

    const { $, statusCode } = await view(`${outboxPath}?cursor=c2`)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(by($, 'list-row')).toHaveLength(0)
    expect(by($, 'list-alert')).toHaveLength(0)
    expect(flat(by($, 'list-footer').find('.gpa-text-danger').text())).toBe(
      'Couldn’t load more events — GAS answered with an error.'
    )
    expect(flat(by($, 'list-footer').find('a').text())).toBe('Retry')
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c2&page=2`
    )
    expect(by($, 'list-footer').attr('role')).toBe('alert')
  })

  test('a later page of a search no longer held goes back to the first page, which says the search has expired', async () => {
    const { statusCode, location, cookie } = await view(
      `${outboxPath}?cursor=c2&searched=0b7c1d1e-0000-4000-8000-000000000001&status=DEAD_LETTER`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(`${outboxPath}?expired=1&status=DEAD_LETTER`)

    const { $ } = await view(location, cookie)

    expect(alertOf($)).toEqual({
      tone: 'info',
      title: 'This search has expired.',
      body: 'Search again to see its results.'
    })
    expect(asked()?.cursor).toBeUndefined()
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
  })

  test('the first page draws no notice of its own', async () => {
    const { $ } = await view()

    expect(by($, 'list-alert')).toHaveLength(0)
  })
})

describe('restoring every row shown', () => {
  const page = (ids: string[], next: string | null) =>
    exact({
      rows: ids.map((id) => eventRow({ id })),
      page: { ...exact().page, next },
      total: { count: 5, capped: false }
    })

  const restoreOf = ($: CheerioAPI) =>
    by($, 'list-footer').attr('data-restore-href')

  const rowIds = ($: CheerioAPI) =>
    by($, 'list-row')
      .toArray()
      .map((row) => $(row).attr('id'))

  test('the footer carries the address of every row shown after each page: the first, a later one, and the last', async () => {
    given(answered(page(['a', 'b'], 'c2')))
    const first = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(restoreOf(first.$)).toBe(
      `${outboxPath}?through=1&status=DEAD_LETTER`
    )

    given(answered(page(['c', 'd'], 'c3')))
    const second = await view(
      String(by(first.$, 'list-footer').find('a').attr('href')),
      first.cookie
    )

    expect(restoreOf(second.$)).toBe(
      `${outboxPath}?through=2&status=DEAD_LETTER`
    )
    expect(by(second.$, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c3&page=3&status=DEAD_LETTER`
    )

    given(answered(page(['e'], null)))
    const last = await view(
      String(by(second.$, 'list-footer').find('a').attr('href')),
      first.cookie
    )

    expect(restoreOf(last.$)).toBe(`${outboxPath}?through=3&status=DEAD_LETTER`)
    expect(flat(by(last.$, 'list-footer').text())).toBe('No more events.')
    expect(by(last.$, 'list-footer').parent().is('gpa-load-more')).toBe(false)
  })

  test('its address draws every row through that page, read page by page as Show more read them, with the way on', async () => {
    given(
      restored([
        page(['a', 'b'], 'c2'),
        page(['c', 'd'], 'c3'),
        page(['e'], 'c4')
      ])
    )

    const { $, statusCode } = await view(
      `${outboxPath}?through=3&status=DEAD_LETTER`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(queryList).toHaveBeenCalledTimes(1)
    expect(asked()).toMatchObject({ pages: 3, repeat: true, count: true })
    expect(asked()).not.toHaveProperty('cursor')
    expect(asked()?.params).toEqual({ status: 'DEAD_LETTER' })
    expect(rowIds($)).toEqual([
      'row-1-1',
      'row-1-2',
      'row-2-1',
      'row-2-2',
      'row-3-1'
    ])
    expect(flat(totalOf($).text())).toBe('5 events')
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c4&page=4&status=DEAD_LETTER`
    )
    expect(restoreOf($)).toBe(`${outboxPath}?through=3&status=DEAD_LETTER`)
  })

  test('each row goes back to the pages through its own, landing on it', async () => {
    given(restored([page(['a'], 'c2'), page(['b'], null)]))

    const { $ } = await view(`${outboxPath}?through=2`)

    expect(by($, 'list-row').eq(1).find('a').first().attr('href')).toBe(
      `${outboxPath}/66f000000000000000000001?back=${encodeURIComponent(
        `${outboxPath}?through=2#row-2-1`
      )}`
    )
    expect(by($, 'list-row').eq(0).find('a').first().attr('href')).toContain(
      encodeURIComponent(`${outboxPath}?through=1#row-1-1`)
    )
  })

  test('each row carries the address that draws its own page, on either side of the most an address draws', async () => {
    given(
      restored(
        Array.from({ length: 50 }, (_, at) => page([`r${at}`], `c${at + 2}`))
      )
    )
    const first = await view(`${outboxPath}?through=50`)
    const restoreOfRow = ($: CheerioAPI, id: string) =>
      $(`#${id}`).attr('data-restore-href')

    expect(restoreOfRow(first.$, 'row-1-1')).toBe(`${outboxPath}?through=1`)
    expect(restoreOfRow(first.$, 'row-50-1')).toBe(`${outboxPath}?through=50`)

    given(answered(page(['z'], 'c52')))
    const later = await view(
      String(by(first.$, 'list-footer').find('a').attr('href')),
      first.cookie
    )
    const pageAt = `${outboxPath}?cursor=c51&page=51`

    expect(restoreOfRow(later.$, 'row-51-1')).toBe(pageAt)
    expect(restoreOf(later.$)).toBe(pageAt)

    first.$('#list-rows').append(later.$('#list-rows').children())

    expect(restoreOfRow(first.$, 'row-1-1')).toBe(`${outboxPath}?through=1`)
    expect(restoreOfRow(first.$, 'row-51-1')).toBe(pageAt)
  })

  test('a quick range keeps the start its first page was read from', async () => {
    vi.setSystemTime(new Date(now.getTime() + 20 * 60 * 1000))
    given(answered(page(['a'], 'c2')))

    const { $ } = await view(
      `${outboxPath}?through=1&from=2026-10-13T14%3A20%3A00.000Z&range=1h`
    )

    expect(asked()).toMatchObject({ from: '2026-10-13T14:20:00.000Z' })
    expect(restoreOf($)).toBe(
      `${outboxPath}?through=1&from=2026-10-13T14%3A20%3A00.000Z&range=1h`
    )
  })

  test('a search’s pages name it by its id, never by what was searched for, and run it again', async () => {
    given(answered(page(['a'], 'c2')))
    const first = await searched('ref', 'abc-123')

    given(restored([page(['a'], 'c2'), page(['b'], null)]))
    const restore = String(restoreOf(first.$)).replace('through=1', 'through=2')

    expect(restore).toMatch(
      /^\/dev-ops\/events\/gas\/outbox\?searched=[0-9a-f-]{36}&through=2$/
    )

    const { $ } = await view(restore, first.cookie)

    expect(asked()).toMatchObject({ search: 'ref:abc-123', pages: 2 })
    expect(rowIds($)).toEqual(['row-1-1', 'row-2-1'])
    expect(tags($)).toEqual(['Reference is abc-123'])
    expect(
      $('a[href], [data-restore-href], form[action]')
        .toArray()
        .flatMap((el) => [
          $(el).attr('href') ?? '',
          $(el).attr('data-restore-href') ?? '',
          $(el).attr('action') ?? ''
        ])
        .filter((href) => href.includes('abc-123'))
    ).toEqual([])
  })

  test('a search no longer held: the first page, saying it has expired, and nothing read; to the loader, a conflict naming it', async () => {
    const restore = `${outboxPath}?searched=0b7c1d1e-0000-4000-8000-000000000001&through=2`
    const { statusCode, location } = await view(restore)
    const loaded = await server.inject({
      method: 'GET',
      url: restore,
      auth: { strategy: 'session', credentials },
      headers: {
        cookie: 'dev-ops-times=utc',
        'x-requested-with': 'gpa-load-more'
      }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(`${outboxPath}?expired=1`)
    expect(loaded.statusCode).toBe(statusCodes.conflict)
    expect(loaded.headers.location).toBe(`${outboxPath}?expired=1`)
    expect(queryList).not.toHaveBeenCalled()
  })

  test('a later page that can’t be read: the rows before it, and a retry of that page', async () => {
    given(
      answered(page(['a'], 'c2'), {
        stopped: { cursor: 'c2', statusCode: 504, code: 'TIMED_OUT' }
      })
    )

    const { $, statusCode } = await view(`${outboxPath}?through=3`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(rowIds($)).toEqual(['row-1-1'])
    expect(by($, 'list-alert')).toHaveLength(0)
    expect(flat(by($, 'list-footer').find('.gpa-text-danger').text())).toBe(
      'Couldn’t load more events — GAS didn’t answer in time.'
    )
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c2&page=2`
    )
    expect(restoreOf($)).toBe(`${outboxPath}?through=1`)
  })

  test('a later page that stopped with no code GAS named reads as an error', async () => {
    given(
      answered(page(['a'], 'c2'), {
        stopped: { cursor: 'c2', statusCode: 500, code: null }
      })
    )

    const { $ } = await view(`${outboxPath}?through=3`)

    expect(flat(by($, 'list-footer').find('.gpa-text-danger').text())).toBe(
      'Couldn’t load more events — GAS answered with an error.'
    )
  })

  test('a first page that can’t be read: the list’s alert, retrying the same address', async () => {
    given(failed({ kind: 'errored' }))

    const { $ } = await view(`${outboxPath}?through=2`)

    expect(by($, 'list-retry').attr('href')).toBe(`${outboxPath}?through=2`)
  })

  test.each([
    ['a cursor and a restore at once', '?cursor=c2&through=2'],
    ['a page number without a cursor', '?page=3'],
    ['more pages than one address draws', '?through=51'],
    ['a first page numbered as a later one', '?cursor=c2&page=1'],
    ['an expired notice that isn’t one', '?expired=yes']
  ])('refuses %s', async (_name, query) => {
    const { statusCode } = await view(`${outboxPath}${query}`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(queryList).not.toHaveBeenCalled()
  })

  test('past the most pages one address draws, the footer’s address is the page’s own cursor', async () => {
    given(answered(page(['a'], 'c61')))

    const { $ } = await view(`${outboxPath}?cursor=c60&page=60`)

    expect(restoreOf($)).toBe(`${outboxPath}?cursor=c60&page=60`)
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c61&page=61`
    )
  })
})

test.each([
  ['Show more', `${outboxPath}?cursor=c2&page=2&status=DEAD_LETTER`],
  ['Keep looking', `${outboxPath}?cursor=k1&page=2`]
])(
  '%s asked for by the in-place loader: the page itself, never a redirect, with its rows to append',
  async (_name, url) => {
    given(answered(exact({ rows: [eventRow({ id: 'r9' })] })))

    const { statusCode, headers, result } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials },
      headers: {
        cookie: 'dev-ops-times=utc',
        'x-requested-with': 'gpa-load-more'
      }
    })
    const $ = load(result as unknown as string)

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect($('tbody#list-rows [data-testid="list-row"]')).toHaveLength(1)
  }
)

test('a later page of a search no longer held, asked for by the in-place loader: a conflict naming the first page, which the loader goes to rather than appending unsearched rows', async () => {
  const { statusCode, headers } = await server.inject({
    method: 'GET',
    url: `${outboxPath}?cursor=c2&searched=0b7c1d1e-0000-4000-8000-000000000001`,
    auth: { strategy: 'session', credentials },
    headers: {
      cookie: 'dev-ops-times=utc',
      'x-requested-with': 'gpa-load-more'
    }
  })

  expect(statusCode).toBe(statusCodes.conflict)
  expect(headers.location).toBe(`${outboxPath}?expired=1`)
  expect(queryList).not.toHaveBeenCalled()
})

describe('Search refused', () => {
  test('the service’s reason in code, the search cleared, and the rows GAS read without it', async () => {
    given(
      answered(exact(), {
        refusedSearch: { refusal: '"ref-value" must be at most 100 characters' }
      })
    )

    const { $, statusCode, cookie } = await searched('ref', 'a'.repeat(120))

    expect(statusCode).toBe(statusCodes.ok)
    expect(alertOf($)).toEqual({
      tone: 'warning',
      title: 'GAS refused this search.',
      body: '"ref-value" must be at most 100 characters The search has been cleared.'
    })
    expect(by($, 'list-alert').find('code').text()).toBe(
      '"ref-value" must be at most 100 characters'
    )
    expect(by($, 'list-start-again').attr('href')).toBe(outboxPath)
    expect(queryList).toHaveBeenCalledTimes(1)
    expect(asked()?.search).toBe(`ref:${'a'.repeat(120)}`)
    expect(by($, 'list-row')).toHaveLength(1)
    expect(tags($)).toEqual([])

    await view(outboxPath, cookie)

    expect(asked()?.search).toBeNull()
  })

  test('refused filters: the reason, Start again, and no rows', async () => {
    given(refused)

    const { $, statusCode } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe('GAS refused these filters.')
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test('a key the list doesn’t declare is GAS’s to refuse, sent as typed with every reserved key left out', async () => {
    given(addressRefused)

    const { $, statusCode } = await view(
      `${outboxPath}?nope=1&status=DEAD_LETTER&from=2026-11-01&range=&times=open`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe(
      'This address has a filter the list doesn’t have.'
    )
    expect(asked()?.params).toEqual({ nope: '1', status: 'DEAD_LETTER' })
  })
})

describe('Unavailable', () => {
  test('timed out: the prototype’s copy, Try again on this address, no table, the filters kept', async () => {
    given(failed({ kind: 'timed-out' }))

    const { $, statusCode } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(statusCode).toBe(statusCodes.gatewayTimeout)
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'The events list couldn’t be loaded.',
      body: 'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    })
    expect(by($, 'list-retry').attr('href')).toBe(
      `${outboxPath}?status=DEAD_LETTER`
    )
    expect(by($, 'list-table')).toHaveLength(0)
    expect(by($, 'list-chip-status')).toHaveLength(1)
  })

  test('answered with an error: says so, apart from a timeout, and where to look if it keeps failing', async () => {
    given(failed({ kind: 'errored' }))

    const { $, statusCode } = await view(outboxPath)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'The events list couldn’t be loaded.',
      body: 'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    })
    expect(by($, 'list-retry').attr('href')).toBe(outboxPath)
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test.each([['not-connected'], ['no-answer']] satisfies [
    GasFailure['kind']
  ][])(
    '%s: no answer carried the lists, so the page says they couldn’t be read, with no lists in the sidebar',
    async (kind) => {
      given(failed({ kind } as GasFailure))

      const { $, statusCode } = await view('/dev-ops/events/cw/outbox')

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(flat($('h1').text())).toBe('Dev Ops couldn’t read its lists')
      expect(by($, 'list-alert')).toHaveLength(0)
    }
  )

  test('GAS answering that it can’t build the catalogue: the same, with no lists', async () => {
    given(
      rejecting(() => {
        vi.mocked(shellCatalogue).mockReturnValue(null)

        return gasAnswer(statusCodes.serviceUnavailable, {
          code: 'CATALOGUE_UNAVAILABLE'
        })
      })
    )

    const { $, statusCode } = await view(outboxPath)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(flat($('h1').text())).toBe('Dev Ops couldn’t read its lists')
  })
})

describe('a CW list names the service its failure is down to', () => {
  test.each([
    [{ kind: 'timed-out' }, 'CW didn’t answer in time.'],
    [{ kind: 'cw-not-reached' }, 'CW couldn’t be reached.']
  ] satisfies [GasFailure, string][])(
    '%o: the alert and the load-more footer say "%s"',
    async (failure, text) => {
      given(failed(failure), failed(failure))

      const first = await view('/dev-ops/events/cw/outbox')
      const later = await view('/dev-ops/events/cw/outbox?cursor=c2')

      expect(alertOf(first.$).body).toBe(
        `${text} Nothing has changed — try again in a moment.`
      )
      expect(
        flat(by(later.$, 'list-footer').find('.gpa-text-danger').text())
      ).toBe(`Couldn’t load more events — ${text}`)
    }
  )
})

describe('Caseworking unreachable', () => {
  const cwDown: Catalogue = {
    buckets: fullCatalogue.buckets.filter(({ service }) => service !== 'CW'),
    sourceErrors: [{ hop: 'CW-BE' }]
  }

  test('a CW events address with CW missing from the catalogue says why, and isn’t a 404', async () => {
    withCatalogue(cwDown)

    const { $, statusCode } = await view('/dev-ops/events/cw/inbox')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(textOf($, 'list-title')).toBe('Events')
    expect(flat($('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'Caseworking can’t be reached.',
      body: 'GAS is up, but its calls to CW are failing, so CW’s events can’t be listed. Nothing has changed.'
    })
    expect(by($, 'list-retry').attr('href')).toBe('/dev-ops/events/cw/inbox')
    expect(by($, 'list-table')).toHaveLength(0)
    expect(by($, 'list-range')).toHaveLength(0)
    expect($('.gpa-filterbar')).toHaveLength(0)
    expect(queryList).toHaveBeenCalledTimes(1)
  })

  test('the sidebar keeps CW’s Events', async () => {
    withCatalogue(cwDown)

    const { $ } = await view('/dev-ops/events/cw/inbox')

    expect($('[data-testid="shell-nav-cw.outbox"]').attr('href')).toBe(
      '/dev-ops/events/cw/outbox'
    )
  })

  test.each([
    ['/dev-ops/cases', 'Cases', 'cases', 'cw.cases'],
    ['/dev-ops/workflows', 'Workflows', 'workflows', 'cw.workflows']
  ])(
    '%s with CW missing from the catalogue says why, keeps the sidebar, and isn’t a 404',
    async (url, title, noun, navId) => {
      withCatalogue(cwDown)

      const { $, statusCode } = await view(url)

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(textOf($, 'list-title')).toBe(title)
      expect(alertOf($)).toEqual({
        tone: 'danger',
        title: 'Caseworking can’t be reached.',
        body: `GAS is up, but its calls to CW are failing, so CW’s ${noun} can’t be listed. Nothing has changed.`
      })
      expect(by($, 'list-retry').attr('href')).toBe(url)
      expect($(`[data-testid="shell-nav-${navId}"]`).attr('href')).toBe(url)
      expect($(`[data-testid="shell-nav-${navId}"]`).attr('aria-current')).toBe(
        'page'
      )
      expect(queryList).toHaveBeenCalledTimes(1)
    }
  )

  test('a path no list of CW’s is at, while CW can’t be reached, can’t be told from a list: the lists couldn’t be read', async () => {
    withCatalogue(cwDown)

    const { $, statusCode } = await view('/dev-ops/nothing/here')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(flat($('h1').text())).toBe('Dev Ops couldn’t read its lists')
  })

  test('without the CW-BE source error, a missing list is not found', async () => {
    withCatalogue({ ...cwDown, sourceErrors: [] })

    const { statusCode } = await view('/dev-ops/events/cw/inbox')

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('the other lists, on the same page', () => {
  test('Applications: Reference, Grant and Received, no position, the service under the title', async () => {
    given(
      answered(
        exact({
          rows: [
            {
              id: 'a1',
              time: '2026-10-13T10:00:00.000Z',
              title: 'abc-123',
              subtitle: null,
              cells: {
                code: 'woodland@1.4.2',
                position: { phase: 'P', stage: 'S', status: 'X' }
              },
              link: {
                kind: 'application',
                code: 'woodland',
                clientRef: 'abc-123'
              }
            }
          ]
        })
      )
    )

    const { $ } = await view('/dev-ops/applications')

    expect(textOf($, 'list-title')).toBe('Applications')
    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(by($, 'list-tabs')).toHaveLength(0)
    expect(headers($)).toEqual(['Reference', 'Grant', 'Received'])
    expect(firstRowCells($)).toEqual([
      'abc-123',
      'woodland@1.4.2',
      '13 Oct 2026 10:00',
      ''
    ])
    expect(by($, 'list-range').find('.gpa-chip-label').text()).toBe('Received:')
  })

  test('Grants: one Grant column, Stored with its hint, the code alone without a version', async () => {
    given(
      answered(
        exact({
          rows: [
            {
              id: 'g1',
              time: '2026-10-13T10:00:00.000Z',
              title: 'woodland',
              subtitle: null,
              cells: {
                version: '1.4.2',
                definition: 'pending',
                status: 'active'
              },
              link: { kind: 'grant', code: 'woodland', version: '1.4.2' }
            },
            {
              id: 'g2',
              time: '2026-10-13T10:00:00.000Z',
              title: 'hedgerow',
              subtitle: null,
              cells: {
                version: null,
                definition: 'permanent_error',
                status: 'draft'
              },
              link: { kind: 'grant', code: 'hedgerow', version: '0.0.1' }
            }
          ]
        })
      )
    )

    const { $ } = await view('/dev-ops/grants')

    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(headers($)).toEqual(['Grant', 'Stored', 'Status', 'Received'])
    expect(firstRowCells($).slice(0, 3)).toEqual([
      'woodland@1.4.2',
      expect.stringContaining('Not stored yet'),
      'Active'
    ])
    expect(
      by($, 'list-row').first().find('gpa-tooltip').attr('text')
    ).toContain("isn't fetched by GAS yet")
    expect(flat(by($, 'list-row').eq(1).find('td').first().text())).toBe(
      'hedgerow'
    )
    expect(
      by($, 'list-row').eq(1).find('.gpa-dot').eq(0).attr('class')
    ).toContain('gpa-dot-danger')
    expect(
      by($, 'list-chip-worstFetchStatus').find('.gpa-chip-label').text()
    ).toBe('Stored:')
    expect(by($, 'list-search')).toHaveLength(0)
  })

  test('Workflows and Cases: CW’s, with their own labels', async () => {
    given(answered(exact({ rows: [] })), answered(exact({ rows: [] })))

    const workflows = await view('/dev-ops/workflows')
    const cases = await view('/dev-ops/cases')

    expect(headers(workflows.$)).toEqual([
      'Workflow',
      'Stored',
      'Status',
      'Received'
    ])
    expect(headers(cases.$)).toEqual(['Reference', 'Grant', 'Created'])
    expect(flat(workflows.$('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(flat(cases.$('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(flat(cases.$('.gpa-empty-body').text())).toBe(
      'Cases CW creates appear here.'
    )
  })
})

describe('a refused search on a later page', () => {
  test('is never added under the search’s rows: the first page, which runs the search again and draws the refusal', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const first = await searched('ref', 'abc')
    const href = by(first.$, 'list-footer').find('a').attr('href')!
    const refusedLater = answered(exact(), {
      refusedSearch: { refusal: 'ref is not valid' }
    })

    given(refusedLater)
    const plain = await view(href, first.cookie)

    expect(plain.statusCode).toBe(statusCodes.found)
    expect(plain.location).toBe(outboxPath)

    given(refusedLater)
    const loaded = await server.inject({
      method: 'GET',
      url: href,
      auth: { strategy: 'session', credentials },
      headers: {
        cookie: withTimes(first.cookie),
        'x-requested-with': 'gpa-load-more'
      }
    })

    expect(loaded.statusCode).toBe(statusCodes.conflict)
    expect(loaded.headers.location).toBe(outboxPath)
    expect(loaded.payload).toBe('')

    given(refusedLater)
    const { $ } = await view(outboxPath, first.cookie)

    expect(asked()?.search).toBe('ref:abc')
    expect(alertOf($).title).toBe('GAS refused this search.')
  })
})

test('a chosen audit value is named by its label', async () => {
  const { $ } = await view(`${outboxPath}?event=Audit`)

  expect(by($, 'list-chip-eventType').find('.gpa-chip-value').text()).toBe(
    'Audit'
  )
})

test('a subtitle the catalogue sends for a list with no subtitle column is drawn under the title', async () => {
  given(
    answered(
      exact({
        rows: [
          {
            id: 'a1',
            time: '2026-10-13T10:00:00.000Z',
            title: 'abc-123',
            subtitle: 'Woodland application',
            cells: { code: 'woodland@1.4.2' },
            link: {
              kind: 'application',
              code: 'woodland',
              clientRef: 'abc-123'
            }
          }
        ]
      })
    )
  )

  const { $ } = await view('/dev-ops/applications')

  expect(by($, 'list-row').find('td').first().text()).toContain(
    'Woodland application'
  )
})

describe('Open in Explore', () => {
  const formOf = ($: CheerioAPI) => {
    const form = $(`#${by($, 'list-explore').attr('form')}`)

    return {
      method: form.attr('method'),
      action: form.attr('action'),
      hidden: form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    }
  }

  test('posts the list and its filters to Explore, never in Explore’s address', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&event=CreateCase`
    )

    expect(textOf($, 'list-explore')).toBe('Open in Explore')
    expect(by($, 'list-explore').attr('type')).toBe('submit')
    expect(by($, 'list-explore').find('svg').attr('data-icon')).toBe(
      'telescope'
    )
    expect(formOf($)).toEqual({
      method: 'post',
      action: '/dev-ops/explore',
      hidden: [
        ['from', 'events/gas/outbox'],
        ['list', 'status=DEAD_LETTER&event=CreateCase']
      ]
    })
  })

  test.each([
    'applications',
    'grants',
    'cases',
    'workflows',
    'events/gas/inbox',
    'events/cw/outbox',
    'events/cw/inbox'
  ])('is on %s', async (path) => {
    const { $ } = await view(`/dev-ops/${path}`)

    expect(formOf($).hidden).toEqual([
      ['from', path],
      ['list', '']
    ])
  })

  test('is on no list Explore doesn’t read', async () => {
    withCatalogue({
      ...fullCatalogue,
      buckets: [{ ...outboxBucket, id: 'gas.other', path: 'other' }]
    })

    const { $ } = await view('/dev-ops/other')

    expect(by($, 'list-explore')).toHaveLength(0)
  })
})
