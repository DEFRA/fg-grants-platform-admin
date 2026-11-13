/**
 * Error summary: the summary takes focus (and scrolls into view) when the page arrives with
 * it, so a screen reader reads what to fix first; a link in it focuses its field, centred, instead of only
 * jumping to it.
 */
export class AuErrorSummary extends HTMLElement {
  connectedCallback() {
    const box = this.querySelector<HTMLElement>('.au-errorsummary')
    if (!box || box.dataset.auSeen) return
    box.dataset.auSeen = ''
    queueMicrotask(() => {
      box.focus()
      box.scrollIntoView?.({ block: 'nearest' })
    })
    box.addEventListener('click', (event) => {
      const a = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      const field = a && document.getElementById(decodeURIComponent(a.hash.slice(1)))
      if (!field) return
      event.preventDefault()
      field.focus()
      field.scrollIntoView?.({ block: 'center' })
    })
  }
}
