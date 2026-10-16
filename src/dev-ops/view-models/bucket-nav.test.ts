import {
  applicationsBucket,
  catalogue,
  outboxBucket,
  pagedInbox,
  pagedOutbox
} from '../use-cases/test-fixtures.ts'
import { toBackBucket, toBucketPath, toNavSections } from './bucket-nav.ts'

describe('toBucketPath', () => {
  test('is the path the bucket declares, below the admin', () => {
    expect(toBucketPath(outboxBucket)).toBe('/dev-ops/events/gas/outbox')
  })
})

describe('toNavSections', () => {
  const cwOutbox = {
    ...outboxBucket,
    id: 'cw.outbox',
    label: 'CW outbox',
    service: 'CW'
  }

  test('draws one section per service and one item per bucket, by its short label, as the catalogue orders them', () => {
    expect(toNavSections(catalogue)).toEqual([
      {
        title: 'GAS',
        items: [
          {
            id: 'gas.outbox',
            ids: ['gas.outbox'],
            label: 'Outbox',
            href: '/dev-ops/events/gas/outbox',
            icon: 'activity'
          },
          {
            id: 'gas.applications',
            ids: ['gas.applications'],
            label: 'Applications',
            href: '/dev-ops/applications',
            icon: 'file-text'
          }
        ]
      }
    ])
  })

  test('draws one link for the lists that share a page, named by the page, opening on the first and standing for each', () => {
    const cwPaged = [pagedOutbox, pagedInbox].map((bucket) => ({
      ...bucket,
      id: bucket.id.replace('gas.', 'cw.'),
      service: 'CW'
    }))
    const sections = toNavSections({
      buckets: [pagedOutbox, pagedInbox, applicationsBucket, ...cwPaged],
      sourceErrors: []
    })

    expect(sections[0].items).toEqual([
      {
        id: 'gas.outbox',
        ids: ['gas.outbox', 'gas.inbox'],
        label: 'Events',
        href: '/dev-ops/events/gas/outbox',
        icon: 'activity'
      },
      {
        id: 'gas.applications',
        ids: ['gas.applications'],
        label: 'Applications',
        href: '/dev-ops/applications',
        icon: 'file-text'
      }
    ])
    expect(sections[1].items.map(({ ids }) => ids)).toEqual([
      ['cw.outbox', 'cw.inbox']
    ])
  })

  test('keeps a service together in the place it was first named', () => {
    const sections = toNavSections({
      buckets: [outboxBucket, cwOutbox, applicationsBucket],
      sourceErrors: []
    })

    expect(
      sections.map(({ title, items }) => [title, items.map(({ id }) => id)])
    ).toEqual([
      ['GAS', ['gas.outbox', 'gas.applications']],
      ['CW', ['cw.outbox']]
    ])
  })

  test('heads a service the portal has never heard of as the catalogue names it', () => {
    const [, section] = toNavSections({
      buckets: [
        outboxBucket,
        { ...cwOutbox, id: 'pay.ledger', service: 'Payments hub' }
      ],
      sourceErrors: []
    })

    expect(section.title).toBe('Payments hub')
  })

  test('draws a list that declares no icon with a folder', () => {
    const [{ items }] = toNavSections({
      buckets: [{ ...applicationsBucket, icon: null }],
      sourceErrors: []
    })

    expect(items[0].icon).toBe('folder')
  })

  test('draws no navigation without a catalogue', () => {
    expect(toNavSections(null)).toEqual([])
  })
})

describe('toBackBucket', () => {
  const buckets = {
    buckets: [pagedOutbox, pagedInbox, applicationsBucket],
    sourceErrors: []
  }

  test.each([
    ['/dev-ops/events/gas/outbox', 'gas.outbox'],
    ['/dev-ops/events/gas/inbox?status=DEAD_LETTER', 'gas.inbox'],
    [
      '/dev-ops/applications?from=2026-10-08T12%3A00%3A00.000Z',
      'gas.applications'
    ],
    [
      '/dev-ops/applications/example-grant/abc-123?tab=events&back=%2Fdev-ops%2Fapplications%3Fgrant%3Dexample-grant',
      'gas.applications'
    ]
  ])('finds the list %s leads back to', (back, id) => {
    expect(toBackBucket(buckets, back)?.id).toBe(id)
  })

  test.each([
    '',
    '/dev-ops',
    '/dev-ops/events',
    '/dev-ops/events/gas/outbox/',
    '/dev-ops/applications/example-grant/abc-123?tab=events'
  ])('finds none for "%s"', (back) => {
    expect(toBackBucket(buckets, back)).toBeNull()
  })

  test('finds none without a catalogue', () => {
    expect(toBackBucket(null, '/dev-ops/applications')).toBeNull()
  })
})
