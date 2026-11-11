import { CalendarView } from '../../../core/calendar.ts'

/**
 * Calendar: the server draws a native date input (it works without a script); this draws the calendar in its
 * place — a month grid with the month/year switcher and its keys. A pick sets the input (now hidden; `change`
 * fires on it) and fires `au-change` (detail `{ value }`) on the element. `data-range-start`/`data-range-end`
 * show a range.
 */
export class AuCalendar extends HTMLElement {
  connectedCallback() {
    const input = this.querySelector<HTMLInputElement>('input[type="date"]')
    if (!input || this.querySelector('.au-calendar:not([data-au-ssr])')) return
    // The server drew this control as it will look (data-au-ssr); it's replaced by the same markup in this task, so nothing moves.
    for (const ssr of this.querySelectorAll(':scope > [data-au-ssr]')) ssr.remove()
    const view = new CalendarView(this, {
      value: input.value || null,
      rangeStart: this.dataset.rangeStart || null,
      rangeEnd: this.dataset.rangeEnd || null,
      min: input.min || null,
      max: input.max || null,
      onSelect: (s) => {
        input.value = s
        view.update({ value: s })
        input.dispatchEvent(new Event('change', { bubbles: true }))
        this.dispatchEvent(new CustomEvent('au-change', { bubbles: true, detail: { value: s } }))
      }
    })
    input.type = 'hidden'
    input.closest('.au-input')?.replaceWith(input)
    input.removeAttribute('data-au-native')
    this.prepend(view.element)
  }
}
