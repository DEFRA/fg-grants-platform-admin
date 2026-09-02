import { render } from '../../../test-utils.ts'

const previousHref = '/dev-ops/events?cursor=START&direction=backward'
const nextHref = '/dev-ops/events?cursor=END&direction=forward'

describe('pager component', () => {
  test('offers both links when there is a page either side', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-previous"]').attr('href')).toBe(
      previousHref
    )
    expect($pager('[data-testid="do-pager-next"]').attr('href')).toBe(nextHref)
  })

  // Both directions are always drawn. A footer that renders only the link it
  // has moves Next across the row the moment Previous appears, so the button
  // an operator is aiming at is somewhere else on the very next page.
  test('links only Next on the first page, and holds Previous in place', () => {
    const $pager = render('pager', { previousHref: null, nextHref })

    expect($pager('[data-testid="do-pager-previous"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager-previous-disabled"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager-next"]')).toHaveLength(1)
  })

  test('links only Previous on the last page, and holds Next in place', () => {
    const $pager = render('pager', { previousHref, nextHref: null })

    expect($pager('[data-testid="do-pager-next"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager-next-disabled"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager-previous"]')).toHaveLength(1)
  })

  // Same size, same place, no href: a direction there is no page in is
  // unavailable, not absent.
  test('mutes the direction there is no page in, as a span', () => {
    const $pager = render('pager', { count: 3 })

    const previous = $pager('[data-testid="do-pager-previous-disabled"]')
    const next = $pager('[data-testid="do-pager-next-disabled"]')

    expect(previous.is('span')).toBe(true)
    expect(next.is('span')).toBe(true)
    expect(previous.attr('href')).toBeUndefined()
    expect(next.attr('href')).toBeUndefined()
    expect(previous.text()).toBe('← Previous')
    expect(next.text()).toBe('Next →')
    expect(previous.attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium text-base-content/30'
    )
    expect(next.attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium text-base-content/30'
    )
  })

  test('renders nothing when there is neither a count nor a link', () => {
    const $pager = render('pager', { previousHref: null, nextHref: null })

    expect($pager('[data-testid="do-pager"]')).toHaveLength(0)
  })

  // The bar is the table's bottom edge as much as it is a control: without it
  // the last row falls off the card.
  test('counts the rows on the page', () => {
    const $pager = render('pager', { count: 24, previousHref, nextHref })

    expect($pager('[data-testid="do-pager-count"]').text()).toBe('24 events')
  })

  test('counts a single row in the singular', () => {
    const $pager = render('pager', { count: 1 })

    expect($pager('[data-testid="do-pager-count"]').text()).toBe('1 event')
  })

  // One fact, and only one: how many rows are on screen. How those rows are
  // drawn — how many of them fold into a group — belongs to the rollup strip
  // at the top of the card, and a footer that said it too was a second
  // summary of a page that has one.
  test('counts the rows and nothing else, whatever it is handed', () => {
    const $pager = render('pager', { count: 20, groupCount: 4 })

    expect($pager('[data-testid="do-pager-count"]').text()).toBe('20 events')
  })

  test('draws the bar for a single page that has no links at all', () => {
    const $pager = render('pager', {
      count: 3,
      previousHref: null,
      nextHref: null
    })

    expect($pager('[data-testid="do-pager"]')).toHaveLength(1)
    expect($pager('[data-testid="do-pager"] a')).toHaveLength(0)
    expect($pager('[data-testid="do-pager"] span')).toHaveLength(3)
    expect($pager('[data-testid="do-pager-links"] > *')).toHaveLength(2)
  })

  // The footer says how much of the stream is on screen and nothing else. The
  // caveat about the read replica qualifies the counts, so it lives in the
  // rollup strip beside them — and a note dropped between Previous and the
  // count split the one control the footer has into two halves of a row.
  test('carries no note, whatever it is handed', () => {
    const $pager = render('pager', {
      count: 3,
      note: 'Read from a secondary — may lag a few seconds',
      noteTitle: 'Data may be a few seconds behind (read from a secondary).'
    })

    expect($pager('[data-testid="do-pager-note"]')).toHaveLength(0)
    expect($pager('[data-testid="do-pager"]').text()).not.toContain('secondary')
  })

  // One cluster, hard right: Previous and Next are one control with two
  // directions, and nothing at all floats between them and the count.
  test('holds both directions in one cluster on the right', () => {
    const $pager = render('pager', { count: 24, previousHref, nextHref })

    const links = $pager('[data-testid="do-pager-links"]')

    expect(links.attr('class')).toBe('ml-auto flex items-center gap-2')
    expect(links.children()).toHaveLength(2)
    expect(links.children().first().attr('data-testid')).toBe(
      'do-pager-previous'
    )
    expect(links.children().last().attr('data-testid')).toBe('do-pager-next')
    expect(links.prev().attr('data-testid')).toBe('do-pager-count')
    expect(links.next()).toHaveLength(0)
  })

  test('renders the count quietly, on the left of the links', () => {
    const $pager = render('pager', { count: 24, previousHref, nextHref })

    const count = $pager('[data-testid="do-pager-count"]')

    expect(count.attr('class')).toContain('text-base-content/55')
    expect(count.prevAll()).toHaveLength(0)
    expect(count.nextAll()).toHaveLength(1)
  })

  test('omits the count when it is not given one', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-count"]')).toHaveLength(0)
  })

  test('names the navigation for assistive technology', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager"]').attr('aria-label')).toBe(
      'Pagination'
    )
    expect($pager('[data-testid="do-pager-previous"]').attr('rel')).toBe('prev')
    expect($pager('[data-testid="do-pager-next"]').attr('rel')).toBe('next')
  })

  test('labels the links with the direction they travel', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-previous"]').text()).toBe(
      '← Previous'
    )
    expect($pager('[data-testid="do-pager-next"]').text()).toBe('Next →')
  })

  // Extra small, like the filter chips: the row is the table's last line, not
  // a control panel under it, so it keeps the height of the rows above it.
  test('renders both links as quiet extra small buttons', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager-previous"]').attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium'
    )
    expect($pager('[data-testid="do-pager-next"]').attr('class')).toBe(
      'btn btn-xs btn-ghost font-medium'
    )
    expect(
      $pager('[data-testid="do-pager-previous"]').attr('class')
    ).not.toContain('font-semibold')
  })

  test('sits under a hairline inside the card it belongs to', () => {
    const $pager = render('pager', { previousHref, nextHref })

    expect($pager('[data-testid="do-pager"]').attr('class')).toContain(
      'border-t border-base-300'
    )
  })

  // Previous, Next and the count are no use to an operator who has to scroll a
  // twenty-row page to reach them, so the bar rides the bottom of the scroll
  // box — opaque, because the rows travel under it.
  test('sticks to the bottom of the box it scrolls in', () => {
    const $pager = render('pager', { count: 20, previousHref, nextHref })

    const pager = $pager('[data-testid="do-pager"]')

    expect(pager.hasClass('do-pager-sticky')).toBe(true)
    expect(pager.hasClass('bg-base-100')).toBe(true)
  })

  // `ml-auto` is on the cluster, once, not on each direction: a page with no
  // Previous still finds Next in exactly the place the last page left it.
  test('keeps the cluster hard right on a page with no Previous', () => {
    const $pager = render('pager', { previousHref: null, nextHref })

    expect($pager('[data-testid="do-pager-links"]').attr('class')).toContain(
      'ml-auto'
    )
    expect($pager('[data-testid="do-pager-next"]').attr('class')).not.toContain(
      'ml-auto'
    )
  })

  test('keeps the whole query string of the href it is given', () => {
    const href =
      '/dev-ops/events?cursor=END&direction=forward&status=DEAD_LETTER'

    const $pager = render('pager', { previousHref: null, nextHref: href })

    expect($pager('[data-testid="do-pager-next"]').attr('href')).toBe(href)
  })
})
