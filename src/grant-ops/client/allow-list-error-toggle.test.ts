// @vitest-environment happy-dom
import { initAllowListErrorFocus } from './allow-list-error-focus.ts'
import { initAllowListErrorToggle } from './allow-list-error-toggle.ts'

const render = (count: number) => {
  document.body.innerHTML = `
    <div id="allow-list-errors" data-allow-list-errors>
      <div class="govuk-error-summary__body">
        <ul class="govuk-error-summary__list">
          ${Array.from(
            { length: count },
            (_, index) => `
            <li><a href="#sbi" data-error-line="${index + 1}">Error on line ${index + 1}</a></li>
          `
          ).join('')}
        </ul>
      </div>
    </div>
    <textarea id="sbi">${Array.from({ length: count }, (_, index) => `bad-${index + 1}`).join('\n')}</textarea>
  `
}

const visibleErrors = () => document.querySelectorAll('li:not([hidden])')
const toggle = () => document.querySelector<HTMLButtonElement>('button')!

describe('initAllowListErrorToggle', () => {
  beforeEach(() => {
    render(11)
  })

  test.each([0, 1, 10])(
    'leaves %i errors visible without a toggle',
    (count) => {
      render(count)

      initAllowListErrorToggle()

      expect(visibleErrors()).toHaveLength(count)
      expect(document.querySelector('button')).toBeNull()
    }
  )

  test.each([11, 1000])('initially shows only 10 of %i errors', (count) => {
    render(count)

    initAllowListErrorToggle()

    expect(visibleErrors()).toHaveLength(10)
    expect(document.querySelectorAll('li')).toHaveLength(count)
    expect(toggle().textContent).toBe(`View all ${count} errors`)
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(
      document.getElementById(toggle().getAttribute('aria-controls')!)
    ).toBe(document.querySelector('ul'))
    expect(document.querySelector('p')?.textContent).toBe(
      `There are ${count} errors. Showing the first 10.`
    )
  })

  test('expands and collapses without submitting or moving keyboard focus', () => {
    initAllowListErrorToggle()
    toggle().focus()

    toggle().click()

    expect(visibleErrors()).toHaveLength(11)
    expect(toggle().textContent).toBe('Show fewer errors')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().type).toBe('button')
    expect(document.activeElement).toBe(toggle())
    expect(document.querySelector('p')?.textContent).toBe(
      'There are 11 errors. Showing all errors.'
    )

    toggle().click()

    expect(visibleErrors()).toHaveLength(10)
    expect(toggle().textContent).toBe('View all 11 errors')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle())
  })

  test('keeps revealed error links selecting the affected textarea line', () => {
    initAllowListErrorToggle()
    initAllowListErrorFocus()
    toggle().click()

    document
      .querySelector<HTMLAnchorElement>('a[data-error-line="11"]')!
      .click()

    const input = document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(document.activeElement).toBe(input)
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(
      'bad-11'
    )
  })

  test('starts a fresh failed submission collapsed with its new error count', () => {
    initAllowListErrorToggle()
    toggle().click()
    render(12)

    initAllowListErrorToggle()

    expect(visibleErrors()).toHaveLength(10)
    expect(toggle().textContent).toBe('View all 12 errors')
  })

  test('does nothing on pages without the allow-list error summary', () => {
    document.body.innerHTML =
      '<div class="govuk-error-summary"><ul><li>Error</li></ul></div>'

    initAllowListErrorToggle()

    expect(visibleErrors()).toHaveLength(1)
    expect(document.querySelector('button')).toBeNull()
  })
})
