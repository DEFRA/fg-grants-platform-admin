import { svg } from '../../../core/layer.ts'

/**
 * SearchField kind picker: the server draws a native <select> (it submits with the search, with or without a
 * script) and the scripted picker, a tertiary button and a menu of kinds; CSS shows one or the other by
 * `@media (scripting)`, so nothing swaps on load. This makes the menu work: choosing a kind updates the select, the button, the ticks and, when
 * the server left the placeholder to the kind (`data-placeholder`), the input's "Exact …" placeholder and label.
 */
export class AuSearchKind extends HTMLElement {
  connectedCallback() {
    const select = this.querySelector('select')
    const dropdown = this.querySelector<HTMLElement>('.au-dropdown')
    if (!select || !dropdown || this.dataset.auUp != null) return
    this.dataset.auUp = ''
    // CSS already shows the menu (`@media (scripting: enabled)`); this only covers browsers without that query.
    select.hidden = true
    dropdown.hidden = false
    dropdown.addEventListener('click', (event) => {
      const item = (event.target as Element).closest<HTMLElement>('[data-value]')
      if (!item) return
      this.choose(item.dataset.value ?? '')
      ;(dropdown as HTMLElement & { close?: (refocus?: boolean) => void }).close?.(true)
    })
  }

  choose(value: string) {
    const select = this.querySelector('select')!
    const option = [...select.options].find((o) => o.value === value)
    if (!option) return
    const changed = select.value !== value
    select.value = value
    const label = this.querySelector('.au-search-kind:not(select) > span')
    if (label) label.textContent = option.textContent
    for (const item of this.querySelectorAll<HTMLElement>('[data-value]')) {
      const on = item.dataset.value === value
      item.setAttribute('aria-checked', String(on))
      const tick = item.querySelector('.au-menuitem-tick')
      if (tick) tick.replaceChildren(...(on ? [svg(this, 'check', 14)].filter(Boolean) as Node[] : []))
    }
    if (this.hasAttribute('data-placeholder')) {
      const form = this.closest('form')
      const input = form?.querySelector<HTMLInputElement>('.au-input input')
      const text = `Exact ${(option.textContent ?? '').toLowerCase()}`
      if (input) {
        input.placeholder = text
        const for_ = input.id && form!.querySelector(`label[for="${CSS.escape(input.id)}"]`)
        if (for_) for_.textContent = text
      }
    }
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }))
  }
}
