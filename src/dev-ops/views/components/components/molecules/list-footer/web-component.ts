import { el } from '../../../core/dom.ts'

/**
 * "Show more" for a long list: wraps a ListFooter in state `more`, whose link
 * goes to the next page (that is all it does without a script). This loads that page in place instead: when the
 * footer scrolls into view (unless `data-auto="false"`) or the link is used. It takes the rows from the same table on
 * the fetched page (the table body with the same id, else the first) and appends them, then puts that page's footer
 * in its place (more again, or the end). While it loads, the footer says so; if it fails, it says that with a Retry
 * that tries again in place. Focus: after the link is used, focus moves to the first new row; loading on scroll
 * leaves it where it is. `au-load` fires (detail `{ rows }`) after rows are added. The fetched page's <style>
 * elements are dropped unparsed, so a nonce-based style-src (a nonce per response) sees no violation.
 */
export class AuLoadMore extends HTMLElement {
  #observer: IntersectionObserver | null = null
  #busy = false

  connectedCallback() {
    const link = this.querySelector<HTMLAnchorElement>('a[data-au-more]')
    if (!link || this.dataset.auUp != null) return
    this.dataset.auUp = ''
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return
      e.preventDefault()
      this.load(true)
    })
    if (this.dataset.auto !== 'false' && typeof IntersectionObserver !== 'undefined') {
      this.#observer = new IntersectionObserver((entries) => {
        if (entries.some((x) => x.isIntersecting)) this.load(false)
      }, { rootMargin: '0px 0px 320px 0px' })
      this.#observer.observe(this)
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
    this.#observer = null
  }

  get #href() {
    return this.querySelector<HTMLAnchorElement>('a[data-au-more]')?.href ?? this.dataset.href ?? ''
  }

  get #body(): HTMLElement | null {
    return this.closest('.au-table')?.querySelector<HTMLElement>('tbody, .au-table-body') ?? null
  }

  #footer(content: (Node | string)[], attrs: Record<string, string> = {}) {
    const foot = this.querySelector<HTMLElement>('.au-listfoot')
    if (!foot) return
    for (const a of ['role', 'aria-live']) foot.removeAttribute(a)
    for (const [k, v] of Object.entries(attrs)) foot.setAttribute(k, v)
    foot.replaceChildren(...content)
  }

  async load(byHand: boolean) {
    const href = this.#href
    const body = this.#body
    if (this.#busy || !href || !body) return
    this.#busy = true
    this.dataset.href = href
    const noun = this.dataset.noun ?? 'records'
    this.#footer([el('span', { className: 'au-spinner au-spinner-sm', 'aria-hidden': 'true' }), `Loading more ${noun}…`], { 'aria-live': 'polite' })
    try {
      const res = await fetch(href, { headers: { Accept: 'text/html', 'X-Requested-With': 'au-load-more' }, credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      // Only its rows are wanted (this page has the styles). Its <style> elements go before parsing: a parsed document
      // takes this page's content security policy, and their nonce is that response's, so Chromium would refuse them.
      const page = new DOMParser().parseFromString((await res.text()).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ''), 'text/html')
      const theirs = (body.id && page.getElementById(body.id)) || page.querySelector('.au-table tbody, .au-table .au-table-body')
      if (!theirs) throw new Error('no rows')
      const rows = [...theirs.children].map((r) => document.importNode(r, true) as HTMLElement)
      body.append(...rows)
      const next = theirs.closest('.au-table')?.querySelector('au-load-more, .au-listfoot')
      this.#observer?.disconnect()
      this.#busy = false
      if (next) this.replaceWith(document.importNode(next, true))
      else this.remove()
      if (byHand && rows[0]) {
        const target = rows[0].querySelector<HTMLElement>('a[href], button:not([disabled])') ?? rows[0]
        if (target === rows[0] && !rows[0].hasAttribute('tabindex')) rows[0].tabIndex = -1
        target.focus()
      }
      body.dispatchEvent(new CustomEvent('au-load', { bubbles: true, detail: { rows } }))
    } catch {
      this.#busy = false
      const retry = el('button', { type: 'button', className: 'au-btn au-btn-default au-btn-sm' }, el('span', {}, 'Retry'))
      retry.addEventListener('click', () => this.load(true))
      this.#footer([el('span', { className: 'au-text-danger' }, `Couldn’t load more ${noun}.`), retry], { role: 'alert' })
    }
  }
}
