const preloadMarginPx = 600

const announceEveryMs = 1500

export const loadedMessage = (count: number): string =>
  `${count} more ${count === 1 ? 'event' : 'events'} loaded`

interface Page {
  rows: Node[]
  next: string | null
  partial: string | null
}

const outage = '[data-testid="events-error"], [data-testid="events-refused"]'

/** A 200 is not always a page of events: the outage and refused states are 200s too. */
const isPageOfEvents = (page: Document): boolean =>
  !page.querySelector(outage) &&
  Boolean(
    page.querySelector('do-load-more') ??
    page.querySelector('[data-testid="events-empty"]')
  )

const nextPageOf = (page: Document): string | null =>
  page.querySelector('do-load-more')?.getAttribute('data-next-page') ?? null

const partialOf = (page: Document): string | null =>
  page.querySelector('[data-testid="events-partial"] span')?.textContent ?? null

const hrefOf = (row: Element): string | null =>
  row.querySelector('[data-testid="event-link"]')?.getAttribute('href') ?? null

const readPage = (page: Document, rowsId: string): Page => ({
  rows: [...page.querySelectorAll(`[id="${rowsId}"] > tr`)].map((row) =>
    document.importNode(row, true)
  ),
  next: nextPageOf(page),
  partial: partialOf(page)?.trim() ?? null
})

