/**
 * Accordion: without a script each item is a `<details>`; with one, every item becomes
 * a heading holding a `button.au-accordion-trigger` (aria-expanded / aria-controls) and a labelled `region`
 * panel — and `data-single` keeps one item open at a time.
 */
let count = 0

export class AuAccordion extends HTMLElement {
  connectedCallback() {
    const level = this.dataset.headingLevel ?? '3'
    const single = this.hasAttribute('data-single')
    const items: { item: HTMLElement; button: HTMLButtonElement; panel: HTMLElement }[] = []
    for (const details of this.querySelectorAll<HTMLDetailsElement>('details.au-accordion-item')) {
      const n = ++count
      const summary = details.querySelector(':scope > summary')!
      const panel = details.querySelector<HTMLElement>(':scope > .au-accordion-panel')!
      const item = document.createElement('div')
      item.className = details.className
      for (const a of details.getAttributeNames()) if (a !== 'class' && a !== 'open') item.setAttribute(a, details.getAttribute(a)!)
      const heading = document.createElement('h' + level)
      heading.className = 'au-accordion-heading'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'au-accordion-trigger'
      button.id = `au-acc-${n}-h`
      if (summary.hasAttribute('data-testid')) button.setAttribute('data-testid', summary.getAttribute('data-testid')!)
      if (details.hasAttribute('data-disabled')) button.disabled = true
      button.append(...summary.childNodes)
      button.querySelector('svg')?.setAttribute('class', 'au-icon au-accordion-chevron')
      heading.append(button)
      panel.id = `au-acc-${n}-p`
      panel.setAttribute('role', 'region')
      panel.setAttribute('aria-labelledby', button.id)
      button.setAttribute('aria-controls', panel.id)
      item.append(heading, panel)
      details.replaceWith(item)
      items.push({ item, button, panel })
      const set = (open: boolean) => {
        button.setAttribute('aria-expanded', String(open))
        item.classList.toggle('is-open', open)
        panel.hidden = !open
      }
      set(details.open)
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true'
        if (open && single) for (const other of items) if (other.button !== button) { other.button.setAttribute('aria-expanded', 'false'); other.item.classList.remove('is-open'); other.panel.hidden = true }
        set(open)
      })
    }
  }
}
