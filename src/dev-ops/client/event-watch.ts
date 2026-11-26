import { swapIn } from './event-swap.ts'
import type { Upgrade } from './event-swap.ts'

interface Check {
  settled: boolean
  failed: number
  allowed: number
}

/** After 2, 3, 5, 8 and 12 seconds: 30 in all, counting only time the tab is shown, waits for answers included. */
const dues = [2000, 5000, 10000, 18000, 30000]

const answerWithin = 4000

const settledOutcomes = new Set(['delivered', 'failed', 'purged'])

const isCheck = (body: unknown): body is Check => {
  const { settled, failed, allowed } = (body ?? {}) as Partial<Check>

  return (
    typeof settled === 'boolean' &&
    Number.isInteger(failed) &&
    Number.isInteger(allowed)
  )
}

/** Loaded once a result comes: importing it up front would run the components' setup before the banner is shown. */
const loadUpgrade = async (): Promise<Upgrade> =>
  (await import('../views/components/index.ts')).upgrade

const readOf = async <T>(
  href: string,
  signal: AbortSignal,
  read: (response: Response) => Promise<T>
): Promise<T | null> => {
  try {
    const response = await fetch(href, { cache: 'no-store', signal })

    return response.ok ? await read(response) : null
  } catch {
    return null
  }
}

const toResult = (html: string): Document | null => {
  const next = new DOMParser().parseFromString(html, 'text/html')
  const outcome = next
    .getElementById('event-record')
    ?.getAttribute('data-gpa-outcome')

  return settledOutcomes.has(outcome ?? '') ? next : null
}

const fillIn = (alert: Element, { failed, allowed }: Check) => {
  for (const [selector, value] of [
    ['[data-gpa-failed]', failed],
    ['[data-gpa-allowed]', allowed]
  ] as const) {
    const slot = alert.querySelector(selector)
    if (slot) slot.textContent = String(value)
  }
}

/** The banner's content as one of the page's templates draws it, in place. */
const showFrom = (
  banner: HTMLElement,
  template: HTMLTemplateElement | null
) => {
  const alert =
    template && document.importNode(template.content, true).firstElementChild

  if (alert) {
    banner.className = alert.className
    banner.replaceChildren(...alert.childNodes)
  }
}

/** A result is not swapped in under an open dialog: that would throw away what is typed in it. */
const whenNoDialogOpen = (run: () => void) => {
  if (document.querySelector('#event-record dialog[open]')) {
    document.addEventListener('gpa-close', () => whenNoDialogOpen(run), {
      once: true
    })
  } else {
    run()
  }
}

const watch = (banner: HTMLElement) => {
  const { statusHref = '', resultHref = '' } = banner.dataset
  const waiting = banner.cloneNode(true) as HTMLElement
  let next = 0
  let phase: 'waiting' | 'stopped' | 'settled' = 'waiting'
  let last: Check = { settled: false, failed: 0, allowed: 0 }
  let timer = 0
  let checking = false
  let away = false
  let inFlight: AbortController | null = null
  let shown = 0
  let shownFrom: number | null = null

  const isShown = () => !away && !document.hidden

  const elapsed = () =>
    shown + (shownFrom === null ? 0 : Date.now() - shownFrom)

  const setClock = (ms: number) => {
    shown = ms
    shownFrom = isShown() ? Date.now() : null
  }

  /** A banner taken off the page has nowhere to say how it went. */
  const isWatching = () => phase === 'waiting' && banner.isConnected

  const ask = async <T>(href: string, read: (r: Response) => Promise<T>) => {
    inFlight = new AbortController()
    const giveUp = window.setTimeout(() => inFlight?.abort(), answerWithin)
    const answer = await readOf(href, inFlight.signal, read)

    window.clearTimeout(giveUp)

    return answer
  }

  const stop = () => {
    phase = 'stopped'
    const variant = last.failed > 0 ? 'retrying' : 'not-retried'
    showFrom(
      banner,
      document.querySelector(`template[data-gpa-watch-stopped="${variant}"]`)
    )
    fillIn(banner, last)
  }

  const settle = async (): Promise<boolean> => {
    const html = await ask(resultHref, (response) => response.text())
    const next = html === null ? null : toResult(html)

    if (next === null) return false

    phase = 'settled'
    const upgrade = await loadUpgrade()
    whenNoDialogOpen(() => swapIn(next, banner, upgrade))

    return true
  }

  const schedule = () => {
    window.clearTimeout(timer)
    if (!isWatching() || !isShown()) return
    if (next === dues.length) return stop()

    timer = window.setTimeout(checkDue, Math.max(0, dues[next] - elapsed()))
  }

  const check = async () => {
    checking = true
    const answer = await ask(statusHref, async (response) => {
      const body: unknown = await response.json()

      return isCheck(body) ? body : null
    })

    if (answer) last = answer
    const settled = Boolean(answer?.settled) && (await settle())

    checking = false
    if (!settled) schedule()
  }

  const checkDue = () => {
    if (checking || !isWatching()) return

    next += 1
    check().catch(() => undefined)
  }

  /** A check brought forward spends no step: the ones left stay due when they were. */
  const checkNow = () => {
    window.clearTimeout(timer)
    if (checking || !isWatching()) return
    if (next === dues.length) return stop()

    check().catch(() => undefined)
  }

  banner.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('[data-gpa-check-again]')) return

    event.preventDefault()
    banner.className = waiting.className
    banner.replaceChildren(...[...waiting.cloneNode(true).childNodes])
    banner.focus({ preventScroll: true })
    phase = 'waiting'
    next = 0
    setClock(0)
    last = { settled: false, failed: 0, allowed: 0 }
    schedule()
  })

  document.addEventListener('visibilitychange', () => {
    setClock(elapsed())
    if (document.hidden) {
      window.clearTimeout(timer)
    } else {
      checkNow()
    }
  })

  window.addEventListener('pagehide', () => {
    away = true
    setClock(elapsed())
    window.clearTimeout(timer)
    inFlight?.abort()
  })

  window.addEventListener('pageshow', (event) => {
    away = false
    setClock(elapsed())
    if (event.persisted) checkNow()
  })

  banner.hidden = false
  setClock(0)
  schedule()
}

const banner = document.querySelector<HTMLElement>('[data-gpa-watch]')

if (banner) watch(banner)
