// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { EventDetail } from '../repositories/events.repository.ts'
import { findEvent, redriveEvent } from '../repositories/events.repository.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/events.repository.ts'), async (original) => ({
  ...(await original()),
  findEvent: vi.fn(),
  redriveEvent: vi.fn()
}))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`

const resubmitted = {
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'io.onsite.agreement.status.updated',
  eventType: 'AgreementStatusUpdated',
  targetTopic: null,
  status: 'RESUBMITTED',
  statusLabel: 'Resubmitted',
  statusRole: 'warning',
  statusRetrying: false,
  attempts: '0/5',
  createdAt: '2026-10-13T14:53:22.397Z',
  purgeDeletionDate: null,
  lastError: null,
  attemptHistory: [],
  payload: { id: 'abc' },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: { at: '2026-10-13T15:05:00.000Z', by: 'Ada Lovelace' },
  history: []
} as unknown as EventDetail

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

test('the script shows the waiting banner before the components’ setup, so focus lands on it and it is read once', async () => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(redriveEvent).mockResolvedValue(undefined)
  vi.mocked(findEvent).mockResolvedValue(resubmitted)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 502 }))
  )

  const posted = await server.inject({
    method: 'POST',
    url: `${path}/redrive`,
    headers: { 'sec-fetch-site': 'same-origin' },
    auth: { strategy: 'session', credentials }
  })
  const { payload } = await server.inject({
    method: 'GET',
    url: posted.headers.location as string,
    headers: { cookie: String(posted.headers['set-cookie']).split(';')[0] },
    auth: { strategy: 'session', credentials }
  })
  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  document.body.replaceChildren(template.content)

  const banner = document.getElementById('event-banner')
  const focus = HTMLElement.prototype.focus
  const focusedWhileHidden: boolean[] = []
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions
  ) {
    if (this === banner) focusedWhileHidden.push(this.hidden === true)
    focus.call(this, options)
  })

  await import('./event-watch.ts')
  await import('../views/components/index.ts')

  expect(focusedWhileHidden).toStrictEqual([false])
  expect(document.activeElement).toBe(banner)
  expect(banner?.hasAttribute('aria-busy')).toBe(false)
})
