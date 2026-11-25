import Boom from '@hapi/boom'
import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { isOpenWithoutScript } from '../test-utils.ts'
import type {
  EventDetail,
  SaveRedrive
} from '../repositories/events.repository.ts'
import {
  editPayload,
  findEvent,
  purgeEvent,
  redriveEvent
} from '../repositories/events.repository.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/events.repository.ts'), async (original) => ({
  ...(await original()),
  findEvent: vi.fn(),
  redriveEvent: vi.fn(),
  purgeEvent: vi.fn(),
  editPayload: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const key = { service: 'gas', box: 'outbox', id }
const listPath = '/dev-ops/events/gas'

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { isResponseError: true, payload: body, res: {} }
  })

const notConnected = Object.assign(new Error('connect ECONNREFUSED'), {
  code: 'ECONNREFUSED'
})

const connectionReset = Object.assign(Boom.badGateway('Client request error'), {
  code: 'ECONNRESET'
})

const message = 'Application with clientRef "ref-e2e-005" not found'

const stored = {
  id: 'abc',
  data: { clientRef: 'ref-e2e-005', status: 'offered' }
}

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
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: { name: 'Error', message, at: '2026-10-13T14:53:24.011Z' },
  attemptHistory: [
    { at: '2026-10-13T14:53:23.177Z', name: 'Error', message, stack: null },
    { at: '2026-10-13T14:53:24.011Z', name: 'Error', message, stack: null }
  ],
  payload: stored,
  payloadRevision: 3,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  ...overrides
})

const edited = JSON.stringify(
  { id: 'abc', data: { clientRef: 'ref-e2e-005-r2', status: 'offered' } },
  null,
  2
)

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const request = async (
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  cookie = ''
) => {
  const response = await server.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: {
      cookie: ['dev-ops-times=utc', cookie].filter(Boolean).join('; '),
      'sec-fetch-site': 'same-origin'
    },
    auth: { strategy: 'session', credentials }
  })

  return {
    $: load(response.result as unknown as string),
    statusCode: response.statusCode,
    location: response.headers.location as string | undefined,
    cookie: cookieOf(response.headers['set-cookie']) || cookie
  }
}

/** Posts, then follows the 303 with the session it set, as a browser would. */
const postAndFollow = async (url: string, payload: object) => {
  const posted = await request('POST', url, payload)

  expect(posted.statusCode).toBe(statusCodes.seeOther)

  const page = await request('GET', posted.location!, undefined, posted.cookie)

  return { ...page, posted }
}

/** A save the service didn't answer: held for the editor its 303 opens, drawn by the GET that follows. */
const followHeld = async (
  posting: ReturnType<typeof request>,
  back = listPath
) => {
  const posted = await posting

  expect(posted.statusCode).toBe(statusCodes.seeOther)
  expect(posted.location).toBe(
    `${posted.location!.split('?')[0]}?${new URLSearchParams(
      back ? { back, edit: 'payload' } : { edit: 'payload' }
    )}#payload`
  )

  return request('GET', posted.location!, undefined, posted.cookie)
}

