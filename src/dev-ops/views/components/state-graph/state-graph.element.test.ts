// @vitest-environment happy-dom
import { StateGraph } from './state-graph.element.ts'

const box = (scrollWidth: number, clientWidth: number, nodeX = 900) => {
  document.body.innerHTML = `<do-state-graph><div data-graph-scroll><svg><g data-band-label data-x="100" data-room="500"></g><a aria-current="true"><rect x="${nodeX}" width="100"></rect></a></svg></div></do-state-graph>`
  const scroller = document.querySelector<HTMLElement>('[data-graph-scroll]')!

  Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(scroller, 'clientWidth', { value: clientWidth })

  return scroller
}

const enhance = () =>
  document.querySelector<StateGraph>('do-state-graph')!.enhance()

describe('state-graph element', () => {
  beforeAll(() => {
    if (!customElements.get('do-state-graph')) {
      customElements.define('do-state-graph', StateGraph)
    }
  })

  test('scrolls a selected status out of view just into view', () => {
    const scroller = box(2000, 400)

    enhance()

    expect(scroller.scrollLeft).toBe(608)
  })

  test('leaves a selected status already in view where it is', () => {
    const scroller = box(2000, 400, 100)

    enhance()

    expect(scroller.scrollLeft).toBe(0)
  })

  test('fades the edges it scrolls on past, and none once it fits', () => {
    const scroller = box(2000, 400)

    enhance()

    expect(scroller.hasAttribute('data-fade-right')).toBe(true)
    expect(scroller.hasAttribute('data-fade-left')).toBe(true)

    const fits = box(400, 400, 100)

    enhance()

    expect(fits.hasAttribute('data-fade-right')).toBe(false)
    expect(fits.hasAttribute('data-fade-left')).toBe(false)
  })

  test("keeps each stage's label at the box's left edge while its band is in view", () => {
    const scroller = box(2000, 400)

    enhance()

    expect(
      scroller.querySelector('[data-band-label]')!.getAttribute('transform')
    ).toBe('translate(500 0)')

    scroller.scrollLeft = 300
    scroller.dispatchEvent(new Event('scroll'))

    expect(
      scroller.querySelector('[data-band-label]')!.getAttribute('transform')
    ).toBe('translate(200 0)')
  })
})
