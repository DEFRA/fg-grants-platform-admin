// @vitest-environment happy-dom
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  EventDetail,
  EventHistoryEntry
} from '../repositories/events.repository.ts'
import { findEvent, redriveEvent } from '../repositories/events.repository.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'
import { upgrade } from '../views/components/index.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/events.repository.ts'), async (original) => ({
  ...(await original()),
  findEvent: vi.fn(),
  redriveEvent: vi.fn()
}))
vi.mock(import('../views/components/index.ts'), () => ({ upgrade: vi.fn() }))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const statusHref = `${path}/status`

const attempt = (number: number, message: string): EventHistoryEntry => ({
  kind: 'attempt',
  at: `2026-10-13T15:0${number}:00.000Z`,
  number,
  name: 'Error',
  message,
  stack: null
})

const redriven: EventHistoryEntry = {
  kind: 'redriven',
  at: '2026-10-13T15:05:00.000Z',
  by: 'Ada Lovelace'
}

const received: EventHistoryEntry = {
  kind: 'received',
  at: '2026-10-13T14:53:22.397Z'
}

const before = [attempt(2, 'boom'), attempt(1, 'boom'), received]

const event = (overrides: Partial<EventDetail> = {}): EventDetail => ({
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
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: null,
  lastError: null,
  attemptHistory: [],
  payload: { id: 'abc' },
  payloadRevision: 3,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: { at: '2026-10-13T15:05:00.000Z', by: 'Ada Lovelace' },
  history: [redriven, ...before],
  ...overrides
})

const failedAgain = event({
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  history: [attempt(4, 'bang'), attempt(3, 'bang'), redriven, ...before]
})

const delivered = event({
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success',
  completionDate: '2026-10-13T15:05:01.000Z',
  history: [
    { kind: 'delivered', at: '2026-10-13T15:05:01.000Z' },
    redriven,
    ...before
  ]
})

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const get = async (url: string, cookie = '') =>
  (
    await server.inject({
      method: 'GET',
      url,
      headers: {
        cookie: ['dev-ops-times=utc', cookie].filter(Boolean).join('; ')
      },
      auth: { strategy: 'session', credentials }
    })
  ).payload

/** The page a redrive returns, as the server draws it, read while the event is `onPage`. */
const redrive = async (tab = 'overview', onPage = event()) => {
  vi.mocked(findEvent).mockResolvedValue(onPage)

  const posted = await server.inject({
    method: 'POST',
    url: `${path}/redrive`,
    payload: { tab },
    headers: { 'sec-fetch-site': 'same-origin' },
    auth: { strategy: 'session', credentials }
  })

  return get(
    posted.headers.location as string,
    cookieOf(posted.headers['set-cookie'])
  )
}

/** The result the page fetches once the status settles, as the server draws it for `now`. */
const resultOf = async (now: EventDetail, tab = 'overview') => {
  vi.mocked(findEvent).mockResolvedValue(now)

  return get(`${path}/result${tab === 'history' ? '?tab=history' : ''}`)
}

const show = (page: string) => {
  const template = document.createElement('template')
  template.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)?.[1] ?? ''
  document.body.replaceChildren(template.content)
}

type Answer = object | Error | number | string

/** Each check answers with the next of `checks`, the last one repeating; the result with `result`. */
const answering = (checks: Answer[], result: string | number = 502) => {
  const fetches: { href: string; signal?: AbortSignal | null }[] = []
  const toResponse = (answer: Answer) => {
    if (answer instanceof Error) throw answer
    if (typeof answer === 'number') {
      return new Response(null, { status: answer })
    }

    return new Response(
      typeof answer === 'string' ? answer : JSON.stringify(answer),
      { status: 200 }
    )
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (href: string, init?: RequestInit) => {
      fetches.push({ href, signal: init?.signal })

      if (href === statusHref) {
        const checksSoFar = fetches.filter((f) => f.href === statusHref).length

        return toResponse(checks[Math.min(checksSoFar, checks.length) - 1])
      }

      return toResponse(result)
    })
  )

  return fetches
}

const waiting = { settled: false, failed: 0, allowed: 5 }
const settled = { settled: true, failed: 5, allowed: 5 }

