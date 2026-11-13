/**
 * List page: the title, alert and filters stick to the top of the main area, and the
 * table's header sticks under them. This measures that top block and keeps `--au-list-top` on the page, so the
 * header sits right under it however tall it grows. Without a script the header sticks to the top instead.
 */
export class AuListPage extends HTMLElement {
  #observer: ResizeObserver | null = null

  connectedCallback() {
    const page = this.querySelector<HTMLElement>(':scope > .au-listpage')
    const top = page?.querySelector<HTMLElement>(':scope > .au-listpage-top')
    if (!page || !top || this.#observer) return
    const set = () => page.style.setProperty('--au-list-top', `${top.offsetHeight}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    this.#observer = new ResizeObserver(set)
    this.#observer.observe(top)
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
    this.#observer = null
  }
}