const fetchPage = async (href: string, rowsId: string): Promise<Page> => {
  const response = await fetch(href, {
    headers: { accept: 'text/html' },
    credentials: 'same-origin'
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const page = new DOMParser().parseFromString(
    await response.text(),
    'text/html'
  )

  if (!isPageOfEvents(page)) {
    throw new Error('Not a page of events')
  }

  return readPage(page, rowsId)
}

interface Parts {
  rows: HTMLElement
  table: HTMLElement
  sentinel: HTMLElement
  spinner: HTMLElement
  end: HTMLElement
  partial: HTMLElement
  error: HTMLElement
  retry: HTMLButtonElement
  status: HTMLElement
}

export class LoadMore extends HTMLElement {
  #parts: Parts | null = null
  #next: string | null = null
  #busy = false
  #failed = false
  #observer: IntersectionObserver | null = null
  #pending = 0
  #pendingPartial: string | null = null
  #pendingEnd = false
  #retryHref: string | null = null
  #timer: number | undefined

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  #find(): Parts | null {
    const rows = document.getElementById(this.dataset.rows ?? '')
    const parts = {
      rows,
      table: rows?.closest('table'),
      sentinel: this.querySelector('[data-load-more-sentinel]'),
      spinner: this.querySelector('[data-load-more-spinner]'),
      end: this.querySelector('[data-load-more-end]'),
      partial: this.querySelector('[data-load-more-partial]'),
      error: this.querySelector('[data-load-more-error]'),
      retry: this.querySelector('[data-load-more-retry]'),
      status: this.querySelector('[data-load-more-status]')
    }

    return Object.values(parts).every(Boolean)
      ? (parts as unknown as Parts)
      : null
  }

  enhance() {
    const parts = this.#parts ? null : this.#find()

    if (!parts) {
      return
    }
    this.#parts = parts
    this.#next = this.dataset.nextPage ?? null
    parts.retry.addEventListener('click', () => this.#retry(parts))
    this.#startWatching(parts)
  }

  #startWatching(parts: Parts) {
    try {
      this.#watch(parts)
    } catch {
      return
    }
    this.#hideFallback()
  }

  /** Only once it is actually watching: otherwise the link stays as the way on. */
  #hideFallback() {
    const link = this.querySelector<HTMLElement>('[data-load-more-link]')

    if (link) {
      link.hidden = true
    }
  }

  #watch(parts: Parts) {
    if (!this.#next) {
      return
    }

    this.#observer?.disconnect()
    this.#observer = new IntersectionObserver(
      (entries) => this.#onIntersect(parts, entries),
      { rootMargin: `0px 0px ${preloadMarginPx}px 0px` }
    )
    this.#observer.observe(parts.sentinel)
  }

  #onIntersect(parts: Parts, entries: IntersectionObserverEntry[]) {
    if (entries.some((entry) => entry.isIntersecting)) {
      this.#load(parts)
    }
  }

  #canLoad(): boolean {
    return !this.#busy && !this.#failed && this.#next !== null
  }

  async #load(parts: Parts) {
    if (!this.#canLoad()) {
      return
    }

    this.#setBusy(parts, true)
    try {
      await this.#append(parts, this.#next ?? '')
    } catch {
      this.#fail(parts)
    }
    this.#setBusy(parts, false)
    this.#keepFilling(parts)
  }

  async #append(parts: Parts, href: string) {
    const { rows, next, partial } = await fetchPage(href, parts.rows.id)
    const fresh = this.#withoutShown(parts, rows)

    parts.rows.append(...fresh)
    this.#next = next
    this.#showPartialNotice(parts, partial)
    if (next === null) {
      this.#end(parts, href, partial)
    }
    this.#queueAnnouncement(parts, fresh.length, partial)
  }

  /** A retried page can repeat rows already shown. */
  #withoutShown(parts: Parts, rows: Node[]): Node[] {
    const shown = new Set(
      [...parts.rows.querySelectorAll('tr')].map(hrefOf).filter(Boolean)
    )

    return rows.filter((row) => {
      const href = row instanceof Element ? hrefOf(row) : null

      return href === null || !shown.has(href)
    })
  }

  /** A partial last page may only look like the end: offer to ask for it again. */
  #end(parts: Parts, href: string, partial: string | null) {
    this.#observer?.disconnect()
    if (partial === null) {
      parts.end.hidden = false
      this.#pendingEnd = true
      return
    }
    this.#retryHref = href
    parts.retry.hidden = false
  }

  #showPartialNotice(parts: Parts, partial: string | null) {
    if (partial !== null) {
      parts.partial.textContent = partial
      parts.partial.hidden = false
    }
  }

  #setBusy(parts: Parts, busy: boolean) {
    this.#busy = busy
    parts.spinner.hidden = !busy
    parts.table.setAttribute('aria-busy', String(busy))
  }

  #keepFilling(parts: Parts) {
    requestAnimationFrame(() => {
      const near =
        parts.sentinel.getBoundingClientRect().top <
        window.innerHeight + preloadMarginPx

      if (near && this.#canLoad()) {
        this.#load(parts)
      }
    })
  }

  #fail(parts: Parts) {
    this.#failed = true
    parts.error.textContent = 'More events could not be loaded.'
    parts.error.hidden = false
    parts.retry.hidden = false
  }

  #retry(parts: Parts) {
    this.#failed = false
    parts.error.hidden = true
    parts.retry.hidden = true
    if (this.#retryHref !== null) {
      this.#next = this.#retryHref
      this.#retryHref = null
      this.#watch(parts)
    }
    this.#load(parts)
  }

  #queueAnnouncement(parts: Parts, count: number, partial: string | null) {
    this.#pending += count
    this.#pendingPartial = partial ?? this.#pendingPartial

    if (this.#hasNews()) {
      this.#timer ??= window.setTimeout(
        () => this.#announce(parts),
        announceEveryMs
      )
    }
  }

  #hasNews(): boolean {
    return (
      this.#pending > 0 || this.#pendingPartial !== null || this.#pendingEnd
    )
  }

  #announce(parts: Parts) {
    const message = [
      this.#pending > 0 ? loadedMessage(this.#pending) : null,
      this.#pendingPartial,
      this.#pendingEnd ? 'No more events' : null
    ]
      .filter(Boolean)
      .join('. ')

    parts.status.textContent = ''
    requestAnimationFrame(() => {
      parts.status.textContent = message
    })
    this.#pending = 0
    this.#pendingPartial = null
    this.#pendingEnd = false
    this.#timer = undefined
  }
}