const stale = (event: EventDetail | null = detail()) =>
  responseError(412, { code: 'STALE_REVISION', event })

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const bannerOf = ($: CheerioAPI) => {
  const banner = by($, 'event-banner')

  return {
    tone: (banner.attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
    title: flat(banner.find('.gpa-alert-title').text()),
    text: flat(banner.find('.gpa-alert-body > div').first().text())
  }
}

/**
 * What the form's `#payload` lands on. A browser clears focus when it scrolls
 * to a fragment that can't take it, so the answer to the post is the target.
 */
const landing = ($: CheerioAPI) => {
  const target = $('[id="payload"]')

  return {
    count: target.length,
    testId: target.attr('data-testid') ?? null,
    classes: target.attr('class') ?? '',
    focusable: target.attr('tabindex') === '-1'
  }
}

const toastsOf = ($: CheerioAPI) =>
  by($, 'toast')
    .toArray()
    .map((toast) => [
      ($(toast).attr('class') ?? '').match(/gpa-toast-(\w+)/)?.[1],
      flat($(toast).find('.gpa-toast-text').text())
    ])

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(findEvent).mockReset().mockResolvedValue(detail())
  vi.mocked(redriveEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(purgeEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(editPayload)
    .mockReset()
    .mockResolvedValue({ payloadRevision: 4, redrive: null })
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('Redrive', () => {
  test('asks GAS as the signed-in person, goes back to the event and its list, and says how it went once', async () => {
    const { $, posted } = await postAndFollow(`${path}/redrive`, {
      back: listPath
    })

    expect(redriveEvent).toHaveBeenCalledWith(key, 'Ada Lovelace')
    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}#event-banner`
    )
    expect(bannerOf($)).toEqual({
      tone: 'success',
      title: 'Redriven.',
      text: 'The poller will pick it up shortly and retry it up to 5 times.'
    })
    expect(by($, 'event-banner').attr('data-focus-on-arrival')).toBe('')
    expect(toastsOf($)).toEqual([['success', 'Event redriven']])

    const again = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(by(again.$, 'event-banner')).toHaveLength(0)
    expect(toastsOf(again.$)).toEqual([])
  })

  test('a body-less post is a redrive that goes back to the event alone; a hostile back is dropped', async () => {
    const bare = await request('POST', `${path}/redrive`)

    expect(bare.statusCode).toBe(statusCodes.seeOther)
    expect(bare.location).toBe(`${path}#event-banner`)

    const hostile = await request('POST', `${path}/redrive`, {
      back: 'https://evil.example/dev-ops/x'
    })

    expect(hostile.location).toBe(`${path}#event-banner`)
  })

  test.each([
    [
      'the event moved on',
      responseError(409, { statusLabel: 'Resubmitted' }),
      {
        tone: 'warning',
        title: 'Not redriven.',
        text: 'This event is now Resubmitted, so it can’t be redriven. Nothing has changed.'
      }
    ],
    [
      'GAS no longer has it',
      responseError(404),
      {
        tone: 'danger',
        title: 'Not redriven.',
        text: 'GAS no longer has this event. Nothing has changed.'
      }
    ],
    [
      'Redrive times out',
      responseError(504),
      {
        tone: 'warning',
        title: 'Redrive status unknown.',
        text: 'GAS didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
      }
    ],
    [
      'GAS is down',
      notConnected,
      {
        tone: 'danger',
        title: 'Not redriven.',
        text: 'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
      }
    ],
    [
      'GAS fails it',
      responseError(502),
      {
        tone: 'danger',
        title: 'Not redriven.',
        text: 'GAS answered with an error. Nothing has changed — try again in a moment.'
      }
    ]
  ])('%s: its banner, and no toast', async (_name, error, banner) => {
    vi.mocked(redriveEvent).mockRejectedValue(error)

    const { $ } = await postAndFollow(`${path}/redrive`, {})

    expect(bannerOf($)).toEqual(banner)
    expect(toastsOf($)).toEqual([])
  })

  test('CW’s redrive that times out names CW, as the prototype does', async () => {
    vi.mocked(findEvent).mockResolvedValue(detail({ service: 'caseworking' }))
    vi.mocked(redriveEvent).mockRejectedValue(responseError(504))

    const { $ } = await postAndFollow(
      `/dev-ops/events/cw/outbox/${id}/redrive`,
      {}
    )

    expect(bannerOf($).text).toBe(
      'CW didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    )
  })

  test.each([
    ['the read timing out here', Boom.clientTimeout()],
    ['the connection dropping', connectionReset]
  ])(
    'unanswered, by %s: the status is unknown, and nothing claims it is unchanged',
    async (_name, error) => {
      vi.mocked(redriveEvent).mockRejectedValue(error)

      const { $ } = await postAndFollow(`${path}/redrive`, {})

      expect(bannerOf($)).toEqual({
        tone: 'warning',
        title: 'Redrive status unknown.',
        text: 'GAS didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
      })
    }
  )

  test('CW’s redrive with GAS down names GAS, not CW', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(notConnected)

    const { $ } = await postAndFollow(
      `/dev-ops/events/cw/outbox/${id}/redrive`,
      {}
    )

    expect(bannerOf($).text).toBe(
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    )
  })
})

describe('Purge', () => {
  test('a reason and a note: purged as the signed-in person, the banner gives the date it can still be redriven until', async () => {
    const { $ } = await postAndFollow(`${path}/purge`, {
      back: listPath,
      reasonCode: 'OTHER',
      note: '  Replaced by\r\nthe resubmission  '
    })

    expect(purgeEvent).toHaveBeenCalledWith(
      key,
      { reasonCode: 'OTHER', note: 'Replaced by\nthe resubmission' },
      'Ada Lovelace'
    )
    expect(bannerOf($)).toEqual({
      tone: 'info',
      title: 'Purged.',
      text: 'It won’t be retried. You can still redrive it until 2 Feb 2027.'
    })
    expect(toastsOf($)).toEqual([['info', 'Event purged']])
  })

  test('a connection that dropped: the status is unknown, and nothing claims it is unchanged', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(connectionReset)

    const { $ } = await postAndFollow(`${path}/purge`, {
      reasonCode: 'BROKEN_PAYLOAD'
    })

    expect(bannerOf($)).toEqual({
      tone: 'warning',
      title: 'Purge status unknown.',
      text: 'GAS didn’t answer in time. Refresh to see whether the event was purged before trying again.'
    })
  })

  test('a coded reason needs no note, and an empty one is left out', async () => {
    await postAndFollow(`${path}/purge`, {
      reasonCode: 'SENT_IN_ERROR',
      note: ' '
    })

    expect(purgeEvent).toHaveBeenCalledWith(
      key,
      { reasonCode: 'SENT_IN_ERROR', note: '' },
      'Ada Lovelace'
    )
  })

  test('Purge with no reason: the dialog is handed back open, saying "Choose a reason"', async () => {
    const posted = await request('POST', `${path}/purge`, {
      back: listPath,
      note: 'typed'
    })

    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}&confirm=purge`
    )

    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(true)
    expect(flat(by($, 'purge-reason-error').text())).toBe('Choose a reason')
    expect(by($, 'purge-note').val()).toBe('typed')
    expect(flat($('[data-gpa-count-for="purge-note"]').text())).toBe('5 / 500')
    expect(purgeEvent).not.toHaveBeenCalled()
  })

  test('Other with no note: "Add a note to say why", the reason kept', async () => {
    const posted = await request('POST', `${path}/purge`, {
      reasonCode: 'OTHER'
    })
    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(flat(by($, 'purge-note-error').text())).toBe('Add a note to say why')
    expect($('input[name="reasonCode"][value="OTHER"]').is('[checked]')).toBe(
      true
    )
    expect(by($, 'purge-note').attr('aria-invalid')).toBe('true')
  })

  test.each([
    ['no reason', { note: 'typed' }, true],
    [
      'another reason',
      { reasonCode: 'SENT_IN_ERROR', note: 'x'.repeat(501) },
      true
    ],
    ['Other', { reasonCode: 'OTHER' }, false]
  ])(
    'sent back with %s, the note is drawn optional (%s), and follows the reason on the page',
    async (_name, payload, optional) => {
      const posted = await request('POST', `${path}/purge`, payload)
      const { $ } = await request(
        'GET',
        posted.location!,
        undefined,
        posted.cookie
      )

      const field = $('.gpa-field:has(#purge-note)')
      const mark = field.find('label[for="purge-note"] .gpa-label-optional')

      expect(mark).toHaveLength(1)
      expect(mark.is('[hidden]')).toBe(!optional)
      expect(field.attr('data-gpa-optional-unless-name')).toBe('reasonCode')
      expect(field.attr('data-gpa-optional-unless-value')).toBe('OTHER')
    }
  )

  test.each([
    ['a deletion date', '2027-02-02T00:00:00.000Z', true],
    ['an empty deletion date', '', false],
    ['no deletion date', null, false]
  ])(
    'a dead letter with %s: the page offers Purge, or not',
    async (_name, purgeDeletionDate, purgeable) => {
      vi.mocked(findEvent).mockResolvedValue(detail({ purgeDeletionDate }))

      const page = await request('GET', path)

      expect(by(page.$, 'event-purge')).toHaveLength(purgeable ? 1 : 0)
    }
  )

  test('a purge is sent without reading the event first: GAS is the gate', async () => {
    await postAndFollow(`${path}/purge`, { reasonCode: 'BROKEN_PAYLOAD' })

    expect(purgeEvent).toHaveBeenCalledTimes(1)
    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test.each([
    [
      { status: 'RESUBMITTED', statusLabel: 'Resubmitted' },
      'This event is now Resubmitted, so it can’t be purged. Nothing has changed.'
    ],
    [
      { status: null, statusLabel: null },
      'This event can’t be purged now. Nothing has changed.'
    ]
  ])(
    'an event GAS says isn’t purgeable, %j: it says what it is now, when GAS does',
    async (named, text) => {
      vi.mocked(purgeEvent).mockRejectedValue(
        responseError(409, { code: 'NOT_PURGEABLE', ...named })
      )

      const { $ } = await postAndFollow(`${path}/purge`, {
        reasonCode: 'BROKEN_PAYLOAD'
      })

      expect(bannerOf($)).toEqual({
        tone: 'warning',
        title: 'Not purged.',
        text
      })
    }
  )

  test.each([
    [
      responseError(404),
      'danger',
      'Not purged.',
      'GAS no longer has this event. Nothing has changed.'
    ],
    [
      responseError(400),
      'danger',
      'Not purged.',
      'GAS refused the request. Nothing has changed.'
    ],
    [
      responseError(504),
      'warning',
      'Purge status unknown.',
      'GAS didn’t answer in time. Refresh to see whether the event was purged before trying again.'
    ],
    [
      responseError(503),
      'danger',
      'Not purged.',
      'GAS answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      notConnected,
      'danger',
      'Not purged.',
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ])('GAS answering %s gives its banner', async (error, tone, title, text) => {
    vi.mocked(purgeEvent).mockRejectedValue(error)

    const { $ } = await postAndFollow(`${path}/purge`, {
      reasonCode: 'BROKEN_PAYLOAD'
    })

    expect(bannerOf($)).toEqual({ tone, title, text })
  })
})

describe('Review', () => {
  const review = (text: string, extra: object = {}) =>
    request('POST', `${path}/payload/review`, {
      text,
      revision: '3',
      back: listPath,
      ...extra
    })

  test('a changed payload: Review changes, a wide form for the diff, the note with its count, and the three buttons', async () => {
    const { $, statusCode } = await review(edited)

    expect(statusCode).toBe(statusCodes.ok)

    const card = by($, 'event-payload-review')

    expect(card.find('.gpa-card-head h2').text()).toBe('Review changes')
    expect(card.find('.gpa-stepper')).toHaveLength(0)
    expect(card.find('form').hasClass('gpa-form-wide')).toBe(true)
    expect(flat(by($, 'event-diff').find('.gpa-diff-summary').text())).toBe(
      '1 line added1 line removed'
    )
    expect(by($, 'event-diff').attr('class')).toContain('gpa-maxh-360')
    expect(card.find('label[for="edit-note"]').text()).toBe(
      'Why are you changing it?'
    )
    expect(flat($('[data-gpa-count-for="edit-note"]').text())).toBe('0 / 500')
    expect(card.find('form').attr('action')).toBe(`${path}/payload#payload`)
    expect(card.find('input[name="text"]').val()).toBe(edited)
    expect(card.find('input[name="revision"]').val()).toBe('3')
    expect(flat(by($, 'event-save-redrive').text())).toBe('Redrive')
    expect(by($, 'event-save-redrive').attr('name')).toBe('then')
    expect(by($, 'event-save-redrive').attr('value')).toBe('redrive')
    expect(by($, 'event-save').text()).toBe('Save')
    expect(by($, 'event-review-back').attr('formaction')).toBe(
      `${path}/payload/review`
    )
    expect(by($, 'event-review-back').attr('name')).toBe('step')
  })

  test('JSON that can’t be read: the editor again, the text kept, the field saying where', async () => {
    const { $ } = await review('{ "a": 1,, }')

    expect(by($, 'event-payload-editor')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe('{ "a": 1,, }')
    expect(flat(by($, 'event-payload-error').text())).toMatch(
      /^Couldn’t read the payload: expected .+ \(line 1\)\. Check for a missing comma, quote or brace\.$/
    )
    expect(by($, 'event-payload-error').attr('id')).toBe('payload-editor-err')
    expect(by($, 'event-payload-text').attr('aria-invalid')).toBe('true')
    expect(by($, 'event-payload-text').attr('aria-describedby')).toBe(
      'payload-editor-err'
    )
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect($('gpa-textarea-code').attr('data-error-line')).toBe('1')
  })

  test('unchanged: Nothing to review', async () => {
    const { $ } = await review(JSON.stringify(stored, null, 2))

    expect(flat(by($, 'event-unchanged').find('.gpa-alert-title').text())).toBe(
      'Nothing to review.'
    )
  })

  test('Changed while editing: caught at review, the payload as it is now shown below the editor', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({
        payloadRevision: 4,
        lastEdit: { at: '2026-11-04T13:47:00.000Z', by: 'alex.k', note: 'x' }
      })
    )

    const { $ } = await review(edited)

    expect(flat(by($, 'event-stale').find('.gpa-alert-title').text())).toBe(
      'Not saved: the payload changed while you were editing.'
    )
    expect(by($, 'event-payload-text').val()).toBe(edited)
    expect(
      by($, 'event-payload-editor').find('input[name="revision"]').val()
    ).toBe('4')
    expect(flat(by($, 'event-payload-editor').text())).toContain(
      'Saved by alex.k at 4 Nov 2026 13:47'
    )
    expect(by($, 'event-current-payload').attr('class')).toContain(
      'gpa-maxh-240'
    )
    expect(
      by($, 'event-current-payload').find('pre').hasClass('gpa-code-coloured')
    ).toBe(true)
  })

  test('a one-line edit to a long payload: the diff compares only what changed', async () => {
    const values = Array.from({ length: 20000 }, (_, n) => n)

    vi.mocked(findEvent).mockResolvedValue(detail({ payload: { values } }))

    const { $ } = await review(
      JSON.stringify({ values: values.with(10000, -1) }, null, 2)
    )

    expect(flat(by($, 'event-diff').find('.gpa-diff-summary').text())).toBe(
      '1 line added1 line removed'
    )
    expect(by($, 'event-diff').find('.gpa-diff-line')).toHaveLength(10)
  })

  test('a long payload rewritten through its middle: too large to compare line by line, so shown removed then added', async () => {
    const values = Array.from({ length: 1500 }, (_, n) => n)

    vi.mocked(findEvent).mockResolvedValue(detail({ payload: { values } }))

    const { $ } = await review(
      JSON.stringify({ values: values.toReversed() }, null, 2)
    )

    expect(flat(by($, 'event-diff').find('.gpa-diff-summary').text())).toBe(
      '1500 lines added1500 lines removedToo large to compare line by line'
    )
    expect(
      by($, 'event-diff')
        .find('.gpa-diff-line')
        .toArray()
        .map((line) => $(line).attr('class')?.split(' ')[1])
        .filter((kind, n, kinds) => kind !== kinds[n - 1])
    ).toEqual([
      'is-same',
      'is-del',
      'is-gap',
      'is-del',
      'is-add',
      'is-gap',
      'is-add',
      'is-same'
    ])
  }, 30_000)

  test('held changes to a long payload: the same bounded diff', async () => {
    const values = Array.from({ length: 1500 }, (_, n) => n)

    vi.mocked(findEvent).mockResolvedValue(detail({ payload: { values } }))
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await followHeld(
      request('POST', `${path}/payload`, {
        text: JSON.stringify({ values: values.toReversed() }, null, 2),
        revision: '3',
        back: listPath,
        note: 'Reversed'
      })
    )

    expect(
      flat(by($, 'event-held-diff').find('.gpa-diff-summary').text())
    ).toContain('Too large to compare line by line')
  }, 30_000)

  test('numbers too large to keep: one warning per line', async () => {
    const big =
      '{\n  "a": 12345678901234567890,\n  "b": 98765432109876543210\n}'

    const { $ } = await review(big)

    expect(
      by($, 'event-rounded')
        .toArray()
        .map((alert) => flat($(alert).find('.gpa-alert-title').text()))
    ).toEqual([
      'Number on line 2 will be rounded.',
      'Number on line 3 will be rounded.'
    ])
  })

  test('Back: the editor with the text as it was', async () => {
    const { $ } = await review(edited, { step: 'edit', note: 'kept?' })

    expect(by($, 'event-payload-editor')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe(edited)
  })

  test('an event that is now completed: the edit-conflict banner, and no review', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({ status: 'COMPLETED', statusLabel: 'Completed' })
    )

    const { $ } = await review(edited)

    expect(bannerOf($)).toEqual({
      tone: 'warning',
      title: 'Not saved.',
      text: 'This event is now Completed, so it can’t be edited. Nothing has changed.'
    })
    expect(by($, 'event-payload-review')).toHaveLength(0)
  })

  test('an event that can’t be read: the reason, and the changes shown so nothing is lost', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(503))

    const { $, statusCode } = await review(edited)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(by($, 'event-kept').find('pre').text()).toContain('ref-e2e-005-r2')
  })
})

