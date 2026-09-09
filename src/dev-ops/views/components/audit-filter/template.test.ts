import { render } from '../../../test-utils.ts'

const excluded = {
  label: 'Exclude audit',
  excluded: true,
  includes: true,
  filters: [{ name: 'status', value: 'DEAD_LETTER' }],
  title: 'Audit records are hidden. Show them alongside the queue.'
}

const included = {
  ...excluded,
  excluded: false,
  includes: false,
  title: 'Audit records are shown. Hide them and leave the queue.'
}

describe('audit-filter component', () => {
  test('is a real checkbox in a real GET form', () => {
    const $control = render('audit-filter', { filter: excluded })

    const form = $control('[data-testid="events-audit-form"]')
    const checkbox = $control('[data-testid="events-filter-audit"]')

    expect(form.attr('method')).toBe('get')
    expect(form.attr('action')).toBe('/dev-ops/events')
    expect(checkbox.attr('type')).toBe('checkbox')
    expect(checkbox.attr('class')).toBe('checkbox checkbox-sm')
    // Stock daisyUI, and no authored selector under any of it.
    expect(
      $control('[data-testid="events-filter-audit-label"]').attr('class')
    ).toBe('label cursor-pointer text-sm text-base-content/70')
  })

  test('names the checkbox by wrapping it in its own label', () => {
    const $control = render('audit-filter', { filter: excluded })

    const label = $control('[data-testid="events-filter-audit-label"]')

    expect(label.is('label')).toBe(true)
    expect(label.find('[data-testid="events-filter-audit"]')).toHaveLength(1)
    expect(label.text().trim()).toBe('Exclude audit')
    expect(label.attr('title')).toContain('hidden')
  })

  // The tick is the state, and the state is the default: a page nobody has
  // touched is a page with the audit records left out.
  test('is ticked while the records are being left out', () => {
    expect(
      render('audit-filter', { filter: excluded })(
        '[data-testid="events-filter-audit"]'
      ).attr('checked')
    ).toBeDefined()
  })

  test('is empty while the records are in the page', () => {
    expect(
      render('audit-filter', { filter: included })(
        '[data-testid="events-filter-audit"]'
      ).attr('checked')
    ).toBeUndefined()
  })

  // The checkbox carries no name at all: it is on when the parameter is
  // absent, which is precisely what a checkbox cannot submit. The button
  // carries the flip instead.
  test('leaves the parameter to the submit button', () => {
    const $control = render('audit-filter', { filter: excluded })

    const apply = $control('[data-testid="events-filter-audit-apply"]')

    expect(
      $control('[data-testid="events-filter-audit"]').attr('name')
    ).toBeUndefined()
    expect(apply.attr('type')).toBe('submit')
    expect(apply.attr('name')).toBe('audit')
    expect(apply.attr('value')).toBe('include')
    expect(apply.text().trim()).toBe('Apply')
  })

  // From the included state the flip is back to the default, and the default
  // is the url with no parameter on it.
  test('sends nothing of its own from the state that already includes them', () => {
    const apply = render('audit-filter', { filter: included })(
      '[data-testid="events-filter-audit-apply"]'
    )

    expect(apply.attr('name')).toBeUndefined()
    expect(apply.attr('value')).toBeUndefined()
  })

  // A form submits its own controls and nothing else, so every other filter
  // rides along — and its own parameter deliberately does not.
  test('restates the filters it was given as hidden fields', () => {
    const $control = render('audit-filter', {
      filter: {
        ...excluded,
        filters: [
          { name: 'status', value: 'DEAD_LETTER' },
          { name: 'q', value: 'gld-9b2' }
        ]
      }
    })

    const fields = $control('[data-testid="events-filter-audit-field"]')

    expect(fields).toHaveLength(2)
    expect(
      fields.toArray().map((field) => $control(field).attr('name'))
    ).toEqual(['status', 'q'])
    expect(fields.first().attr('type')).toBe('hidden')
    expect(fields.first().attr('value')).toBe('DEAD_LETTER')
  })

  // Apply ships visible: it is the whole control on a page whose script never
  // arrives, and the element is what takes it away.
  test('ships the apply button visible, for the page without script', () => {
    const apply = render('audit-filter', { filter: excluded })(
      '[data-testid="events-filter-audit-apply"]'
    )

    expect(apply.attr('hidden')).toBeUndefined()
    expect(apply.attr('class')).toBe('btn btn-sm')
  })
})
