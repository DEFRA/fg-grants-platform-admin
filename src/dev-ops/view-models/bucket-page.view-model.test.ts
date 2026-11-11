import {
  applicationsBucket,
  fieldsApplicationsBucket,
  grantsBucket,
  outboxBucket,
  toggledBucket
} from '../use-cases/test-fixtures.ts'
import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { toBucketPage, toSearchQuery } from './bucket-page.view-model.ts'

const now = new Date('2026-10-09T09:20:00.000Z')

const row = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: '66f000000000000000000001',
  time: '2026-10-09T09:14:03.120Z',
  title: 'UpdateCaseStatus',
  subtitle: '0b7c1d1e-0000-4000-8000-000000000001',
  cells: {
    status: 'DEAD_LETTER',
    grantCode: 'example-grant',
    completedAt: null
  },
  link: {
    kind: 'event',
    service: 'gas',
    box: 'outbox',
    id: '66f000000000000000000001'
  },
  ...overrides
})

const exact = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'gas.outbox',
  plan: {
    kind: 'exact',
    index: ['kind', 'status', 'eventType', 'publicationDate', '_id'],
    bound: ['status', 'eventType'],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [row()],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: 'status',
      values: [
        { value: 'PUBLISHED', count: 0, capped: false },
        { value: 'DEAD_LETTER', count: 21, capped: false }
      ],
      total: { count: 48, capped: false }
    }
  ],
  ...overrides
})

const bounded = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'gas.outbox',
  plan: {
    kind: 'bounded',
    index: ['kind', 'status', 'publicationDate', '_id'],
    bound: ['status'],
    filled: [],
    residual: ['grantCode'],
    scans: 1
  },
  rows: [],
  page: {
    next: null,
    keepLooking: 'eyJ0Ijoi',
    searchedTo: '2026-09-03T10:12:00.000Z',
    complete: false
  },
  groups: [],
  ...overrides
})

const read = (page: BucketResult | null = exact()): BucketListResult => ({
  page,
  unavailable: false,
  refused: false,
  refusal: null,
  timedOut: false
})

const page = (
  result: BucketListResult = read(),
  filters: Record<string, string> = {},
  bucket: BucketEntry = outboxBucket
) => toBucketPage(bucket, result, { filters }, null, now)

const searchedPage = (q: string, result: BucketListResult = read()) =>
  toBucketPage(outboxBucket, result, { filters: {} }, { q, id: searchId }, now)

const path = '/dev-ops/events/gas/outbox'

const searchId = '0b7c1d1e-0000-4000-8000-000000000001'

/** An application list read for one version of its chosen grant, with another filter beside them. */
const versioned = () =>
  page(
    read(),
    {
      code: 'example-grant',
      currentConfigVersion: '1.2.0',
      archived: 'false'
    },
    applicationsBucket
  )

const woodland = { code: 'woodland-creation' }

describe('toSearchQuery', () => {
  test('stores the kind and the value as one', () => {
    expect(
      toSearchQuery(outboxBucket, {}, 'trace', 'abc-123:xyz@example._')
    ).toEqual({ q: 'trace:abc-123:xyz@example._', error: null })
  })

  test.each([
    ['a kind the bucket does not declare', 'sbi', '900000005'],
    ['no kind', '', 'abc-123'],
    ['a value with a space', 'ref', 'abc 123'],
    ['a value with markup', 'ref', '<b>'],
    ['an empty value', 'ref', ''],
    ['a value over 200 characters', 'ref', 'x'.repeat(201)]
  ])('refuses %s', (_name, kind, value) => {
    expect(toSearchQuery(outboxBucket, {}, kind, value)).toEqual({
      q: null,
      error: 'Enter an identifier using only letters, numbers and . _ : @ -'
    })
  })

  test('stores a field the chosen grant declares, spaces and punctuation as typed', () => {
    expect(
      toSearchQuery(
        fieldsApplicationsBucket,
        woodland,
        'field.businessName',
        "O'Neill & Sons: Hilltop"
      )
    ).toEqual({ q: "field.businessName:O'Neill & Sons: Hilltop", error: null })
  })

  test('says why a field value cannot be searched for', () => {
    expect(
      toSearchQuery(
        fieldsApplicationsBucket,
        woodland,
        'field.businessName',
        'Hi'
      )
    ).toEqual({
      q: null,
      error: 'Enter at least 3 letters or numbers of the business name'
    })
  })

  test.each([
    ['no grant is chosen', {}],
    ['the chosen grant does not declare it', { code: 'hedgerow-restoration' }]
  ])('refuses a field when %s', (_name, filters) => {
    expect(
      toSearchQuery(
        fieldsApplicationsBucket,
        filters,
        'field.businessName',
        'Hilltop'
      )
    ).toEqual({ q: null, error: 'Choose a grant that declares this field' })
  })

  test('refuses a field beside another filter, saying to clear it', () => {
    expect(
      toSearchQuery(
        fieldsApplicationsBucket,
        { ...woodland, currentConfigVersion: '1.48.0' },
        'field.businessName',
        'Hilltop'
      )
    ).toEqual({
      q: null,
      error:
        "Clear the other filters to search by woodland-creation's own fields"
    })
  })

  test('takes a field kind on a list with no fields for an unknown identifier', () => {
    expect(
      toSearchQuery(
        applicationsBucket,
        woodland,
        'field.businessName',
        'Hilltop'
      )
    ).toEqual({
      q: null,
      error: 'Enter an identifier using only letters, numbers and . _ : @ -'
    })
  })
})