describe('where a post to the editor lands, so the answer takes focus', () => {
  const review = (text: string, extra: object = {}) =>
    request('POST', `${path}/payload/review`, {
      text,
      revision: '3',
      back: listPath,
      ...extra
    })

  const save = (extra: object = {}) =>
    request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      back: listPath,
      note: 'Pointed at the resubmission',
      ...extra
    })

  test('unchanged: on the alert that says so', async () => {
    const { $ } = await review(JSON.stringify(stored, null, 2))

    expect(landing($)).toMatchObject({
      count: 1,
      testId: 'event-unchanged',
      focusable: true
    })
  })

  test('JSON that can’t be read: on the box itself, with no error summary', async () => {
    const { $ } = await review('{ "a": 1,, }')

    expect(landing($)).toMatchObject({
      count: 1,
      testId: 'event-payload-text'
    })
    expect($('[id="payload"]').is('textarea')).toBe(true)
    expect($('.gpa-errorsummary')).toHaveLength(0)
    expect($('[data-focus-on-arrival]').attr('id')).toBe('payload')
  })

  test('no note: on an error summary that links to the note', async () => {
    const { $ } = await save({ note: '' })
    const summary = $('[id="payload"]')

    expect(landing($).classes).toContain('gpa-errorsummary')
    expect(summary.find('a').attr('href')).toBe('#edit-note')
    expect(flat(summary.find('a').text())).toBe(
      'Say why you’re changing the payload'
    )
  })

  test('changed while editing: on the alert that says so', async () => {
    vi.mocked(editPayload).mockRejectedValue(stale())

    const { $ } = await save()

    expect(landing($)).toMatchObject({ count: 1, testId: 'event-stale' })
  })

  test('held changes: on the alert that says why', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await followHeld(save())

    expect(landing($)).toMatchObject({ count: 1, testId: 'event-held' })
  })

  test('held changes, and the event can’t be read after: on the alert that says they may have been saved', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))
    vi.mocked(findEvent).mockRejectedValue(notConnected)

    const { $ } = await followHeld(save())

    expect(landing($)).toMatchObject({
      count: 1,
      testId: 'event-kept-held',
      focusable: true
    })
    expect($('[data-focus-on-arrival]').attr('id')).toBe('payload')
  })

  test('a failed save, and the event can’t be read after: on the alert that says the event couldn’t be loaded', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(503))
    vi.mocked(findEvent).mockRejectedValue(notConnected)

    const { $ } = await followHeld(save())

    expect(landing($)).toMatchObject({
      count: 1,
      testId: 'event-unavailable',
      focusable: true
    })
    expect($('[data-focus-on-arrival]').attr('id')).toBe('payload')
  })

  test('a review of an event that can’t be read: on the alert that says so', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(503))

    const { $ } = await review(edited)

    expect(landing($)).toMatchObject({
      count: 1,
      testId: 'event-unavailable',
      focusable: true
    })
  })

  test('the editor drawn again with something to say leaves the box to the message', async () => {
    const { $ } = await review(JSON.stringify(stored, null, 2))

    expect($('[autofocus]')).toHaveLength(0)
  })

  test('Back from the review: the editor again, focus in the box', async () => {
    const { $ } = await review(edited, { step: 'edit' })

    expect(by($, 'event-payload-text').attr('autofocus')).toBeDefined()
  })

  test('a save the page refuses: on its error', async () => {
    const { $ } = await server
      .inject({
        method: 'POST',
        url: `${path}/payload`,
        payload: { text: edited, revision: '3', note: 'n' },
        headers: {
          cookie: 'dev-ops-times=utc',
          'sec-fetch-site': 'same-origin'
        },
        auth: { strategy: 'session', credentials: { scope: credentials.scope } }
      })
      .then((response) => ({ $: load(response.result as unknown as string) }))

    expect(landing($)).toMatchObject({ count: 1, testId: 'event-save-error' })
  })

  test('an event that moved on: nowhere, so the banner keeps its focus', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({ status: 'COMPLETED', statusLabel: 'Completed' })
    )

    const { $ } = await review(edited)

    expect(by($, 'event-banner').attr('data-focus-on-arrival')).toBeDefined()
    expect(landing($).count).toBe(0)
  })

  test('the review and the editor with nothing to say: on the card', async () => {
    const reviewed = await review(edited)
    const back = await review(edited, { step: 'edit' })

    expect(landing(reviewed.$).testId).toBe('event-payload-review')
    expect(landing(back.$).testId).toBe('event-payload-editor')
  })
})

