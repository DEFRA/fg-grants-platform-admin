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
    expect(newer.attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium text-base-content/30'
    )
    expect(older.attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium text-base-content/30'
    )
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

  // One cluster, hard right: the two directions are one control, and nothing
  // at all floats to the left of them.
  test('holds both directions in one cluster on the right', () => {
    const $pager = render('pager', { previousHref, nextHref })

    const links = $pager('[data-testid="do-pager-links"]')

    expect(links.attr('class')).toBe('ml-auto flex items-center gap-2')
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

  // Extra small, like the filter segments: the row is the table's last line,
  // not a control panel under it, so it keeps the height of the rows above it.
  test('renders both links as quiet extra small buttons', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-newer"]').attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium'
    )
    expect($pager('[data-testid="do-pager-older"]').attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium'
    )
    expect(
      $pager('[data-testid="do-pager-newer"]').attr('class')
    ).not.toContain('font-semibold')
  })

  test('sits under a hairline inside the card it belongs to', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager"]').attr('class')).toContain(
      'border-t border-base-300'
    )
  })

  // The directions are no use to an operator who has to scroll a twenty-row
  // page to reach them, so the bar rides the bottom of the scroll box —
  // opaque, because the rows travel under it.
  test('sticks to the bottom of the box it scrolls in', () => {
    const $pager = render('pager', { previousHref, nextHref })

    const pager = $pager('[data-testid="do-pager"]')

    expect(pager.hasClass('do-pager-sticky')).toBe(true)
    expect(pager.hasClass('bg-base-100')).toBe(true)
  })

  // `ml-auto` is on the cluster, once, not on each direction: a page with no
  // Newer still finds Older in exactly the place the last page left it.
  test('keeps the cluster hard right on a page with no Newer', () => {
    const $pager = render('pager', { previousHref: null, nextHref })

    expect($pager('[data-testid="do-pager-links"]').attr('class')).toContain(
      'ml-auto'
    )
    expect(
      $pager('[data-testid="do-pager-older"]').attr('class')
    ).not.toContain('ml-auto')
  })

  test('keeps the whole query string of the href it is given', () => {
    const href =
      '/dev-ops/events?cursor=END&direction=forward&status=DEAD_LETTER'

    const $pager = render('pager', { previousHref: null, nextHref: href })

    expect($pager('[data-testid="do-pager-older"]').attr('href')).toBe(href)
  })
})