describe('toBucketPage', () => {
  test('names the bucket, where it lives and where it sits in the navigation', () => {
    expect(page()).toMatchObject({
      navActive: 'gas.outbox',
      bucket: {
        id: 'gas.outbox',
        label: 'GAS outbox',
        path,
        noun: { one: 'event', many: 'events' }
      }
    })
  })

  test('draws a list that groups by nothing with no tiles, and its codes as a menu of the codes themselves, All first, with no counts', () => {
    const drawn = page(read(), {}, applicationsBucket)

    expect(drawn.tiles).toBeNull()
    expect(drawn.menus[0]).toEqual(
      expect.objectContaining({
        fact: 'code',
        name: 'Grant',
        items: [
          expect.objectContaining({ label: 'All', active: true }),
          expect.objectContaining({
            label: 'example-grant',
            href: '/dev-ops/applications?grant=example-grant',
            active: false
          })
        ]
      })
    )
    expect(JSON.stringify(drawn.menus)).not.toContain('count')
  })

  test('draws the first grouping as tiles: All with the total, then every value with its count', () => {
    expect(page().tiles).toEqual({
      name: 'Status',
      items: [
        {
          value: null,
          label: 'All',
          href: path,
          active: true,
          countLabel: '48',
          zero: false,
          alarming: false
        },
        {
          value: 'PUBLISHED',
          label: 'Queued',
          href: `${path}?status=PUBLISHED`,
          active: false,
          countLabel: '0',
          zero: true,
          alarming: false
        },
        {
          value: 'DEAD_LETTER',
          label: 'Dead letter',
          href: `${path}?status=DEAD_LETTER`,
          active: false,
          countLabel: '21',
          zero: false,
          alarming: true
        }
      ]
    })
  })

  test('marks the chosen tile, keeps the other filters on every tile, and keeps the count of All', () => {
    const { tiles } = page(read(), {
      status: 'DEAD_LETTER',
      eventType: 'UpdateCaseStatus'
    })

    expect(
      tiles?.items.map(({ href, active, countLabel }) => ({
        href,
        active,
        countLabel
      }))
    ).toEqual([
      {
        href: `${path}?event=UpdateCaseStatus`,
        active: false,
        countLabel: '48'
      },
      {
        href: `${path}?status=PUBLISHED&event=UpdateCaseStatus`,
        active: false,
        countLabel: '0'
      },
      {
        href: `${path}?status=DEAD_LETTER&event=UpdateCaseStatus`,
        active: true,
        countLabel: '21'
      }
    ])
  })

  test('writes a capped count with a plus', () => {
    const { tiles } = page(
      read(
        exact({
          groups: [
            {
              by: 'status',
              values: [{ value: 'PUBLISHED', count: 10000, capped: true }],
              total: { count: 10000, capped: true }
            }
          ]
        })
      )
    )

    expect(tiles?.items.map(({ countLabel }) => countLabel)).toEqual([
      '10,000+',
      '10,000+',
      null
    ])
  })

  test.each([
    [
      'the counts could not be read exactly',
      bounded({ groups: [{ by: 'status', values: null, total: null }] })
    ],
    ['a later page carries no groups', exact({ groups: [] })]
  ])('gives the tiles no counts when %s', (_name, result) => {
    expect(
      page(read(result)).tiles?.items.map(({ countLabel }) => countLabel)
    ).toEqual([null, null, null])
  })

  test('counts All by the grouping, not by the list a chosen tile narrowed', () => {
    const [all] = page(read(), { status: 'DEAD_LETTER' }).tiles!.items

    expect(all).toMatchObject({ active: false, countLabel: '48', zero: false })
  })

  test.each([
    ['a capped total with a plus', { count: 10000, capped: true }, '10,000+'],
    ['a total that could not be counted as none', null, null]
  ])('writes %s on All under a chosen tile', (_name, total, label) => {
    const [status] = exact().groups
    const result = exact({ groups: [{ ...status, total }] })
    const [all] = page(read(result), { status: 'DEAD_LETTER' }).tiles!.items

    expect(all.countLabel).toBe(label)
  })

  test('does not alarm over a count of none', () => {
    const { tiles } = page(
      read(
        exact({
          groups: [
            {
              by: 'status',
              values: [{ value: 'DEAD_LETTER', count: 0, capped: false }],
              total: { count: 0, capped: false }
            }
          ]
        })
      )
    )

    expect(tiles?.items.at(-1)).toMatchObject({ zero: true, alarming: false })
  })

  test('draws no tiles for a bucket that groups by nothing', () => {
    expect(
      page(read(), {}, { ...outboxBucket, groupings: [] }).tiles
    ).toBeNull()
  })

  test('draws a menu for every other fact with values, from the values it declares', () => {
    expect(page().menus).toEqual([
      {
        fact: 'eventType',
        name: 'Event',
        label: 'Filter by event',
        items: [
          { value: null, label: 'All', href: path, active: true, hint: null },
          {
            value: 'UpdateCaseStatus',
            label: 'UpdateCaseStatus',
            href: `${path}?event=UpdateCaseStatus`,
            active: false,
            hint: null
          },
          {
            value: 'Unrecognised',
            label: 'Unrecognised',
            href: `${path}?event=Unrecognised`,
            active: false,
            hint: null
          }
        ]
      }
    ])
  })

  test('draws a toggle as a switch, off on a bare URL, and offers only the values it shows', () => {
    const drawn = page(read(), {}, toggledBucket)

    expect(drawn.toggles).toEqual([
      {
        fact: 'eventType',
        label: 'Show audit events',
        checked: false,
        href: `${path}?audit=on`
      }
    ])
    expect(drawn.menus[0].items.map(({ value }) => value)).toEqual([
      null,
      'UpdateCaseStatus',
      'Unrecognised'
    ])
  })

  test('draws a toggle the URL turns on as on, with the way back off, and offers every value', () => {
    const drawn = page(
      read(),
      { status: 'DEAD_LETTER', show: 'eventType' },
      toggledBucket
    )

    expect(drawn.toggles).toEqual([
      {
        fact: 'eventType',
        label: 'Show audit events',
        checked: true,
        href: `${path}?status=DEAD_LETTER`
      }
    ])
    expect(drawn.menus[0].items.map(({ value }) => value)).toEqual([
      null,
      'Audit',
      'UpdateCaseStatus',
      'Unrecognised'
    ])
  })

  test('drops a hidden value the list was filtered by when its toggle is switched off', () => {
    const [toggle] = page(
      read(),
      { eventType: 'Audit', show: 'eventType' },
      toggledBucket
    ).toggles

    expect(toggle).toMatchObject({ checked: true, href: path })
  })

  test('keeps a value the toggle does not hide when it is switched off', () => {
    const [toggle] = page(
      read(),
      { eventType: 'Unrecognised', show: 'eventType' },
      toggledBucket
    ).toggles

    expect(toggle.href).toBe(`${path}?event=Unrecognised`)
  })

  test('carries a toggle that is on through every link and form of the list', () => {
    const drawn = toBucketPage(
      toggledBucket,
      read(
        exact({
          page: {
            next: 'eyJ0Ijoi',
            keepLooking: null,
            searchedTo: null,
            complete: false
          }
        })
      ),
      { filters: { show: 'eventType' } },
      null,
      now
    )

    expect(drawn.tiles?.items.map(({ href }) => href)).toEqual([
      `${path}?audit=on`,
      `${path}?status=PUBLISHED&audit=on`,
      `${path}?status=DEAD_LETTER&audit=on`
    ])
    expect(drawn.menus[0].items[1].href).toBe(`${path}?event=Audit&audit=on`)
    expect(drawn.search?.hiddenFields).toEqual([{ name: 'audit', value: 'on' }])
    expect(drawn.nextHref).toBe(`${path}?cursor=eyJ0Ijoi&audit=on`)
    expect(drawn.rows[0].href).toContain(
      `back=${encodeURIComponent(`${path}?audit=on`)}`
    )
  })

  test('draws no switch for a bucket with no toggle', () => {
    expect(page().toggles).toEqual([])
  })

  test('marks the chosen option of a menu', () => {
    const [, archived] = page(
      read(exact({ groups: [] })),
      { archived: 'true' },
      { ...applicationsBucket, groupings: [] }
    ).menus

    expect(archived.items).toEqual([
      {
        value: null,
        label: 'All',
        href: '/dev-ops/applications',
        active: false,
        hint: null
      },
      {
        value: 'true',
        label: 'Archived',
        href: '/dev-ops/applications?archived=true',
        active: true,
        hint: null
      },
      {
        value: 'false',
        label: 'Current',
        href: '/dev-ops/applications?archived=false',
        active: false,
        hint: null
      }
    ])
  })

  test('keeps a chosen value the menu no longer lists', () => {
    const [menu] = page(read(), { eventType: 'RetiredType' }).menus

    expect(menu.items.at(-1)).toEqual({
      value: 'RetiredType',
      label: 'RetiredType',
      href: `${path}?event=RetiredType`,
      active: true,
      hint: null
    })
  })

  test('notes each open filter in force, with the way to clear it alone', () => {
    expect(
      page(read(), {
        status: 'DEAD_LETTER',
        'lastError.name': 'MongoServerError'
      }).notes
    ).toEqual([
      {
        fact: 'lastError.name',
        label: 'Error name',
        value: 'MongoServerError',
        clearHref: `${path}?status=DEAD_LETTER`
      }
    ])
  })

  test('notes a version of the chosen grant, and clears it alone, keeping the grant', () => {
    expect(versioned().notes).toEqual([
      {
        fact: 'currentConfigVersion',
        label: 'Version',
        value: '1.2.0',
        clearHref: '/dev-ops/applications?grant=example-grant&archived=false'
      }
    ])
  })

  test('drops the version from every choice of grant, All among them', () => {
    expect(versioned().menus[0].items.map(({ href }) => href)).toEqual([
      '/dev-ops/applications?archived=false',
      '/dev-ops/applications?grant=example-grant&archived=false'
    ])
  })

  test('keeps the version on a choice of another fact', () => {
    expect(versioned().menus[1].items[1].href).toBe(
      '/dev-ops/applications?grant=example-grant&version=1.2.0&archived=true'
    )
  })

  test('keeps the version on the time range and the search', () => {
    const { timeRange, search } = versioned()
    const kept = [
      { name: 'grant', value: 'example-grant' },
      { name: 'version', value: '1.2.0' },
      { name: 'archived', value: 'false' }
    ]

    expect(timeRange.hiddenFields).toEqual(kept)
    expect(search?.hiddenFields).toEqual(kept)
  })

  test('keeps an open filter when a tile is chosen', () => {
    expect(
      page(read(), { 'lastError.name': 'MongoServerError' }).tiles?.items[2]
        .href
    ).toBe(`${path}?status=DEAD_LETTER&error=MongoServerError`)
  })

  test('sets the time range on the list, keeping the filters', () => {
    const { timeRange } = page(read(), {
      status: 'DEAD_LETTER',
      from: '2026-10-08T09:20:00.000Z',
      range: '24h'
    })

    expect(timeRange).toMatchObject({
      label: 'Last 24h',
      action: path,
      anyTimeHref: `${path}?status=DEAD_LETTER`,
      hiddenFields: [{ name: 'status', value: 'DEAD_LETTER' }]
    })
    expect(timeRange.presets[0]).toMatchObject({
      title: 'Events from the last 15m',
      href: `${path}?status=DEAD_LETTER&from=2026-10-09T09%3A05%3A00.000Z&range=15m`
    })
  })

  test('offers a search by each kind of identifier the bucket declares', () => {
    expect(page(read(), { status: 'DEAD_LETTER' }).search).toEqual({
      kinds: [
        { value: 'ref', label: 'Reference', active: false },
        { value: 'trace', label: 'Trace ID', active: false }
      ],
      placeholder: 'Exact identifier',
      inputLabel: 'Identifier',
      value: '',
      error: null,
      hiddenFields: [{ name: 'status', value: 'DEAD_LETTER' }],
      note: null,
      fieldsHint: null
    })
  })

  test('names the one kind in the box when the bucket declares only one', () => {
    expect(page(read(), {}, applicationsBucket).search).toMatchObject({
      kinds: [{ value: 'ref', label: 'Reference', active: false }],
      placeholder: 'Exact Reference',
      inputLabel: 'Reference'
    })
  })

  test('shows the search that ran, by the name of its kind', () => {
    const { search } = searchedPage('trace:urn:uuid:0b7c1d1e')

    expect(search).toMatchObject({
      kinds: [
        { value: 'ref', active: false },
        { value: 'trace', active: true }
      ],
      value: 'urn:uuid:0b7c1d1e',
      note: { label: 'Trace ID', value: 'urn:uuid:0b7c1d1e', starting: false }
    })
  })

  test('offers the fields the chosen grant declares after the identifiers', () => {
    expect(
      page(read(), woodland, fieldsApplicationsBucket).search
    ).toMatchObject({
      kinds: [
        { value: 'ref', label: 'Reference', active: false },
        { value: 'field.businessName', label: 'Business name', active: false },
        { value: 'field.landParcelId', label: 'Land parcel ID', active: false }
      ],
      placeholder: 'Identifier or field value',
      inputLabel: 'Identifier or field value',
      fieldsHint: null
    })
  })

  test.each([
    ['no grant is chosen', {}, 'Choose a grant to search by its own fields'],
    ['the chosen grant declares none', { code: 'hedgerow-restoration' }, null],
    [
      'another filter is set',
      { ...woodland, currentConfigVersion: '1.48.0' },
      "Clear the other filters to search by woodland-creation's own fields"
    ]
  ])('offers only the identifiers when %s', (_name, filters, fieldsHint) => {
    expect(
      page(read(), filters, fieldsApplicationsBucket).search
    ).toMatchObject({
      kinds: [{ value: 'ref', label: 'Reference', active: false }],
      placeholder: 'Exact Reference',
      fieldsHint
    })
  })

  test.each([
    [
      'field.businessName:Hilltop',
      { label: 'Business name', value: 'Hilltop', starting: true }
    ],
    [
      'field.landParcelId:SX0679 9238',
      { label: 'Land parcel ID', value: 'SX0679 9238', starting: false }
    ]
  ])('notes the field search %j that ran', (q, note) => {
    const { search } = toBucketPage(
      fieldsApplicationsBucket,
      read(),
      { filters: woodland },
      { q, id: searchId },
      now
    )

    expect(search).toMatchObject({ value: note.value, note })
    expect(search?.kinds.find(({ active }) => active)?.label).toBe(note.label)
  })

  const fieldSearched = (total?: BucketResult['total']) =>
    toBucketPage(
      fieldsApplicationsBucket,
      read(exact({ groups: [], ...(total !== undefined && { total }) })),
      { filters: woodland },
      { q: 'field.businessName:Hilltop', id: searchId },
      now
    ).search?.note?.totalLabel

  test.each([
    [{ count: 1, capped: false }, '1 application'],
    [{ count: 48, capped: false }, '48 applications'],
    [{ count: 0, capped: false }, '0 applications'],
    [{ count: 10_000, capped: true }, '10,000+ applications']
  ])('counts the field search that ran, %j', (total, label) => {
    expect(fieldSearched(total)).toBe(label)
  })

  test('counts nothing when GAS answers no total', () => {
    expect(fieldSearched(null)).toBeNull()
    expect(fieldSearched()).toBeNull()
  })

  test('counts nothing beside a ref search', () => {
    expect(searchedPage('trace:urn:uuid:0b7c1d1e').search?.note).toMatchObject({
      totalLabel: null
    })
  })

  test('offers no fields on a list whose catalogue entry has no fields', () => {
    expect(Object.hasOwn(applicationsBucket, 'fields')).toBe(false)
    expect(page(read(), woodland, applicationsBucket).search).toMatchObject({
      kinds: [{ value: 'ref', label: 'Reference', active: false }],
      fieldsHint: null
    })
  })

  test('shows no search for a browse', () => {
    expect(searchedPage('').search).toMatchObject({
      value: '',
      note: null
    })
  })

  test('hands a refused search back as typed, with the reason and no note', () => {
    const { search } = toBucketPage(
      outboxBucket,
      read(),
      { filters: {} },
      null,
      now,
      { kind: 'trace', value: 'not this', error: 'Enter an identifier' }
    )

    expect(search).toMatchObject({
      kinds: [
        { value: 'ref', active: false },
        { value: 'trace', active: true }
      ],
      value: 'not this',
      error: 'Enter an identifier',
      note: null
    })
  })

  test('offers no search for a bucket with no identifiers', () => {
    expect(page(read(), {}, { ...outboxBucket, refs: [] }).search).toBeNull()
  })

  test('has nothing to keep looking for after an exact read, and names no plan', () => {
    expect(page()).not.toHaveProperty('plan')
    expect(page()).toMatchObject({
      keepLooking: null,
      searchedEverything: false
    })
  })

  test('says how far a bounded read looked and the way on', () => {
    expect(
      page(read(bounded()), { status: 'COMPLETED', grantCode: 'example-grant' })
    ).toMatchObject({
      rows: [],
      nextHref: null,
      keepLooking: {
        href: `${path}?cursor=eyJ0Ijoi&status=COMPLETED&grant=example-grant`,
        searchedTo: '3 Sep 2026 11:12:00.000'
      },
      searchedEverything: false,
      emptyText: 'No matches so far.'
    })
  })

  test('says a bounded read that reached the end searched everything', () => {
    expect(
      page(
        read(
          bounded({
            page: {
              next: null,
              keepLooking: null,
              searchedTo: null,
              complete: true
            }
          })
        )
      )
    ).toMatchObject({
      keepLooking: null,
      searchedEverything: true,
      emptyText: 'No events found. Searched everything.'
    })
  })

  test('links on to the next page under the same filters', () => {
    expect(
      page(
        read(
          exact({
            page: {
              next: 'eyJ0IjoiMjAy',
              keepLooking: null,
              searchedTo: null,
              complete: false
            }
          })
        ),
        { status: 'DEAD_LETTER' }
      ).nextHref
    ).toBe(`${path}?cursor=eyJ0IjoiMjAy&status=DEAD_LETTER`)
  })

  test('marks the later pages of a search as one, so they run it again', () => {
    const searched = searchedPage(
      'ref:abc-123-xyz',
      read(
        bounded({
          page: {
            next: 'NEXT',
            keepLooking: 'EDGE',
            searchedTo: '2026-09-03T10:12:00.000Z',
            complete: false
          }
        })
      )
    )

    expect(searched.nextHref).toBe(`${path}?cursor=NEXT&searched=${searchId}`)
    expect(searched.keepLooking?.href).toBe(
      `${path}?cursor=EDGE&searched=${searchId}`
    )
  })

  test('heads the table with the title, each column and the time', () => {
    expect(page(read(), {}, applicationsBucket).head).toEqual({
      title: 'Reference',
      columns: [
        {
          key: 'code',
          label: 'Grant',
          format: 'mono',
          right: false,
          phoneHidden: false
        },
        {
          key: 'position',
          label: 'Status',
          format: 'position',
          right: false,
          phoneHidden: false
        }
      ],
      time: 'Created',
      even: true,
      layout: null
    })
  })

  test('draws an event row by its short name, linked to its page and back to this list', () => {
    const [drawn] = page(read(), { status: 'DEAD_LETTER' }).rows

    expect(drawn).toEqual({
      href: `/dev-ops/events/gas/outbox/66f000000000000000000001?back=${encodeURIComponent(`${path}?status=DEAD_LETTER`)}`,
      title: 'UpdateCaseStatus',
      eventName: { name: 'UpdateCaseStatus', spoken: 'Update case status' },
      mono: false,
      spokenVersion: null,
      subtitle: '0b7c1d1e-0000-4000-8000-000000000001',
      cells: [
        {
          key: 'status',
          right: false,
          phoneHidden: false,
          kind: 'badge',
          status: 'DEAD_LETTER',
          label: 'Dead letter',
          role: 'error',
          title: 'Dead letter'
        },
        {
          key: 'grantCode',
          right: false,
          phoneHidden: false,
          kind: 'mono',
          text: 'example-grant'
        }
      ],
      time: {
        text: '6m ago',
        instant: '2026-10-09T09:14:03.120Z',
        precise: '9 Oct 2026 10:14:03.120',
        clock: '10:14:03'
      },
      alarming: true
    })
  })

  test('leaves the position and the search out of the list a row goes back to', () => {
    const [drawn] = toBucketPage(
      outboxBucket,
      read(),
      { filters: { status: 'DEAD_LETTER' }, cursor: 'eyJ0Ijoi' },
      { q: 'ref:abc-123-xyz', id: searchId },
      now
    ).rows

    expect(drawn.href).toBe(
      `/dev-ops/events/gas/outbox/66f000000000000000000001?back=${encodeURIComponent(`${path}?status=DEAD_LETTER`)}`
    )
  })

  test('draws a record row by its reference, with its position', () => {
    const [drawn] = page(
      read(
        exact({
          rows: [
            row({
              title: 'abc-123-xyz',
              subtitle: null,
              cells: {
                code: 'example-grant',
                position: {
                  phase: 'PRE_AWARD',
                  stage: 'REVIEW_APPLICATION',
                  status: 'IN_REVIEW'
                }
              },
              link: {
                kind: 'application',
                code: 'example-grant',
                clientRef: 'abc-123-xyz'
              }
            })
          ]
        })
      ),
      {},
      applicationsBucket
    ).rows

    expect(drawn).toMatchObject({
      href: '/dev-ops/applications/example-grant/abc-123-xyz?back=%2Fdev-ops%2Fapplications',
      title: 'abc-123-xyz',
      eventName: null,
      mono: true,
      subtitle: null,
      cells: [
        { key: 'code', kind: 'mono', text: 'example-grant' },
        {
          key: 'position',
          kind: 'position',
          statusLabel: 'In review',
          positionLabel: 'Pre award › Review application › In review'
        }
      ],
      alarming: false
    })
  })

  const columnsOf = (...formats: string[]): BucketEntry => ({
    ...outboxBucket,
    columns: formats.map((format, index) => ({
      key: `c${index}`,
      label: format,
      format
    }))
  })

  const cellsOf = (bucket: BucketEntry, cells: BucketRow['cells']) =>
    page(read(exact({ rows: [row({ cells })] })), {}, bucket).rows[0].cells

  test('draws text and a time each in its own way', () => {
    expect(
      cellsOf(columnsOf('text', 'time'), {
        c0: 'agreement',
        c1: '2026-10-09T09:00:00.000Z'
      })
    ).toEqual([
      {
        key: 'c0',
        right: false,
        phoneHidden: false,
        kind: 'text',
        text: 'agreement'
      },
      {
        key: 'c1',
        right: true,
        phoneHidden: false,
        kind: 'time',
        time: expect.objectContaining({ text: '20m ago' })
      }
    ])
  })

  test('draws a format it has not heard of, and a value that does not fit its format, as text', () => {
    expect(
      cellsOf(columnsOf('sparkline', 'position', 'text'), {
        c0: 'up',
        c1: 'IN_REVIEW',
        c2: true
      })
    ).toEqual([
      { key: 'c0', right: false, phoneHidden: false, kind: 'text', text: 'up' },
      {
        key: 'c1',
        right: false,
        phoneHidden: false,
        kind: 'text',
        text: 'IN_REVIEW'
      },
      {
        key: 'c2',
        right: false,
        phoneHidden: false,
        kind: 'text',
        text: 'true'
      }
    ])
  })

  test('draws a cell the row has not got, or holds as null, as none', () => {
    expect(cellsOf(columnsOf('mono', 'time'), { c0: null })).toEqual([
      { key: 'c0', right: false, phoneHidden: false, kind: 'none' },
      { key: 'c1', right: true, phoneHidden: false, kind: 'none' }
    ])
  })

  test('draws a badge for a value its fact does not list as the value itself, quietly', () => {
    const [badge] = cellsOf(outboxBucket, { status: 'PARKED' })

    expect(badge).toMatchObject({
      kind: 'badge',
      status: 'PARKED',
      label: 'PARKED',
      role: 'neutral'
    })
  })

  test('draws a row with no title and no page as a dash and no link', () => {
    const [drawn] = page(
      read(exact({ rows: [row({ title: null, subtitle: null, link: null })] }))
    ).rows

    expect(drawn).toMatchObject({
      href: null,
      title: '—',
      eventName: null,
      subtitle: null
    })
  })

  test('carries the reason for a refusal, and the way to start again', () => {
    expect(
      page({
        page: null,
        unavailable: false,
        refused: true,
        refusal: 'A filter names a fact this bucket does not declare',
        timedOut: false
      })
    ).toMatchObject({
      refused: {
        message: 'A filter names a fact this bucket does not declare',
        startHref: path
      },
      unavailable: false,
      rows: [],
      nextHref: null,
      keepLooking: null,
      searchedEverything: false
    })
  })

  test.each([
    [
      'a prefix field',
      'field.businessName:hil',
      {
        by: null,
        message:
          'Too many applications have a business name starting "hil" to list in time. Type more of it',
        startHref: '/dev-ops/applications'
      }
    ],
    ['an exact field', 'field.landParcelId:SX0679', null],
    ['an identifier', 'ref:abc-123', null]
  ])(
    'says what to do about a read that timed out for %s',
    (_name, q, refused) => {
      const drawn = toBucketPage(
        fieldsApplicationsBucket,
        {
          page: null,
          unavailable: true,
          refused: false,
          refusal: null,
          timedOut: true
        },
        { filters: woodland },
        { q, id: searchId },
        now
      )

      expect(drawn).toMatchObject({ unavailable: true, refused })
    }
  )

  test('says the list is unavailable, still drawing its filters from the catalogue', () => {
    const drawn = page({
      page: null,
      unavailable: true,
      refused: false,
      refusal: null,
      timedOut: false
    })

    expect(drawn).toMatchObject({ unavailable: true, refused: null, rows: [] })
    expect(drawn.tiles?.items).toHaveLength(3)
    expect(drawn.menus).toHaveLength(1)
  })

  const versionRow = (cells: BucketRow['cells']): BucketRow =>
    row({
      title: 'woodland',
      subtitle: null,
      cells,
      link: { kind: 'grant', code: 'woodland', version: '1.43.2' }
    })

  const versionPage = (cells: BucketRow['cells']) =>
    page(read(exact({ rows: [versionRow(cells)] })), {}, grantsBucket)

  test('says the version after a version row title, for a screen reader', () => {
    const [drawn] = versionPage({
      version: '1.43.2',
      status: 'active',
      definition: 'fetched'
    }).rows

    expect(drawn.spokenVersion).toBe('1.43.2')
    expect(page().rows[0].spokenVersion).toBeNull()
  })

  test("titles a badge with its value's hint, and a draft row's other badges with the draft clause", () => {
    const [drawn] = versionPage({
      version: '2.0.0',
      status: 'draft',
      definition: 'permanent_error'
    }).rows

    expect(
      drawn.cells.map((cell) => cell.kind === 'badge' && cell.title)
    ).toEqual([
      false,
      "GAS refused at least one of this version's files and won't use it. Draft: GAS won't pick it for new work until it is published as active.",
      'Not yet published as active.'
    ])
  })

  test('says a version that is not Active beside it on phones, where Status is hidden', () => {
    const [version] = versionPage({
      version: '2.0.0',
      status: 'draft',
      definition: 'pending'
    }).rows[0].cells

    expect(version).toMatchObject({ key: 'version', phoneBadge: 'Draft' })
    expect(
      versionPage({ version: '1.0.0', status: 'active', definition: 'pending' })
        .rows[0].cells[0]
    ).not.toHaveProperty('phoneBadge')
  })

  test('hides Status below sm on the version lists only', () => {
    const drawn = versionPage({
      version: '1.0.0',
      status: 'active',
      definition: 'fetched'
    })

    expect(drawn.head.layout).toBe('versions')
    expect(drawn.head.columns.map(({ phoneHidden }) => phoneHidden)).toEqual([
      false,
      false,
      true
    ])
    expect(drawn.rows[0].cells.map(({ phoneHidden }) => phoneHidden)).toEqual([
      false,
      false,
      true
    ])
  })

  test('splits a code@version cell into its code and version', () => {
    const [cell] = page(
      read(
        exact({ rows: [row({ cells: { code: 'frps-private-beta@1.4.2' } })] })
      ),
      {},
      applicationsBucket
    ).rows[0].cells

    expect(cell).toMatchObject({
      kind: 'versioned',
      text: 'frps-private-beta@1.4.2',
      code: 'frps-private-beta',
      version: '1.4.2'
    })
  })

  test('says which choices found nothing, by their labels', () => {
    expect(
      page(
        read(exact({ rows: [], groups: [] })),
        { status: 'draft' },
        grantsBucket
      ).emptyText
    ).toBe('No grant versions whose Status is Draft.')
    expect(
      page(read(exact({ rows: [], groups: [] })), {}, grantsBucket).emptyText
    ).toBe('No grant versions found.')
  })

  test.each([
    [
      'a prefix field',
      woodland,
      'field.businessName:hil',
      'No applications whose Grant is woodland-creation match Business name starting "hil".'
    ],
    [
      'an exact field',
      woodland,
      'field.landParcelId:ZZ9999 9999',
      'No applications whose Grant is woodland-creation match Land parcel ID "ZZ9999 9999".'
    ],
    [
      'an identifier, with nothing chosen',
      {},
      'ref:abc-123',
      'No applications match Reference "abc-123".'
    ]
  ])('names the search by %s that found nothing', (_name, filters, q, text) => {
    expect(
      toBucketPage(
        fieldsApplicationsBucket,
        read(exact({ rows: [], groups: [] })),
        { filters },
        { q, id: searchId },
        now
      ).emptyText
    ).toBe(text)
  })

  test('gives each menu value its hint', () => {
    const definition = page(read(), {}, grantsBucket).menus.find(
      ({ fact }) => fact === 'worstFetchStatus'
    )

    expect(definition?.items.map(({ hint }) => hint)).toEqual([
      null,
      'GAS has fetched every file of this version (grant, agreement, payment) itself.',
      "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet.",
      "GAS's last fetch of at least one of this version's files from S3 failed.",
      "GAS refused at least one of this version's files and won't use it."
    ])
  })
})
