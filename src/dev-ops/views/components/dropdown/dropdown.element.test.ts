// @vitest-environment happy-dom

import { Dropdown } from './dropdown.element.ts'

/**
 * The markup the events toolbar wraps: a summary that opens a panel, with a
 * link and a form inside it. Written here rather than rendered from a macro
 * because this element has no component of its own — it is a behaviour the
 * page wraps around a disclosure it already had.
 */
const givenDropdown = async () => {
  await import('../index.ts')

  document.body.innerHTML = `
    <do-dropdown>
      <details data-testid="range">
        <summary data-testid="button">Any time</summary>
        <div><a href="/dev-ops/events" data-testid="preset">Last 24h</a></div>
      </details>
    </do-dropdown>
    <button data-testid="elsewhere">Search</button>
  `

  await Promise.resolve()

  const at = <T extends HTMLElement>(id: string) =>
    document.querySelector(`[data-testid="${id}"]`) as T

  const details = at<HTMLDetailsElement>('range')
  details.open = true

  return {
    details,
    summary: at('button'),
    preset: at('preset'),
    elsewhere: at('elsewhere')
  }
}

const clickOn = (target: HTMLElement) => {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

const pressKey = (key: string) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('do-dropdown', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await givenDropdown()

    expect(customElements.get('do-dropdown')).toBe(Dropdown)
  })

  // The one behaviour a disclosure does not have and a menu is expected to.
  test('closes when the click lands outside it', async () => {
    const { details, elsewhere } = await givenDropdown()

    clickOn(elsewhere)

    expect(details.open).toBe(false)
  })

  test('stays open while the click is inside it', async () => {
    const { details, preset } = await givenDropdown()

    clickOn(preset)

    expect(details.open).toBe(true)
  })

  test('closes on Escape', async () => {
    const { details } = await givenDropdown()

    pressKey('Escape')

    expect(details.open).toBe(false)
  })

  test('leaves other keys alone', async () => {
    const { details } = await givenDropdown()

    pressKey('a')

    expect(details.open).toBe(true)
  })

  // Dismissing a panel the operator was inside puts the caret back on the
  // button it came out of, which is where a keyboard expects to resume.
  test('returns focus to the button when the panel had it', async () => {
    const { preset, summary } = await givenDropdown()

    preset.focus()
    pressKey('Escape')

    expect(document.activeElement).toBe(summary)
  })

  // ...and does not yank it back from wherever they had moved on to.
  test('leaves focus alone when the panel did not have it', async () => {
    const { elsewhere } = await givenDropdown()

    elsewhere.focus()
    clickOn(elsewhere)

    expect(document.activeElement).toBe(elsewhere)
  })

  test('does nothing to a panel that is already closed', async () => {
    const { details, elsewhere } = await givenDropdown()

    details.open = false
    clickOn(elsewhere)

    expect(details.open).toBe(false)
  })

  // A panel that leaves the page leaves no listeners on the document behind.
  test('stops listening once it is disconnected', async () => {
    const { details } = await givenDropdown()
    const element = document.querySelector('do-dropdown') as HTMLElement

    element.remove()
    document.body.append(details)
    details.open = true
    pressKey('Escape')

    expect(details.open).toBe(true)
  })
})
