import type { SourceError } from '../repositories/events.repository.ts'
import type {
  GrantVersionEvents,
  RecordEvents,
  VersionEvents
} from '../use-cases/record-reads.ts'
import { configEvent } from '../use-cases/test-fixtures.ts'
import { toGrantVersionEvent, toWorkflowVersionEvent } from './version-event.ts'

const back = '/dev-ops/grants/woodland/1.2.0'

const read = (
  rows: RecordEvents['rows'],
  more = false,
  sourceErrors: SourceError[] = []
): VersionEvents => ({ outcome: 'read', events: { rows, more }, sourceErrors })

const readByGas = (
  rows: RecordEvents['rows'],
  extra: Partial<Extract<GrantVersionEvents, { outcome: 'read' }>> = {}
): GrantVersionEvents => ({
  outcome: 'read',
  events: { rows, more: false },
  sourceErrors: [],
  pastDeletion: false,
  ...extra
})

const now = new Date('2026-11-17T12:00:00.000Z')
const old = { receivedAt: '2026-08-18T11:59:00.000Z', now }
const recent = { receivedAt: '2026-11-09T09:00:00.000Z', now }

const gone = {
  kind: 'gone',
  text: 'No longer held: past its deletion date'
}

describe('toGrantVersionEvent', () => {
  test('links the newest event that completed, coming back to the version', () => {
    expect(
      toGrantVersionEvent(
        readByGas([
          configEvent('gas', {
            id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            status: 'DEAD_LETTER'
          }),
          configEvent('gas', {
            id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            eventId: 'newest-completed'
          }),
          configEvent('gas', {
            id: 'cccccccccccccccccccccccc',
            eventId: 'older'
          })
        ]),
        back
      )
    ).toEqual({
      kind: 'held',
      eventId: 'newest-completed',
      href: '/dev-ops/events/gas/inbox/bbbbbbbbbbbbbbbbbbbbbbbb?back=%2Fdev-ops%2Fgrants%2Fwoodland%2F1.2.0'
    })
  })

  test.each(['PROCESSING', 'PUBLISHED'])(
    'links the newest event held when none has completed yet and it is %s',
    (status) => {
      expect(
        toGrantVersionEvent(
          readByGas([
            configEvent('gas', { status: 'FAILED', eventId: 'failed' }),
            configEvent('gas', { status, eventId: 'on-its-way' })
          ]),
          back
        )
      ).toMatchObject({ kind: 'held', eventId: 'on-its-way' })
    }
  )

  test.each(['DEAD_LETTER', 'FAILED', 'RESUBMITTED', 'PURGED'])(
    'never links a %s delivery as the event the version arrived as, and says that is all it holds',
    (status) => {
      expect(
        toGrantVersionEvent(readByGas([configEvent('gas', { status })]), back)
      ).toEqual({
        kind: 'none',
        text: 'Only failed deliveries in GAS’s inbox.'
      })
    }
  )

  test('says the event is past its deletion date when GAS says so', () => {
    expect(
      toGrantVersionEvent(readByGas([], { pastDeletion: true }), back)
    ).toEqual(gone)
  })

  test('says only that no event was found when GAS says the version is within its retention', () => {
    expect(toGrantVersionEvent(readByGas([]), back)).toEqual({
      kind: 'none',
      text: 'No event found in GAS’s inbox.'
    })
  })

  test.each([
    [{ outcome: 'timed-out' }, 'GAS didn’t answer in time.'],
    [{ outcome: 'failed' }, 'GAS answered with an error.'],
    [
      readByGas([configEvent('gas')], { sourceErrors: [{ hop: 'GAS inbox' }] }),
      'GAS answered with an error.'
    ]
  ] satisfies [GrantVersionEvents, string][])(
    "says GAS's inbox couldn't be read, and why: %o",
    (events, why) => {
      expect(toGrantVersionEvent(events, back)).toEqual({
        kind: 'unread',
        text: `Couldn’t be read from GAS’s inbox. ${why}`
      })
    }
  )

  test('says the inbox couldn’t be read when nothing was read', () => {
    expect(toGrantVersionEvent(undefined, back)).toEqual({
      kind: 'unread',
      text: 'Couldn’t be read from GAS’s inbox.'
    })
  })
})

describe('toWorkflowVersionEvent', () => {
  test("links CW's event under CW's own address", () => {
    expect(
      toWorkflowVersionEvent(read([configEvent('caseworking')]), back, old)
    ).toMatchObject({
      href: expect.stringMatching(/^\/dev-ops\/events\/cw\/inbox\//)
    })
  })

  test('says the event is past its deletion date when the inbox, read whole, holds none of a version older than events are kept', () => {
    expect(toWorkflowVersionEvent(read([]), back, old)).toEqual(gone)
  })

  test('an old version whose inbox holds only a failed delivery is not past its deletion date', () => {
    expect(
      toWorkflowVersionEvent(
        read([configEvent('caseworking', { status: 'DEAD_LETTER' })]),
        back,
        old
      )
    ).toEqual({ kind: 'none', text: 'Only failed deliveries in CW’s inbox.' })
  })

  test.each([
    ['received within the time events are kept', recent],
    ['received at a time that is not one', { receivedAt: 'soon', now }]
  ])(
    'says only that no event was found for a version %s',
    (_when, received) => {
      expect(toWorkflowVersionEvent(read([]), back, received)).toEqual({
        kind: 'none',
        text: 'No event found in CW’s inbox.'
      })
    }
  )

  test.each([
    ['none', []],
    [
      'only a dead letter',
      [configEvent('caseworking', { status: 'DEAD_LETTER' })]
    ]
  ])(
    'never says past its deletion date when the inbox has more than it gave and holds %s',
    (_held, rows) => {
      expect(toWorkflowVersionEvent(read(rows, true), back, old)).toEqual({
        kind: 'unread',
        text: 'Not among the newest events in CW’s inbox.'
      })
    }
  )

  test.each([
    [{ outcome: 'timed-out' }, 'CW didn’t answer in time.'],
    [
      read([configEvent('caseworking')], false, [{ hop: 'CW-BE' }]),
      'CW couldn’t be reached.'
    ]
  ] satisfies [VersionEvents, string][])(
    "says CW's inbox couldn't be read, and why: %o",
    (events, why) => {
      expect(toWorkflowVersionEvent(events, back, old)).toEqual({
        kind: 'unread',
        text: `Couldn’t be read from CW’s inbox. ${why}`
      })
    }
  )
})