describe('Save', () => {
  const save = (extra: object = {}) =>
    request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      back: listPath,
      note: 'Pointed at the resubmission',
      ...extra
    })

  test('saved: GAS gets the edit as the signed-in person, the banner offers Redrive now, and a toast', async () => {
    const posted = await save()

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}#event-banner`
    )
    expect(editPayload).toHaveBeenCalledWith(
      key,
      {
        payload: JSON.parse(edited),
        note: 'Pointed at the resubmission',
        revision: 3
      },
      'Ada Lovelace',
      false
    )
    expect(redriveEvent).not.toHaveBeenCalled()

    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(bannerOf($)).toEqual({
      tone: 'info',
      title: 'Payload saved.',
      text: 'It hasn’t been retried yet — redrive it to process the edited payload.'
    })
    expect(by($, 'event-banner-redrive').attr('data-gpa-open')).toBe(
      'redrive-dialog'
    )
    expect(by($, 'event-banner-redrive').attr('href')).toBe(
      `${path}?back=${encodeURIComponent(listPath)}&confirm=redrive`
    )
    expect(toastsOf($)).toEqual([['success', 'Payload saved']])
  })

  test('no note: the review again, saying why it’s needed, the text kept', async () => {
    const { $, statusCode } = await save({ note: '   ' })

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'event-note-error').text())).toBe(
      'Say why you’re changing the payload'
    )
    expect(by($, 'event-payload-review').find('input[name="text"]').val()).toBe(
      edited
    )
    expect(editPayload).not.toHaveBeenCalled()
  })

  test('Changed while editing, caught by GAS: the editor again over the event GAS answered with, read no more', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      stale(detail({ payload: { id: 'theirs' }, payloadRevision: 4 }))
    )

    const { $, statusCode } = await save()

    expect(statusCode).toBe(statusCodes.ok)
    expect(by($, 'event-stale')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe(edited)
    expect(
      by($, 'event-payload-editor').find('input[name="revision"]').val()
    ).toBe('4')
    expect(flat($('body').text())).toContain('theirs')
    expect(findEvent).not.toHaveBeenCalled()
  })

  test('Changed while editing, and GAS couldn’t read the event again: the changes kept, saying the event couldn’t be loaded', async () => {
    vi.mocked(editPayload).mockRejectedValue(stale(null))

    const { $, statusCode } = await save()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(by($, 'event-kept').find('pre').text()).toContain('ref-e2e-005-r2')
    expect(by($, 'event-unavailable')).toHaveLength(1)
    expect(findEvent).not.toHaveBeenCalled()
  })

  test('Save times out: the changes held for the editor the 303 opens, with Try again and Cancel', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $, statusCode } = await followHeld(save())

    expect(statusCode).toBe(statusCodes.ok)

    const held = by($, 'event-payload-held')

    expect(flat(held.find('.gpa-card-head').text())).toBe('Your changes')
    expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
      'Not saved: GAS timed out.'
    )
    expect(flat(held.find('dd').text())).toBe('Pointed at the resubmission')
    expect(held.find('form').attr('action')).toBe(`${path}/payload#payload`)
    expect(held.find('input[name="text"]').val()).toBe(edited)
    expect(held.find('input[name="note"]').val()).toBe(
      'Pointed at the resubmission'
    )
    expect(by($, 'event-held-cancel').attr('href')).toBe(
      `${path}?back=${encodeURIComponent(listPath)}`
    )
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
  })

  test('held changes are compared line for line, whatever line breaks the form sent', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await followHeld(
      save({ text: edited.replace(/\n/g, '\r\n') })
    )

    expect(
      flat(by($, 'event-payload-held').find('.gpa-diff-summary').text())
    ).toBe('1 line added1 line removed')
  })

  test('held Try again: the same save, which goes through', async () => {
    vi.mocked(editPayload).mockRejectedValueOnce(responseError(504))

    await followHeld(save())

    const posted = await save()

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(editPayload).toHaveBeenCalledTimes(2)
  })

  test.each([
    [
      'the event moved on',
      responseError(409, { statusLabel: 'Completed' }),
      {
        tone: 'warning',
        title: 'Not saved.',
        text: 'This event is now Completed, so it can’t be edited. Nothing has changed.'
      }
    ],
    [
      'GAS no longer has it',
      responseError(404),
      {
        tone: 'danger',
        title: 'Not saved.',
        text: 'GAS no longer has this event. Nothing has changed.'
      }
    ]
  ])('%s: its banner, and no toast', async (_name, error, banner) => {
    vi.mocked(editPayload).mockRejectedValue(error)

    const { $ } = await postAndFollow(`${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n'
    })

    expect(bannerOf($)).toEqual(banner)
    expect(toastsOf($)).toEqual([])
  })

  test.each([
    [
      'GAS fails it',
      path,
      responseError(503),
      'Not saved: GAS answered with an error.'
    ],
    [
      'GAS can’t be reached',
      path,
      notConnected,
      'Not saved: GAS couldn’t be reached.'
    ],
    [
      'GAS can’t be reached, for a CW event',
      `/dev-ops/events/cw/outbox/${id}`,
      notConnected,
      'Not saved: GAS couldn’t be reached.'
    ],
    [
      'CW doesn’t answer GAS in time',
      `/dev-ops/events/cw/outbox/${id}`,
      responseError(504),
      'Not saved: CW timed out.'
    ]
  ])(
    '%s: the changes held, naming the service it is down to',
    async (_name, eventPath, error, title) => {
      vi.mocked(editPayload).mockRejectedValue(error)

      const { $, statusCode } = await followHeld(
        request('POST', `${eventPath}/payload`, {
          text: edited,
          revision: '3',
          note: 'n'
        }),
        ''
      )

      expect(statusCode).toBe(statusCodes.ok)
      expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
        title
      )
      expect(by($, 'event-held-retry')).toHaveLength(1)
    }
  )

  test.each([
    ['the read timing out here', Boom.clientTimeout()],
    ['the connection dropping', connectionReset]
  ])(
    'unanswered, by %s: the changes held, and it may have been saved',
    async (_name, error) => {
      vi.mocked(editPayload).mockRejectedValue(error)

      const { $, statusCode } = await followHeld(save())

      expect(statusCode).toBe(statusCodes.ok)
      expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
        'Not saved: GAS timed out.'
      )
      expect(
        flat(by($, 'event-held').find('.gpa-alert-body > div').first().text())
      ).toBe(
        'It may not have been saved. Your payload and note are below; trying again is safe: if it was saved, you’ll see the payload as it is now.'
      )
      expect(by($, 'event-payload-held').find('input[name="text"]').val()).toBe(
        edited
      )
    }
  )

  test('unanswered, and the event can’t be read after: the changes kept, and it may have been saved', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))
    vi.mocked(findEvent).mockRejectedValue(notConnected)

    const { $, statusCode } = await followHeld(save())
    const kept = by($, 'event-kept')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(kept.find('pre').text()).toContain('ref-e2e-005-r2')
    expect(kept.find('pre').hasClass('gpa-code-coloured')).toBe(true)
    expect(kept.find('.gpa-code-str').text()).toContain('"ref-e2e-005-r2"')
    expect(flat(kept.find('dd').text())).toBe('Pointed at the resubmission')
    expect(flat(by($, 'event-kept-held').find('.gpa-alert-title').text())).toBe(
      'Save status unknown — GAS timed out.'
    )
    expect(
      flat(
        by($, 'event-kept-held').find('.gpa-alert-body > div').first().text()
      )
    ).toBe(
      'It may not have been saved: copy your changes before you leave this page, then try again once the event can be read.'
    )
    expect(by($, 'event-kept-held').attr('class')).toContain('gpa-alert-danger')
  })

  test('failed, and the event can’t be read after: the changes kept, and they haven’t been saved', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(503))
    vi.mocked(findEvent).mockRejectedValue(notConnected)

    const { $ } = await followHeld(save())
    const kept = by($, 'event-kept')

    expect(flat(kept.find('dd').text())).toBe('Pointed at the resubmission')
    expect(flat(kept.find('.gpa-text-muted').first().text())).toBe(
      'They haven’t been saved. Copy them before you leave this page, then try again.'
    )
    expect(by($, 'event-kept-held')).toHaveLength(0)
  })

  test('unanswered, and the event moved on meanwhile: the changes held, with no Try again', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))
    vi.mocked(findEvent).mockResolvedValue(
      detail({ status: 'RESUBMITTED', statusLabel: 'Resubmitted' })
    )

    const { $, statusCode } = await followHeld(save())
    const held = by($, 'event-payload-held')

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
      'Not saved: GAS timed out.'
    )
    expect(
      flat(by($, 'event-held').find('.gpa-alert-body > div').first().text())
    ).toBe(
      'It may not have been saved. Your payload and note are below. This event is now Resubmitted, so it can’t be edited again.'
    )
    expect(flat(held.find('dd').text())).toBe('Pointed at the resubmission')
    expect(by($, 'event-held-retry')).toHaveLength(0)
    expect(by($, 'event-held-cancel').attr('href')).toBe(
      `${path}?back=${encodeURIComponent(listPath)}`
    )
    expect(by($, 'event-banner')).toHaveLength(0)
  })

  test('can’t be reached: nothing has changed, so the body says so', async () => {
    vi.mocked(editPayload).mockRejectedValue(notConnected)

    const { $ } = await followHeld(save())

    expect(
      flat(by($, 'event-held').find('.gpa-alert-body > div').first().text())
    ).toBe('Nothing has changed on the event. Your payload and note are below.')
  })

  test('GAS refuses the payload: the banner gives its reason', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      responseError(422, { reason: 'TOO_LARGE' })
    )

    const { $ } = await postAndFollow(`${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n'
    })

    expect(bannerOf($)).toEqual({
      tone: 'danger',
      title: 'Not saved.',
      text: 'The payload is over 256 KiB once formatted. Nothing has changed.'
    })
  })

  test('a session that names nobody: not saved, said above the review', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `${path}/payload`,
      payload: { text: edited, revision: '3', note: 'n' },
      headers: { 'sec-fetch-site': 'same-origin' },
      auth: {
        strategy: 'session',
        credentials: { user: {}, scope: credentials.scope }
      }
    })
    const $ = load(response.result as unknown as string)

    expect(
      flat(by($, 'event-save-error').find('.gpa-alert-title').text())
    ).toBe(
      'Not saved: your account has no name or email to record against this change.'
    )
    expect(editPayload).not.toHaveBeenCalled()
  })
})

