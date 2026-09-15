// @vitest-environment happy-dom

describe('focus on arrival', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    document.body.innerHTML =
      '<a href="#">first</a><h3 tabindex="-1" data-focus-on-arrival>Redrive this event?</h3>'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('moves focus to the marked element once the page has loaded', async () => {
    await import('./focus-on-arrival.ts')
    vi.advanceTimersToNextFrame()

    expect(document.activeElement?.hasAttribute('data-focus-on-arrival')).toBe(
      true
    )
  })

  test('moves no focus on a page with nothing marked', async () => {
    document.body.innerHTML = '<a href="#">first</a>'

    await import('./focus-on-arrival.ts')
    vi.advanceTimersToNextFrame()

    expect(document.activeElement).toBe(document.body)
  })
})
