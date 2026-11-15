import type { HeldSave } from './event-payload.ts'
import { takeHeldSave, toHeldSaves } from './held-saves.ts'

const held: HeldSave = {
  failure: { kind: 'timed-out' },
  text: '{"a":1}',
  revision: 2,
  note: 'Fix the name',
  then: 'redrive'
}

const minute = 60 * 1000

const page = '/dev-ops/events/gas/inbox/e1'

const other = '/dev-ops/events/gas/inbox/e2'

describe('toHeldSaves', () => {
  test('holds the save by its event, stamped with the time it was held', () => {
    expect(toHeldSaves(null, page, held, 1000)).toEqual({
      [page]: { ...held, heldAt: 1000 }
    })
  })

  test('keeps another event’s save while it is fresh, and drops one too old to show', () => {
    const saves = {
      [other]: { ...held, heldAt: 0 },
      '/dev-ops/events/gas/inbox/e3': { ...held, heldAt: -minute }
    }

    expect(Object.keys(toHeldSaves(saves, page, held, 5 * minute))).toEqual([
      other,
      page
    ])
  })
})

describe('takeHeldSave', () => {
  test('gives the event’s save without its stamp, and keeps the others', () => {
    const saves = toHeldSaves(toHeldSaves(null, other, held, 0), page, held, 0)

    expect(takeHeldSave(saves, page, minute)).toEqual({
      held,
      kept: { [other]: { ...held, heldAt: 0 } }
    })
  })

  test('a save older than five minutes is gone', () => {
    const saves = toHeldSaves(null, page, held, 0)

    expect(takeHeldSave(saves, page, 5 * minute + 1)).toEqual({
      held: null,
      kept: {}
    })
  })

  test('nothing held is nothing to take', () => {
    expect(takeHeldSave(null, page, 0)).toEqual({ held: null, kept: {} })
  })
})
