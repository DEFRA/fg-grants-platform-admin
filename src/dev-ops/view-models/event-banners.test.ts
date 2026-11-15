import { toBanner, toToasts } from './event-banners.ts'
import type { BannerContext, EventNotice } from './event-banners.ts'

const context: BannerContext = {
  service: 'CW',
  allowed: 5,
  deletionDay: '2 Feb 2027',
  canRedrive: true
}

const notice = (overrides: Partial<EventNotice>): EventNotice => ({
  outcome: 'redriven',
  status: null,
  page: '/dev-ops/events/cw/outbox/x',
  ...overrides
})

describe('toBanner', () => {
  test('nothing to say without a notice', () => {
    expect(toBanner(null, context)).toBeNull()
  })

  test('a notice from before purge existed is a redrive', () => {
    expect(toBanner(notice({}), context)?.title).toBe('Redriven.')
  })

  test('redriven: up to the allowed attempts, or without a count when there is none', () => {
    expect(toBanner(notice({}), context)?.text).toBe(
      'The poller will pick it up shortly and retry it up to 5 times.'
    )
    expect(toBanner(notice({}), { ...context, allowed: null })?.text).toBe(
      'The poller will pick it up shortly and retry it.'
    )
  })

  test.each([
    [
      'timed-out',
      { kind: 'timed-out' },
      'CW didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    ],
    [
      'timed-out',
      { kind: 'no-answer' },
      'GAS didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    ],
    [
      'unavailable',
      { kind: 'not-connected' },
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ],
    [
      'unavailable',
      { kind: 'cw-not-reached' },
      'CW couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ] as const)(
    'a CW redrive %s names the service its failure is down to: %o',
    (outcome, failure, text) => {
      expect(toBanner(notice({ outcome, failure }), context)?.text).toBe(text)
    }
  )

  test.each([
    [
      'timed-out',
      'CW didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    ],
    [
      'unavailable',
      'GAS answered with an error. Nothing has changed — try again in a moment.'
    ]
  ] as const)(
    'a %s notice another release wrote without its failure still has its banner',
    (outcome, text) => {
      expect(toBanner(notice({ outcome }), context)?.text).toBe(text)
    }
  )

  test('a conflict with no status still says nothing changed', () => {
    expect(
      toBanner(notice({ outcome: 'conflict', action: 'purge' }), context)?.text
    ).toBe('This event can’t be purged now. Nothing has changed.')
  })

  test('purged without a deletion date', () => {
    expect(
      toBanner(notice({ outcome: 'purged', action: 'purge' }), {
        ...context,
        deletionDay: null
      })?.text
    ).toBe('It won’t be retried. You can still redrive it.')
  })

  test('saved: Redrive now only where it can be redriven', () => {
    const saved = notice({ outcome: 'saved', action: 'edit' })

    expect(toBanner(saved, context)?.redriveNow).toBe(true)
    expect(toBanner(saved, { ...context, canRedrive: false })?.redriveNow).toBe(
      false
    )
  })

  test('saved, then a redrive GAS no longer had the event for', () => {
    expect(
      toBanner(
        notice({
          outcome: 'saved',
          action: 'edit',
          redrive: { outcome: 'not-found', status: null }
        }),
        context
      )
    ).toEqual({
      tone: 'danger',
      title: 'Payload saved. Not redriven.',
      text: 'The edited payload is stored, but CW no longer had the event to redrive.',
      redriveNow: false
    })
  })

  test.each([
    [
      'Queued',
      'The edited payload is stored. This event is now Queued, so it can’t be redriven.'
    ],
    [null, 'The edited payload is stored. This event can’t be redriven now.']
  ])(
    'saved, then the redrive refused with %s: the save stands, never nothing has changed',
    (status, text) => {
      expect(
        toBanner(
          notice({
            outcome: 'saved',
            action: 'edit',
            redrive: { outcome: 'conflict', status }
          }),
          context
        )
      ).toEqual({
        tone: 'warning',
        title: 'Payload saved. Not redriven.',
        text,
        redriveNow: false
      })
    }
  )

  test('saved, then the redrive went unanswered: the save stands', () => {
    expect(
      toBanner(
        notice({
          outcome: 'saved',
          action: 'edit',
          redrive: {
            outcome: 'timed-out',
            status: null,
            failure: { kind: 'timed-out' }
          }
        }),
        context
      )?.text
    ).toMatch(
      /^The edited payload is stored\. .* Refresh to see whether the event was queued before redriving it again\.$/
    )
  })

  test('saved, then the redrive failed: the save stands, and the banner offers the redrive again where it can be redriven', () => {
    const failed = notice({
      outcome: 'saved',
      action: 'edit',
      redrive: {
        outcome: 'unavailable',
        status: null,
        failure: { kind: 'errored' }
      }
    })

    expect(toBanner(failed, context)).toEqual({
      tone: 'danger',
      title: 'Payload saved. Not redriven.',
      text: 'The edited payload is stored, but the redrive didn’t go through. You can try the redrive again.',
      redriveNow: true
    })
    expect(
      toBanner(failed, { ...context, canRedrive: false })?.redriveNow
    ).toBe(false)
  })

  test('a refusal with a reason this release has no sentence for still reads as a refusal', () => {
    expect(
      toBanner(
        notice({ outcome: 'refused', action: 'edit', reason: 'NEW_RULE' }),
        context
      )?.text
    ).toBe('CW refused the change. Nothing has changed.')
  })

  test('an outcome another release wrote is no banner', () => {
    expect(
      toBanner(notice({ outcome: 'nope' as 'saved', action: 'edit' }), context)
    ).toBeNull()
  })
})

describe('toToasts', () => {
  test.each([
    [notice({}), [{ tone: 'success', text: 'Event redriven' }]],
    [
      notice({ outcome: 'purged', action: 'purge' }),
      [{ tone: 'info', text: 'Event purged' }]
    ],
    [
      notice({ outcome: 'saved', action: 'edit' }),
      [{ tone: 'success', text: 'Payload saved' }]
    ],
    [
      notice({
        outcome: 'saved',
        action: 'edit',
        redrive: { outcome: 'redriven', status: null }
      }),
      [{ tone: 'success', text: 'Payload saved and redriven' }]
    ],
    [notice({ outcome: 'timed-out' }), []],
    [null, []]
  ])('%#', (given, toasts) => {
    expect(toToasts(given)).toEqual(toasts)
  })
})

test('an action another release wrote is no banner and no toast, and doesn’t throw', () => {
  const unknown = notice({
    outcome: 'archived' as 'saved',
    action: 'archive' as 'edit'
  })

  expect(toBanner(unknown, context)).toBeNull()
  expect(toToasts(unknown)).toEqual([])
})
