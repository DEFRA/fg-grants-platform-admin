import type { BucketResult } from '../repositories/buckets.repository.ts'
import {
  casesBucket,
  gasEvents,
  gasOutbox
} from '../use-cases/test-fixtures.ts'
import { toCaseworkingListAt } from './bucket-nav.ts'
import { toCaseworkingUnreachable, toListPage } from './list-page.view-model.ts'
import type { ListPageInput, ListPageModel } from './list-page.view-model.ts'
import { toTimes } from './times.ts'

const result = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'x',
  plan: {
    kind: 'exact',
    index: [],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  ...overrides
})

const chipOf = (page: ListPageModel, fact: string) =>
  page.chips.find((chip) => chip.fact === fact)!

const input = (overrides: Partial<ListPageInput> = {}): ListPageInput => ({
  bucket: gasOutbox,
  read: { kind: 'read', page: result() },
  filters: {},
  times: toTimes('utc'),
  search: null,
  now: new Date('2026-10-13T15:20:00.000Z'),
  ...overrides
})

describe('toListPage', () => {
  test('choosing a fact drops the facts within it, as a version is within its workflow', () => {
    const page = toListPage(
      input({
        bucket: casesBucket,
        filters: {
          workflowCode: 'example-grant',
          currentConfigVersion: '1.0.0'
        }
      })
    )

    expect(page.chips[0]).toEqual(
      expect.objectContaining({
        name: 'workflow',
        action: '/dev-ops/cases',
        keep: [],
        clearHref: '/dev-ops/cases'
      })
    )
    expect(chipOf(page, 'workflowCode').value).toBe('example-grant')
    expect(
      page.applied.map(({ label, value }) => `${label} is ${value}`)
    ).toEqual(['Version is 1.0.0'])
    expect(page.applied[0]).toEqual(
      expect.objectContaining({
        removeHref: '/dev-ops/cases?workflow=example-grant'
      })
    )
    expect(page.filtered).toBe(true)
  })

  test('nothing set: every chip reads All, no tags and not filtered', () => {
    const page = toListPage(input())

    expect(page.chips.map(({ value }) => value)).toEqual(['All', 'All'])
    expect(page.applied).toEqual([])
    expect(page.filtered).toBe(false)
  })

  test('several values: the chip says how many, and a tag each, in the menu’s order', () => {
    const page = toListPage(
      input({ filters: { status: ['DEAD_LETTER', 'FAILED'] } })
    )

    expect(chipOf(page, 'status').value).toBe('2 selected')
    expect(page.applied.map(({ value }) => value)).toEqual([
      'Failed',
      'Dead letter'
    ])
  })

  test('the error is the search: Error picked, the message shown, no tag, and the field leaves it to the chips', () => {
    const page = (errorKey: string) =>
      toListPage(
        input({ filters: { status: 'DEAD_LETTER', errorKey }, search: null })
      )
    const thrown = page('Error: Grant <v> not found')

    expect(thrown.searchField).toMatchObject({
      value: 'Grant <v> not found',
      hidden: [
        { name: 'status', value: 'DEAD_LETTER' },
        { name: 'ref-error-at', value: 'error' },
        { name: 'ref-error', value: 'Error: Grant <v> not found' }
      ]
    })
    expect(
      thrown.searchField?.kinds.map(({ text, checked }) => [text, checked])
    ).toContainEqual(['Error', true])
    expect(thrown.applied).toEqual([])
    expect(thrown.filtered).toBe(false)
    expect(page('No error recorded').searchField?.value).toBe(
      'No error recorded'
    )
  })

  test('an error search with no match names it', () => {
    const page = toListPage(
      input({
        filters: { errorKey: 'Error: Boom' },
        read: { kind: 'read', page: result({ rows: [] }) }
      })
    )

    expect(page.table?.empty?.text).toBe('No events have this error.')
  })

  test('a chosen value the catalogue no longer lists is kept in the menu', () => {
    const page = toListPage(input({ filters: { eventType: 'Retired' } }))

    expect(chipOf(page, 'eventType').items.at(-1)).toEqual(
      expect.objectContaining({ text: 'Retired', checked: true })
    )
  })

  test('a held search: shown in the field by its kind, with no tag; Clear all drops it', () => {
    const page = toListPage(
      input({
        search: { q: 'id:abc', id: 'u1' },
        filters: { status: ['DEAD_LETTER', 'FAILED'] }
      })
    )

    expect(page.searchField?.value).toBe('abc')
    expect(page.applied.map(({ key }) => key)).toEqual(['status', 'status'])
    expect(page.filtered).toBe(true)
    expect(page.clearAllHref).toBe('/dev-ops/events/gas/outbox?clear=all')
    expect(page.searchField?.kinds.find(({ checked }) => checked)?.value).toBe(
      'id'
    )
  })

  test('a later page of a search names it in its own next link, and the address of every page through it', () => {
    const page = toListPage(
      input({
        search: { q: 'ref:abc', id: 'u1' },
        cursor: 'c1',
        page: 4,
        read: {
          kind: 'read',
          page: result({
            page: {
              next: 'c2',
              keepLooking: null,
              searchedTo: null,
              complete: false
            }
          })
        }
      })
    )

    expect(page.table?.footer).toEqual({
      state: 'more',
      nextHref: '/dev-ops/events/gas/outbox?cursor=c2&searched=u1&page=5',
      restoreHref: '/dev-ops/events/gas/outbox?searched=u1&through=4',
      noun: 'events'
    })
  })

  const laterPage = (page: number, read: ListPageInput['read']) =>
    toListPage(
      input({ search: { q: 'ref:abc', id: 'u1' }, cursor: 'c1', page, read })
    )

  const linkedRow = {
    id: 'r',
    time: 'not a time',
    title: 'T',
    subtitle: null,
    cells: {},
    link: { kind: 'event', service: 'gas', box: 'outbox', id: 'e1' }
  }

  const backOf = (href: string | null | undefined): string | null =>
    href ? new URL(href, 'http://x').searchParams.get('back') : null

  test.each([
    [50, '/dev-ops/events/gas/outbox?searched=u1&through=50#row-50-1'],
    [51, '/dev-ops/events/gas/outbox?cursor=c1&searched=u1&page=51#row-51-1']
  ])(
    'a row on page %i goes back to an address that draws its page',
    (at, back) => {
      const page = laterPage(at, {
        kind: 'read',
        page: result({
          rows: [linkedRow],
          page: {
            next: 'c2',
            keepLooking: null,
            searchedTo: null,
            complete: false
          }
        })
      })

      const [restoreHref] = back.split('#')

      expect(backOf(page.table?.rows[0].href)).toBe(back)
      expect(page.table).toMatchObject({
        rows: [{ restoreHref: at > 50 ? restoreHref : null }],
        footer: { restoreHref }
      })
    }
  )

  test('a later page past the most an address draws with no rows keeps its own address, as its rows would', () => {
    const page = laterPage(51, {
      kind: 'read',
      page: result({
        rows: [],
        page: {
          next: 'c2',
          keepLooking: null,
          searchedTo: null,
          complete: false
        }
      })
    })

    expect(page.table?.footer?.restoreHref).toBe(
      '/dev-ops/events/gas/outbox?cursor=c1&searched=u1&page=51'
    )
  })

  test('a later page past the most an address draws that could not be read keeps its own address', () => {
    const page = laterPage(51, {
      kind: 'failed',
      failure: { kind: 'no-answer' }
    })

    expect(page.table?.footer?.restoreHref).toBe(
      '/dev-ops/events/gas/outbox?cursor=c1&searched=u1&page=51'
    )
  })

  test('a row with no page of its own is no link', () => {
    const page = toListPage(
      input({
        bucket: gasEvents,
        read: {
          kind: 'read',
          page: result({
            rows: [
              {
                id: 'r',
                time: 'not a time',
                title: 'T',
                subtitle: null,
                cells: {},
                link: null
              }
            ]
          })
        }
      })
    )

    expect(page.table?.rows[0]).toEqual({
      id: 'row-1-1',
      restoreHref: null,
      href: null,
      cells: [
        { kind: 'text', text: 'T', mono: false, align: 'start' },
        { kind: 'none', align: 'start' },
        { kind: 'none', align: 'start' },
        { kind: 'none', align: 'start' },
        { kind: 'text', text: 'not a time', mono: false, align: 'right' }
      ],
      narrowCells: [
        {
          main: { kind: 'text', text: 'T', mono: false, align: 'start' },
          under: [],
          align: 'start'
        },
        {
          main: { kind: 'none', align: 'start' },
          under: [
            { kind: 'text', text: 'not a time', mono: false, align: 'right' }
          ],
          align: 'right'
        }
      ]
    })
  })
})

