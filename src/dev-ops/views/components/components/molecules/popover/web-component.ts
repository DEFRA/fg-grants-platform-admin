import { Popover } from '../../../core/popover.ts'

/**
 * Popover: the server draws a native popover (it opens and closes without a script). This places it
 * against the trigger in the top layer (flipped when there's no room), focus moved into it, closed by Escape, Tab
 * past either end and a press outside, with focus back on the trigger.
 */
export class AuPopover extends HTMLElement {
  connectedCallback() {
    const host = this.querySelector<HTMLElement>(':scope > .au-dropdown')
    const trigger = host?.querySelector<HTMLElement>(':scope > [popovertarget]')
    const native = host?.querySelector<HTMLElement>(':scope > [popover]')
    if (!host || !trigger || !native) return
    trigger.removeAttribute('popovertarget')
    native.remove()
    const content = [...native.childNodes]
    const pop = new Popover(host, trigger, {
      label: native.getAttribute('aria-label') ?? '',
      align: this.dataset.align === 'end' ? 'end' : 'start',
      padded: native.classList.contains('au-popover-padded'),
      build: (panel) => panel.append(...content)
    })
    for (const c of native.classList) if (!['au-float', 'au-popover', 'au-popover-padded'].includes(c)) pop.panel.classList.add(c)
    if (native.dataset.testid) pop.panel.dataset.testid = native.dataset.testid
  }
}
