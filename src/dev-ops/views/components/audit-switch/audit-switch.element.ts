const hasModifier = (event: MouseEvent): boolean =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

const isPlainActivation = (event: MouseEvent): boolean =>
  !event.defaultPrevented && event.button === 0 && !hasModifier(event)

export class AuditSwitch extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  #parts() {
    const link = this.querySelector<HTMLAnchorElement>('a[href]')
    const toggle = this.querySelector<HTMLElement>('.toggle')
    const state = this.querySelector<HTMLElement>('[data-audit-switch-state]')

    return link && toggle && state ? { link, toggle, state } : null
  }

  enhance() {
    const parts = this.#enhanced ? null : this.#parts()

    if (!parts) {
      return
    }
    this.#enhanced = true

    const { link, toggle, state } = parts
    const rendered = this.dataset.checked === 'true'
    const show = (on: boolean) => {
      toggle.setAttribute('aria-checked', String(on))
      state.textContent = on ? ', on' : ', off'
    }

    link.addEventListener('click', (event) => {
      if (isPlainActivation(event)) {
        show(!rendered)
      }
    })

    // A bfcache restore returns the DOM as the operator left it: put the knob back.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        show(rendered)
      }
    })
  }
}
