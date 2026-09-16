const explorer = 'https://logs.dev.cdp-int.defra.cloud'

/** The schema validates as it loads, so each case needs its own load. */
const loadConfigWith = async (value?: string) => {
  vi.resetModules()

  if (value === undefined) {
    delete process.env.LOGS_EXPLORER_BASE_URL
  } else {
    process.env.LOGS_EXPLORER_BASE_URL = value
  }

  return (await import('./config.ts')).config
}

afterEach(() => {
  process.env.LOGS_EXPLORER_BASE_URL = explorer
})

describe('the logs explorer url', () => {
  test('is taken from the environment', async () => {
    const config = await loadConfigWith(explorer)

    expect(config.get('logs.explorerBaseUrl')).toBe(explorer)
  })

  // It is the whole of the event page's Trace ID link, and a deployment that
  // silently lost it is what this replaces.
  test.each([
    ['is not set', undefined],
    ['is blank', ''],
    ['is not a url', 'logs.dev.cdp-int.defra.cloud'],
    ['is a url nothing can safely link to', 'javascript:alert(1)']
  ])('stops the app from starting when it %s', async (_case, value) => {
    await expect(loadConfigWith(value)).rejects.toThrow(
      'LOGS_EXPLORER_BASE_URL must be an http or https url'
    )
  })
})
