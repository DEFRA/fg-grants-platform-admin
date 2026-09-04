// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { CopyButton } from './copy-button.element.ts'

const value = 'GLD-9B2-BWS-grasslands'

const writeText = vi.fn<(text: string) => Promise<void>>()

/** The clipboard is not there on an insecure origin, so it is injected. */
const givenClipboard = (clipboard: unknown) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true
  })
}

const mountButton = async () => {
  const body = await mount('copy-button', { value, what: 'reference' })

  return {
    element: body.querySelector('do-copy-button') as HTMLElement,
    button: body.querySelector('button') as HTMLButtonElement
  }
}

/** The click handler is async; two turns settle the write and its feedback. */
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('do-copy-button', () => {
  beforeEach(() => {
    // Only the timeout: faking queueMicrotask would stop the element
    // enhancing at all.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    writeText.mockResolvedValue(undefined)
    givenClipboard({ writeText })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('registers the custom element', async () => {
    await mountButton()

    expect(customElements.get('do-copy-button')).toBe(CopyButton)
  })

  test('enables the button the template ships disabled', async () => {
    const { button } = await mountButton()

    expect(button.disabled).toBe(false)
  })

  test('writes the value to the clipboard when it is clicked', async () => {
    const { button } = await mountButton()

    button.click()
    await settle()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(value)
  })

  test('shows the check for a moment, then goes back to the clipboard', async () => {
    const { element, button } = await mountButton()

    button.click()
    await settle()

    expect(element.dataset.copied).toBe('')

    vi.advanceTimersByTime(1500)

    expect(element.dataset.copied).toBeUndefined()
  })

  test('holds the check the full moment after a second copy', async () => {
    const { element, button } = await mountButton()

    button.click()
    await settle()
    vi.advanceTimersByTime(1000)
    button.click()
    await settle()
    vi.advanceTimersByTime(1000)

    expect(element.dataset.copied).toBe('')
  })

  // An insecure origin has no clipboard at all: the button stays visibly
  // inert rather than swallowing every click in silence.
  test('leaves the button disabled where there is no clipboard', async () => {
    givenClipboard(undefined)

    const { button } = await mountButton()

    expect(button.disabled).toBe(true)
    expect(writeText).toHaveBeenCalledTimes(0)
  })

  // A denied permission is not something a row can usefully report.
  test('says nothing when the clipboard refuses the write', async () => {
    writeText.mockRejectedValue(new Error('denied'))

    const { element, button } = await mountButton()

    button.click()
    await settle()

    expect(element.dataset.copied).toBeUndefined()
  })

  test('drops the timer when the row it sits in goes away', async () => {
    const { element, button } = await mountButton()

    button.click()
    await settle()
    element.remove()
    vi.advanceTimersByTime(1500)

    expect(element.dataset.copied).toBe('')
  })

  // An element with nothing to copy still has to survive being clicked.
  test('copies nothing when the element carries no value', async () => {
    const { element, button } = await mountButton()

    element.removeAttribute('value')
    button.click()
    await settle()

    expect(writeText).toHaveBeenCalledWith('')
  })

  test('upgrades without a button to enhance', async () => {
    await mountButton()
    document.body.innerHTML = '<do-copy-button></do-copy-button>'
    await Promise.resolve()

    expect(document.querySelector('do-copy-button')).toBeInstanceOf(CopyButton)
  })
})
