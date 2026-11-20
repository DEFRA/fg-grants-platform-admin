import { toEditorVocabulary } from './explore-vocabulary.view-model.ts'

describe('toEditorVocabulary', () => {
  test('gives the editor each path by its type, an ObjectId one as objectId so it offers ObjectId(…)', () => {
    expect(
      toEditorVocabulary({
        sources: [
          {
            name: 'applications',
            label: 'Applications',
            time: 'createdAt',
            paths: [
              { path: '_id', type: 'objectId', indexed: true },
              { path: 'createdAt', type: 'date', indexed: true },
              { path: 'metadata', indexed: false }
            ]
          }
        ]
      }).sources[0].fields
    ).toEqual([
      { name: '_id', detail: 'ObjectId, indexed', type: 'objectId' },
      { name: 'createdAt', detail: 'Date, indexed', type: 'date' },
      { name: 'metadata', detail: 'Stored value' }
    ])
  })
})
