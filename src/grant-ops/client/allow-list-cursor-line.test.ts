// @vitest-environment happy-dom
import { initAllowListCursorLines } from './allow-list-cursor-line.ts'

const render = (value = '') => {
  document.body.innerHTML = `<textarea data-allow-list-input>${value}</textarea>`
}

describe('initAllowListCursorLines', () => {
  beforeEach(() => {
    render()
  })

  test('shows the current physical line while the textarea has focus', () => {
    initAllowListCursorLines()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!

    textarea.focus()

    const lineNumber = document.querySelector<HTMLElement>(
      '.app-allow-list-line-number'
    )
    expect(lineNumber?.hidden).toBe(false)
    expect(lineNumber?.textContent).toBe('Line 1')
  })

  test('updates the current line when the cursor moves across blank lines', () => {
    render('106000033\n\ninvalid')
    initAllowListCursorLines()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)

    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }))

    expect(
      document.querySelector('.app-allow-list-line-number')?.textContent
    ).toBe('Line 3')
  })

  test('hides the current line when the textarea loses focus', () => {
    initAllowListCursorLines()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.focus()

    textarea.blur()

    expect(
      document.querySelector<HTMLElement>('.app-allow-list-line-number')?.hidden
    ).toBe(true)
  })
})
