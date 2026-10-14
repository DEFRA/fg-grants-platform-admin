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
    ['one value', '900000002', 1],
    ['mixed line endings', '900000002\r\n900000003\r900000102\n', 3],
    ['blank padded lines', ' 900000002 \n \n\r\n900000003', 2],
    ['duplicate lines', '900000002\n900000002', 2]
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
    textarea.value = '900000002\n900000003'
    textarea.dispatchEvent(new Event('input'))

    expect(document.querySelector('#sbi-hint')?.textContent).toBe(
      'One per line. 2 listed.'
    )
  })

  test('ignores an input whose count target is absent', () => {
    render('900000002', 'missing')

    expect(() => initAllowListCounts()).not.toThrow()
  })
})
