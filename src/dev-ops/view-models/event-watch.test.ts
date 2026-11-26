import type {
  EventDetail,
  EventHistoryEntry
} from '../use-cases/get-event.use-case.ts'
import type { EventContext } from './event-context.ts'
import {
  toFailedAgain,
  toSameError,
  toWatch,
  toWatchOutcome
} from './event-watch.ts'

const attempt = (
  number: number,
  message: string,
  name = 'Error'
): EventHistoryEntry => ({
  kind: 'attempt',
  at: `2026-10-13T14:53:2${number}.000Z`,
  number,
  name,
  message,
  stack: null
})

const redriven: EventHistoryEntry = {
  kind: 'redriven',
  at: '2026-10-13T15:00:00.000Z',
  by: 'Ada Lovelace'
}

const received: EventHistoryEntry = {
  kind: 'received',
  at: '2026-10-13T14:53:00.000Z'
}

const withHistory = (history?: EventHistoryEntry[]) =>
  ({ history }) as EventDetail

const waiting = {
  tone: 'success',
  title: 'Payload saved and redriven.',
  text: 'Checking for the result…',
  redriveNow: false,
  busy: true
} as const

const context = (tab: 'overview' | 'history', from = '') =>
  ({
    key: {
      service: 'caseworking',
      box: 'inbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b'
    },
    from,
    tab
  }) as EventContext

describe('toWatch', () => {
  test('checks the event’s status, and fetches its result for the tab it is on, keeping where it goes back to', () => {
    const watch = toWatch(context('history', '/dev-ops/events/cw'), waiting)

    expect(watch.statusHref).toBe(
      '/dev-ops/events/cw/inbox/665f1c2e9a1b2c3d4e5f6a7b/status'
    )
    expect(watch.resultHref).toBe(
      '/dev-ops/events/cw/inbox/665f1c2e9a1b2c3d4e5f6a7b/result?back=%2Fdev-ops%2Fevents%2Fcw&tab=history'
    )
  })

  test('without a script: the same title, and a Reload of the same page', () => {
    expect(toWatch(context('overview'), waiting).noScript).toStrictEqual({
      tone: 'success',
      title: 'Payload saved and redriven.',
      text: 'Reload the page to see how it went.',
      redriveNow: false,
      reloadHref: '/dev-ops/events/cw/inbox/665f1c2e9a1b2c3d4e5f6a7b'
    })
  })

  test('stopped: not retried yet, under the same title, with Check again on the same page', () => {
    expect(toWatch(context('history'), waiting).stopped).toStrictEqual({
      notRetried: {
        tone: 'success',
        title: 'Payload saved and redriven.',
        text: 'Not retried yet. Stopped checking after 30 seconds.',
        redriveNow: false
      },
      title: 'Payload saved and redriven.',
      againHref: '/dev-ops/events/cw/inbox/665f1c2e9a1b2c3d4e5f6a7b?tab=history'
    })
  })
})

describe('toWatchOutcome', () => {
  test('delivered, a dead letter again, purged since, or no result yet', () => {
    expect(
      ['COMPLETED', 'DEAD_LETTER', 'PURGED', 'RESUBMITTED', 'FAILED'].map(
        toWatchOutcome
      )
    ).toStrictEqual(['delivered', 'failed', 'purged', 'waiting', 'waiting'])
  })
})

describe('toSameError', () => {
  test('the newest error since the redrive against the newest before it', () => {
    expect(
      toSameError(
        withHistory([
          attempt(7, 'boom'),
          attempt(6, 'bang'),
          redriven,
          attempt(5, 'boom'),
          attempt(4, 'other'),
          received
        ])
      )
    ).toBe(true)
  })

  test('one cut shorter than the other is the same error', () => {
    expect(
      toSameError(
        withHistory([
          attempt(2, 'Not found: ref-1'),
          redriven,
          attempt(1, 'Not found')
        ])
      )
    ).toBe(true)
  })

  test('another message, or another name, is a different error', () => {
    expect(
      toSameError(
        withHistory([attempt(2, 'bang'), redriven, attempt(1, 'boom')])
      )
    ).toBe(false)
    expect(
      toSameError(
        withHistory([
          attempt(2, 'boom', 'TypeError'),
          redriven,
          attempt(1, 'boom')
        ])
      )
    ).toBe(false)
  })

  test('nothing to compare: no attempt kept before the redrive, none since, or no redrive', () => {
    expect(
      toSameError(withHistory([attempt(1, 'boom'), redriven, received]))
    ).toBeNull()
    expect(toSameError(withHistory([redriven, attempt(1, 'boom')]))).toBeNull()
    expect(toSameError(withHistory([attempt(1, 'boom'), received]))).toBeNull()
    expect(toSameError(withHistory())).toBeNull()
  })

  test('only the newest redrive counts', () => {
    expect(
      toSameError(
        withHistory([
          attempt(3, 'boom'),
          redriven,
          attempt(2, 'bang'),
          redriven,
          attempt(1, 'boom')
        ])
      )
    ).toBe(false)
  })
})

describe('toFailedAgain', () => {
  test.each([
    [
      'the same error',
      [attempt(2, 'boom'), redriven, attempt(1, 'boom')],
      'It’s a dead letter again, with the same error.'
    ],
    [
      'a different error',
      [attempt(2, 'bang'), redriven, attempt(1, 'boom')],
      'It’s a dead letter again, with a different error. History shows it.'
    ],
    [
      'nothing to compare',
      [attempt(1, 'boom'), redriven, received],
      'It’s a dead letter again. History shows the error.'
    ]
  ])('a warning: %s', (_case, history, text) => {
    expect(toFailedAgain(withHistory(history))).toStrictEqual({
      tone: 'warning',
      title: 'Failed again.',
      text,
      redriveNow: false
    })
  })
})