const start = async () => {
  vi.resetModules()
  await import('./event-watch.ts')
}

const banner = () => document.getElementById('event-banner')

const bannerText = () =>
  [
    ...(banner()?.querySelectorAll('.gpa-alert-title, .gpa-alert-body > div') ??
      [])
  ]
    .filter((node) => !node.classList.contains('gpa-alert-actions'))
    .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

const statusChecks = (fetches: { href: string }[]) =>
  fetches.filter(({ href }) => href === statusHref).length

const after = (ms: number) => vi.advanceTimersByTimeAsync(ms)

let hidden: boolean

const setHidden = (value: boolean) => {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden
  })
})

beforeEach(() => {
  hidden = false
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(redriveEvent).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

afterAll(async () => {
  await server.stop()
})

test('shows the waiting banner, already busy and never aria-busy, and checks after 2, 3, 5, 8 and 12 seconds', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()

  expect(banner()?.hidden).toBe(true)

  await start()

  expect(banner()?.hidden).toBe(false)
  expect(banner()?.querySelector('.gpa-spinner')).not.toBeNull()
  expect(document.querySelector('[aria-busy]')).toBeNull()
  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])

  const counts = []
  for (const step of [1999, 1, 3000, 5000, 8000, 12000]) {
    await after(step)
    counts.push(statusChecks(fetches))
  }

  expect(counts).toStrictEqual([0, 1, 2, 3, 4, 5])
  expect(fetches[0]).toMatchObject({ href: statusHref })
})

test('stops after 30 seconds with no attempt: not retried yet, with Check again, and no more checks', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()
  await start()

  await after(30000)

  expect(bannerText()).toStrictEqual([
    'Redriven.',
    'Not retried yet. Stopped checking after 30 seconds.'
  ])
  expect(banner()?.querySelector('.gpa-spinner')).toBeNull()
  expect(
    banner()?.querySelector('[data-gpa-check-again]')?.getAttribute('href')
  ).toBe(path)

  await after(60000)

  expect(statusChecks(fetches)).toBe(5)
})

test('stops mid-retry: how many of how many attempts have failed so far, from the last check that answered', async () => {
  show(await redrive())
  answering([waiting, { settled: false, failed: 2, allowed: 5 }, 502])
  vi.useFakeTimers()
  await start()

  await after(30000)

  expect(bannerText()).toStrictEqual([
    'Redriven.',
    'Still retrying: 2 of 5 attempts have failed so far. Stopped checking after 30 seconds.'
  ])
})

test('Check again shows the waiting banner once more and watches again', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()
  await start()
  await after(30000)

  banner()
    ?.querySelector<HTMLElement>('[data-gpa-check-again]')
    ?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )

  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])
  expect(banner()?.querySelector('.gpa-spinner')).not.toBeNull()
  expect(document.activeElement).toBe(banner())

  await after(2000)

  expect(statusChecks(fetches)).toBe(6)

  await after(28000)

  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('a failed check changes nothing and shows nothing: refused, not 2xx, not JSON, or not a check', async () => {
  show(await redrive())
  const fetches = answering([
    new TypeError('Failed to fetch'),
    502,
    'not json',
    { settled: 'yes' },
    waiting
  ])
  vi.useFakeTimers()
  await start()
  const drawn = banner()?.outerHTML

  await after(18000)

  expect(statusChecks(fetches)).toBe(4)
  expect(banner()?.outerHTML).toBe(drawn)
})

test('a check that takes too long is given up after 4 seconds', async () => {
  show(await redrive())
  const fetches: AbortSignal[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_href: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          fetches.push(signal!)
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
  )
  vi.useFakeTimers()
  await start()

  await after(2000 + 3999)

  expect(fetches[0].aborted).toBe(false)

  await after(1)

  expect(fetches[0].aborted).toBe(true)
})