describe('Save and redrive', () => {
  const saveAndRedrive = () =>
    postAndFollow(`${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'Pointed at the resubmission',
      then: 'redrive'
    })

  const redrove = (redrive: SaveRedrive) =>
    vi.mocked(editPayload).mockResolvedValue({ payloadRevision: 4, redrive })

  test('both go through, in one call: one banner and one toast for both', async () => {
    redrove({ outcome: 'redriven' })

    const { $ } = await saveAndRedrive()

    expect(editPayload).toHaveBeenCalledExactlyOnceWith(
      key,
      expect.any(Object),
      'Ada Lovelace',
      true
    )
    expect(redriveEvent).not.toHaveBeenCalled()
    expect(bannerOf($)).toEqual({
      tone: 'success',
      title: 'Payload saved and redriven.',
      text: 'The poller will retry it with the edited payload.'
    })
    expect(toastsOf($)).toEqual([['success', 'Payload saved and redriven']])
  })

  test('saved, but the redrive failed: saved, and the redrive’s failure after it, not held', async () => {
    redrove({ outcome: 'failed' })

    const { $, posted } = await saveAndRedrive()

    expect(posted.location).toBe(`${path}#event-banner`)
    expect(bannerOf($)).toEqual({
      tone: 'danger',
      title: 'Payload saved. Not redriven.',
      text: 'The edited payload is stored, but the redrive didn’t go through. You can try the redrive again.'
    })
    expect(by($, 'event-banner-redrive').attr('href')).toBe(
      `${path}?confirm=redrive`
    )
    expect(toastsOf($)).toEqual([['success', 'Payload saved']])
    expect(by($, 'event-payload-held')).toHaveLength(0)
  })

  test('saved, but the redrive refused: the payload stored, and why it wasn’t redriven', async () => {
    redrove({ outcome: 'conflict', status: 'PUBLISHED', statusLabel: 'Queued' })

    const { $ } = await saveAndRedrive()

    expect(bannerOf($)).toEqual({
      tone: 'warning',
      title: 'Payload saved. Not redriven.',
      text: 'The edited payload is stored. This event is now Queued, so it can’t be redriven.'
    })
  })

  test('the save is stale: the editor again, and nothing redriven', async () => {
    vi.mocked(editPayload).mockRejectedValue(stale())

    const { $ } = await request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n',
      then: 'redrive'
    })

    expect(by($, 'event-stale')).toHaveLength(1)
    expect(redriveEvent).not.toHaveBeenCalled()
  })

  test('the save times out: held, and Try again keeps the redrive', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await followHeld(
      request('POST', `${path}/payload`, {
        text: edited,
        revision: '3',
        note: 'n',
        then: 'redrive'
      }),
      ''
    )

    expect(by($, 'event-held-retry').attr('name')).toBe('then')
    expect(by($, 'event-held-retry').attr('value')).toBe('redrive')
    expect(redriveEvent).not.toHaveBeenCalled()
  })
})

