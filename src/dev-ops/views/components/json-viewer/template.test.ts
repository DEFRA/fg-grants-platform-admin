import { render } from '../../../test-utils.ts'
import { toJsonView } from '../../../view-models/json-viewer.view-model.ts'

const viewer = (value: unknown, label = 'Payload') =>
  render('json-viewer', {
    view: toJsonView(value),
    label,
    testId: 'payload'
  })

describe('json-viewer component', () => {
  test('nests a details for each object or array that spans lines', () => {
    const $ = viewer({ a: { b: [1, 2] }, c: [] })

    expect($('[data-testid="payload"] > details')).toHaveLength(1)
    expect($('details details details')).toHaveLength(1)
    expect($('details')).toHaveLength(3)
  })

  test('puts the opening line in the summary, so a click on it folds the node', () => {
    const $ = viewer({ a: { b: 1 } })
    const summary = $('details details > summary')

    expect(summary.find('[data-testid="payload-line"] code').text()).toBe(
      '  "a": {'
    )
    expect(summary.find('[data-line]').attr('data-line')).toBe('2')
  })

  test('says what a folded node holds, and closes it, on the summary line', () => {
    const $ = viewer({ a: Array.from({ length: 13 }, (_, i) => i), b: 1 })
    const fold = $('details details')

    expect(fold.attr('open')).toBeUndefined()
    expect(
      fold
        .children('summary')
        .find('[data-testid="payload-folded"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    ).toBe('13 items ],')
  })

  test('makes each fold at least 24px high, a target big enough to hit', () => {
    const $ = viewer({ a: { b: 1 } })

    expect($('summary').first().attr('class')?.split(' ')).toContain('min-h-6')
  })

  test('keeps numbers out of the selectable text', () => {
    const $ = viewer({ a: 1 })
    const number = $('[data-testid="payload-line"] [data-line]').first()

    expect(number.text()).toBe('')
    expect(number.attr('aria-hidden')).toBe('true')
    expect(number.attr('class')).toContain('before:content-[attr(data-line)]')
  })

  test('is a named region a keyboard can reach', () => {
    const region = viewer(
      { a: 1 },
      'Payload before the first edit'
    )('[data-testid="payload"]')

    expect(region.attr('role')).toBe('region')
    expect(region.attr('tabindex')).toBe('0')
    expect(region.attr('aria-label')).toBe('Payload before the first edit')
  })

  test('draws markup in a key or a value as text', () => {
    const $ = viewer({ '<b>key</b>': '<script>alert(1)</script>' })

    expect($('script')).toHaveLength(0)
    expect($('b')).toHaveLength(0)
    expect($('[data-testid="payload-line"] code').eq(1).text()).toBe(
      '  "<b>key</b>": "<script>alert(1)</script>"'
    )
  })

  test('hides Copy until script shows it, and names what it copies', () => {
    const $ = viewer({ a: 1 })
    const copy = $('[data-testid="payload-copy"]')

    expect(copy.parent().attr('hidden')).toBeDefined()
    expect(copy.text()).toBe('Copy payload')
  })
})
