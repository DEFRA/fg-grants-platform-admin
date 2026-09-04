import { render } from '../../../test-utils.ts'

/**
 * The list is newest first, so the cursor walks it in time: `backward` from
 * the top of the page reaches what arrived after these rows, and `forward`
 * reaches what arrived before. The two hrefs are named for what they hold
 * rather than for the labels above them, because that is the fact the labels
 * are derived from.
 */
const previousHref = '/dev-ops/events?cursor=START&direction=backward'
const nextHref = '/dev-ops/events?cursor=END&direction=forward'

describe('pager component', () => {
  test('offers both links when there is a page either side', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-newer"]').attr('href')).toBe(
      previousHref
    )
    expect($pager('[data-testid="do-pager-older"]').attr('href')).toBe(nextHref)
  })

  // Both directions are always drawn. A footer that renders only the link it
  // has moves the other one across the row the moment the first appears, so
  // the button an operator is aiming at is somewhere else on the next page.
  test('links only Older on the newest page, and holds Newer in place', () => {
    const $pager = render('pager', { previousHref: null, nextHref })

    expect($pager('[data-testid="do-pager-newer"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager-newer-disabled"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager-older"]')).toHaveLength(1)
  })

  test('links only Newer on the oldest page, and holds Older in place', () => {
    const $pager = render('pager', { previousHref, nextHref: null })

    expect($pager('[data-testid="do-pager-older"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager-older-disabled"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager-newer"]')).toHaveLength(1)
  })

  // Same size, same place, no href: a direction there is no page in is
  // unavailable, not absent.
  test('mutes the direction there is no page in, as a span', () => {
    const $pager = render('pager', {})

    const newer = $pager('[data-testid="do-pager-newer-disabled"]')
    const older = $pager('[data-testid="do-pager-older-disabled"]')

    expect(newer.is('span')).toBe(true)
    expect(older.is('span')).toBe(true)
    expect(newer.attr('href')).toBeUndefined()
    expect(older.attr('href')).toBeUndefined()
    expect(newer.text()).toBe('← Newer')
    expect(older.text()).toBe('Older →')
    expect(newer.attr('class')).toBe('btn btn-xs join-item btn-disabled')
    expect(older.attr('class')).toBe('btn btn-xs join-item btn-disabled')
  })

  // The bar is the table's bottom edge as much as it is a control: without it
  // the last row falls off the card, so it is drawn even on a single page.
  test('draws the bar for a single page that has no links at all', () => {
    const $pager = render('pager', { previousHref: null, nextHref: null })

    expect($pager('[data-testid="do-pager"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager"] a')).toHaveLength(0)
    expect($pager('[data-testid="do-pager-links"] > *')).toHaveLength(2)
  })

  // The footer counts nothing. `20 events` under a page of twenty was a fact
  // about a window sitting in the smallest type on the card, under a toolbar
  // whose segments now carry the facts about the whole stream.
  test('counts nothing, whatever it is handed', () => {
    const $pager = render('pager', { count: 24, groupCount: 4, previousHref })

    expect($pager('[data-testid="do-pager-count"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager"]').text()).not.toContain('event')
    expect($pager('[data-testid="do-pager"]').text()).not.toContain('24')
  })

  // The footer says which way the two directions travel and nothing else: a
  // note dropped between them would split the one control it has into halves.
  test('carries no note, whatever it is handed', () => {
    const $pager = render('pager', { note: 'Something to say' })

    expect($pager('[data-testid="do-pager-note"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager"]').text()).not.toContain(
      'Something to say'
    )
  })

  // One cluster, centred under the table: the two directions are one control —
  // a `join`, which is daisyUI's own pagination — and nothing at all floats
  // beside them.
  test('holds both directions in one joined cluster', () => {
    const $pager = render('pager', { previousHref, nextHref })

    const links = $pager('[data-testid="do-pager-links"]')

    expect(links.attr('class')).toBe('join')
    expect(links.children()).toHaveLength(2)
    expect(links.children().first().attr('data-testid')).toBe('do-pager-newer')
    expect(links.children().last().attr('data-testid')).toBe('do-pager-older')
    expect(links.prevAll()).toHaveLength(0)
    expect(links.next()).toHaveLength(0)
  })

  test('names the navigation for assistive technology', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager"]').attr('aria-label')).toBe(
      'Pagination'
    )
    expect($pager('[data-testid="do-pager-newer"]').attr('rel')).toBe('prev')
    expect($pager('[data-testid="do-pager-older"]').attr('rel')).toBe('next')
  })

  // The list is newest first, so the backward cursor walks towards the events
  // that arrived after these and the forward one towards the ones before.
  // `Previous` on such a list points at whichever of the two the reader
  // guessed, which is the wrong thing for a control that moves a triage
  // window: the labels say time, and the `rel` still says page order.
  test('labels each link with the direction in time that it travels', () => {
    const $pager = render('pager', { previousHref, nextHref })

    const newer = $pager('[data-testid="do-pager-newer"]')
    const older = $pager('[data-testid="do-pager-older"]')

    expect(newer.text()).toBe('← Newer')
    expect(newer.attr('href')).toContain('direction=backward')
    expect(older.text()).toBe('Older →')
    expect(older.attr('href')).toContain('direction=forward')
    expect($pager('[data-testid="do-pager"]').text()).not.toContain('Previous')
    expect($pager('[data-testid="do-pager"]').text()).not.toContain('Next')
  })

  // Extra small joined buttons, which is daisyUI's documented pagination:
  // one control with two segments, and the quietest thing on the card.
  test('renders both directions as joined extra small buttons', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-newer"]').attr('class')).toBe(
      'btn btn-xs join-item'
    )
    expect($pager('[data-testid="do-pager-older"]').attr('class')).toBe(
      'btn btn-xs join-item'
    )
  })

  test('sits under a hairline inside the card it belongs to', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager"]').attr('class')).toContain(
      'border-t border-base-300'
    )
  })

  // The directions are no use to an operator who has to scroll a twenty-row
  // page to reach them. The bar sits below the table's scroll box rather than
  // inside it, and never gives up its height to the rows above.
  test('holds its height at the foot of the card', () => {
    const $pager = render('pager', { previousHref, nextHref })

    const pager = $pager('[data-testid="do-pager"]')

    expect(pager.hasClass('shrink-0')).toBe(true)
    expect(pager.attr('class')).not.toContain('sticky')
  })

  // The cluster is one object however many directions have a page in them: a
  // page with no Newer still finds Older exactly where the last page left it.
  test('keeps the cluster in one place on a page with no Newer', () => {
    const $pager = render('pager', { previousHref: null, nextHref })

    const links = $pager('[data-testid="do-pager-links"]')

    expect(links.attr('class')).toBe('join')
    expect(links.children()).toHaveLength(2)
    expect(links.children().first().attr('data-testid')).toBe(
      'do-pager-newer-disabled'
    )
    expect(links.children().last().attr('data-testid')).toBe('do-pager-older')
  })

  test('keeps the whole query string of the href it is given', () => {
    const href =
      '/dev-ops/events?cursor=END&direction=forward&status=DEAD_LETTER'

    const $pager = render('pager', { previousHref: null, nextHref: href })

    expect($pager('[data-testid="do-pager-older"]').attr('href')).toBe(href)
  })
})
