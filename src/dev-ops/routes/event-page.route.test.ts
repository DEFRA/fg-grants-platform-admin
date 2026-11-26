import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  closeHrefOf,
  isOpenWithoutScript,
  resetsOnOpen
} from '../test-utils.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const listPath = '/dev-ops/events/gas'
const fromList = `${path}?back=${encodeURIComponent(listPath)}`

const message = 'Application with clientRef "ref-e2e-005" not found'
const stack = `Error: ${message}\n    at handle (/src/a.js:1:1)\n    at run (/src/b.js:2:2)`

const attempt = (at: string, overrides = {}) => ({
  at,
  name: 'Error',
  message,
  stack,
  ...overrides
})

const attempts = [
  attempt('2026-10-13T14:53:22.635Z'),
  attempt('2026-10-13T14:53:23.177Z'),
  attempt('2026-10-13T14:53:23.455Z'),
  attempt('2026-10-13T14:53:23.733Z'),
  attempt('2026-10-13T14:53:24.011Z')
]

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'io.onsite.agreement.status.updated',
  eventType: 'AgreementStatusUpdated',
  targetTopic: null,
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-10-13T14:53:22.397Z',
  traceId: '80fb392b3aa416e9e7868fdd3e628dd5',
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: { name: 'Error', message, at: '2026-10-13T14:53:24.011Z' },
  errorKey: 'Error: Application with clientRef <v> not found',
  attemptHistory: attempts,
  payload: { id: 'abc', data: { clientRef: 'ref-e2e-005', status: 'offered' } },
  payloadRevision: 0,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  record: { kind: 'application', code: 'woodland', ref: 'ref-e2e-005' },
  ...overrides
})

/** The prototype's "Edited and previously purged": redriven after an edit, so nothing has run since. */
const editedAndPurged = () =>
  detail({
    status: 'RESUBMITTED',
    statusLabel: 'Resubmitted',
    statusRole: 'warning',
    attempts: '0/5',
    attemptHistory: [],
    payload: { id: 'abc', data: { clientRef: 'ref-e2e-005-r2' } },
    lastEdit: {
      at: '2026-11-04T10:12:00.000Z',
      by: 'alex',
      note: 'clientRef pointed at the withdrawn application.'
    },
    lastPurge: {
      at: '2026-11-03T16:40:00.000Z',
      by: 'alex',
      reasonCode: 'BROKEN_PAYLOAD',
      note: null
    },
    lastRedrive: { at: '2026-11-04T10:13:00.000Z', by: 'alex' },
    purgeDeletionDate: null
  })

const given = (event: EventDetail = detail()) =>
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'found',
    event,
    failure: null
  })

let server: Server

const view = async (url = fromList, times = 'utc') => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    headers: { cookie: `dev-ops-times=${times}` },
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The text of an element as read: words in neighbouring elements stay apart. */
const spaced = (html: string | null) =>
  flat(load((html ?? '').replace(/></g, '> <')).text())

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) => flat(by($, testId).text())

const facts = ($: CheerioAPI) =>
  by($, 'event-details')
    .find('dt')
    .toArray()
    .map((dt) => [flat($(dt).text()), spaced($(dt).next('dd').html())])

const historyPath = `${fromList}&tab=history`

const historyRows = ($: CheerioAPI) =>
  by($, 'event-history-entry')
    .toArray()
    .map((li) => ({
      meta: flat($(li).find('.gpa-timeline-meta').text()),
      title: flat($(li).find('.gpa-timeline-title').text()),
      mark: $(li).find('.gpa-timeline-mark').attr('class'),
      content: flat($(li).find('.gpa-timeline-content').text())
    }))

const tabsOf = ($: CheerioAPI) =>
  $('nav.gpa-tabs a')
    .toArray()
    .map((a) => ({
      text: flat($(a).text()),
      href: $(a).attr('href'),
      current: $(a).attr('aria-current') === 'page'
    }))

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  config.set('environmentLabel', 'dev')
  given()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

test('a list address too long to go back to: the event still shows, and goes back to the list without its filters', async () => {
  const long = `${listPath}?${Array.from({ length: 250 }, (_, n) => `grant=code-${n}`).join('&')}`

  expect(long.length).toBeGreaterThan(3000)

  const { $, statusCode } = await view(
    `${path}?back=${encodeURIComponent(long)}`
  )

  expect(statusCode).toBe(statusCodes.ok)
  expect(by($, 'event-back').attr('href')).toBe(listPath)
  expect(by($, 'event-redrive').attr('href')).toBe(
    `${fromList}&confirm=redrive`
  )
})

