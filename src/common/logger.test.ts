vi.mock(import('@defra/hapi-tracing'))
vi.mock(import('pino'))

describe('logger', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('adds trace.id mixin when trace id present', async () => {
    const { getTraceId } = await import('@defra/hapi-tracing')
    vi.mocked(getTraceId).mockReturnValue('trace-abc')

    const { pino } = await import('pino')

    await import('./logger.ts')

    expect(pino).toHaveBeenCalledTimes(1)

    const options = vi.mocked(pino).mock.calls[0][0] as {
      mixin: () => Record<string, string>
    }

    expect(options.mixin()).toEqual({
      'trace.id': 'trace-abc'
    })
  })

  test('returns empty mixin when trace id absent', async () => {
    const { getTraceId } = await import('@defra/hapi-tracing')
    vi.mocked(getTraceId).mockReturnValue(null)

    const { pino } = await import('pino')

    await import('./logger.ts')

    expect(pino).toHaveBeenCalledTimes(1)

    const options = vi.mocked(pino).mock.calls[0][0] as {
      mixin: () => Record<string, string>
    }

    expect(options.mixin()).toEqual({})
  })
})
