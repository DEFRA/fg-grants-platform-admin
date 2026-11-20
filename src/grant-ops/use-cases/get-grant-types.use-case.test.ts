import { getGrantTypes } from '../repositories/grant-types.repository.ts'
import { getGrantTypesUseCase } from './get-grant-types.use-case.ts'

vi.mock(import('../repositories/grant-types.repository.ts'))

describe('getGrantTypesUseCase', () => {
  test('returns the grant types view from its repository', async () => {
    const view = {
      grantTypes: [{ code: 'woodland', name: 'Woodland Management Plan' }]
    }
    vi.mocked(getGrantTypes).mockResolvedValue(view)

    await expect(getGrantTypesUseCase()).resolves.toEqual(view)
  })
})
