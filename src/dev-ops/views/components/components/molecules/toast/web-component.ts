/**
 * A toast: goes by itself after `data-timeout` ms (6 seconds by default, and
 * never while it is hovered or holds focus), or when its close button is pressed.
 */
export class AuToast extends HTMLElement {
  #timer = 0

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  disconnectedCallback() {
    window.clearTimeout(this.#timer)
  }

  enhance() {
    this.querySelector('[data-au-dismiss]')?.addEventListener('click', () =>
      this.dismiss()
    )
    const timeout = Number(this.dataset.timeout ?? 6000)
    if (timeout > 0) {
      const start = () => {
        window.clearTimeout(this.#timer)
        this.#timer = window.setTimeout(() => this.dismiss(), timeout)
      }
      const stop = () => window.clearTimeout(this.#timer)
      this.addEventListener('pointerenter', stop)
      this.addEventListener('pointerleave', start)
      this.addEventListener('focusin', stop)
      this.addEventListener('focusout', start)
      start()
    }
  }

  dismiss() {
    window.clearTimeout(this.#timer)
    this.remove()
  }
}
