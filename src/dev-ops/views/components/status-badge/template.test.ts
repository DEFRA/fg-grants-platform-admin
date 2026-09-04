import { render } from '../../../test-utils.ts'

const badge = (params: object) =>
  render('status-badge', params)('[data-testid="do-status-badge"]')

describe('status-badge component', () => {
  // The wire shouts its statuses; the page says them. The raw value is still
  // one hover away, which is where a log query or a `?status=` needs it.
  test('shows the label it is given and hangs the raw status off the title', () => {
    const $badge = badge({
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error'
    })

    expect($badge.text()).toBe('Dead letter')
    expect($badge.attr('title')).toBe('DEAD_LETTER')
  })

  const dotClass = (params: object) =>
    render(
      'status-badge',
      params
    )('[data-testid="do-status-dot"]').attr('class')

  const labelClass = (params: object) =>
    render(
      'status-badge',
      params
    )('[data-testid="do-status-label"]').attr('class')

  // One anatomy for every status: a dot and a word, at the same x. The dot is
  // where the colour lives, so the column can be read down its left edge
  // whatever each row happens to say.
  test('draws every status as a dot and a label, in that order', () => {
    const $badge = badge({
      status: 'PROCESSING',
      label: 'Processing',
      role: 'info'
    })

    expect($badge.children()).toHaveLength(2)
    expect($badge.children().first().attr('data-testid')).toBe('do-status-dot')
    expect($badge.children().last().attr('data-testid')).toBe('do-status-label')
    expect($badge.attr('class')).toContain('inline-flex')
  })

  // Published: queued and healthy, and the quietest dot on the page — which is
  // daisyUI's own unmodified `status`, drawn in the text colour held well back.
  test('dots the neutral role in the text colour, held well back', () => {
    expect(dotClass({ status: 'PUBLISHED', role: 'neutral' })).toBe('status')
  })

  test('dots the informational role', () => {
    expect(dotClass({ status: 'PROCESSING', role: 'info' })).toBe(
      'status status-info'
    )
  })

  test('dots the warning role', () => {
    expect(dotClass({ status: 'FAILED', role: 'warning' })).toBe(
      'status status-warning'
    )
  })

  test('dots the error role', () => {
    expect(dotClass({ status: 'DEAD_LETTER', role: 'error' })).toBe(
      'status status-error'
    )
  })

  // Completed is most of a healthy stream, so its dot is held back rather than
  // drawn at full strength — but it is still a dot, at the same x as the rest.
  test('dots the success role, and gives it the same anatomy as the others', () => {
    const $badge = badge({
      status: 'COMPLETED',
      label: 'Completed',
      role: 'success'
    })

    expect($badge.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-success'
    )
    expect($badge.text()).toBe('Completed')
    expect($badge.attr('title')).toBe('COMPLETED')
  })

  // Weight says which status is worth stopping on. Dead letter is the page's
  // subject and reads at full contrast; Completed recedes furthest.
  test('recedes the completed label and holds the dead letter one at full contrast', () => {
    expect(labelClass({ status: 'COMPLETED', role: 'success' })).toBe(
      'text-base-content/55'
    )
    expect(labelClass({ status: 'DEAD_LETTER', role: 'error' })).toBe(
      'font-medium'
    )
  })

  test('sets every other label at one muted weight', () => {
    expect(labelClass({ status: 'PUBLISHED', role: 'neutral' })).toBe(
      'text-base-content/80'
    )
    expect(labelClass({ status: 'PROCESSING', role: 'info' })).toBe(
      'text-base-content/80'
    )
    expect(labelClass({ status: 'FAILED', role: 'warning' })).toBe(
      'text-base-content/80'
    )
  })

  test('hides the dot from assistive technology, which reads the label', () => {
    expect(
      badge({ status: 'FAILED', role: 'warning' })
        .find('[data-testid="do-status-dot"]')
        .attr('aria-hidden')
    ).toBe('true')
  })

  // The pill was the loudest thing on a page where five of the six states are
  // healthy, and demoting one state out of it only left the column with two
  // anatomies. There is no pill of any kind left.
  test("carries no pill classes at all, daisyUI's or this app's own", () => {
    const html = render('status-badge', {
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error'
    }).html()

    expect(html).not.toContain('do-badge')
    expect(html).not.toContain('do-status-quiet')
    expect(html).not.toContain('badge-error')
    expect(html).not.toContain('uppercase')
  })

  // The other spelling, for the page about one event: there is no column to
  // line up there and one piece of state to say, so it is a soft badge.
  test('says the status as a soft badge when asked for one', () => {
    const $badge = badge({
      status: 'DEAD_LETTER',
      label: 'Dead letter',
      role: 'error',
      variant: 'badge'
    })

    expect($badge.attr('class')).toBe('badge badge-error badge-soft')
    expect($badge.attr('title')).toBe('DEAD_LETTER')
    expect($badge.text()).toBe('Dead letter')
    expect($badge.find('[data-testid="do-status-dot"]')).toHaveLength(0)
  })

  test.each([
    ['info', 'badge badge-info badge-soft'],
    ['warning', 'badge badge-warning badge-soft'],
    ['success', 'badge badge-success badge-soft'],
    ['neutral', 'badge badge-ghost'],
    ['chartreuse', 'badge badge-ghost']
  ])('badges the %s role as %s', (role, expected) => {
    expect(badge({ status: 'X', role, variant: 'badge' }).attr('class')).toBe(
      expected
    )
  })

  test('keeps the badge variant on the same testids', () => {
    const $badge = badge({
      status: 'FAILED',
      label: 'Failed',
      role: 'warning',
      retrying: true,
      variant: 'badge'
    })

    expect($badge).toHaveLength(1)
    expect($badge.find('[data-testid="do-status-label"]').text()).toBe(
      'Failed ↻'
    )
  })

  test('falls back to the quietest dot for a role it does not know', () => {
    expect(dotClass({ status: 'PUBLISHED', role: 'chartreuse' })).toBe('status')
    expect(labelClass({ status: 'PUBLISHED', role: 'chartreuse' })).toBe(
      'text-base-content/80'
    )
  })

  // Same testid, whatever the status: every assertion about "the status of
  // this row" points at exactly one element.
  test('keeps every status on one badge testid', () => {
    expect(badge({ status: 'COMPLETED', role: 'success' })).toHaveLength(1)
    expect(badge({ status: 'DEAD_LETTER', role: 'error' })).toHaveLength(1)
  })

  test('falls back to the quietest dot when no role is given', () => {
    expect(dotClass({ status: 'PUBLISHED' })).toBe('status')
  })

  test('trails a retrying status with the retry glyph', () => {
    expect(
      badge({
        status: 'FAILED',
        label: 'Failed',
        role: 'warning',
        retrying: true
      }).text()
    ).toBe('Failed ↻')
  })

  test('omits the retry glyph otherwise', () => {
    expect(
      badge({
        status: 'COMPLETED',
        label: 'Completed',
        role: 'success',
        retrying: false
      }).text()
    ).toBe('Completed')
  })

  test('carries no icon of its own', () => {
    expect(
      badge({
        status: 'FAILED',
        label: 'Failed',
        role: 'warning',
        retrying: true
      }).find('svg')
    ).toHaveLength(0)
  })

  // A status nobody has written a label for is shown as the endpoint spelled
  // it: an invented sentence case would hide the string worth grepping for.
  test('falls back to the raw status of one it has no label for', () => {
    expect(badge({ status: 'QUARANTINED', role: 'neutral' }).text()).toBe(
      'QUARANTINED'
    )
  })

  test('escapes a status containing markup', () => {
    const $badge = render('status-badge', {
      status: '<script>alert(1)</script>',
      role: 'neutral'
    })

    expect($badge('script')).toHaveLength(0)
  })
})
