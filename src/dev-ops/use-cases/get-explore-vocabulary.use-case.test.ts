import Boom from '@hapi/boom'

import type { Vocabulary } from '../repositories/explore.repository.ts'
import { findVocabulary } from '../repositories/explore.repository.ts'
import { getExploreVocabularyUseCase } from './get-explore-vocabulary.use-case.ts'

vi.mock(import('../repositories/explore.repository.ts'))

const source = (name: string) => ({
  name,
  label: name,
  time: null,
  paths: []
})

const vocabulary: Vocabulary = {
  sources: [
    'applications',
    'cases',
    'grants',
    'workflows',
    'events',
    'agreements',
    'payments',
    'ledgers'
  ].map(source)
}

describe('getExploreVocabularyUseCase', () => {
  test('asks GAS with the person’s roles, and gives exactly the sources it lists', async () => {
    vi.mocked(findVocabulary).mockResolvedValue(vocabulary)

    expect(
      await getExploreVocabularyUseCase({ roles: ['FCP.GrantOperationsAdmin'] })
    ).toEqual({ outcome: 'read', answer: vocabulary })
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith([
      'FCP.GrantOperationsAdmin'
    ])
  })

  test('suggests no source when GAS lists none for the person’s roles', async () => {
    vi.mocked(findVocabulary).mockResolvedValue({ sources: [] })

    expect(await getExploreVocabularyUseCase({ roles: ['FCP.Other'] })).toEqual(
      { outcome: 'read', answer: { sources: [] } }
    )
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith(['FCP.Other'])
  })

  test('passes on how GAS failed', async () => {
    vi.mocked(findVocabulary).mockRejectedValue(Boom.gatewayTimeout())

    expect(
      await getExploreVocabularyUseCase({ roles: ['FCP.GrantOperationsAdmin'] })
    ).toEqual({
      outcome: 'failed',
      failure: {
        kind: 'no-answer',
        service: 'GAS',
        failure: { kind: 'no-answer' }
      }
    })
  })
})
