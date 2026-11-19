import { cwEvents, gasEvents } from '../use-cases/test-fixtures.ts'
import {
  eventsPresentationId,
  toEventsEntry,
  toEventsHref,
  toEventsList,
  toEventsPageHref,
  toQueueLabel
} from './events-list.ts'

const grouped = { buckets: [gasEvents, cwEvents], sourceErrors: [] }

describe('toEventsList', () => {
  test('with the Events page listed: its path, the filters as its URL spells them, and the queue given', () => {
    expect(
      toEventsList(grouped, {
        service: 'cw',
        box: 'inbox',
        filters: { status: 'DEAD_LETTER', errorKey: 'No error recorded' }
      })
    ).toEqual({
      path: '/dev-ops/events/cw',
      query: {
        queue: 'inbox',
        status: 'DEAD_LETTER',
        error: 'No error recorded'
      }
    })
  })

  test('no queue given: the Events page with none picked', () => {
    expect(toEventsList(grouped, { service: 'gas' })).toEqual({
      path: '/dev-ops/events/gas',
      query: {}
    })
  })

  test('with no Events page listed: nothing to link', () => {
    expect(toEventsList(null, { service: 'gas', box: 'outbox' })).toBeNull()
    expect(
      toEventsList(
        { buckets: [gasEvents], sourceErrors: [] },
        { service: 'cw', box: 'inbox' }
      )
    ).toBeNull()
  })

  test('an arrival clears any search held', () => {
    const ask = {
      service: 'gas',
      box: 'outbox',
      filters: { eventType: 'CreateCase' },
      clear: true
    } as const

    expect(toEventsList(grouped, ask)?.query).toEqual({
      queue: 'outbox',
      event: 'CreateCase',
      clear: 'all'
    })
  })
})

describe('toEventsHref', () => {
  test('joins the path and query, or is null', () => {
    expect(
      toEventsHref(grouped, {
        service: 'gas',
        box: 'outbox',
        filters: { eventType: 'CreateCase' },
        clear: true
      })
    ).toBe('/dev-ops/events/gas?queue=outbox&event=CreateCase&clear=all')
    expect(toEventsHref(null, { service: 'gas', box: 'outbox' })).toBeNull()
  })
})

describe('toEventsEntry', () => {
  test('is the Events page, or none', () => {
    expect(toEventsEntry(grouped, 'gas')?.id).toBe('gas.events')
    expect(
      toEventsEntry({ buckets: [gasEvents], sourceErrors: [] }, 'cw')
    ).toBeNull()
  })
})

test('every event of a service is toned by its Events page', () => {
  expect(eventsPresentationId('gas')).toBe('gas.events')
  expect(eventsPresentationId('cw')).toBe('cw.events')
})

test('a service’s Events page, by its address', () => {
  expect(toEventsPageHref('cw')).toBe('/dev-ops/events/cw')
})

describe('toQueueLabel', () => {
  test.each([
    ['events/gas', { queue: 'inbox' }, 'Inbox'],
    ['events/gas', { queue: 'elsewhere' }, 'elsewhere'],
    ['events/gas', {}, null],
    ['events/gas/outbox', {}, null],
    ['applications', {}, null]
  ])('%s with %j is %s', (path, query, label) => {
    expect(toQueueLabel(grouped, { path, query })).toBe(label)
  })

  test('takes the label GAS gives the queue, under the key it declares', () => {
    const [queue, ...facts] = gasEvents.facts
    const relabelled = {
      buckets: [
        {
          ...gasEvents,
          facts: [
            {
              ...queue,
              param: 'box',
              values: [{ value: 'inbox', label: 'Incoming' }]
            },
            ...facts
          ]
        }
      ],
      sourceErrors: []
    }

    expect(
      toQueueLabel(relabelled, { path: 'events/gas', query: { box: 'inbox' } })
    ).toBe('Incoming')
  })

  test('with no lists to read it from, none', () => {
    expect(
      toQueueLabel(null, { path: 'events/gas', query: { queue: 'inbox' } })
    ).toBeNull()
  })
})