test('Caseworking unreachable: no filters, no table, the reason and Try again', () => {
  const page = toCaseworkingUnreachable(
    toCaseworkingListAt('events/cw')!,
    '/dev-ops/events/cw?queue=inbox'
  )

  expect(page.range).toBeNull()
  expect(page.table).toBeNull()
  expect(page.title).toBe('Events')
  expect(page.navActive).toBe('cw.events')
  expect(page.alert?.retryHref).toBe('/dev-ops/events/cw?queue=inbox')
})

test('a chosen value is named by its label, not its code', () => {
  const page = toListPage(
    input({
      bucket: {
        ...gasOutbox,
        facts: gasOutbox.facts.map((fact) =>
          fact.name === 'eventType'
            ? {
                ...fact,
                values: [{ value: 'AUD', label: 'Audit' }]
              }
            : fact
        )
      },
      filters: { eventType: 'AUD' }
    })
  )

  expect(chipOf(page, 'eventType').value).toBe('Audit')
  expect(chipOf(page, 'eventType').items.at(-1)?.text).toBe('Audit')
})

describe('the Events page over both queues', () => {
  const events = (overrides: Partial<ListPageInput> = {}) =>
    input({ bucket: gasEvents, ...overrides })
  const timedOut = {
    kind: 'failed',
    failure: { kind: 'timed-out' }
  } as const
  const failureText =
    'GAS didn’t answer in time. Nothing has changed — try again in a moment.'

  test.each([
    [{}, '/dev-ops/events/gas', '/dev-ops/events/gas?queue=inbox'],
    [
      { box: ['outbox', 'inbox'], status: 'DEAD_LETTER' },
      '/dev-ops/events/gas?queue=outbox&queue=inbox&status=DEAD_LETTER',
      '/dev-ops/events/gas?queue=inbox&status=DEAD_LETTER'
    ]
  ])(
    'a queue that failed the first page with %o picked: which, why both are needed, and the other alone',
    (filters, retryHref, href) => {
      const { alert } = toListPage(
        events({ filters, read: timedOut, failedQueue: 'outbox' })
      )

      expect(alert).toEqual({
        tone: 'danger',
        title: 'The events list couldn’t be loaded.',
        code: null,
        text: `${failureText} The Outbox couldn’t be read, and both queues are needed to show events in order.`,
        retryHref,
        startHref: null,
        links: [{ text: 'Show the Inbox only', href }]
      })
    }
  )

  test('a queue that failed the first page with only it picked: the usual alert, Try again alone', () => {
    const { alert } = toListPage(
      events({
        filters: { box: ['outbox'] },
        read: timedOut,
        failedQueue: 'outbox'
      })
    )

    expect(alert).toMatchObject({ text: failureText, links: [] })
  })

  test('a queue that failed Load more is named in the footer', () => {
    const { table } = toListPage(
      events({ cursor: 'c2', page: 2, read: timedOut, failedQueue: 'inbox' })
    )

    expect(table?.footer).toMatchObject({
      state: 'error',
      text: 'Couldn’t load more events — GAS didn’t answer in time. The Inbox couldn’t be read.'
    })
  })

  test('a list of one queue that failed says nothing of queues', () => {
    const page = toListPage(input({ read: timedOut, failedQueue: 'outbox' }))

    expect(page.alert?.text).toBe(failureText)
    expect(page.alert?.links).toEqual([])
  })

  const limitedBy = (filters = {}) =>
    toListPage(
      events({
        filters,
        read: {
          kind: 'read',
          page: result({
            plan: { ...result().plan, kind: 'bounded' },
            page: {
              next: null,
              keepLooking: 'k1',
              searchedTo: '2026-10-06T14:00:00.000Z',
              complete: false
            },
            queues: { limited: ['outbox'], waiting: ['inbox'] }
          })
        }
      })
    )

  test('one queue limits the page while the other has older rows: says so, with the other alone, and the footer keeps looking', () => {
    const page = limitedBy()

    expect(page.alert).toEqual({
      tone: 'info',
      title: 'The Outbox is searched a window at a time.',
      code: null,
      text: 'Inbox events older than 6\u00a0Oct 2026 14:00 show once the Outbox has been searched that far back.',
      retryHref: null,
      startHref: null,
      links: [
        { text: 'Show the Inbox only', href: '/dev-ops/events/gas?queue=inbox' }
      ]
    })
    expect(page.table?.footer?.state).toBe('searched')
    expect(page.total).toBeNull()
  })

  test('a page no queue held back has no such alert', () => {
    const page = toListPage(
      events({
        read: {
          kind: 'read',
          page: result({ queues: { limited: [], waiting: [] } })
        }
      })
    )

    expect(page.alert).toBeNull()
  })

  test('a list changed under its cursor: the first page says so', () => {
    expect(toListPage(events({ notice: 'changed' })).alert).toEqual({
      tone: 'info',
      title: 'This list changed since the page was loaded.',
      code: null,
      text: 'Showing the newest events.',
      retryHref: null,
      startHref: null,
      links: []
    })
  })

  test('nothing ever recorded, and filters that match nothing, say the prototype’s words', () => {
    expect(toListPage(events()).table?.empty).toMatchObject({
      title: 'No events yet',
      text: 'Events GAS sends and receives appear here.'
    })
    expect(
      toListPage(events({ filters: { box: ['inbox'], eventType: ['Audit'] } }))
        .table?.empty
    ).toMatchObject({
      title: 'No events match',
      text: 'Nothing created in this time range matches these filters.'
    })
  })

  test('the Queue cell is its label, and a value the catalogue doesn’t list is drawn as it comes', () => {
    const rows = ['outbox', 'inbox', 'elsewhere'].map((box, n) => ({
      id: `r${n}`,
      time: '2026-10-13T14:53:00.000Z',
      title: 'CreateCase',
      subtitle: null,
      cells: { box, status: 'PUBLISHED' },
      link: null
    }))
    const { table } = toListPage(
      events({ read: { kind: 'read', page: result({ rows }) } })
    )

    expect(table?.rows.map(({ cells }) => cells[2])).toEqual([
      { kind: 'text', text: 'Outbox', mono: false, align: 'start' },
      { kind: 'text', text: 'Inbox', mono: false, align: 'start' },
      { kind: 'text', text: 'elsewhere', mono: false, align: 'start' }
    ])
    expect(
      table?.rows.map(({ narrowCells }) =>
        narrowCells[0].under.map((cell) => cell.kind === 'text' && cell.text)
      )
    ).toEqual([['Outbox'], ['Inbox'], ['elsewhere']])
    expect(table?.narrowColumns).toEqual([
      { label: 'Event', width: 'minmax(0, 1fr)', align: 'start' },
      { label: 'Status', width: 'max-content', align: 'right' }
    ])
  })

  test('the Queue chip comes first, and a picked queue is named on it, with no tag', () => {
    const page = toListPage(events({ filters: { box: ['inbox'] } }))

    expect(page.chips.map(({ fact }) => fact)).toEqual([
      'box',
      'eventType',
      'status'
    ])
    expect(chipOf(page, 'box').value).toBe('Inbox')
    expect(page.applied).toEqual([])
  })
})
