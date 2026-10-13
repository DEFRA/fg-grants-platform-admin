import { replaceGrantAllowList } from '../repositories/allow-list.repository.ts'
import { replaceAllowListUseCase } from './replace-allow-list.use-case.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

const global = { sbi: ['106000033'], crn: ['1042000000'] }

const gasError = (statusCode: number, payload?: object) =>
  Object.assign(new Error('Response Error'), {
    output: { statusCode },
    data: { payload }
  })

describe('replaceAllowListUseCase', () => {
  test('replaces the complete allow list', async () => {
    await expect(
      replaceAllowListUseCase('woodland', global)
    ).resolves.toBeUndefined()

    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', global)
  })

  test.each([400, 404])('returns a GAS %i refusal', async (statusCode) => {
    const message = 'The allow list was refused'
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(statusCode, { message })
    )

    await expect(replaceAllowListUseCase('woodland', global)).resolves.toEqual({
      statusCode,
      message
    })
  })

  test('rethrows a GAS server failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(500, { message: 'Service unavailable' })
    )

    await expect(replaceAllowListUseCase('woodland', global)).rejects.toThrow(
      'Response Error'
    )
  })

  test('rethrows a connection failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      new Error('ECONNREFUSED')
    )

    await expect(replaceAllowListUseCase('woodland', global)).rejects.toThrow(
      'ECONNREFUSED'
    )
  })
})
