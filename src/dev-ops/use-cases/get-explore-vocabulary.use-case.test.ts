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
  test('gives exactly the sources GAS lists', async () => {
    vi.mocked(findVocabulary).mockResolvedValue(vocabulary)

    expect(await getExploreVocabularyUseCase()).toEqual({
      outcome: 'read',
      answer: vocabulary
    })
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
  })

  test('passes on how GAS failed', async () => {
    vi.mocked(findVocabulary).mockRejectedValue(Boom.gatewayTimeout())

    expect(await getExploreVocabularyUseCase()).toEqual({
      outcome: 'failed',
      failure: {
        kind: 'no-answer',
        service: 'GAS',
        failure: { kind: 'no-answer' }
      }
    })
  })
})