test.each([
  '/dev-ops/events/gas/outbox',
  '/dev-ops/events/gas/inbox',
  '/dev-ops/events/cw/outbox',
  '/dev-ops/events/cw/inbox',
  '/dev-ops/events/gas/inbox?status=DEAD_LETTER&through=2#row-2-3',
  '/dev-ops/events/cw/outbox/?event=CreateCase'
])(
  'Back from %s, a queue’s own address, which is no page: the event’s own service’s Events instead',
  async (back) => {
    const { $ } = await view(`${path}?back=${encodeURIComponent(back)}`)

    expect(by($, 'event-back').attr('href')).toBe('/dev-ops/events/gas')
    expect(by($, 'event-redrive').attr('href')).toBe(`${path}?confirm=redrive`)
  }
)

test('Back from a row goes to every page of the list through the row’s, landing on the row', async () => {
  const back = `${listPath}?through=3&status=DEAD_LETTER#row-3-7`
  const { $ } = await view(`${path}?back=${encodeURIComponent(back)}`)

  expect(by($, 'event-back').attr('href')).toBe(back)
  expect(textOf($, 'event-back')).toBe('Back to Events')
  expect(by($, 'event-redrive').attr('href')).toBe(
    `${path}?back=${encodeURIComponent(back)}&confirm=redrive`
  )
})

