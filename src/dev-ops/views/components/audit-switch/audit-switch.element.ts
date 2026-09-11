/**
 * Enhances the audit-switch component: the "Show audit events" switch flips
 * the moment it is pressed, rather than when the next page arrives.
 *
 * The control is a plain link to the other state's url, so it works before
 * this element upgrades and with scripting off. What the element adds is the
 * flip itself: on an ordinary activation — a primary click, Enter, a tap — it
 * turns the toggle over and rewrites the link's hidden ", on"/", off", then
 * lets the link navigate as it would have anyway. No `preventDefault` and no
 * delay: the browser keeps painting this document until the next one commits,
 * so daisyUI's knob transition plays while the page loads.
 *
 * A modified or middle click opens the url somewhere else and leaves this page
 * as it is, so it must not flip this page's switch.
 *
 * The state the server rendered is kept on `data-checked`. A page restored
 * from the bfcache comes back with its DOM as the operator left it — including
 * the flip on the way out — so a restored page is put back to the state it
 * was rendered in, which is the state its url and its link's href are still
 * about.
 */
const modifiers = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const

/** A click the link will follow in this tab: the primary button, bare. */
const isPlainActivation = (event: MouseEvent): boolean =>
  [
    !event.defaultPrevented,
    event.button === 0,
    ...modifiers.map((key) => !event[key])
  ].every(Boolean)

export class AuditSwitch extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    // A parser can connect an already-defined element before its children
    // exist, so enhancement is deferred a microtask rather than reading
    // children here.
    queueMicrotask(() => this.enhance())
  }

  /** The three parts the markup draws, or null on markup it does not know. */
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

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        show(rendered)
      }
    })
  }
}
