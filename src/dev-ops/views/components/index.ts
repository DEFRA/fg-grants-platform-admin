import { AuAccordion } from './components/molecules/accordion/web-component.ts'
import { AuCalendar } from './components/molecules/calendar/web-component.ts'
import { AuClearable } from './components/atoms/input/web-component.ts'
import { AuCopy } from './components/molecules/copy-button/web-component.ts'
import { AuDataTable } from './components/organisms/data-table/web-component.ts'
import { AuDateRangeChip } from './components/molecules/date-range-chip/web-component.ts'
import { AuDialog } from './components/organisms/dialog/web-component.ts'
import { AuDisclosure } from './components/molecules/disclosure/web-component.ts'
import { AuDismiss } from './components/molecules/alert/web-component.ts'
import { AuDropdown } from './components/molecules/dropdown/web-component.ts'
import { AuErrorSummary } from './components/molecules/error-summary/web-component.ts'
import { AuListPage } from './components/templates/list-page/web-component.ts'
import { AuLoadMore } from './components/molecules/list-footer/web-component.ts'
import { AuPopover } from './components/molecules/popover/web-component.ts'
import { AuSearchKind } from './components/molecules/search-field/web-component.ts'
import { AuSegmented } from './components/molecules/segmented-control/web-component.ts'
import { AuStateMap } from './components/organisms/state-map/web-component.ts'
import { AuTabs } from './components/molecules/tabs/web-component.ts'
import { AuThemeToggle } from './components/molecules/theme-toggle/web-component.ts'
import { AuToastRegion } from './components/molecules/toast-region/web-component.ts'
import { AuToast } from './components/molecules/toast/web-component.ts'
import { AuTooltip } from './components/atoms/tooltip/web-component.ts'

/**
 * Design system's custom elements: the behaviour the Nunjucks components need a script for, so a server-rendered
 * page behaves fully. Every one enhances markup that already works without it. Import once per
 * page; defining twice is harmless.
 */
const elements: [string, CustomElementConstructor][] = [
  ['au-accordion', AuAccordion],
  ['au-calendar', AuCalendar],
  ['au-clearable', AuClearable],
  ['au-copy', AuCopy],
  ['au-data-table', AuDataTable],
  ['au-date-range-chip', AuDateRangeChip],
  ['au-dialog', AuDialog],
  ['au-disclosure', AuDisclosure],
  ['au-dismiss', AuDismiss],
  ['au-dropdown', AuDropdown],
  ['au-error-summary', AuErrorSummary],
  ['au-list-page', AuListPage],
  ['au-load-more', AuLoadMore],
  ['au-popover', AuPopover],
  ['au-search-kind', AuSearchKind],
  ['au-segmented', AuSegmented],
  ['au-state-map', AuStateMap],
  ['au-tabs', AuTabs],
  ['au-theme-toggle', AuThemeToggle],
  ['au-toast-region', AuToastRegion],
  ['au-toast', AuToast],
  ['au-tooltip', AuTooltip]
]

for (const [name, element] of elements) {
  if (!customElements.get(name)) customElements.define(name, element)
}

/**
 * Behaviour on plain markup, not worth an element of its own:
 * - checkboxes drawn half-ticked (`data-au-indeterminate`; HTML has no attribute for it);
 * - an Alert with `focusOnArrival` takes focus when the page loads (the answer to what you just did);
 * - a Field `count: { max }` follows its control as you type;
 * - a Button with `loadingOnSubmit` shows its spinner and goes off once its form submits;
 * - a Button with `disabledReason` does nothing when pressed.
 */
const upgrade = (root: ParentNode) => {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[data-au-indeterminate]')) input.indeterminate = true
  const arrived = root.querySelector<HTMLElement>('[data-focus-on-arrival]')
  if (arrived && root === document) {
    arrived.focus({ preventScroll: true })
    arrived.scrollIntoView?.({ block: 'nearest' })
  }
  for (const count of root.querySelectorAll<HTMLElement>('[data-au-count-for]')) {
    const control = document.getElementById(count.dataset.auCountFor ?? '') as HTMLInputElement | HTMLTextAreaElement | null
    if (control && 'value' in control) count.textContent = `${control.value.length} / ${count.dataset.max}`
  }
}

document.addEventListener('input', (event) => {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement
  if (!control.id || !('value' in control)) return
  for (const count of document.querySelectorAll<HTMLElement>(`[data-au-count-for="${CSS.escape(control.id)}"]`)) count.textContent = `${control.value.length} / ${count.dataset.max}`
})

document.addEventListener('submit', (event) => {
  const button = (event as SubmitEvent).submitter as HTMLButtonElement | null
  if (!button?.hasAttribute('data-au-loading-on-submit')) return
  // After the submit has gone (a later task), so the button's own name and value still go with the form.
  window.setTimeout(() => {
    if (event.defaultPrevented) return
    button.setAttribute('aria-busy', 'true')
    button.disabled = true
    const spinner = document.createElement('span')
    spinner.className = 'au-spinner au-spinner-sm'
    spinner.setAttribute('aria-hidden', 'true')
    spinner.dataset.auSubmitSpinner = ''
    // The spinner takes the start icon's place.
    const lead = button.firstElementChild
    if (lead?.matches('svg.au-icon')) {
      lead.setAttribute('hidden', '')
      lead.setAttribute('data-au-submit-hidden', '')
    }
    button.prepend(spinner)
  }, 0)
})

// Back to a page the browser kept (bfcache): the submit that set the button off never finished here.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-au-loading-on-submit][aria-busy="true"]')) {
    button.disabled = false
    button.removeAttribute('aria-busy')
    button.querySelector('[data-au-submit-spinner]')?.remove()
    button.querySelector('[data-au-submit-hidden]')?.removeAttribute('hidden')
  }
})

document.addEventListener('click', (event) => {
  if ((event.target as Element).closest?.('[data-au-off]')) event.preventDefault()
}, true)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgrade(document))
else upgrade(document)

export { AuAccordion, AuCalendar, AuClearable, AuCopy, AuDataTable, AuDateRangeChip, AuDialog, AuDisclosure, AuDismiss, AuDropdown, AuErrorSummary, AuListPage, AuLoadMore, AuPopover, AuSearchKind, AuSegmented, AuStateMap, AuTabs, AuThemeToggle, AuToastRegion, AuToast, AuTooltip }