describe('a held save, kept in the session', () => {
  const otherPath = `/dev-ops/events/gas/outbox/${'b'.repeat(24)}`

  const hold = async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    return request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'Pointed at the resubmission'
    })
  }

  const heldOn = ($: CheerioAPI) => by($, 'event-payload-held').length === 1

  test('is drawn once, on its own event only', async () => {
    const posted = await hold()
    const other = await request('GET', otherPath, undefined, posted.cookie)
    const own = await request('GET', path, undefined, other.cookie)
    const again = await request('GET', path, undefined, own.cookie)

    expect(heldOn(other.$)).toBe(false)
    expect(heldOn(own.$)).toBe(true)
    expect(heldOn(again.$)).toBe(false)
  })

  test('is dropped once older than five minutes', async () => {
    const posted = await hold()

    vi.setSystemTime(new Date('2026-10-13T15:25:01.000Z'))
    const page = await request('GET', path, undefined, posted.cookie)

    vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))
    expect(heldOn(page.$)).toBe(false)
  })

  test('keeps another event’s held save while one is spent', async () => {
    const first = await hold()
    const second = await request(
      'POST',
      `${otherPath}/payload`,
      { text: edited, revision: '3', note: 'n' },
      first.cookie
    )
    const own = await request('GET', path, undefined, second.cookie)
    const other = await request('GET', otherPath, undefined, own.cookie)

    expect(heldOn(own.$)).toBe(true)
    expect(heldOn(other.$)).toBe(true)
  })

  const heldAfterAnotherEdit = async (
    error: unknown,
    moved: Parameters<typeof detail>[0] = {}
  ) => {
    vi.mocked(editPayload).mockRejectedValue(error)
    const posted = await request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'Pointed at the resubmission'
    })

    vi.mocked(findEvent).mockResolvedValue(
      detail({ payloadRevision: 4, ...moved })
    )

    return request('GET', posted.location!, undefined, posted.cookie)
  }

  const heldBodyOf = ($: CheerioAPI) =>
    flat(by($, 'event-held').find('.gpa-alert-body > div').first().text())

  test.each([
    [
      'unanswered',
      responseError(504),
      'Save status unknown — GAS timed out.',
      'It may have been saved, but the payload has changed since: your payload and note are below, against the payload as it is now. Trying again opens them in the editor over it.'
    ],
    [
      'failed',
      responseError(503),
      'Not saved: GAS answered with an error.',
      'Nothing you sent was saved, but the payload has changed since: your payload and note are below, against the payload as it is now. Trying again opens them in the editor over it.'
    ]
  ])(
    '%s, and another edit moved the revision on: the changes still held, saying the payload changed',
    async (_name, error, title, body) => {
      const { $ } = await heldAfterAnotherEdit(error)
      const held = by($, 'event-payload-held')

      expect(heldOn($)).toBe(true)
      expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
        title
      )
      expect(heldBodyOf($)).toBe(body)
      expect(held.find('input[name="text"]').val()).toBe(edited)
      expect(held.find('input[name="revision"]').val()).toBe('3')
      expect(flat(held.find('dd').text())).toBe('Pointed at the resubmission')
      expect(by($, 'event-held-retry')).toHaveLength(1)
      expect(by($, 'event-banner')).toHaveLength(0)
    }
  )

  test('failed, another edit moved the revision on, and the event can’t be edited now: the changes still held, with no Try again', async () => {
    const { $ } = await heldAfterAnotherEdit(responseError(503), {
      status: 'RESUBMITTED',
      statusLabel: 'Resubmitted'
    })

    expect(heldOn($)).toBe(true)
    expect(heldBodyOf($)).toBe(
      'Nothing you sent was saved, but the payload has changed since: your payload and note are below, against the payload as it is now. This event is now Resubmitted, so it can’t be edited again.'
    )
    expect(by($, 'event-payload-held').find('input[name="text"]').val()).toBe(
      edited
    )
    expect(by($, 'event-held-retry')).toHaveLength(0)
  })
})

