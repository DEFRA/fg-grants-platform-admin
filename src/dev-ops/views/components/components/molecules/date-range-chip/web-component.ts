import { CalendarView } from '../../../core/calendar.ts'
import { el } from '../../../core/dom.ts'
import { Popover } from '../../../core/popover.ts'

/**
 * Date range chip: a FilterChip for a list's time. Without a script the chip opens a popover of quick ranges
 * (links, or buttons that submit name=value) and, when the server gave the range's field names, a From/To form.
 * This turns it into the quick ranges as pressed buttons beside a range calendar: the first
 * day picked starts the range and the second ends it, then the From/To fields are filled and their form submitted
 * (or `au-change`, detail `{ start, end }` or `{ preset }`, fires on the element for a page to handle).
 */
export class AuDateRangeChip extends HTMLElement {
  connectedCallback() {
    const trigger = this.querySelector<HTMLButtonElement>(':scope > .au-dropdown > .au-chip')
    const native = this.querySelector<HTMLElement>(':scope > .au-dropdown > [popover]')
    if (!trigger || !native || this.dataset.auUp != null) return
    this.dataset.auUp = ''
    const label = native.getAttribute('aria-label') ?? ''
    const presetsFrom = [...native.querySelectorAll<HTMLElement>('.au-range-presets > *')]
    const startInput = native.querySelector<HTMLInputElement>('input[data-au-range="start"]')
    const endInput = native.querySelector<HTMLInputElement>('input[data-au-range="end"]')
    const hint = this.dataset.hint || ''
    const host = trigger.parentElement as HTMLElement
    const value = { start: startInput?.value || null, end: endInput?.value || null }
    // Keep the From/To fields, hidden, with their form: the popover's own GET form moves out of it, or they stay
    // tied to the page's form by their form attribute.
    let form: HTMLFormElement | null = startInput?.form ?? null
    for (const i of [startInput, endInput]) if (i) i.type = 'hidden'
    if (form && native.contains(form)) {
      form.hidden = true
      // The From/To fields sit inside their labels: keep them in the form before the labels go.
      for (const i of [startInput, endInput]) if (i) form.append(i)
      for (const x of form.querySelectorAll('button, .au-range-native-label')) x.remove()
      this.append(form)
    } else {
      for (const i of [startInput, endInput]) if (i) this.append(i)
      form = startInput?.form ?? null
    }
    native.remove()
    trigger.removeAttribute('popovertarget')

    let draft: { start: string | null; end: string | null } | null = null
    const finish = (detail: Record<string, unknown>, go: () => void) => {
      const ev = new CustomEvent('au-change', { bubbles: true, cancelable: true, detail })
      if (this.dispatchEvent(ev)) go()
    }
    new Popover(host, trigger, {
      label,
      onOpenChange: () => (draft = null),
      build: (panel, close) => {
        const presets = el('div', { className: 'au-range-presets', role: 'group', 'aria-label': 'Quick ranges' })
        for (const src of presetsFrom) {
          const on = src.getAttribute('aria-pressed') === 'true' || src.getAttribute('aria-current') === 'true'
          const btn = el('button', { type: 'button', className: `au-btn au-btn-${on ? 'secondary' : 'tertiary'} au-btn-sm`, 'aria-pressed': String(on) }, el('span', {}, src.textContent ?? ''))
          btn.addEventListener('click', () => {
            close()
            const href = src.getAttribute('href')
            const btnSrc = src as HTMLButtonElement
            finish({ preset: src.textContent }, () => {
              if (href) location.assign(href)
              else if (btnSrc.form) btnSrc.form.requestSubmit(btnSrc)
            })
          })
          presets.append(btn)
        }
        // No standing instruction (only a hint the page gives); after the first day, screen readers hear what's next.
        const hintEl = hint ? el('p', { className: 'au-range-hint' }, hint) : null
        const live = el('span', { 'aria-live': 'polite', className: 'au-vh' })
        const cur = () => draft ?? value
        const cal: CalendarView = new CalendarView(this, {
          rangeStart: cur().start,
          rangeEnd: cur().end,
          min: this.dataset.min,
          max: this.dataset.max,
          onSelect: (d) => {
            if (!draft || !draft.start || draft.end) {
              draft = { start: d, end: null }
              live.textContent = 'Now pick the last day.'
              cal.update({ rangeStart: d, rangeEnd: null })
              return
            }
            let [a, b] = [draft.start, d]
            if (b < a) [a, b] = [b, a]
            draft = null
            close()
            finish({ start: a, end: b }, () => {
              if (startInput) startInput.value = a
              if (endInput) endInput.value = b
              form?.requestSubmit()
            })
          }
        })
        panel.append(el('div', { className: 'au-range' }, presets, el('div', { className: 'au-range-cal' }, cal.element, hintEl, live)))
      }
    })
  }
}
