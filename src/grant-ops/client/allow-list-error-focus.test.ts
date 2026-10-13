// @vitest-environment happy-dom
import { initAllowListErrorFocus } from './allow-list-error-focus.ts'

const render = (value = '106000033\n\ninvalid', line = 3) => {
  document.body.innerHTML = `
    <a href="#sbi" data-error-line="${line}">Invalid SBI</a>
    <textarea id="sbi" data-allow-list-input>${value}</textarea>
  `
}

describe('initAllowListErrorFocus', () => {
  beforeEach(() => {
    render()
  })

  test('moves the cursor to the error line when its summary link is clicked', () => {
    initAllowListErrorFocus()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!

    document.querySelector<HTMLAnchorElement>('a')!.click()

    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(11)
    expect(textarea.selectionEnd).toBe(11)
  })

  test('moves the cursor to the start of the first line', () => {
    render('invalid', 1)
    initAllowListErrorFocus()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!

    document.querySelector<HTMLAnchorElement>('a')!.click()

    expect(textarea.selectionStart).toBe(0)
  })

  test('does not add a live line indicator when the textarea is focused', () => {
    initAllowListErrorFocus()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!

    textarea.focus()

    expect(document.querySelector('.app-allow-list-line-number')).toBeNull()
  })
})
