// @vitest-environment happy-dom

import { render } from '../../../test-utils.ts'
import { LoadMore, loadedMessage } from './load-more.element.ts'

/** One IntersectionObserver the element made, and a way to fire it. */
class FakeObserver {
  static made: FakeObserver[] = []
  disconnected = false
  observed: Element[] = []
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.callback = callback
    this.options = options
    FakeObserver.made.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  disconnect() {
    this.disconnected = true
  }
}

/** The sentinel entering the observer's margin, as a scroll would do it. */
const intersect = () => {
  const observer = FakeObserver.made.at(-1)!

  observer.callback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver
  )
}

/** A list page as the server draws it: its rows, and its own next page. */
const pageOf = (ids: string[], next: string | null) =>
  `<table><tbody id="events-rows">${ids
    .map((id) => `<tr data-testid="event-row"><td>${id}</td></tr>`)
    .join('')}</tbody></table>${render('load-more', {
    nextHref: next,
    rows: 'events-rows'
  })('body').html()}`

/** The list's outage and refused-link states: 200s with no rows. */
const outagePage = `<div data-testid="events-card"><div role="alert" data-testid="events-error"><span>Events could not be loaded from GAS.</span></div></div>`
const refusedPage = `<div data-testid="events-card"><div role="alert" data-testid="events-refused"><span>GAS refused this link's parameters.</span></div></div>`
/** A page whose filter matched nothing: a genuine, empty end. */
const emptyPage = `<div data-testid="events-card"><p data-testid="events-empty">No events found.</p></div>`
/** A page that answered only in part, as the list draws it. */
const partialPage = (ids: string[], next: string | null) =>
  `<div role="alert" data-testid="events-partial"><span>Some event sources are unavailable: CW Inbox. Showing the rest.</span></div>${pageOf(ids, next)}`

/** A fetch answer the test settles itself. */
const answer = (html: string, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  text: async () => html
})

const fetchMock = vi.fn()

const mountList = async (next: string | null = '/dev-ops/events?cursor=A') => {
  await import('../index.ts')
  document.body.innerHTML = pageOf(['1'], next)
  await vi.advanceTimersByTimeAsync(0)

  const body = document.body
  const part = (testId: string) =>
    body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

  return {
    rows: () =>
      [...body.querySelectorAll('#events-rows > tr')].map((row) =>
        row.textContent?.trim()
      ),
    table: body.querySelector('table')!,
    sentinel: part('events-load-more-sentinel'),
    spinner: part('events-load-more-spinner'),
    end: part('events-load-more-end'),
    error: part('events-load-more-error'),
    retry: part('events-load-more-retry') as HTMLButtonElement,
    status: part('events-load-more-status')
  }
}

/** Far below the fold: a finished load does not ask again of its own. */
const farAway = (sentinel: HTMLElement) => {
  sentinel.getBoundingClientRect = () => ({ top: 100_000 }) as DOMRect
}

