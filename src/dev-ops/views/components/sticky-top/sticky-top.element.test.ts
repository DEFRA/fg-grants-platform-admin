// @vitest-environment happy-dom

import { render } from '../../../test-utils.ts'
import { StickyTop } from './sticky-top.element.ts'

/** One ResizeObserver the element made, and a way to fire it. */
class FakeResizeObserver {
  static made: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false

  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.made.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }
}

const heights = new Map<string, number>()

/** Every box's height, by what it is: the bar, or the sticky block. */
const measured = function (this: HTMLElement) {
  const key = this.matches('header.navbar') ? 'navbar' : this.localName

  return { height: heights.get(key) ?? 0 } as DOMRect
}

const mountPage = async () => {
  await import('../index.ts')
  document.body.innerHTML = `<header class="navbar"></header>${render(
    'sticky-top',
    {},
    '<h1>Events</h1>'
  )('body').html()}`
  await Promise.resolve()

  return document.querySelector<StickyTop>('do-sticky-top')!
}

const property = (name: string) =>
  document.documentElement.style.getPropertyValue(name)

describe('do-sticky-top', () => {
  beforeEach(() => {
    FakeResizeObserver.made = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      measured
    )
    heights.set('navbar', 57).set('do-sticky-top', 184)
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('registers the custom element', async () => {
    await mountPage()

    expect(customElements.get('do-sticky-top')).toBe(StickyTop)
  })

  // Where the block sticks, and where the header row pins under it.
  test('measures the bar and the block onto the root', async () => {
    await mountPage()

    expect(property('--nav-h')).toBe('57px')
    expect(property('--sticky-top')).toBe('241px')
  })

  // Both move with wrapping and zoom, so both are watched.
  test('measures again when either box resizes', async () => {
    const block = await mountPage()
    const [observer] = FakeResizeObserver.made

    expect(observer.observed).toEqual([
      block,
      document.querySelector('header.navbar')
    ])

    heights.set('do-sticky-top', 232)
    observer.callback([], observer as unknown as ResizeObserver)

    expect(property('--sticky-top')).toBe('289px')
  })

  test('stops watching once it leaves the page', async () => {
    const block = await mountPage()

    block.remove()

    expect(FakeResizeObserver.made[0].disconnected).toBe(true)
  })

  // The template wraps what the page gives it, sticky only where there is
  // room, and opaque over the rows scrolling under it.
  test("wraps the page's own top, sticky only where there is room", async () => {
    const block = await mountPage()

    expect(block.querySelector('h1')?.textContent).toBe('Events')
    expect(block.classList).toContain(
      '[@media(min-width:64rem)_and_(min-height:40rem)]:sticky'
    )
    expect(block.classList).not.toContain('sticky')
    expect(block.classList).toContain('bg-base-200')
  })
})