test('checks that each take their full 4 seconds still keep to the 30 seconds: the last starts at 30, not later', async () => {
  show(await redrive())
  const starts: number[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_href: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          starts.push(Date.now())
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
  )
  vi.useFakeTimers()
  const from = Date.now()
  await start()

  await after(30000)

  expect(starts.map((at) => Math.round((at - from) / 100) * 100)).toStrictEqual(
    [2000, 6000, 10000, 18000, 30000]
  )

  await after(4000)

  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('the last check ending while the tab is hidden: shown again, it stops at once with no more checks', async () => {
  show(await redrive())
  let checks = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_href: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          checks += 1
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
  )
  vi.useFakeTimers()
  await start()

  await after(30000)
  setHidden(true)
  await after(4000)

  expect(checks).toBe(5)
  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])

  setHidden(false)
  await after(0)

  expect(checks).toBe(5)
  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('pauses while the tab is hidden, and checks at once when it is shown again', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()
  await start()

  await after(1000)
  setHidden(true)
  await after(60000)

  expect(statusChecks(fetches)).toBe(0)

  setHidden(false)
  await after(0)

  expect(statusChecks(fetches)).toBe(1)

  await after(999)

  expect(statusChecks(fetches)).toBe(1)

  await after(1)

  expect(statusChecks(fetches)).toBe(2)

  await after(3000)

  expect(statusChecks(fetches)).toBe(3)
})

test('hiding and showing the tab over and over doesn’t use up the checks: each still comes when it is due', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()
  await start()

  for (let switches = 0; switches < 10; switches += 1) {
    setHidden(true)
    setHidden(false)
    await after(0)
  }
  const brought = statusChecks(fetches)

  await after(2000 + 3000 + 5000 + 8000)

  expect(statusChecks(fetches) - brought).toBe(4)
  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])

  await after(12000)

  expect(statusChecks(fetches) - brought).toBe(5)
  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('leaving aborts the check in flight; coming back from the back/forward cache checks at once and goes on', async () => {
  show(await redrive())
  const signals: AbortSignal[] = []
  let answer = (_response: Response) => {}
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_href: string, { signal }: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          signals.push(signal!)
          answer = resolve
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
  )
  vi.useFakeTimers()
  await start()
  await after(2000)

  window.dispatchEvent(new Event('pagehide'))
  await after(60000)

  expect(signals).toHaveLength(1)
  expect(signals[0].aborted).toBe(true)

  window.dispatchEvent(
    Object.assign(new Event('pageshow'), { persisted: true })
  )
  await after(0)

  expect(signals).toHaveLength(2)

  answer(new Response(JSON.stringify(waiting)))
  await after(2999)

  expect(signals).toHaveLength(2)

  await after(1)

  expect(signals).toHaveLength(3)
})

test('back from the cache once it has stopped: the stopped banner stays, and nothing is checked', async () => {
  show(await redrive())
  const fetches = answering([waiting])
  vi.useFakeTimers()
  await start()
  await after(30000)

  window.dispatchEvent(new Event('pagehide'))
  window.dispatchEvent(
    Object.assign(new Event('pageshow'), { persisted: true })
  )
  await after(30000)

  expect(statusChecks(fetches)).toBe(5)
  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('failed again: the same banner turns into the warning, the header and History are swapped in, then set up', async () => {
  show(await redrive('history'))
  const result = await resultOf(failedAgain, 'history')
  const fetches = answering([waiting, settled], result)
  vi.useFakeTimers()
  await start()
  const region = banner()

  await after(5000)

  expect(fetches.map(({ href }) => href)).toStrictEqual([
    statusHref,
    statusHref,
    `${path}/result?tab=history`
  ])
  expect(banner()).toBe(region)
  expect(banner()?.className).toMatch(/gpa-alert-warning/)
  expect(bannerText()).toStrictEqual([
    'Failed again.',
    'It’s a dead letter again, with a different error. History shows it.'
  ])
  expect(
    document.querySelector('[data-testid="event-status"]')?.textContent
  ).toContain('Dead letter')
  expect(document.querySelector('[data-testid="event-redrive"]')).not.toBeNull()
  expect(
    document.querySelectorAll('[data-testid="event-history-entry"]')
  ).toHaveLength(6)
  expect(document.getElementById('redrive-dialog')).not.toBeNull()
  expect(document.getElementById('purge-dialog')).not.toBeNull()
  expect(document.querySelector('template[data-gpa-watch-stopped]')).toBeNull()

  const upgraded = vi.mocked(upgrade).mock.calls.map(([root]) => root)

  expect(upgraded).toContain(document.querySelector('.gpa-pageheader'))
  expect(upgraded).toContain(
    document.querySelector('[data-testid="event-history"]')
  )
  expect(upgraded).toContain(
    document.getElementById('purge-dialog')?.parentElement
  )
  expect(upgraded).toContain(region)
  expect(upgraded.every((root) => (root as Node).isConnected)).toBe(true)

  await after(60000)

  expect(fetches).toHaveLength(3)
})

test('a result that comes while a dialog is open waits for it to close, keeping what is typed in it', async () => {
  show(await redrive('overview', failedAgain))
  answering([settled], await resultOf(failedAgain))
  vi.useFakeTimers()
  await start()
  const dialog = document.getElementById('purge-dialog')
  dialog?.setAttribute('open', '')

  await after(2000)

  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])
  expect(document.getElementById('purge-dialog')).toBe(dialog)

  dialog?.removeAttribute('open')
  dialog?.dispatchEvent(new CustomEvent('gpa-close', { bubbles: true }))

  expect(bannerText()[0]).toBe('Failed again.')
  expect(document.getElementById('purge-dialog')).not.toBe(dialog)
})

