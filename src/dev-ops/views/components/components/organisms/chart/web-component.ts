import { chartModel, fmtNum, type ChartInput } from '../../../core/charts.ts'

const NS = 'http://www.w3.org/2000/svg'

/**
 * Chart: the server draws the whole chart for any width (percentages across, container queries for the x labels),
 * so nothing here redraws it or measures it. This adds the hover read-out: a crosshair and dots on a line chart,
 * the other bars dimmed on a bar chart, and a tip with every series' value at that x.
 */
export class AuChart extends HTMLElement {
  #data!: ChartInput & { title?: string; summary?: string }
  #area!: HTMLElement
  #hover: number | null = null

  connectedCallback() {
    const area = this.querySelector<HTMLElement>('.au-chart-area')
    if (!area || this.#area) return
    this.#area = area
    try {
      this.#data = JSON.parse(this.dataset.chart ?? '{}')
    } catch {
      return
    }
    const svg = area.querySelector<SVGSVGElement>('.au-chart-svg')
    if (!svg) return
    svg.addEventListener('mousemove', (e) => {
      const mdl = chartModel(this.#data)
      const r = svg.getBoundingClientRect()
      const f = (e.clientX - r.left) / r.width
      const i = mdl.bar ? Math.floor(f * mdl.n) : Math.round(f * (mdl.n - 1))
      const next = Math.max(0, Math.min(mdl.n - 1, i))
      if (next !== this.#hover) {
        this.#hover = next
        this.#show(svg)
      }
    })
    svg.addEventListener('mouseleave', () => {
      this.#hover = null
      this.#show(svg)
    })
  }

  #show(svg: SVGSVGElement) {
    const mdl = chartModel(this.#data)
    const hv = this.#hover
    svg.querySelector(':scope > .au-chart-hover')?.remove()
    this.#area.querySelector(':scope > .au-chart-tip')?.remove()
    for (const slot of svg.querySelectorAll<SVGSVGElement>(':scope > .au-chart-slot')) {
      for (const b of slot.querySelectorAll('.au-chart-bar')) b.classList.toggle('is-dim', hv != null && String(hv) !== slot.dataset.i)
    }
    if (hv == null) return
    const x = mdl.P(hv) + '%'
    if (!mdl.bar) {
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('class', 'au-chart-hover')
      mdl.series.forEach((s, si) => {
        const v = s.data[hv]
        if (v == null) return
        const c = document.createElementNS(NS, 'circle')
        for (const [k, val] of Object.entries({ cx: x, cy: String(mdl.Y(v)), r: '4', fill: `var(--chart-${si + 1})`, class: 'au-chart-dot' })) c.setAttribute(k, val)
        g.append(c)
      })
      const cross = document.createElementNS(NS, 'line')
      for (const [k, val] of Object.entries({ x1: x, x2: x, y1: String(mdl.m.t), y2: String(mdl.m.t + mdl.ih), class: 'au-chart-cross' })) cross.setAttribute(k, val)
      g.append(cross)
      svg.append(g)
    }
    const tip = document.createElement('div')
    tip.className = 'au-chart-tip'
    tip.style.left = x
    const head = document.createElement('div')
    head.className = 'au-chart-tip-x'
    head.textContent = mdl.xs[hv]
    tip.append(head)
    mdl.series.forEach((sr, si) => {
      const row = document.createElement('div')
      row.className = 'au-chart-tip-row'
      const key = document.createElement('span')
      key.className = `au-chart-key au-bg-chart-${si + 1}`
      const name = document.createElement('span')
      name.textContent = sr.name
      const val = document.createElement('strong')
      const v = sr.data[hv]
      val.textContent = v == null ? '—' : fmtNum(v)
      row.append(key, name, val)
      tip.append(row)
    })
    this.#area.append(tip)
  }
}
