import { Client, Policy } from '@hapi/catbox'
import { Engine } from '@hapi/catbox-memory'

import { config } from '../../common/config.ts'
import {
  dropHeldRun,
  findHeldPage,
  findHeldRun,
  findRecentQuery,
  findRunIndex,
  provideExploreRunsStore,
  saveHeldPage,
  saveHeldRun,
  saveRecentQuery,
  saveRestorable,
  saveRunIndex
} from './explore-runs.repository.ts'

const owner = { session: 'session-1', user: 'user-1' }

const page = {
  positions: 'after-1',
  end: false,
  found: 1,
  source: { name: 'cases', noun: 'case' }
}

const client = new Client(Engine)

const cache = vi.fn(
  (options: { expiresIn: number; segment: string }) =>
    new Policy({ expiresIn: options.expiresIn }, client, options.segment)
)

beforeAll(async () => {
  await client.start()
})

beforeEach(() => {
  provideExploreRunsStore({ cache } as never)
})

afterAll(async () => {
  await client.stop()
})

describe('provideExploreRunsStore', () => {
  test('keeps Explore in a segment of its own in the session’s cache, for 30 minutes from each write', () => {
    expect(cache).toHaveBeenCalledWith({
      cache: config.get('session.cache.name'),
      segment: 'explore',
      expiresIn: 30 * 60 * 1000
    })
  })
})

describe('the held runs', () => {
  test('keep each run, window, Recent query and index under its owner', async () => {
    const other = { ...owner, user: 'user-2' }

    await saveHeldRun(owner, { id: 'run-1', q: 'db.cases.find()', heldAt: 1 })
    await saveHeldPage(owner, 'run-1', 1, page)
    await saveRecentQuery(owner, { id: 'r-1', q: 'db.cases.find()' })
    await saveRunIndex(owner, {
      runs: ['run-1'],
      recent: [{ id: 'r-1', q: 'db.cases.find()' }]
    })

    expect(await findHeldRun(owner, 'run-1')).toEqual({
      id: 'run-1',
      q: 'db.cases.find()',
      heldAt: 1
    })
    expect(await findHeldPage(owner, 'run-1', 1)).toEqual(page)
    expect(await findHeldPage(owner, 'run-1', 2)).toBeNull()
    expect(await findRecentQuery(owner, 'r-1')).toEqual({
      id: 'r-1',
      q: 'db.cases.find()'
    })
    expect((await findRunIndex(owner)).runs).toEqual(['run-1'])
    expect(await findHeldRun(other, 'run-1')).toBeNull()
    expect(await findRecentQuery(other, 'r-1')).toBeNull()
    expect(await findRunIndex(other)).toEqual({ runs: [], recent: [] })
  })

  test('drop a run, and the limit learnt for it', async () => {
    const run = { id: 'run-2', q: 'db.cases.find()', heldAt: Date.now() }

    await saveHeldRun(owner, run)
    await saveRestorable(owner, run, 3)
    await dropHeldRun(owner, 'run-2')

    expect(await findHeldRun(owner, 'run-2')).toBeNull()

    await saveHeldRun(owner, run)

    expect(await findHeldRun(owner, 'run-2')).toEqual(run)
  })

  test('read a run with the limit learnt for it, kept apart from the run', async () => {
    const run = { id: 'run-3', q: 'db.cases.find()', heldAt: Date.now() }

    await saveHeldRun(owner, run)
    await saveRestorable(owner, run, 3)

    expect(await findHeldRun(owner, 'run-3')).toEqual({ ...run, restorable: 3 })
  })

  test('never read a limit without its run', async () => {
    const run = { id: 'run-4', q: 'db.cases.find()', heldAt: Date.now() }

    await saveRestorable(owner, run, 3)

    expect(await findHeldRun(owner, 'run-4')).toBeNull()
  })

  test('keep no limit for a run past its time', async () => {
    const run = {
      id: 'run-5',
      q: 'db.cases.find()',
      heldAt: Date.now() - 30 * 60 * 1000
    }

    await saveHeldRun(owner, run)
    await saveRestorable(owner, run, 3)

    expect(await findHeldRun(owner, 'run-5')).toEqual(run)
  })
})
