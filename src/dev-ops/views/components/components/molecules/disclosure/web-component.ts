/**
 * Disclosure: without a script it's a `<details>`; with one it becomes a
 * `button.au-disclosure` (aria-expanded, the label switching between `data-show` and `data-hide`) followed by
 * its content, which takes no box of its own (display: contents), so it lays out in the row it sits in.
 */
let count = 0

export class AuDisclosure extends HTMLElement {
  connectedCallback() {
    const details = this.querySelector<HTMLDetailsElement>(':scope > details')
    if (!details) return
    const summary = details.querySelector(':scope > summary')!
    const panel = details.querySelector<HTMLElement>(':scope > .au-disclosure-panel')!
    const show = this.dataset.show ?? summary.textContent?.trim() ?? ''
    const hide = this.dataset.hide ?? show
    const chevron = summary.querySelector('svg')
    chevron?.setAttribute('class', 'au-icon au-chevron')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'au-disclosure'
    for (const name of ['data-testid', 'title']) {
      const v = summary.getAttribute(name)
      if (v) button.setAttribute(name, v)
    }
    const label = document.createElement('span')
    button.append(label)
    if (chevron) button.append(chevron)
    panel.id ||= `au-disclosure-${++count}`
    panel.classList.add('is-upgraded')
    button.setAttribute('aria-controls', panel.id)
    const set = (open: boolean) => {
      button.setAttribute('aria-expanded', String(open))
      label.textContent = open ? hide : show
      panel.hidden = !open
    }
    set(details.open)
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true'
      set(open)
      this.dispatchEvent(new CustomEvent('au-toggle', { detail: { open }, bubbles: true }))
    })
    details.replaceWith(button, panel)
  }
}
