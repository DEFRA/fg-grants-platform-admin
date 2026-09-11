/** How far below the viewport the sentinel starts the next load. */
const ahead = 600

/** Loads landing inside this window are announced once, as one total. */
const announceEveryMs = 1500

/** "20 more events loaded". */
export const loadedMessage = (count: number): string =>
  `${count} more ${count === 1 ? 'event' : 'events'} loaded`

interface Page {
  rows: Node[]
  /** The page after it, as that page itself says it; null at the end. */
  next: string | null
  /**
   * The page's own "Some event sources are unavailable" warning, when it
   * could only answer in part; null when every source answered.
   */
  partial: string | null
}

const outage = '[data-testid="events-error"], [data-testid="events-refused"]'

/**
 * A 200 is not always a page of events: the list draws its outage and its
 * refused-link states as ordinary pages, with no rows and no loader. Read as
 * a page, either would say "no next" and end the list with nothing wrong
 * shown, so both — and anything else without a loader that is not the list's
 * own genuine "No events found" — are failures, never the end.
 */
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

/**
 * The rows, imported whole, so every row behaviour — the stretched link,
 * hover, the focus outline, the dead-letter tint — comes with them.
 */
const readPage = (page: Document, rowsId: string): Page => ({
  rows: [...page.querySelectorAll(`[id="${rowsId}"] > tr`)].map((row) =>
    document.importNode(row, true)
  ),
  next: nextPageOf(page),
  partial: partialOf(page)?.trim() ?? null
})

/** Fetches one list page as HTML and reads it; see isPageOfEvents. */
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

/**
 * Enhances the load-more component: loads the list's next page as the reader
 * nears the bottom, with no button.
 *
 * An IntersectionObserver watches a sentinel under the table with a 600px
 * margin below the viewport, so the next page is usually in before the
 * reader gets there. Tabbing down the rows scrolls the page, which moves the
 * sentinel just the same, so a keyboard reaches every row. One request at a
 * time; when a page says it has no next, the observer stops and "No more
 * events" shows. A page too short to reach the sentinel keeps loading until
 * the window is full or the pages run out.
 *
 * While a page is on its way the table is `aria-busy` and a spinner shows. A
 * failure stops the loading and offers Retry. Arrivals are announced
 * politely, summed over 1.5s so a fast scroll is one sentence rather than
 * five. Focus is never moved.
 */
export class LoadMore extends HTMLElement {
  #parts: Parts | null = null
  #next: string | null = null
  #busy = false
  #failed = false
  #observer: IntersectionObserver | null = null
  #pending = 0
  #pendingPartial: string | null = null
  #timer: number | undefined

  connectedCallback() {
    // A parser can connect an already-defined element before its children
    // exist, so enhancement is deferred a microtask rather than reading
    // children here.
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  /** Every part the markup draws, or null on markup it does not know. */
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
    this.#watch(parts)
  }

  /** Nothing to watch on a page that is already the last. */
  #watch(parts: Parts) {
    if (!this.#next) {
      return
    }

    this.#observer = new IntersectionObserver(
      (entries) => this.#onIntersect(parts, entries),
      { rootMargin: `0px 0px ${ahead}px 0px` }
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

  /** Never rejects: a failure is drawn, not thrown. */
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

    parts.rows.append(...rows)
    this.#next = next
    this.#warn(parts, partial)
    this.#tally(parts, rows.length, partial)
    if (next === null) {
      this.#observer?.disconnect()
      parts.end.hidden = false
    }
  }

  /**
   * A page that answered only in part says which sources it is missing. The
   * rows it did bring are appended, and the gap stays said under the list:
   * those rows are missing for good, whatever the next page does.
   */
  #warn(parts: Parts, partial: string | null) {
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

  /**
   * The observer only speaks when the sentinel crosses its margin; a page
   * that still leaves the sentinel inside it has to ask again itself.
   */
  #keepFilling(parts: Parts) {
    requestAnimationFrame(() => {
      const near =
        parts.sentinel.getBoundingClientRect().top < window.innerHeight + ahead

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
    this.#load(parts)
  }

  /**
   * Sums the arrivals inside one window into one polite sentence, with any
   * missing sources after it. Nothing arrived and nothing missing is nothing
   * to say: never "0 more events loaded".
   */
  #tally(parts: Parts, count: number, partial: string | null) {
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
    return this.#pending > 0 || this.#pendingPartial !== null
  }

  #announce(parts: Parts) {
    const message = [
      this.#pending > 0 ? loadedMessage(this.#pending) : null,
      this.#pendingPartial
    ]
      .filter(Boolean)
      .join('. ')

    // Cleared first, so the same words twice in a row are still announced.
    parts.status.textContent = ''
    requestAnimationFrame(() => {
      parts.status.textContent = message
    })
    this.#pending = 0
    this.#pendingPartial = null
    this.#timer = undefined
  }
}
