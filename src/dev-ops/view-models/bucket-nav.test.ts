import {
  applicationsBucket,
  catalogue,
  cwEvents,
  cwInbox,
  cwOutbox as cwOutboxQueue,
  gasEvents,
  gasInbox,
  gasOutbox,
  outboxBucket
} from '../use-cases/test-fixtures.ts'
import {
  toBackBucket,
  toBucketPath,
  toNavSections,
  toShellNav
} from './bucket-nav.ts'

describe('toBucketPath', () => {
  test('is the path the bucket declares, below the admin', () => {
    expect(toBucketPath(outboxBucket)).toBe('/dev-ops/events/gas/outbox')
  })
})

describe('toNavSections', () => {
  const gasTokens = {
    id: 'clients-gas',
    label: 'Access tokens',
    perService: true,
    href: '/dev-ops/clients/gas',
    icon: 'key'
  }
  const cwTokens = {
    id: 'clients-cw',
    label: 'Access tokens',
    perService: true,
    href: '/dev-ops/clients/cw',
    icon: 'key'
  }
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
            id: 'gas.events',
            label: 'Events',
            perService: true,
            href: '/dev-ops/events/gas',
            icon: 'activity'
          },
          {
            id: 'gas.applications',
            label: 'Applications',
            perService: false,
            href: '/dev-ops/applications',
            icon: 'file-text'
          },
          {
            id: 'gas.grants',
            label: 'Grants',
            perService: false,
            href: '/dev-ops/grants',
            icon: 'scroll-text'
          },
          gasTokens
        ]
      },
      {
        title: 'CW',
        items: [
          {
            id: 'cw.cases',
            label: 'Cases',
            perService: false,
            href: '/dev-ops/cases',
            icon: 'folder'
          },
          {
            id: 'cw.workflows',
            label: 'Workflows',
            perService: false,
            href: '/dev-ops/workflows',
            icon: 'workflow'
          },
          cwTokens
        ]
      }
    ])
  })

  test('draws one link per list: a service’s Events page, or each queue’s own list while GAS lists them apart', () => {
    const grouped = toNavSections({
      buckets: [gasEvents, applicationsBucket, cwEvents],
      sourceErrors: []
    })
    const apart = toNavSections({
      buckets: [gasOutbox, gasInbox, cwOutboxQueue, cwInbox],
      sourceErrors: []
    })

    expect(grouped[0].items[0]).toEqual({
      id: 'gas.events',
      label: 'Events',
      perService: true,
      href: '/dev-ops/events/gas',
      icon: 'activity'
    })
    expect(grouped[1].items.map(({ id }) => id)).toEqual([
      'cw.events',
      'clients-cw'
    ])
    expect(
      apart.flatMap(({ items }) =>
        items.map(({ label, href }) => [label, href])
      )
    ).toEqual([
      ['Outbox', '/dev-ops/events/gas/outbox'],
      ['Inbox', '/dev-ops/events/gas/inbox'],
      ['Access tokens', '/dev-ops/clients/gas'],
      ['Outbox', '/dev-ops/events/cw/outbox'],
      ['Inbox', '/dev-ops/events/cw/inbox'],
      ['Access tokens', '/dev-ops/clients/cw']
    ])
  })

  test('keeps CW’s Events, Cases and Workflows in reach while GAS can’t reach CW', () => {
    const sections = toNavSections({
      buckets: [gasEvents],
      sourceErrors: [{ hop: 'CW-BE' }]
    })

    expect(sections[1].items.slice(0, 3)).toEqual([
      {
        id: 'cw.events',
        label: 'Events',
        perService: true,
        href: '/dev-ops/events/cw',
        icon: 'activity'
      },
      expect.objectContaining({ id: 'cw.cases' }),
      expect.objectContaining({ id: 'cw.workflows' })
    ])
  })

  test('marks each service’s event lists as its own, whether or not they have a page, and nothing else from the catalogue', () => {
    const sections = toNavSections({
      buckets: [outboxBucket, cwOutbox, applicationsBucket],
      sourceErrors: []
    })

    expect(
      sections.flatMap(({ items }) =>
        items.map(({ id, label, perService }) => [id, label, perService])
      )
    ).toEqual([
      ['gas.outbox', 'Outbox', true],
      ['gas.applications', 'Applications', false],
      ['clients-gas', 'Access tokens', true],
      ['cw.outbox', 'Outbox', true],
      ['clients-cw', 'Access tokens', true]
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
      ['GAS', ['gas.outbox', 'gas.applications', 'clients-gas']],
      ['CW', ['cw.outbox', 'clients-cw']]
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

  test('still draws each service with its access tokens without a catalogue', () => {
    expect(toNavSections(null)).toEqual([
      { title: 'GAS', items: [gasTokens] },
      { title: 'CW', items: [cwTokens] }
    ])
  })

  test('adds a section for a service the catalogue does not name', () => {
    expect(
      toNavSections({ buckets: [outboxBucket], sourceErrors: [] }).map(
        ({ title, items }) => [title, items.map(({ id }) => id)]
      )
    ).toEqual([
      ['GAS', ['gas.outbox', 'clients-gas']],
      ['CW', ['clients-cw']]
    ])
  })
})

describe('toBackBucket', () => {
  const buckets = {
    buckets: [gasEvents, applicationsBucket],
    sourceErrors: []
  }

  test.each([
    ['/dev-ops/events/gas', 'gas.events'],
    ['/dev-ops/events/gas?queue=inbox&status=DEAD_LETTER', 'gas.events'],
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

describe('toShellNav', () => {
  const overview = {
    title: '',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        perService: false,
        href: '/dev-ops',
        icon: 'layout-dashboard'
      },
      {
        id: 'explore',
        label: 'Explore',
        perService: false,
        href: '/dev-ops/explore',
        icon: 'telescope'
      }
    ]
  }

  test('opens with the Overview and Explore, untitled, then each service’s lists', () => {
    expect(toShellNav(catalogue)).toEqual([
      overview,
      ...toNavSections(catalogue)
    ])
  })

  test('keeps the Overview and Explore without the catalogue', () => {
    expect(toShellNav(null)[0]).toEqual(overview)
  })
})