test('a result that fails to come is tried again at the next check', async () => {
  show(await redrive())
  const result = await resultOf(failedAgain)
  let results = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (href: string) => {
      if (href === statusHref) return new Response(JSON.stringify(settled))
      results += 1

      return results === 1
        ? new Response(null, { status: 502 })
        : new Response(result)
    })
  )
  vi.useFakeTimers()
  await start()

  await after(2000)

  expect(bannerText()).toStrictEqual(['Redriven.', 'Checking for the result…'])

  await after(3000)

  expect(bannerText()[0]).toBe('Failed again.')
})

test('a result that is still on its way is no result: the page keeps checking', async () => {
  show(await redrive())
  const fetches = answering(
    [{ ...settled, failed: 0 }],
    await resultOf(event({ status: 'FAILED', statusLabel: 'Failed' }))
  )
  vi.useFakeTimers()
  await start()

  await after(30000)

  expect(statusChecks(fetches)).toBe(5)
  expect(bannerText()).toContain(
    'Not retried yet. Stopped checking after 30 seconds.'
  )
})

test('delivered: the banner goes, an Event delivered toast comes, and focus on the banner is not moved', async () => {
  show(await redrive())
  answering([settled], await resultOf(delivered))
  vi.useFakeTimers()
  await start()
  banner()?.focus()

  await after(2000)

  expect(banner()).toBeNull()
  expect(
    document.querySelector('[data-testid="event-status"]')?.textContent
  ).toContain('Completed')
  expect(
    [...document.querySelectorAll('.gpa-toast-region gpa-toast')].map((toast) =>
      toast.textContent?.trim()
    )
  ).toContain('Event delivered')

  expect(document.activeElement).toBe(document.body)
  expect(document.querySelector('h1')?.hasAttribute('tabindex')).toBe(false)
})

test('purged since it failed: the banner goes and an Event purged toast comes', async () => {
  show(await redrive())
  answering(
    [settled],
    await resultOf(
      event({
        status: 'PURGED',
        statusLabel: 'Purged',
        statusRole: 'neutral'
      })
    )
  )
  vi.useFakeTimers()
  await start()

  await after(2000)

  expect(banner()).toBeNull()
  expect(
    [...document.querySelectorAll('.gpa-toast-region gpa-toast')].map((toast) =>
      toast.textContent?.trim()
    )
  ).toContain('Event purged')
})

test('focus on Redrive: delivered takes it to the heading, failed again to the Redrive drawn in its place', async () => {
  const deadLetterPage = await redrive('overview', failedAgain)

  show(deadLetterPage)
  answering([settled], await resultOf(delivered))
  vi.useFakeTimers()
  await start()
  document.querySelector<HTMLElement>('[data-testid="event-redrive"]')?.focus()
  await after(2000)

  expect(document.activeElement).toBe(document.querySelector('h1'))

  vi.useRealTimers()
  show(deadLetterPage)
  answering([settled], await resultOf(failedAgain))
  vi.useFakeTimers()
  await start()
  document.querySelector<HTMLElement>('[data-testid="event-redrive"]')?.focus()
  await after(2000)

  expect(document.activeElement).toBe(
    document.querySelector('[data-testid="event-redrive"]')
  )
})