describe('Loaded: a dead letter, every attempt the same', () => {
  test('the header: name, status, id with copy, Purge and Redrive that open their dialogs', async () => {
    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'event-title')).toBe('AgreementStatusUpdated')
    expect(textOf($, 'event-back')).toBe('Back to Events')
    expect(by($, 'event-back').attr('href')).toBe(listPath)
    expect(textOf($, 'event-status')).toBe('Dead letter')
    expect(by($, 'event-status').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(textOf($, 'event-id')).toBe('5208709c-e2d5-4870-b6ae-ff168bf65726')
    const copy = $(
      'gpa-copy[data-value="5208709c-e2d5-4870-b6ae-ff168bf65726"]'
    )
    expect(copy).toHaveLength(1)
    expect(copy.find('[data-gpa-copy]').is('[hidden]')).toBe(false)
    expect(by($, 'event-purge').attr('data-gpa-open')).toBe('purge-dialog')
    expect(by($, 'event-purge').attr('href')).toBe(`${fromList}&confirm=purge`)
    expect(by($, 'event-redrive').attr('data-gpa-open')).toBe('redrive-dialog')
    expect(by($, 'event-redrive').attr('href')).toBe(
      `${fromList}&confirm=redrive`
    )
    expect(
      $('link[rel="stylesheet"]')
        .map((_i, link) => $(link).attr('href'))
        .get()
    ).toEqual(['/public/src/dev-ops/views/dev-ops.css'])
  })

  test('Details: the prototype’s facts, the deletion date after Created', async () => {
    const { $ } = await view()

    expect(facts($)).toEqual([
      ['Queue', 'Outbox'],
      ['Created', '13 Oct 2026 14:53'],
      ['Deletion date', '2 Feb 2027 00:00'],
      ['Logs', 'OpenSearch (opens in a new tab)'],
      ['Application', 'ref-e2e-005']
    ])
    expect(by($, 'event-details').find('a').eq(1).attr('href')).toBe(
      '/dev-ops/applications/woodland/ref-e2e-005'
    )
    expect(by($, 'event-logs').attr('target')).toBe('_blank')
    expect(by($, 'event-details').find('gpa-copy')).toHaveLength(0)
  })

  test('Overview: the payload and Details, with no Attempts card', async () => {
    const { $ } = await view()

    expect(by($, 'event-payload')).toHaveLength(1)
    expect(by($, 'event-details')).toHaveLength(1)
    expect(by($, 'event-attempts')).toHaveLength(0)
    expect($('.gpa-timeline')).toHaveLength(0)
    expect(by($, 'event-history')).toHaveLength(0)
  })

  test('with no back, it goes back to its service’s Events, whether or not the catalogue lists it', async () => {
    const listed = await view(path)

    vi.mocked(shellCatalogue).mockReturnValue({ buckets: [], sourceErrors: [] })
    const unlisted = await view(path)

    expect(listed.$('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events/gas'
    )
    expect(unlisted.$('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events/gas'
    )
  })

  test('its status is toned as on its Events page: Queued info, Failed danger', async () => {
    given(
      detail({ status: 'FAILED', statusLabel: 'Failed', statusRole: 'warning' })
    )

    const { $ } = await view()

    expect(by($, 'event-status').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
  })

  test('Payload: the stored JSON, Copy and Edit payload', async () => {
    const { $ } = await view()

    expect(by($, 'event-payload').find('pre').text()).toContain(
      '"clientRef": "ref-e2e-005"'
    )
    expect(
      by($, 'event-payload').find('pre').hasClass('gpa-code-coloured')
    ).toBe(true)
    expect(
      by($, 'event-payload')
        .find('.gpa-code-key')
        .toArray()
        .map((key) => $(key).text())
    ).toContain('"clientRef"')
    expect(by($, 'event-edit').attr('href')).toBe(`${fromList}&edit=payload`)
    expect(flat(by($, 'event-edit').text())).toBe('Edit')
    expect(by($, 'event-edit').attr('aria-label')).toBe('Edit payload')
    expect(by($, 'event-edited')).toHaveLength(0)
    expect(by($, 'event-original-toggle')).toHaveLength(0)
  })

  test('the dialogs are on the page, closed, for the buttons to open', async () => {
    const { $ } = await view()

    expect($('dialog#redrive-dialog')).toHaveLength(1)
    expect($('dialog#purge-dialog')).toHaveLength(1)
    expect(isOpenWithoutScript($, 'redrive-dialog')).toBe(false)
    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(false)
  })
})

describe('Times from the address', () => {
  test('opens over the event, which keeps the list it goes back to', async () => {
    const { $, statusCode } = await view(`${fromList}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(closeHrefOf($, 'times-dialog')).toBe(fromList)
    expect(by($, 'event-back').attr('href')).toBe(listPath)
  })
})

describe('Edited and previously purged', () => {
  test('Resubmitted and no actions: no Attempts card, and no redrive, edit or earlier purge in Details', async () => {
    given(editedAndPurged())

    const { $ } = await view()

    expect(textOf($, 'event-status')).toBe('Resubmitted')
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(by($, 'event-attempts')).toHaveLength(0)
    expect(facts($).map(([label]) => label)).toEqual([
      'Queue',
      'Created',
      'Deletion date',
      'Logs',
      'Application'
    ])
  })

  test('the Edited badge stays; the payload before the first edit is in History, not under the payload', async () => {
    given(editedAndPurged())

    const { $ } = await view()

    expect(textOf($, 'event-edited')).toBe('Edited')
    expect(by($, 'event-edit')).toHaveLength(0)
    expect($.text()).not.toContain('Show the payload before the first edit')
  })
})

describe('Purged', () => {
  const purged = () =>
    detail({
      status: 'PURGED',
      statusLabel: 'Purged',
      statusRole: 'neutral',
      purgeDeletionDate: null,
      lastPurge: {
        at: '2026-11-04T09:00:00.000Z',
        by: 'alex',
        reasonCode: 'SENT_IN_ERROR',
        note: 'Duplicate.'
      }
    })

  test('Redrive only; the purge is a fact after the deletion date; the redrive dialog says what redriving brings back', async () => {
    given(purged())

    const { $ } = await view()

    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(1)
    expect(facts($).map(([label]) => label)).toEqual([
      'Queue',
      'Created',
      'Deletion date',
      'Purged',
      'Logs',
      'Application'
    ])
    expect(facts($)[3]).toEqual([
      'Purged',
      '4 Nov 2026 09:00 by alex: Sent in error “Duplicate.”'
    ])
    expect(textOf($, 'redrive-purged')).toBe(
      'It was purged on 4 Nov 2026 by alex. Redriving brings it back to the queue; the purge stays in its history.'
    )
    expect(by($, 'redrive-unchanged')).toHaveLength(0)
  })
})

describe('the states without actions', () => {
  test('Completed: no attempts card, no actions', async () => {
    given(
      detail({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success',
        attemptHistory: [],
        lastError: null,
        purgeDeletionDate: null
      })
    )

    const { $ } = await view()

    expect(by($, 'event-attempts')).toHaveLength(0)
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(by($, 'event-edit')).toHaveLength(0)
    expect($('#redrive-dialog, #purge-dialog')).toHaveLength(0)
  })

  test('Failed, still retrying: no actions (the service’s gate)', async () => {
    given(
      detail({
        status: 'FAILED',
        statusLabel: 'Failed',
        statusRole: 'warning',
        attempts: '2/5',
        attemptHistory: attempts.slice(0, 2),
        purgeDeletionDate: null
      })
    )

    const { $ } = await view()

    expect(by($, 'event-status').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(by($, 'event-redrive')).toHaveLength(0)
  })

  test('no revision from the service: no Edit payload', async () => {
    given(detail({ payloadRevision: null }))

    const { $ } = await view()

    expect(by($, 'event-edit')).toHaveLength(0)
  })

  test('no trace, no record, no deletion date: those facts are left out', async () => {
    given(detail({ traceId: null, record: null, expiresAt: null }))

    const { $ } = await view()

    expect(facts($).map(([label]) => label)).toEqual(['Queue', 'Created'])
  })

  test('CW’s inbox event: a case, and CW named', async () => {
    given(
      detail({
        service: 'caseworking',
        box: 'inbox',
        record: { kind: 'case', code: 'woodland', ref: 'ref-e2e-019' }
      })
    )

    const { $ } = await view(`/dev-ops/events/cw/inbox/${id}`)

    expect(textOf($, 'event-back')).toBe('Back to Events')
    expect(facts($)[0]).toEqual(['Queue', 'Inbox'])
    expect(facts($)[4]).toEqual(['Case', 'ref-e2e-019'])
    expect(textOf($, 'redrive-unchanged')).toBe(
      'Nothing has changed since it failed. If the cause hasn’t been fixed in CW, it will fail again.'
    )
  })
})

describe('Unavailable, timed out, not found', () => {
  test.each([
    [
      'timed-out',
      { kind: 'timed-out' },
      statusCodes.gatewayTimeout,
      'GAS timed out waiting for it. Nothing has changed — try again in a moment.'
    ],
    [
      'unavailable',
      { kind: 'not-connected' },
      statusCodes.serviceUnavailable,
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ] as const)(
    '%s: the id as the title, the reason, Try again and Back',
    async (outcome, failure, code, body) => {
      vi.mocked(getEventUseCase).mockResolvedValue({
        outcome,
        event: null,
        failure
      })

      const { $, statusCode } = await view()

      expect(statusCode).toBe(code)
      expect(textOf($, 'event-title')).toBe(id)
      expect(by($, `event-${outcome}`).find('.gpa-alert-title').text()).toBe(
        'This event couldn’t be loaded.'
      )
      expect(
        flat(
          by($, `event-${outcome}`).find('.gpa-alert-body > div').first().text()
        )
      ).toBe(body)
      expect(by($, 'event-retry').attr('href')).toBe(fromList)
      expect(
        flat(by($, `event-${outcome}`).find('.gpa-alert-actions').text())
      ).toBe('Try again Back to Events')
    }
  )

  test.each([
    ['timed-out', { kind: 'timed-out' }, 'CW timed out waiting for it.'],
    ['timed-out', { kind: 'no-answer' }, 'GAS timed out waiting for it.'],
    ['unavailable', { kind: 'not-connected' }, 'GAS couldn’t be reached.'],
    ['unavailable', { kind: 'errored' }, 'GAS answered with an error.'],
    [
      'unavailable',
      { kind: 'errored', upstream: true },
      'CW answered with an error.'
    ],
    ['unavailable', { kind: 'cw-not-reached' }, 'CW couldn’t be reached.']
  ] as const)(
    'a CW event that is %s names the service the failure is down to: %o',
    async (outcome, failure, reason) => {
      vi.mocked(getEventUseCase).mockResolvedValue({
        outcome,
        event: null,
        failure
      })

      const { $ } = await view(`/dev-ops/events/cw/outbox/${id}`)

      expect(
        flat(
          by($, `event-${outcome}`).find('.gpa-alert-body > div').first().text()
        )
      ).toBe(`${reason} Nothing has changed — try again in a moment.`)
    }
  )

  test('not found: the prototype’s empty state, naming the service', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue({
      outcome: 'not-found',
      event: null,
      failure: null
    })

    const { $, statusCode } = await view(`/dev-ops/events/cw/outbox/${id}`)

    expect(statusCode).toBe(statusCodes.notFound)
    expect(flat(by($, 'event-not-found').find('.gpa-empty-title').text())).toBe(
      'No CW event has this ID.'
    )
    expect(flat(by($, 'event-not-found').find('.gpa-empty-body').text())).toBe(
      'It may have passed its deletion date, or the ID may be from the other service. Check the ID, or search for it from Events.'
    )
    expect(by($, 'event-not-found').find('a').attr('href')).toBe(
      '/dev-ops/events/cw'
    )
  })
})

describe('the redrive dialog', () => {
  test('without a script, the address opens it: what happens, and that a failing event will fail again', async () => {
    const { $ } = await view(`${fromList}&confirm=redrive`)

    expect(isOpenWithoutScript($, 'redrive-dialog')).toBe(true)
    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(false)

    const dialog = by($, 'redrive-dialog')

    expect(flat(dialog.find('.gpa-dialog-head h2').text())).toBe(
      'Redrive this event?'
    )
    expect(dialog.text()).not.toContain('AgreementStatusUpdated')
    expect(dialog.text()).not.toContain('5208709c')
    expect(dialog.text()).not.toContain('This changes production.')
    expect(flat(dialog.find('.gpa-text-default').first().text())).toBe(
      'It goes back in the queue and is tried up to 5 more times.'
    )
    expect(textOf($, 'redrive-unchanged')).toBe(
      'Nothing has changed since it failed. If the cause hasn’t been fixed in GAS, it will fail again.'
    )
    expect(by($, 'redrive-unchanged').hasClass('gpa-text-muted')).toBe(true)
    expect(dialog.find('.gpa-alert')).toHaveLength(0)
    expect(
      dialog
        .find('.gpa-dialog-foot a, .gpa-dialog-foot button')
        .toArray()
        .map((el) => flat($(el).text()))
    ).toEqual(['Cancel', 'Redrive'])
    expect(dialog.find('.gpa-dialog-body a')).toHaveLength(0)
    expect(dialog.find('.gpa-dialog-close').attr('href')).toBe(fromList)
  })

  test('an attempt count that doesn’t read as made/allowed: it goes back in the queue, with no number of tries', async () => {
    given(detail({ attempts: 'unknown' }))

    const { $ } = await view(`${fromList}&confirm=redrive`)

    expect(
      flat(by($, 'redrive-dialog').find('.gpa-text-default').first().text())
    ).toBe('It goes back in the queue.')
  })

  test('the form posts the page to go back to, and Redrive submits it with a spinner', async () => {
    const { $ } = await view()

    const form = $('form#redrive-form')

    expect(form.attr('action')).toBe(`${path}/redrive`)
    expect(form.find('input[name="back"]').val()).toBe(listPath)
    expect(by($, 'redrive-submit').attr('form')).toBe('redrive-form')
    expect(by($, 'redrive-submit').is('[data-gpa-loading-on-submit]')).toBe(
      true
    )
  })

  test('an edit not yet redriven: it says the edited payload is used, not that it will fail again', async () => {
    given(
      detail({
        lastEdit: { at: '2026-10-14T08:00:00.000Z', by: 'alex.k', note: 'fix' }
      })
    )

    const { $ } = await view()

    expect(textOf($, 'redrive-edited')).toBe(
      'It will use the payload edited by alex.k on 14 Oct 2026 08:00, not the original.'
    )
    expect(by($, 'redrive-unchanged')).toHaveLength(0)
  })

  test('an edit redriven that failed again: it will fail again, with no edited note', async () => {
    given(
      detail({
        lastEdit: { at: '2026-10-13T14:00:00.000Z', by: 'alex.k', note: 'fix' },
        lastRedrive: { at: '2026-10-13T14:30:00.000Z', by: 'alex.k' }
      })
    )

    const { $ } = await view()

    expect(by($, 'redrive-unchanged')).toHaveLength(1)
    expect(by($, 'redrive-edited')).toHaveLength(0)
  })

  test('in production, both dialogs say so first', async () => {
    config.set('environmentLabel', 'prod')

    const { $ } = await view()

    for (const dialog of ['redrive-dialog', 'purge-dialog']) {
      expect(flat(by($, dialog).find('.gpa-badge').first().text())).toBe('prod')
      expect(by($, dialog).text()).toContain('This changes production.')
      expect(by($, dialog).text()).not.toContain('5208709c')
    }
  })
})

describe('the purge dialog', () => {
  test('without a script, the address opens it: the reasons, the note with its count, the deletion date', async () => {
    const { $ } = await view(`${fromList}&confirm=purge`)

    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(true)

    const dialog = by($, 'purge-dialog')

    expect(dialog.find('.gpa-dialog').attr('role')).toBe('alertdialog')
    expect(dialog.text()).not.toContain('5208709c')
    expect(dialog.text()).not.toContain('This changes production.')
    expect(flat(dialog.find('.gpa-text-default').first().text())).toBe(
      'It stops being retried and is no longer a dead letter. You can still redrive it until 2 Feb 2027, when it’s deleted.'
    )
    expect(
      dialog
        .find('input[name="reasonCode"]')
        .toArray()
        .map((input) => [$(input).val(), flat($(input).parent().text())])
    ).toEqual([
      ['BROKEN_PAYLOAD', 'Payload is broken'],
      ['SENT_IN_ERROR', 'Sent in error'],
      ['OTHER', 'Other']
    ])
    expect(dialog.find('input[name="reasonCode"]').is('[checked]')).toBe(false)
    expect(flat(dialog.find('label[for="purge-note"]').text())).toBe(
      'Note (optional)'
    )
    expect(dialog.find('.gpa-label-optional').is('[hidden]')).toBe(false)
    expect(flat(dialog.find('#purge-note-hint').text())).toBe(
      'Shown on the event. Don’t include personal data.'
    )
    expect(dialog.find('#purge-note').attr('maxlength')).toBe('500')
    expect(flat(dialog.find('[data-gpa-count-for="purge-note"]').text())).toBe(
      '0 / 500'
    )
    expect(by($, 'purge-submit').text()).toBe('Purge')
    expect(by($, 'purge-submit').attr('class')).toContain(
      'gpa-btn-danger-solid'
    )
    expect(by($, 'purge-submit').is('[disabled]')).toBe(false)
  })
})

describe('a dialog the address opens', () => {
  test.each([
    ['redrive', fromList, fromList],
    ['purge', fromList, fromList],
    ['redrive', path, path],
    ['purge', path, path]
  ])(
    '%s over %s closes to the page without the opener',
    async (write, page, closed) => {
      const opened = `${page}${page.includes('?') ? '&' : '?'}confirm=${write}`
      const { $ } = await view(opened)

      expect(isOpenWithoutScript($, `${write}-dialog`)).toBe(true)
      expect(closeHrefOf($, `${write}-dialog`)).toBe(closed)
    }
  )
})

describe('reopening a dialog from the page', () => {
  test('starts Purge clean, its reason and note as the server drew them; Redrive has nothing to clear', async () => {
    const { $ } = await view()

    expect(resetsOnOpen($, 'purge-dialog')).toBe(true)
    expect(resetsOnOpen($, 'redrive-dialog')).toBe(false)
  })
})

describe('editing the payload', () => {
  test('Edit: the lead line and the JSON in an editor named Payload, with no label, Stepper, Why it failed, Purge or Redrive', async () => {
    const { $ } = await view(`${fromList}&edit=payload`)

    const editor = by($, 'event-payload-editor')

    expect(editor.attr('id')).toBe('payload')
    expect(editor.find('.gpa-stepper')).toHaveLength(0)
    expect(editor.find('label')).toHaveLength(0)
    expect(editor.text()).toContain(
      'You’ll review your changes before anything is saved.'
    )
    expect(editor.text()).not.toContain('Why it failed')
    expect(editor.find('form').hasClass('gpa-form-wide')).toBe(true)
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(by($, 'event-payload-text').val()).toContain(
      '"clientRef": "ref-e2e-005"'
    )
    expect(by($, 'event-payload-text').attr('name')).toBe('text')
    expect(by($, 'event-payload-text').attr('aria-label')).toBe('Payload')
    expect(by($, 'event-payload-text').attr('aria-describedby')).toBeUndefined()
    expect(
      by($, 'event-payload-text').closest('gpa-textarea-code').data()
    ).toEqual({ language: 'json' })
    expect(editor.find('form').attr('action')).toBe(
      `${path}/payload/review#payload`
    )
    expect(editor.find('input[name="revision"]').val()).toBe('0')
    expect(by($, 'event-discard').attr('href')).toBe(fromList)
    expect(by($, 'event-payload')).toHaveLength(0)
  })

  test('a service that says the payload isn’t plain JSON is warned of in the editor', async () => {
    given(detail({ payloadIsPlainJson: false }))

    const { $ } = await view(`${fromList}&edit=payload`)

    expect(
      flat(by($, 'event-not-plain-json').find('.gpa-alert-title').text())
    ).toBe('Some values in this payload aren’t plain JSON.')
  })

  test('opening the editor puts focus in the box, as nothing else on the page asks for it', async () => {
    const { $ } = await view(`${fromList}&edit=payload`)

    expect(by($, 'event-payload-text').attr('autofocus')).toBeDefined()
    expect($('[autofocus], [data-focus-on-arrival]')).toHaveLength(1)
  })

  test('the stored payload, not being edited, takes no focus', async () => {
    const { $ } = await view()

    expect($('[autofocus]')).toHaveLength(0)
  })

  test('the editor isn’t opened over a dialog the address asks for', async () => {
    const { $ } = await view(`${fromList}&edit=payload&confirm=redrive`)

    expect(by($, 'event-payload-editor')).toHaveLength(0)
  })
})

test('Try again on an event that couldn’t be loaded keeps the page it was opened from', async () => {
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'timed-out',
    event: null,
    failure: { kind: 'timed-out' }
  })

  const { $ } = await view()

  expect(by($, 'event-retry').attr('href')).toBe(fromList)
})

