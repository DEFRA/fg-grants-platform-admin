import type {
  EventDetail,
  EventHistoryEntry
} from '../use-cases/get-event.use-case.ts'
import { toHistory } from './event-history.ts'
import { toTimes } from './times.ts'

const utc = toTimes('utc')

const at = '2026-10-13T14:53:24.011Z'

const historyFor = (...history: EventHistoryEntry[]) =>
  toHistory({ history } as EventDetail, utc)

const one = (entry: EventHistoryEntry) => historyFor(entry)[0]

describe('toHistory', () => {
  test.each<[string, EventHistoryEntry, object]>([
    [
      'received',
      { kind: 'received', at },
      { icon: 'inbox', tone: 'neutral', title: 'Received', content: null }
    ],
    [
      'dead-lettered',
      { kind: 'dead-lettered', at },
      {
        icon: 'archive',
        tone: 'warning',
        title: 'Marked as a dead letter',
        content: null
      }
    ],
    [
      'redriven',
      { kind: 'redriven', at, by: 'ada' },
      {
        icon: 'refresh-cw',
        tone: 'info',
        title: 'Redriven by ada',
        content: null
      }
    ],
    [
      'delivered',
      { kind: 'delivered', at },
      { icon: 'check', tone: 'success', title: 'Delivered', content: null }
    ],
    [
      'purged',
      {
        kind: 'purged',
        at,
        by: 'ada',
        reasonCode: 'SENT_IN_ERROR',
        note: 'Duplicate.'
      },
      {
        icon: 'trash',
        tone: 'neutral',
        title: 'Purged by ada',
        content: {
          kind: 'purge',
          reason: 'Sent in error',
          note: '“Duplicate.”'
        }
      }
    ],
    [
      'payload-edited',
      {
        kind: 'payload-edited',
        at,
        by: 'ada',
        note: 'Fixed.',
        before: { a: 1 },
        after: { a: 2 }
      },
      {
        icon: 'pencil',
        tone: 'info',
        title: 'Payload edited by ada',
        content: {
          kind: 'edit',
          note: '“Fixed.”',
          diff: { before: '{\n  "a": 1\n}', after: '{\n  "a": 2\n}' }
        }
      }
    ]
  ])('%s', (_kind, entry, expected) => {
    expect(one(entry)).toMatchObject({ ...expected, hiddenTitle: null })
  })

  test('an attempt: no title, a hidden one, its error and stack in one block, to the millisecond', () => {
    expect(
      one({
        kind: 'attempt',
        at,
        number: 3,
        name: 'Error',
        message: 'boom',
        stack: 'Error: boom\n    at x (/a.js:1:1)'
      })
    ).toEqual({
      id: 'history-1',
      icon: 'x',
      tone: 'danger',
      title: null,
      hiddenTitle: 'Attempt 3 failed',
      at: {
        datetime: at,
        text: '13 Oct 2026 14:53:24.011',
        title: '13 Oct 2026 14:53:24 UTC'
      },
      content: {
        kind: 'error',
        label: 'Attempt 3: error',
        code: 'Error: boom\n    at x (/a.js:1:1)'
      }
    })
  })

  test('every other entry to the second', () => {
    expect(one({ kind: 'received', at })?.at?.text).toBe('13 Oct 2026 14:53:24')
  })

  test('an edit with no payload kept from before: its note, no diff; with no note either, nothing under it', () => {
    const edit = {
      kind: 'payload-edited' as const,
      at,
      by: 'ada',
      before: null,
      after: null
    }

    expect(one({ ...edit, note: 'n' }).content).toEqual({
      kind: 'edit',
      note: '“n”',
      diff: null
    })
    expect(one({ ...edit, note: null }).content).toBeNull()
  })

  test('a purge with no reason code or note says neither', () => {
    expect(
      one({ kind: 'purged', at, by: 'ada', reasonCode: '', note: null }).content
    ).toEqual({ kind: 'purge', reason: null, note: null })
  })

  test('no time: no meta', () => {
    expect(one({ kind: 'received', at: null }).at).toBeNull()
  })

  test('ids count from the oldest, so they hold as newer entries arrive', () => {
    expect(
      historyFor({ kind: 'delivered', at }, { kind: 'received', at }).map(
        ({ id }) => id
      )
    ).toEqual(['history-2', 'history-1'])
  })

  test('a kind this page doesn’t know yet is left out, and the rest still shown', () => {
    expect(
      historyFor(
        { kind: 'delivered', at },
        { kind: 'reassigned', at } as unknown as EventHistoryEntry,
        { kind: 'received', at }
      ).map(({ id, title }) => [id, title])
    ).toEqual([
      ['history-2', 'Delivered'],
      ['history-1', 'Received']
    ])
  })

  test('no history from GAS: no entries', () => {
    expect(toHistory({} as EventDetail, utc)).toEqual([])
  })
})
