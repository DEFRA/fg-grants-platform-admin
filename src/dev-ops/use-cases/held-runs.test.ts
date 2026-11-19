import {
  findFurthestPage,
  findLiveRun,
  findRecent,
  holdRun,
  keepPage,
  keepRestorable,
  recentQueries
} from './held-runs.ts'
import type { HeldPage } from './held-runs.ts'
import { provideMemoryExploreStore } from './test-fixtures.ts'

const owner = { session: 'session-1', user: 'user-1' }

const window = (positions: string | null, found: number): HeldPage => ({
  positions,
  end: positions === null,
  found,
  source: { name: 'applications', noun: 'application' }
})

let entries: Map<string, unknown>

beforeEach(() => {
  entries = provideMemoryExploreStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('holdRun', () => {
  test('keeps a run under its owner, never another’s', async () => {
    const id = await holdRun(owner, 'db.cases.find()')

    expect(await findLiveRun(owner, id)).toMatchObject({
      id,
      q: 'db.cases.find()'
    })
    expect(await findLiveRun({ ...owner, user: 'user-2' }, id)).toBeNull()
    expect(await findLiveRun({ ...owner, session: 'session-2' }, id)).toBeNull()
  })

  test('lets the first of eleven runs go', async () => {
    const ids = []

    for (const n of Array.from({ length: 11 }, (_, at) => at)) {
      ids.push(await holdRun(owner, `db.cases.find({ n: ${n} })`))
    }

    expect(await findLiveRun(owner, ids[0])).toBeNull()
    expect(await findLiveRun(owner, ids[1])).not.toBeNull()
    expect(await findLiveRun(owner, ids[10])).not.toBeNull()
  })

  test('lets a run go 30 minutes after it was held', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T10:00:00Z') })

    const id = await holdRun(owner, 'db.cases.find()')

    vi.setSystemTime(new Date('2026-11-16T10:30:00Z'))
    expect(await findLiveRun(owner, id)).not.toBeNull()

    vi.setSystemTime(new Date('2026-11-16T10:30:01Z'))
    expect(await findLiveRun(owner, id)).toBeNull()
  })

  test('keeps a text run again under the one Recent id, first', async () => {
    await holdRun(owner, 'db.cases.find()')
    const [before] = await recentQueries(owner)

    await holdRun(owner, 'db.grants.find()')
    await holdRun(owner, 'db.cases.find()')

    const recent = await recentQueries(owner)

    expect(recent.map(({ q }) => q)).toEqual([
      'db.cases.find()',
      'db.grants.find()'
    ])
    expect(recent[0].id).toBe(before.id)
    expect(await findRecent(owner, before.id)).toBe('db.cases.find()')
  })

  test('keeps the last six texts in Recent', async () => {
    for (const n of Array.from({ length: 7 }, (_, at) => at)) {
      await holdRun(owner, `db.cases.find({ n: ${n} })`)
    }

    expect((await recentQueries(owner)).map(({ q }) => q)).toEqual(
      [6, 5, 4, 3, 2, 1].map((n) => `db.cases.find({ n: ${n} })`)
    )
  })

  test('two Runs landing together each keep their run and their Recent query, whichever the index keeps', async () => {
    const [first, second] = await Promise.all([
      holdRun(owner, 'db.cases.find()'),
      holdRun(owner, 'db.grants.find()')
    ])
    const index = entries.get('session-1:user-1:index') as {
      runs: string[]
    }
    const recentIds = [...entries.keys()]
      .filter((key) => key.startsWith('session-1:user-1:recent:'))
      .map((key) => key.split(':').at(-1)!)

    expect(index.runs).toHaveLength(1)
    expect((await findLiveRun(owner, first))?.q).toBe('db.cases.find()')
    expect((await findLiveRun(owner, second))?.q).toBe('db.grants.find()')
    expect(
      await Promise.all(recentIds.map((id) => findRecent(owner, id)))
    ).toEqual(['db.cases.find()', 'db.grants.find()'])
  })
})

describe('keepRestorable', () => {
  test('is read with its run', async () => {
    const id = await holdRun(owner, 'db.cases.find()')

    await keepRestorable(owner, (await findLiveRun(owner, id))!, 3)

    expect(await findLiveRun(owner, id)).toMatchObject({ id, restorable: 3 })
  })

  test('never brings back a run let go after it was read', async () => {
    const id = await holdRun(owner, 'db.cases.find()')
    const held = (await findLiveRun(owner, id))!

    for (const n of Array.from({ length: 10 }, (_, at) => at)) {
      await holdRun(owner, `db.cases.find({ n: ${n} })`)
    }
    await keepRestorable(owner, held, 3)

    expect(entries.has(`session-1:user-1:run:${id}`)).toBe(false)
    expect(await findLiveRun(owner, id)).toBeNull()
  })
})

describe('findRecent', () => {
  test('finds nothing for an id this owner never ran', async () => {
    await holdRun(owner, 'db.cases.find()')
    const [{ id }] = await recentQueries(owner)

    expect(await findRecent(owner, 'nothing')).toBeNull()
    expect(await findRecent({ ...owner, user: 'user-2' }, id)).toBeNull()
  })
})

describe('findFurthestPage', () => {
  test('is null before any window is read', async () => {
    const id = await holdRun(owner, 'db.cases.find()')

    expect(await findFurthestPage(owner, id)).toBeNull()
  })

  test('is the furthest window read, though a slower tab wrote an earlier one after it', async () => {
    const id = await holdRun(owner, 'db.cases.find()')

    await keepPage(owner, id, 1, window('after-1', 1))
    await keepPage(owner, id, 2, window('after-2', 2))
    await keepPage(owner, id, 3, window('after-3', 3))
    await keepPage(owner, id, 2, window('after-2', 2))

    expect(await findFurthestPage(owner, id)).toEqual(window('after-3', 3))
  })
})
