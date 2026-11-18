import {
  applicationsBucket,
  outboxBucket,
  pagedInbox,
  pagedOutbox
} from '../use-cases/test-fixtures.ts'
import { pageMates, toPageHead } from './bucket-tabs.ts'

const mates = [pagedOutbox, pagedInbox]

const head = (bucket = pagedOutbox) => toPageHead(bucket, mates)

describe('pageMates', () => {
  const buckets = [
    pagedOutbox,
    pagedInbox,
    applicationsBucket,
    { ...pagedInbox, id: 'cw.inbox', service: 'CW' },
    {
      ...pagedInbox,
      id: 'gas.other',
      page: { id: 'other', label: 'Other', shortLabel: 'Other' }
    }
  ]

  test('are the lists of the same service on the same page, this one among them, in catalogue order', () => {
    expect(pageMates(pagedInbox, buckets).map(({ id }) => id)).toEqual([
      'gas.outbox',
      'gas.inbox'
    ])
  })

  test('are none for a list with a page of its own', () => {
    expect(pageMates(applicationsBucket, buckets)).toEqual([])
  })
})

describe('toPageHead', () => {
  test('is titled by the page, with a tab per list in order, this one active and linked to itself', () => {
    expect(head()).toEqual({
      title: 'GAS events',
      tabs: [
        {
          id: 'gas.outbox',
          label: 'Outbox',
          href: '/dev-ops/events/gas/outbox',
          active: true
        },
        {
          id: 'gas.inbox',
          label: 'Inbox',
          href: '/dev-ops/events/gas/inbox',
          active: false
        }
      ]
    })
  })

  test('is titled by the list and has no tabs for a list with a page of its own', () => {
    expect(toPageHead(applicationsBucket, [])).toEqual({
      title: 'Applications',
      tabs: []
    })
    expect(toPageHead(outboxBucket, [outboxBucket]).tabs).toEqual([])
  })

  test('links each tab to the plain list when nothing is chosen', () => {
    expect(head(pagedInbox).tabs.map(({ href }) => href)).toEqual([
      '/dev-ops/events/gas/outbox',
      '/dev-ops/events/gas/inbox'
    ])
  })

  test('carries the filters and time range to the other tab, so the Inbox opens on the same dead letters', () => {
    const filters = {
      status: ['DEAD_LETTER'],
      grantCode: 'woodland',
      from: '2026-10-12T15:00:00.000Z',
      to: '2026-10-13T15:00:00.000Z'
    }

    expect(
      toPageHead(pagedOutbox, mates, filters).tabs.map(({ href }) => href)
    ).toEqual([
      '/dev-ops/events/gas/outbox?status=DEAD_LETTER&grant=woodland&from=2026-10-12T15%3A00%3A00.000Z&to=2026-10-13T15%3A00%3A00.000Z',
      '/dev-ops/events/gas/inbox?status=DEAD_LETTER&grant=woodland&from=2026-10-12T15%3A00%3A00.000Z&to=2026-10-13T15%3A00%3A00.000Z'
    ])
  })

  test('leaves out a value the other tab doesn’t offer, and a key it doesn’t declare', () => {
    const inbox = {
      ...pagedInbox,
      facts: pagedInbox.facts.filter(({ name }) => name !== 'grantCode')
    }

    expect(
      toPageHead(pagedOutbox, [pagedOutbox, inbox], {
        eventType: ['Audit', 'UpdateCaseStatus'],
        grantCode: 'woodland'
      }).tabs[1]?.href
    ).toBe('/dev-ops/events/gas/inbox?event=UpdateCaseStatus')
  })
})
