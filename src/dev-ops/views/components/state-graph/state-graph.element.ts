const margin = 8

/**
 * Brings the selected status into view inside its own scroll box, only when
 * it is out of view and without moving the page. While the graph scrolls on,
 * the box fades at the edge it goes on past, and each stage's label stays at
 * the box's left edge for as long as its band is in view.
 */
export class StateGraph extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    for (const box of this.querySelectorAll<HTMLElement>(
      '[data-graph-scroll]'
    )) {
      this.#reveal(box)
      this.#follow(box)
      box.addEventListener('scroll', () => this.#follow(box), {
        passive: true
      })
    }
  }

  #reveal(box: HTMLElement) {
    const node = box.querySelector('[aria-current] rect')

    if (!node) {
      return
    }

    const left = Number(node.getAttribute('x')) - margin
    const right = left + Number(node.getAttribute('width')) + 2 * margin

    if (left < box.scrollLeft) {
      box.scrollLeft = left
    } else if (right > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = right - box.clientWidth
    }
  }

  #follow(box: HTMLElement) {
    box.toggleAttribute('data-fade-left', box.scrollLeft > 0)
    box.toggleAttribute(
      'data-fade-right',
      box.scrollLeft + box.clientWidth < box.scrollWidth - 1
    )

    for (const label of box.querySelectorAll('[data-band-label]')) {
      const start = Number(label.getAttribute('data-x'))
      const room = Number(label.getAttribute('data-room'))
      const shift = Math.min(Math.max(box.scrollLeft - start, 0), room)

      label.setAttribute('transform', `translate(${shift} 0)`)
    }
  }
}