const copyButtons = () =>
  document.querySelectorAll<HTMLElement>('gpa-copy [data-gpa-copy]')

/** As the copy button says it for a moment after a click. */
const sayCopied = (button: HTMLElement | undefined) => {
  button?.setAttribute('aria-label', 'Copied')
  button?.append('Copied')
}

test('focus on a tab or a copy button goes to the one drawn in its place, a copy button just clicked included', async () => {
  const page = await redrive('overview', failedAgain)
  const picks: [() => HTMLElement | undefined, boolean][] = [
    [() => document.querySelectorAll<HTMLElement>('nav.gpa-tabs a')[1], false],
    [() => copyButtons()[0], false],
    [() => copyButtons()[0], true],
    [() => [...copyButtons()].at(-1), true]
  ]

  for (const [pick, clicked] of picks) {
    vi.useRealTimers()
    show(page)
    expect(copyButtons().length).toBeGreaterThan(1)
    answering([settled], await resultOf(failedAgain))
    vi.useFakeTimers()
    await start()
    const before = pick()
    if (clicked) sayCopied(before)
    before?.focus()

    await after(2000)

    expect(before?.isConnected).toBe(false)
    expect(document.activeElement).toBe(pick())
  }
})

test('focus on a control with two look-alikes in the result goes to the heading', async () => {
  const twins =
    '<button type="button">Twin</button><button type="button">Twin</button><h1'
  show((await redrive('overview', failedAgain)).replace('<h1', twins))
  answering([settled], (await resultOf(failedAgain)).replace('<h1', twins))
  vi.useFakeTimers()
  await start()
  const twin = [
    ...document.querySelectorAll<HTMLElement>('#event-record button')
  ].find((button) => button.textContent === 'Twin')
  twin?.focus()

  expect(document.activeElement).toBe(twin)

  await after(2000)

  expect(document.activeElement).toBe(document.querySelector('h1'))
})

test('focus elsewhere on the page stays where it is', async () => {
  show(await redrive())
  answering([settled], await resultOf(failedAgain))
  vi.useFakeTimers()
  await start()
  const outside = document.createElement('button')
  document.body.append(outside)
  outside.focus()

  await after(2000)

  expect(document.activeElement).toBe(outside)
})

test('the banner is said once on arrival and once with the outcome: nothing changes in it while waiting', async () => {
  show(await redrive())
  answering([waiting, waiting, settled], await resultOf(failedAgain))
  vi.useFakeTimers()
  await start()
  const changes: MutationRecord[][] = []
  const observer = new MutationObserver((records) => changes.push(records))
  observer.observe(banner()!, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true
  })

  await after(5000)
  await Promise.resolve()

  expect(changes).toHaveLength(0)

  await after(5000)
  await Promise.resolve()
  observer.disconnect()

  expect(changes).toHaveLength(1)
  expect(
    document.querySelectorAll('[role="status"] .gpa-alert-title')
  ).toHaveLength(1)
})

test('the scroll position holds on the entry being read as newer ones land above it', async () => {
  show(await redrive('history'))
  answering([settled], await resultOf(failedAgain, 'history'))
  vi.useFakeTimers()
  await start()
  const drawn = new Set(document.querySelectorAll('[id]'))
  const main = document.querySelector('main')!
  main.scrollTop = 600
  const scrollBy = vi.spyOn(main, 'scrollBy').mockImplementation(() => {})
  const rect = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const reading = this.id === 'history-2'
      const top = drawn.has(this) ? 4 : 204

      return { top: reading ? top : 900 } as DOMRect
    })

  await after(2000)
  rect.mockRestore()

  expect(document.getElementById('history-2')).not.toBeNull()
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith(0, 200)
})

test('at the top of the page, the page stays at the top', async () => {
  show(await redrive('history'))
  answering([settled], await resultOf(failedAgain, 'history'))
  vi.useFakeTimers()
  await start()
  const scrollBy = vi.spyOn(Element.prototype, 'scrollBy')

  await after(2000)

  expect(bannerText()[0]).toBe('Failed again.')
  expect(scrollBy).not.toHaveBeenCalled()
})
