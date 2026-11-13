/**
 * DataTable: sets the column tracks the macro wrote in `data-cols` (CSSOM, which a strict content security
 * policy allows), and the narrow-screen tracks; marks the first cell of each row sticky with `data-sticky`;
 * runs row selection with `data-selectable` (the header box selects every row, shows a dash when some are,
 * rows tint, the BulkActionBar shows "N selected" and Clear selection); and gives a first-column link that is
 * cut short its whole text as a title on hover. `au-selection` reports the selected row ids.
 */
export class AuDataTable extends HTMLElement {
  connectedCallback() {
    const scroll = this.querySelector<HTMLElement>('.au-table-scroll')
    if (!scroll) return
    const cols = this.dataset.cols
    if (cols) {
      scroll.style.setProperty('--au-cols', cols)
      const narrow = cols.split(/\s+(?![^(]*\))/).map((t) => (/^var\(--size-column-(check|chevron)\)$/.test(t) ? t : 'auto')).join(' ')
      scroll.style.setProperty('--au-cols-narrow', narrow)
    }
    if (this.hasAttribute('data-sticky')) {
      for (const row of scroll.querySelectorAll('tbody .au-tr')) {
        const cells = [...row.children].filter((c) => !c.classList.contains('au-cell-check'))
        cells[0]?.classList.add('au-sticky-col')
        if (this.hasAttribute('data-selectable')) cells[0]?.classList.add('au-sticky-after-check')
        row.querySelector('.au-cell-check')?.classList.add('au-sticky-col')
      }
    }
    this.addEventListener('mouseover', (event) => {
      const link = (event.target as Element).closest<HTMLElement>('.au-rowlink')
      if (!link) return
      if (link.scrollWidth > link.clientWidth + 1) link.title ||= link.textContent?.trim() ?? ''
    })
    if (this.hasAttribute('data-selectable')) this.#selection()
  }

  #selection() {
    const all = this.querySelector<HTMLInputElement>('input[data-au-all]')
    const rows = () => [...this.querySelectorAll<HTMLInputElement>('input[data-au-row]')]
    const bar = this.querySelector<HTMLElement>('.au-bulkbar')
    const sync = () => {
      const boxes = rows()
      const on = boxes.filter((b) => b.checked)
      for (const b of boxes) {
        const tr = b.closest('tr')
        tr?.classList.toggle('is-selected', b.checked)
        tr?.setAttribute('aria-selected', String(b.checked))
      }
      if (all) {
        all.checked = boxes.length > 0 && on.length === boxes.length
        all.indeterminate = on.length > 0 && on.length < boxes.length
        all.disabled = boxes.length === 0
        const tick = all.parentElement?.querySelector('svg')
        if (tick) tick.style.display = ''
      }
      if (bar) {
        bar.hidden = on.length === 0
        const text = `${on.length} selected`
        bar.setAttribute('aria-label', text)
        const count = bar.querySelector('.au-bulkbar-count')
        if (count) count.textContent = text
      }
      this.dispatchEvent(new CustomEvent('au-selection', { detail: { ids: on.map((b) => b.value) }, bubbles: true }))
    }
    this.addEventListener('change', (event) => {
      const t = event.target as HTMLInputElement
      if (t === all) for (const b of rows()) b.checked = all.checked
      if (t === all || t.hasAttribute('data-au-row')) sync()
    })
    bar?.querySelector('[data-au-clear]')?.addEventListener('click', () => {
      for (const b of rows()) b.checked = false
      sync()
    })
    sync()
  }
}