describe('the writes are refused from another origin', () => {
  test.each([
    ['redrive', `${path}/redrive`, {}],
    ['purge', `${path}/purge`, { reasonCode: 'BROKEN_PAYLOAD' }],
    ['review', `${path}/payload/review`, { text: edited, revision: '3' }],
    ['save', `${path}/payload`, { text: edited, revision: '3', note: 'n' }]
  ])(
    '%s: 403 from a same-site frontend that isn’t this app, and GAS is never asked',
    async (_name, url, payload) => {
      const response = await server.inject({
        method: 'POST',
        url,
        payload,
        headers: {
          'sec-fetch-site': 'same-site',
          origin: 'https://other.cdp-int.defra.cloud'
        },
        auth: { strategy: 'session', credentials }
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(redriveEvent).not.toHaveBeenCalled()
      expect(purgeEvent).not.toHaveBeenCalled()
      expect(editPayload).not.toHaveBeenCalled()
      expect(findEvent).not.toHaveBeenCalled()
    }
  )
})

describe('the page to go back to', () => {
  test.each([
    ['a protocol-relative path', '//evil.example/dev-ops/x'],
    ['a backslash path', '/dev-ops\\evil.example'],
    ['a path outside Dev Ops', '/auth/logout']
  ])('%s is dropped from the redirect', async (_name, back) => {
    const posted = await request('POST', `${path}/redrive`, { back })

    expect(posted.location).toBe(`${path}#event-banner`)
  })

  test.each([
    ['a protocol-relative path', '//evil.example/dev-ops/x'],
    ['a backslash path', '/dev-ops\\evil.example']
  ])('%s is no Back link on the page', async (_name, back) => {
    const { $ } = await request(
      'GET',
      `${path}?back=${encodeURIComponent(back)}`
    )

    expect(by($, 'event-back').attr('href')).toBe('/dev-ops/events/gas')
  })
})

test('Back from Review keeps the note, and the next review shows it again', async () => {
  const back = await request('POST', `${path}/payload/review`, {
    text: edited,
    revision: '3',
    note: 'Pointed at the resubmission',
    step: 'edit'
  })

  expect(
    by(back.$, 'event-payload-editor').find('input[name="note"]').val()
  ).toBe('Pointed at the resubmission')

  const again = await request('POST', `${path}/payload/review`, {
    text: edited,
    revision: '3',
    note: 'Pointed at the resubmission'
  })

  expect(by(again.$, 'event-note').text().trim()).toBe(
    'Pointed at the resubmission'
  )
})