describe('do-load-more', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame']
    })
    FakeObserver.made = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('registers the custom element', async () => {
    await mountList()

    expect(customElements.get('do-load-more')).toBe(LoadMore)
  })

  // Well before the reader gets there: the margin is below the viewport.
  test('watches the sentinel with a margin below the viewport', async () => {
    const { sentinel } = await mountList()

    const [observer] = FakeObserver.made

    expect(observer.observed).toEqual([sentinel])
    expect(observer.options?.rootMargin).toBe('0px 0px 600px 0px')
  })

  test('fetches the next page, appends its rows, and takes its next page', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(
      answer(pageOf(['2', '3'], '/dev-ops/events?cursor=B'))
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledWith(
      '/dev-ops/events?cursor=A',
      expect.objectContaining({ credentials: 'same-origin' })
    )
    expect(list.rows()).toEqual(['1', '2', '3'])

    fetchMock.mockResolvedValueOnce(answer(pageOf(['4'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/dev-ops/events?cursor=B',
      expect.anything()
    )
    expect(list.rows()).toEqual(['1', '2', '3', '4'])
  })

  // The appended rows are the server's markup, so every row behaviour comes
  // with them.
  test('appends the rows whole, as the server drew them', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(
      document.querySelectorAll('#events-rows > [data-testid="event-row"]')
    ).toHaveLength(2)
  })

  test('never fetches twice at once', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    let settle: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    intersect()
    intersect()
    intersect()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Busy while it is on its way: a spinner, and the table says so.
    expect(list.spinner.hidden).toBe(false)
    expect(list.table.getAttribute('aria-busy')).toBe('true')

    settle(answer(pageOf(['2'], null)))
    await vi.advanceTimersByTimeAsync(0)

    expect(list.spinner.hidden).toBe(true)
    expect(list.table.getAttribute('aria-busy')).toBe('false')
  })

  test('stops at the end, and says so', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.end.hidden).toBe(false)
    expect(list.end.textContent).toBe('No more events')
    expect(FakeObserver.made[0].disconnected).toBe(true)

    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // The server already says it: a page with no next draws the end showing
  // and gives the element nothing to watch.
  test('watches nothing on a page that is already the last', async () => {
    const list = await mountList(null)

    expect(FakeObserver.made).toHaveLength(0)
    expect(list.end.hidden).toBe(false)
  })

  test('stops on a failure and offers Retry, which loads again', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer('', false))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.error.hidden).toBe(false)
    expect(list.error.textContent).toBe('More events could not be loaded.')
    expect(list.error.getAttribute('role')).toBe('alert')
    expect(list.retry.hidden).toBe(false)
    expect(list.spinner.hidden).toBe(true)
    expect(list.rows()).toEqual(['1'])

    // No more loading of its own while it has failed.
    intersect()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    list.retry.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(list.rows()).toEqual(['1', '2'])
    expect(list.error.hidden).toBe(true)
    expect(list.retry.hidden).toBe(true)
  })

  // The list draws its outage and its refused-link states as ordinary 200
  // pages with no rows and no loader. Read as pages, either would end the
  // list with nothing wrong shown; both are failures, with Retry.
  test.each([
    ['an outage page', outagePage],
    ['a refused page', refusedPage],
    ['a page it does not recognise', '<p>Something else</p>']
  ])(
    'fails, and offers Retry, on %s answered with a 200',
    async (_name, html) => {
      const list = await mountList()

      farAway(list.sentinel)
      fetchMock.mockResolvedValueOnce(answer(html))
      intersect()
      await vi.advanceTimersByTimeAsync(2000)

      expect(list.error.hidden).toBe(false)
      expect(list.retry.hidden).toBe(false)
      expect(list.end.hidden).toBe(true)
      expect(FakeObserver.made[0].disconnected).toBe(false)
      expect(list.rows()).toEqual(['1'])
      expect(list.status.textContent).toBe('')
    }
  )

  // A page whose filter matched nothing is a genuine end: no failure, and
  // nothing announced — never "0 more events loaded".
  test('ends quietly on a genuine empty page', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(answer(emptyPage))
    intersect()
    await vi.advanceTimersByTimeAsync(2000)

    expect(list.end.hidden).toBe(false)
    expect(list.error.hidden).toBe(true)
    expect(list.status.textContent).toBe('')
  })

  // The rows a partial page brought are appended, and the missing sources
  // are said under the list and in the announcement.
  test('appends a partial page and says which sources are missing', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockResolvedValueOnce(
      answer(partialPage(['2'], '/dev-ops/events?cursor=B'))
    )
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    const partial = document.querySelector<HTMLElement>(
      '[data-testid="events-load-more-partial"]'
    )!

    expect(list.rows()).toEqual(['1', '2'])
    expect(partial.hidden).toBe(false)
    expect(partial.textContent).toBe(
      'Some event sources are unavailable: CW Inbox. Showing the rest.'
    )

    await vi.advanceTimersByTimeAsync(1600)

    expect(list.status.textContent).toBe(
      '1 more event loaded. Some event sources are unavailable: CW Inbox. Showing the rest.'
    )
  })

  test('treats a network failure as a failure too', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.retry.hidden).toBe(false)
  })

  // Politely, and summed: a fast scroll through two pages is one sentence.
  test('announces the arrivals in one polite sentence', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    fetchMock
      .mockResolvedValueOnce(
        answer(pageOf(['2', '3'], '/dev-ops/events?cursor=B'))
      )
      .mockResolvedValueOnce(answer(pageOf(['4'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(list.status.textContent).toBe('')

    await vi.advanceTimersByTimeAsync(1600)

    expect(list.status.getAttribute('aria-live')).toBe('polite')
    expect(list.status.textContent).toBe('3 more events loaded')
  })

  // A first page too short to reach the sentinel keeps loading until the
  // window is full or the pages run out.
  test('keeps loading while the sentinel is still in reach', async () => {
    const list = await mountList()

    list.sentinel.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    fetchMock
      .mockResolvedValueOnce(answer(pageOf(['2'], '/dev-ops/events?cursor=B')))
      .mockResolvedValueOnce(answer(pageOf(['3'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(list.rows()).toEqual(['1', '2', '3'])
    expect(list.end.hidden).toBe(false)
  })

  test('moves no focus', async () => {
    const list = await mountList()

    farAway(list.sentinel)
    const before = document.activeElement
    fetchMock.mockResolvedValueOnce(answer(pageOf(['2'], null)))
    intersect()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.activeElement).toBe(before)
  })

  // The element enhances what the markup already does, so a host without
  // the parts it expects is left exactly as it was found.
  test('leaves markup it does not recognise alone', async () => {
    await import('../index.ts')
    document.body.innerHTML =
      '<do-load-more data-next-page="/x"><p>Nothing here</p></do-load-more>'
    await vi.advanceTimersByTimeAsync(0)

    expect(FakeObserver.made).toHaveLength(0)
  })
})

describe('loadedMessage', () => {
  test('counts what arrived, in the singular for one', () => {
    expect(loadedMessage(20)).toBe('20 more events loaded')
    expect(loadedMessage(1)).toBe('1 more event loaded')
  })
})
