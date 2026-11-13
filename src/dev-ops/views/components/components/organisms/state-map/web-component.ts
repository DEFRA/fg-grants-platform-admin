/**
 * State map: the server draws each state as a button that submits `name=id`. This picks in place:
 * a press picks a state; ←/→ (↑/↓) move to the next state and pick it, Home/End to the first and last,
 * with one tab stop on the picked state. The pick goes in a hidden input of the name (`change` fires on it) and
 * `au-change` (detail `{ value }`) fires on the element.
 *
 * On a server-drawn page what the pick shows has to follow it. `data-submit`: a pick (a press, Enter, Space) sends
 * the form with `name=id`, so the server draws the page for that state; arrows move between states without picking.
 * `data-panels="<id>"`: that element holds one child per state, `[data-state="<id>"]`, and the pick shows its own.
 */
export class AuStateMap extends HTMLElement {
  connectedCallback() {
    const map = this.querySelector<HTMLElement>('.au-statemap')
    if (!map || map.dataset.auUp != null) return
    map.dataset.auUp = ''
    const states = [...map.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
    const live = states.filter((b) => !b.disabled)
    let hidden: HTMLInputElement | null = null
    if (this.dataset.name) {
      hidden = document.createElement('input')
      hidden.type = 'hidden'
      hidden.name = this.dataset.name
      const form = states[0]?.getAttribute('form')
      if (form) hidden.setAttribute('form', form)
      hidden.value = states.find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.value ?? ''
      this.append(hidden)
    }
    const submit = this.hasAttribute('data-submit')
    const panels = this.dataset.panels ? document.getElementById(this.dataset.panels) : null
    const show = (value: string) => {
      if (!panels) return
      for (const panel of panels.querySelectorAll<HTMLElement>(':scope > [data-state]')) panel.hidden = panel.dataset.state !== value
    }
    const send = (b: HTMLButtonElement) => {
      const form = hidden?.form ?? b.form
      if (form) form.requestSubmit()
    }
    const pick = (b: HTMLButtonElement) => {
      for (const x of states) {
        const on = x === b
        x.setAttribute('aria-checked', String(on))
        x.classList.toggle('is-selected', on)
        x.tabIndex = on ? 0 : -1
      }
      const value = b.dataset.value ?? ''
      if (hidden && hidden.value !== value) {
        hidden.value = value
        hidden.dispatchEvent(new Event('change', { bubbles: true }))
      }
      show(value)
      this.dispatchEvent(new CustomEvent('au-change', { bubbles: true, detail: { value } }))
    }
    for (const b of states) {
      b.type = 'button'
      b.removeAttribute('name')
      b.addEventListener('click', () => {
        pick(b)
        if (submit) send(b)
      })
      b.addEventListener('keydown', (e) => {
        const i = live.indexOf(b)
        const rtl = getComputedStyle(map).direction === 'rtl'
        const next = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        const prev = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
        let n: HTMLButtonElement | undefined
        if (next) n = live[(i + 1) % live.length]
        else if (prev) n = live[(i - 1 + live.length) % live.length]
        else if (e.key === 'Home') n = live[0]
        else if (e.key === 'End') n = live[live.length - 1]
        if (!n) return
        e.preventDefault()
        if (submit) {
          // Moving only: one tab stop follows focus; Enter or Space (a click) picks and sends.
          for (const x of states) x.tabIndex = x === n ? 0 : -1
        } else pick(n)
        n.focus()
      })
    }
  }
}
