// @vitest-environment happy-dom
import { initAllowListCounts } from './allow-list-count.ts'

const render = (value = '', target = 'sbi-hint') => {
  document.body.innerHTML = `
    <textarea data-allow-list-input data-count-target="${target}">${value}</textarea>
    <div id="sbi-hint">Server count</div>
  `
}

describe('initAllowListCounts', () => {
  beforeEach(() => {
    render()
  })

  test('sets the initial zero count', () => {
    initAllowListCounts()

    expect(document.querySelector('#sbi-hint')?.textContent).toBe(
      'One per line. 0 listed.'
    )
  })

  test.each([
    ['one value', '106000033', 1],
    ['mixed line endings', '106000033\r\n106000044\r106000055\n', 3],
    ['blank padded lines', ' 106000033 \n \n\r\n106000044', 2],
    ['duplicate lines', '106000033\n106000033', 2]
  ])('counts %s', (_description, value, count) => {
    render(value)

    initAllowListCounts()

    expect(document.querySelector('#sbi-hint')?.textContent).toBe(
      `One per line. ${count} listed.`
    )
  })

  test('updates the count after input', () => {
    initAllowListCounts()
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '106000033\n106000044'
    textarea.dispatchEvent(new Event('input'))

    expect(document.querySelector('#sbi-hint')?.textContent).toBe(
      'One per line. 2 listed.'
    )
  })

  test('ignores an input whose count target is absent', () => {
    render('106000033', 'missing')

    expect(() => initAllowListCounts()).not.toThrow()
  })
})
