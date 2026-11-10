/**
 * The × on an Alert, a Banner or a Toast: removes the closest `[data-au-dismissable]`
 * (or `.au-toast`) when its button is pressed, and moves focus somewhere sensible.
 */
export class AuDismiss extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('button')) return
      const target = this.closest<HTMLElement>('[data-au-dismissable], .au-toast')
      if (!target) return
      const next = target.nextElementSibling as HTMLElement | null
      target.remove()
      this.dispatchEvent(new CustomEvent('au-dismiss', { bubbles: true }))
      if (next && next.tabIndex >= 0) next.focus({ preventScroll: true })
    })
  }
}
