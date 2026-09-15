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
