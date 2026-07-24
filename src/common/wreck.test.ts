vi.mock(import('@defra/hapi-tracing'))

describe('wreck', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('adds the trace header when a trace id is present', async () => {
    const { getTraceId } = await import('@defra/hapi-tracing')
    vi.mocked(getTraceId).mockReturnValue('trace-123')

    const { wreck } = await import('./wreck.ts')

    const uri = { headers: {} as Record<string, string> }

    wreck.events?.emit('preRequest', uri as unknown as string, {})

    expect(uri.headers['x-cdp-request-id']).toBe('trace-123')
  })

  test('does not add the trace header when a trace id is absent', async () => {
    const { getTraceId } = await import('@defra/hapi-tracing')
    vi.mocked(getTraceId).mockReturnValue(null)

    const { wreck } = await import('./wreck.ts')

    const uri = { headers: {} as Record<string, string> }

    wreck.events?.emit('preRequest', uri as unknown as string, {})

    expect(uri.headers['x-cdp-request-id']).toBeUndefined()
  })
})
