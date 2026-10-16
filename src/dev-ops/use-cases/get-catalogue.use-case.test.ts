import { logger } from '../../common/logger.ts'
import type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'
import { findBuckets } from '../repositories/buckets.repository.ts'
import {
  forgetCatalogue,
  getBucketAtUseCase,
  getCatalogueUseCase
} from './get-catalogue.use-case.ts'

vi.mock(import('../repositories/buckets.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const bucket = (id: string): BucketEntry => ({
  id,
  path: id.replace('.', '/'),
  label: id,
  service: 'GAS',
  shortLabel: id,
  icon: null,
  order: 10,
  noun: { one: 'record', many: 'records' },
  time: { label: 'Created' },
  facts: [],
  refs: [],
  indexes: [[]],
  groupings: [],
  title: { label: 'Reference', format: 'mono' },
  columns: [],
  audited: false,
  timeline: false,
  summaries: [],
  page: null,
  tab: null
})

const catalogueOf = (...ids: string[]): Catalogue => ({
  buckets: ids.map(bucket),
  sourceErrors: []
})

const start = new Date('2026-10-09T09:00:00.000Z')

const later = (seconds: number) =>
  vi.setSystemTime(new Date(start.getTime() + seconds * 1000))

describe('getCatalogueUseCase', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    forgetCatalogue()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('reads the catalogue from GAS', async () => {
    vi.mocked(findBuckets).mockResolvedValue(catalogueOf('gas.outbox'))

    await expect(getCatalogueUseCase()).resolves.toEqual(
      catalogueOf('gas.outbox')
    )
  })

  test('keeps it for a minute, so a page costs no call', async () => {
    vi.mocked(findBuckets).mockResolvedValue(catalogueOf('gas.outbox'))

    await getCatalogueUseCase()
    later(59)
    await getCatalogueUseCase()

    expect(findBuckets).toHaveBeenCalledTimes(1)
  })

  test('reads it again once the minute is up', async () => {
    vi.mocked(findBuckets)
      .mockResolvedValueOnce(catalogueOf('gas.outbox'))
      .mockResolvedValueOnce(catalogueOf('gas.outbox', 'gas.inbox'))

    await getCatalogueUseCase()
    later(60)

    await expect(getCatalogueUseCase()).resolves.toEqual(
      catalogueOf('gas.outbox', 'gas.inbox')
    )
  })

  test('answers the last good copy when a later read fails', async () => {
    vi.mocked(findBuckets)
      .mockResolvedValueOnce(catalogueOf('gas.outbox'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))

    await getCatalogueUseCase()
    later(61)

    await expect(getCatalogueUseCase()).resolves.toEqual(
      catalogueOf('gas.outbox')
    )
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the bucket catalogue')
    )
  })

  test('answers none when no read has ever worked, and tries again next time', async () => {
    vi.mocked(findBuckets)
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(catalogueOf('gas.outbox'))

    await expect(getCatalogueUseCase()).resolves.toBeNull()
    await expect(getCatalogueUseCase()).resolves.toEqual(
      catalogueOf('gas.outbox')
    )
  })
})

describe('getBucketAtUseCase', () => {
  beforeEach(() => {
    forgetCatalogue()
  })

  test('finds the bucket the catalogue lists at a path', async () => {
    vi.mocked(findBuckets).mockResolvedValue(catalogueOf('gas.outbox'))

    await expect(getBucketAtUseCase('gas/outbox')).resolves.toEqual({
      available: true,
      bucket: bucket('gas.outbox')
    })
  })

  test('reads the catalogue once more for a path the kept copy has not got', async () => {
    vi.mocked(findBuckets)
      .mockResolvedValueOnce(catalogueOf('gas.outbox'))
      .mockResolvedValueOnce(catalogueOf('gas.outbox', 'gas.ledger'))

    await getCatalogueUseCase()

    await expect(getBucketAtUseCase('gas/ledger')).resolves.toEqual({
      available: true,
      bucket: bucket('gas.ledger')
    })
    expect(findBuckets).toHaveBeenCalledTimes(2)
  })

  test('says a bucket no catalogue lists is missing, after one fresh read', async () => {
    vi.mocked(findBuckets).mockResolvedValue(catalogueOf('gas.outbox'))

    await getCatalogueUseCase()

    await expect(getBucketAtUseCase('gas/nothing')).resolves.toEqual({
      available: true,
      bucket: null
    })
    expect(findBuckets).toHaveBeenCalledTimes(2)
  })

  test('does not read twice for a missing path when the catalogue was only just read', async () => {
    vi.mocked(findBuckets).mockResolvedValue(catalogueOf('gas.outbox'))

    await getBucketAtUseCase('gas/nothing')

    expect(findBuckets).toHaveBeenCalledTimes(1)
  })

  test('says nothing is known when no catalogue could be read', async () => {
    vi.mocked(findBuckets).mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(getBucketAtUseCase('gas/outbox')).resolves.toEqual({
      available: false,
      bucket: null
    })
  })
})