test('Try again on History that couldn’t be loaded keeps History', async () => {
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'timed-out',
    event: null,
    failure: { kind: 'timed-out' }
  })

  const { $ } = await view(historyPath)

  expect(by($, 'event-retry').attr('href')).toBe(historyPath)
})

const served = (overrides: Partial<EventDetail> = {}) =>
  detail({
    history: [
      { kind: 'dead-lettered', at: '2026-10-13T14:53:24.011Z' },
      {
        kind: 'attempt',
        at: '2026-10-13T14:53:24.011Z',
        number: 2,
        name: 'Error',
        message,
        stack
      },
      {
        kind: 'attempt',
        at: '2026-10-13T14:53:23.177Z',
        number: 1,
        name: 'TypeError',
        message: 'x is undefined',
        stack: null
      },
      { kind: 'received', at: '2026-10-13T14:53:22.397Z' }
    ],
    ...overrides
  })

describe('the tabs', () => {
  test('Overview and History, each keeping the list it goes back to; History counts its entries', async () => {
    given(served())

    const { $ } = await view()

    expect($('nav.gpa-tabs').attr('aria-label')).toBe('Event')
    expect(tabsOf($)).toEqual([
      { text: 'Overview', href: fromList, current: true },
      { text: 'History4', href: historyPath, current: false }
    ])
    expect(flat($('nav.gpa-tabs a').eq(1).find('.gpa-count').text())).toBe('4')
  })

  test('?tab=history opens History, with no Details beside it, and the actions keep the tab', async () => {
    const { $, statusCode } = await view(historyPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(tabsOf($).map(({ current }) => current)).toEqual([false, true])
    expect(by($, 'event-history')).toHaveLength(1)
    expect(by($, 'event-payload')).toHaveLength(0)
    expect(by($, 'event-details')).toHaveLength(0)
    expect(by($, 'event-redrive').attr('href')).toBe(
      `${historyPath}&confirm=redrive`
    )
    expect(by($, 'event-purge').attr('href')).toBe(
      `${historyPath}&confirm=purge`
    )
    expect(closeHrefOf($, 'redrive-dialog')).toBe(historyPath)
    expect($('#redrive-form input[name="tab"]').val()).toBe('history')
    expect($('#purge-form input[name="tab"]').val()).toBe('history')
  })

  test.each(['nonsense', 'overview', 'HISTORY', ''])(
    'tab=%s opens the Overview',
    async (tab) => {
      const { $, statusCode } = await view(`${fromList}&tab=${tab}`)

      expect(statusCode).toBe(statusCodes.ok)
      expect(tabsOf($).map(({ current }) => current)).toEqual([true, false])
      expect(by($, 'event-payload')).toHaveLength(1)
      expect($('#redrive-form input[name="tab"]').val()).toBe('')
    }
  )

  test('a tab too long to be one is refused', async () => {
    const { statusCode } = await view(`${fromList}&tab=${'x'.repeat(33)}`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('without a script, the tabs are links and History is drawn by the server', async () => {
    given(served())

    const { $ } = await view(historyPath)

    expect($('gpa-tabs, [role="tablist"]')).toHaveLength(0)
    expect(by($, 'event-history-entry').length).toBeGreaterThan(0)
    expect(by($, 'event-history').find('[hidden]')).toHaveLength(0)
    expect(by($, 'event-history').find('details, gpa-disclosure')).toHaveLength(
      0
    )
  })
})

describe('History', () => {
  test('one untitled card holding a History timeline, time first, newest first, as GAS serves it', async () => {
    given(served())

    const { $ } = await view(historyPath)

    expect(by($, 'event-history').find('.gpa-card-head')).toHaveLength(0)
    expect(
      by($, 'event-history').find('ol.gpa-timeline').attr('aria-label')
    ).toBe('History')
    expect(
      by($, 'event-history')
        .find('ol.gpa-timeline')
        .hasClass('gpa-timeline-meta-first')
    ).toBe(true)
    expect(historyRows($)).toEqual([
      {
        meta: '13 Oct 2026 14:53:24',
        title: 'Marked as a dead letter',
        mark: 'gpa-timeline-mark has-icon gpa-timeline-mark-warning',
        content: ''
      },
      {
        meta: '13 Oct 2026 14:53:24.011',
        title: 'Attempt 2 failed',
        mark: 'gpa-timeline-mark has-icon gpa-timeline-mark-danger',
        content: flat(stack)
      },
      {
        meta: '13 Oct 2026 14:53:23.177',
        title: 'Attempt 1 failed',
        mark: 'gpa-timeline-mark has-icon gpa-timeline-mark-danger',
        content: 'TypeError: x is undefined'
      },
      {
        meta: '13 Oct 2026 14:53:22',
        title: 'Received',
        mark: 'gpa-timeline-mark has-icon gpa-timeline-mark-neutral',
        content: ''
      }
    ])
    expect(tabsOf($)[1].text).toBe('History4')
  })

  test('an attempt’s title is only for screen readers, and its error is a wrapped stack block with no line numbers', async () => {
    given(served())

    const { $ } = await view(historyPath)
    const attempt = by($, 'event-history-entry').eq(1)

    expect(attempt.find('.gpa-timeline-title > .gpa-vh').text()).toBe(
      'Attempt 2 failed'
    )
    expect(attempt.find('.gpa-code-wrap')).toHaveLength(1)
    expect(attempt.find('.gpa-code-gutter, .gpa-code-num')).toHaveLength(0)
    expect(attempt.find('[aria-label="Attempt 2: error"]')).toHaveLength(1)
    expect(attempt.find('.gpa-code-msg').text()).toBe(`Error: ${message}`)
  })

  test('each entry has an id counted from the oldest', async () => {
    given(served())

    const { $ } = await view(historyPath)

    expect(
      by($, 'event-history-entry')
        .toArray()
        .map((li) => $(li).attr('id'))
    ).toEqual(['history-4', 'history-3', 'history-2', 'history-1'])
  })

  test('no "Events with this error" link: each entry is only what happened', async () => {
    given(served())

    const { $ } = await view(historyPath)

    expect(by($, 'event-history').find('a')).toHaveLength(0)
    expect($.text()).not.toContain('Events with this error')
  })

  test('attempt times are in the chosen zone', async () => {
    given(served())

    const { $ } = await view(historyPath, 'uk')

    expect(historyRows($)[1].meta).toBe('13 Oct 2026 15:53:24.011')
    expect(by($, 'event-history-entry').eq(1).find('time').attr('title')).toBe(
      '13 Oct 2026 15:53:24 BST'
    )
  })

  test('a purge, an edit with its diff, a redrive and a delivery', async () => {
    given(
      served({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success',
        history: [
          { kind: 'delivered', at: '2026-11-04T10:14:00.000Z' },
          { kind: 'redriven', at: '2026-11-04T10:13:00.000Z', by: 'alex' },
          {
            kind: 'payload-edited',
            at: '2026-11-04T10:12:00.000Z',
            by: 'alex',
            note: 'clientRef pointed at the withdrawn application.',
            before: { clientRef: 'ref-e2e-005' },
            after: { clientRef: 'ref-e2e-005-r2' }
          },
          {
            kind: 'purged',
            at: '2026-11-03T16:40:00.000Z',
            by: 'alex',
            reasonCode: 'SENT_IN_ERROR',
            note: 'Duplicate.'
          }
        ]
      })
    )

    const { $ } = await view(historyPath)
    const rows = historyRows($)

    expect(rows.map(({ title }) => title)).toEqual([
      'Delivered',
      'Redriven by alex',
      'Payload edited by alex',
      'Purged by alex'
    ])
    expect(rows.map(({ mark }) => mark?.split('-').at(-1))).toEqual([
      'success',
      'info',
      'info',
      'neutral'
    ])
    expect(rows[3].content).toBe('Sent in error“Duplicate.”')

    const edit = by($, 'event-history-entry').eq(2)

    expect(flat(edit.find('.gpa-timeline-content').text())).toMatch(
      /^“clientRef pointed at the withdrawn application.”/
    )
    expect(edit.find('.gpa-diff .gpa-diff-body').attr('aria-label')).toBe(
      'The change'
    )
    expect(edit.find('.gpa-diff-line.is-del .gpa-diff-text').text()).toContain(
      '"ref-e2e-005"'
    )
    expect(edit.find('.gpa-diff-line.is-add .gpa-diff-text').text()).toContain(
      '"ref-e2e-005-r2"'
    )
  })

  test('an edit whose payload before wasn’t kept: its note, and no diff', async () => {
    given(
      served({
        history: [
          {
            kind: 'payload-edited',
            at: '2026-11-04T10:12:00.000Z',
            by: 'alex',
            note: 'Fixed.',
            before: null,
            after: null
          }
        ]
      })
    )

    const { $ } = await view(historyPath)

    expect(historyRows($)[0].content).toBe('“Fixed.”')
    expect(by($, 'event-history').find('.gpa-diff')).toHaveLength(0)
  })

  test('no history from GAS: the tab with no entries, counting none', async () => {
    given(detail({ history: undefined }))

    const { $, statusCode } = await view(historyPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(tabsOf($)[1]).toEqual({
      text: 'History0',
      href: historyPath,
      current: true
    })
    expect(by($, 'event-history').find('ol.gpa-timeline')).toHaveLength(1)
    expect(by($, 'event-history-entry')).toHaveLength(0)
  })
})
