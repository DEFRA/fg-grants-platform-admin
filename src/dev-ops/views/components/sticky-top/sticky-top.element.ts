/**
 * Measures the sticky top of a page into two custom properties on the root:
 *
 * - `--nav-h`: the navbar's height, which is where the block sticks
 * - `--sticky-top`: the navbar plus the block, which is where the table's
 *   header row pins, and (plus that row) the document's scroll padding
 *
 * Both heights move with wrapping, zoom and the theme's own metrics, so they
 * are measured rather than guessed, and measured again whenever either box
 * resizes. The template carries fallbacks for both, so a page whose script
 * never arrives is still usable, just approximate.
 */
export class StickyTop extends HTMLElement {
  #observer: ResizeObserver | null = null

  connectedCallback() {
    const navbar = document.querySelector<HTMLElement>('header.navbar')

    this.#observer = new ResizeObserver(() => this.measure(navbar))
    this.#observer.observe(this)
    if (navbar) {
      this.#observer.observe(navbar)
    }
    this.measure(navbar)
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
  }

  measure(navbar: HTMLElement | null) {
    const nav = navbar?.getBoundingClientRect().height ?? 0
    const own = this.getBoundingClientRect().height
    const root = document.documentElement

    root.style.setProperty('--nav-h', `${nav}px`)
    root.style.setProperty('--sticky-top', `${nav + own}px`)
  }
}
