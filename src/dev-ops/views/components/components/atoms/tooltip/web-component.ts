import { place } from '../../../core/floating.ts'

/**
 * A tooltip for whatever is inside: `<au-tooltip text="Copy event ID" side="top">…</au-tooltip>`.
 * Shows 300ms after the pointer arrives, at once on keyboard focus,
 * not on a click; Escape hides it. It lives in the top layer (a manual popover) and is the
 * trigger's description (`aria-describedby`).
 */
let count = 0

export class AuTooltip extends HTMLElement {
  #tip: HTMLElement | null = null
  #timer = 0

  connectedCallback() {
    const show = () => this.show()
    this.addEventListener('pointerenter', () => {
      window.clearTimeout(this.#timer)
      this.#timer = window.setTimeout(show, 300)
    })
    this.addEventListener('pointerleave', () => this.hide())
    this.addEventListener('pointerdown', () => this.hide())
    this.addEventListener('focusin', (event) => {
      const target = event.target as Element
      try {
        if (target.matches(':focus-visible')) show()
      } catch {
        show()
      }
    })
    this.addEventListener('focusout', () => this.hide())
  }

  disconnectedCallback() {
    this.hide()
  }

  get trigger(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.au-tooltip-trigger, button, a, [tabindex], input, select, textarea') ?? (this.firstElementChild as HTMLElement | null)
  }

  show() {
    window.clearTimeout(this.#timer)
    const text = this.getAttribute('text')
    const trigger = this.trigger
    if (!text || !trigger || this.#tip) return
    const tip = document.createElement('span')
    tip.className = 'au-tooltip au-float'
    tip.setAttribute('role', 'tooltip')
    tip.id = `au-tip-${++count}`
    tip.textContent = text
    if ('showPopover' in tip) tip.setAttribute('popover', 'manual')
    const host = this.closest('dialog[open]') ?? document.body
    host.appendChild(tip)
    try {
      tip.showPopover?.()
    } catch {}
    place(trigger, tip, { side: (this.getAttribute('side') as 'top' | 'bottom') ?? 'top', align: 'center', gap: 6 })
    // A trigger that already names its description (Tooltip focusable, a disabled button's reason) keeps it.
    if (!trigger.hasAttribute('aria-describedby')) {
      trigger.setAttribute('aria-describedby', tip.id)
      tip.dataset.described = ''
    }
    this.#tip = tip
    document.addEventListener('keydown', this.#onKey, true)
  }

  hide() {
    window.clearTimeout(this.#timer)
    document.removeEventListener('keydown', this.#onKey, true)
    if (!this.#tip) return
    if (this.#tip.dataset.described != null) this.trigger?.removeAttribute('aria-describedby')
    this.#tip.remove()
    this.#tip = null
  }

  #onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.hide()
  }
}
