// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`

const deadLetter = {
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'io.onsite.agreement.status.updated',
  eventType: 'AgreementStatusUpdated',
  targetTopic: null,
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-10-13T14:53:22.397Z',
  traceId: null,
  expiresAt: null,
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: null,
  errorKey: null,
  attemptHistory: [],
  payload: { id: 'abc' },
  payloadRevision: 0,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  record: null
} as unknown as EventDetail

let server: Server

/** The page as the server draws it, put in the document for the components' elements to upgrade. */
const open = async (url: string) => {
  const { payload } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(payload)?.[1] ?? ''
  document.body.replaceChildren(template.content)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const click = (element: Element | null) =>
  element?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  )

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const purgeDialog = () =>
  document.getElementById('purge-dialog') as HTMLDialogElement

const choose = (value: string) => {
  const radio = document.querySelector<HTMLInputElement>(
    `input[name="reasonCode"][value="${value}"]`
  )
  if (!radio) throw new Error(`no ${value} reason`)
  radio.checked = true
  radio.dispatchEvent(new Event('input', { bubbles: true }))
  radio.dispatchEvent(new Event('change', { bubbles: true }))
}

const note = () => ({
  optional: !(
    purgeDialog().querySelector<HTMLElement>('.gpa-label-optional')?.hidden ??
    true
  ),
  required: document.getElementById('purge-note')?.getAttribute('aria-required')
})

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  await import('../views/components/index.ts')
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'found',
    event: deadLetter,
    failure: null
  })
})

afterAll(async () => {
  await server.stop()
})

test('the note is required while Other is chosen, and optional again when Purge reopens with no reason', async () => {
  await open(path)
  click(document.querySelector('[data-testid="event-purge"]'))

  expect(purgeDialog().open).toBe(true)
  expect(note()).toEqual({ optional: true, required: null })

  choose('OTHER')

  expect(note()).toEqual({ optional: false, required: 'true' })

  click(purgeDialog().querySelector('[data-gpa-close]'))
  await settle()
  click(document.querySelector('[data-testid="event-purge"]'))

  expect(purgeDialog().open).toBe(true)
  expect(
    document.querySelector<HTMLInputElement>('input[value="OTHER"]')?.checked
  ).toBe(false)
  expect(note()).toEqual({ optional: true, required: null })
})
