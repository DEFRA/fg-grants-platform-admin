/**
 * Segmented control: the server draws the options as buttons that submit `name=value` (or as links). This keeps
 * button options in place: a press checks it, a hidden input of the name carries the
 * value (`change` fires on it, and `au-change` on the element). Links are left to navigate.
 */
export class AuSegmented extends HTMLElement {
  connectedCallback() {
    const group = this.querySelector<HTMLElement>('[role="radiogroup"]')
    const buttons = [...this.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
    if (!group || !buttons.length || group.dataset.auUp != null) return
    group.dataset.auUp = ''
    let hidden: HTMLInputElement | null = null
    const name = this.dataset.name
    if (name) {
      hidden = document.createElement('input')
      hidden.type = 'hidden'
      hidden.name = name
      const form = buttons[0].getAttribute('form')
      if (form) hidden.setAttribute('form', form)
      hidden.value = buttons.find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.value ?? ''
      this.append(hidden)
    }
    for (const b of buttons) {
      b.type = 'button'
      b.removeAttribute('name')
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-checked') === 'true') return
        for (const x of buttons) x.setAttribute('aria-checked', String(x === b))
        const value = b.dataset.value ?? ''
        if (hidden) {
          hidden.value = value
          hidden.dispatchEvent(new Event('change', { bubbles: true }))
        }
        this.dispatchEvent(new CustomEvent('au-change', { bubbles: true, detail: { value } }))
      })
    }
  }
}
