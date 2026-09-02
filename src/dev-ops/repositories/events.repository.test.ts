import { getFromGas } from '../../common/gas.ts'
import type { EventsPage } from './events.repository.ts'
import { findEvents } from './events.repository.ts'

vi.mock(import('../../common/gas.ts'))

const page: EventsPage = {
  events: [
    {
      service: 'gas',
      box: 'outbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b',
      eventId: '3f2c1a0e-1111-2222-3333-444455556666',
      type: 'case.status.updated',
      fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
      source: null,
      target: 'cw__sns__update_status_fifo',
      segregationRef: 'GLD-9B2-BWS-grasslands',
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      createdAt: '2026-06-16T10:00:00.000Z',
      lastFailureAt: '2026-06-16T10:16:05.000Z',
      completedAt: null
    }
  ],
  pagination: {
    startCursor: 'START',
    endCursor: 'END',
    hasNextPage: true,
    hasPreviousPage: false
  },
  sourceErrors: []
}

describe('findEvents', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue(page)
  })

  test('reads the events page from fg-gas-backend', async () => {
    await findEvents({ cursor: 'eyJ2IjoxfQ' })

    expect(getFromGas).toHaveBeenCalledTimes(1)
    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=eyJ2IjoxfQ'
    )
  })

  test('asks for the unfiltered page when given no parameters', async () => {
    await findEvents({})

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events')
  })

  test('forwards the cursor, direction, status and service', async () => {
    await findEvents({
      cursor: 'eyJ2IjoxfQ',
      direction: 'forward',
      status: 'DEAD_LETTER',
      service: 'gas'
    })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=eyJ2IjoxfQ&direction=forward&status=DEAD_LETTER&service=gas'
    )
  })

  test('leaves out a parameter that was not given', async () => {
    await findEvents({ cursor: undefined, status: 'FAILED' })

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events?status=FAILED')
  })

  test('forwards a status the endpoint may reject', async () => {
    await findEvents({ status: 'BOGUS' })

    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/events?status=BOGUS')
  })

  test('escapes a cursor containing url characters', async () => {
    await findEvents({ cursor: 'a+b/c=' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?cursor=a%2Bb%2Fc%3D'
    )
  })

  test('escapes a status containing url characters', async () => {
    await findEvents({ status: 'a&b=c' })

    expect(getFromGas).toHaveBeenCalledWith(
      '/grant-admin/events?status=a%26b%3Dc'
    )
  })

  test('returns the page the backend answers with', async () => {
    await expect(findEvents({})).resolves.toEqual(page)
  })
})
