import { logger } from '../../common/logger.ts'
import type { DefinitionFetchFile } from '../repositories/grants.repository.ts'
import { fetchGrantDefinitions } from '../repositories/grants.repository.ts'
import { fetchGrantDefinitionsUseCase } from './fetch-grant-definitions.use-case.ts'

vi.mock(import('../repositories/grants.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const ref = { code: 'woodland-creation', version: '2.0.0' }

const files: DefinitionFetchFile[] = [
  { file: 'grant', outcome: 'stored' },
  { file: 'payment', outcome: 'failed', reason: 'missing', message: null }
]

const responseError = (statusCode: number) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: {}, res: {} }
  })

describe('fetchGrantDefinitionsUseCase', () => {
  beforeEach(() => {
    vi.mocked(fetchGrantDefinitions).mockResolvedValue({ files })
  })

  test('asks GAS to fetch the version the caller named, for the operator', async () => {
    await fetchGrantDefinitionsUseCase(ref, 'Ada Lovelace')

    expect(fetchGrantDefinitions).toHaveBeenCalledWith(ref, 'Ada Lovelace')
  })

  test("reports what GAS did with each file, a failed one among them, as GAS's answer", async () => {
    await expect(fetchGrantDefinitionsUseCase(ref)).resolves.toEqual({
      outcome: 'fetched',
      files
    })
  })

  test('reports a fetch with nothing left to store', async () => {
    vi.mocked(fetchGrantDefinitions).mockResolvedValue({ files: [] })

    await expect(fetchGrantDefinitionsUseCase(ref)).resolves.toEqual({
      outcome: 'fetched',
      files: []
    })
  })

  test('reports a version GAS no longer has, as a warning only', async () => {
    vi.mocked(fetchGrantDefinitions).mockRejectedValue(responseError(404))

    await expect(fetchGrantDefinitionsUseCase(ref)).resolves.toEqual({
      outcome: 'not-found',
      files: []
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Did not fetch definitions of grant woodland-creation@2.0.0: not-found'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('reports a fetch GAS did not answer in time', async () => {
    vi.mocked(fetchGrantDefinitions).mockRejectedValue(responseError(504))

    await expect(fetchGrantDefinitionsUseCase(ref)).resolves.toEqual({
      outcome: 'timed-out',
      files: []
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['stopped part-way', responseError(500)],
    ['refused', responseError(400)],
    ['unreachable', new Error('connect ECONNREFUSED')]
  ])('reports a fetch GAS %s as unavailable', async (_name, error) => {
    vi.mocked(fetchGrantDefinitions).mockRejectedValue(error)

    await expect(fetchGrantDefinitionsUseCase(ref)).resolves.toEqual({
      outcome: 'unavailable',
      files: []
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Could not fetch definitions of grant woodland-creation@2.0.0 in fg-gas-backend: '
      )
    )
  })
})
