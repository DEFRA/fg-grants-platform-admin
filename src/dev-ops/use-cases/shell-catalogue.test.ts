import { logger } from '../../common/logger.ts'
import { findShell } from '../repositories/shell.repository.ts'
import { catalogue, queuesApartCatalogue } from './test-fixtures.ts'
import { readShellUseCase, shellCatalogue } from './shell-catalogue.ts'

vi.mock(import('../repositories/shell.repository.ts'))
vi.mock(import('../../common/logger.ts'))

describe('shellCatalogue', () => {
  test('answers the catalogue the request’s answer carried', () => {
    expect(
      shellCatalogue({ app: { upstream: { calls: 1, shell: { catalogue } } } })
    ).toEqual(catalogue)
  })

  test('leaves out a queue’s own list, which no page draws', () => {
    const listed = {
      ...catalogue,
      buckets: [...queuesApartCatalogue.buckets, ...catalogue.buckets]
    }

    expect(
      shellCatalogue({
        app: { upstream: { calls: 1, shell: { catalogue: listed } } }
      })?.buckets.map(({ path }) => path)
    ).toEqual([
      'applications',
      'grants',
      'cases',
      'workflows',
      ...catalogue.buckets.map(({ path }) => path)
    ])
  })

  test.each([
    ['no store', {}],
    ['no shell', { app: { upstream: { calls: 1, shell: null } } }]
  ])('answers none with %s', (_name, request) => {
    expect(shellCatalogue(request)).toBeNull()
  })
})

describe('readShellUseCase', () => {
  test('asks GAS for the shell', async () => {
    vi.mocked(findShell).mockResolvedValue({ catalogue })

    await readShellUseCase()

    expect(findShell).toHaveBeenCalledTimes(1)
  })

  test('logs a failure without its body, and draws on', async () => {
    vi.mocked(findShell).mockRejectedValue(
      Object.assign(new Error('Client request timeout'), {
        data: { payload: { secret: 'x' } }
      })
    )

    await expect(readShellUseCase()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Could not read the shell from fg-gas-backend: Error: Client request timeout'
    )
  })
})
