import type { GrantLifecycle } from '../use-cases/get-grant-page.use-case.ts'
import { toLifecycleNames } from './lifecycle-names.ts'

const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'REVIEW',
          name: null,
          statuses: [
            { code: 'IN_REVIEW', name: 'Being reviewed' },
            { code: 'WITHDRAWN' }
          ]
        },
        {
          code: 'OFFER',
          name: 'Offer',
          statuses: [{ code: 'WITHDRAWN', name: null }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:REVIEW:IN_REVIEW',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [],
  claimApproval: null
}

describe('toLifecycleNames', () => {
  const names = toLifecycleNames(lifecycle)

  test("names a status by the definition's name, else its code made readable", () => {
    expect(names.status('PRE_AWARD:REVIEW:IN_REVIEW')).toBe('Being reviewed')
    expect(names.status('PRE_AWARD:OFFER:WITHDRAWN')).toBe('Withdrawn')
    expect(names.status('ELSEWHERE:X:STATUS_GONE')).toBe('Gone')
  })

  test('names stages and phases the same way', () => {
    expect(names.stage('PRE_AWARD:REVIEW')).toBe('Review')
    expect(names.stage('PRE_AWARD:OFFER')).toBe('Offer')
    expect(names.stage('PRE_AWARD:LEGACY_TRIAGE')).toBe('Legacy triage')
    expect(names.phase('PRE_AWARD')).toBe('Pre-award')
  })

  test('knows its positions and stages, and a status code held in more than one stage', () => {
    expect([...names.positions]).toEqual([
      'PRE_AWARD:REVIEW:IN_REVIEW',
      'PRE_AWARD:REVIEW:WITHDRAWN',
      'PRE_AWARD:OFFER:WITHDRAWN'
    ])
    expect([...names.stages]).toEqual(['PRE_AWARD:REVIEW', 'PRE_AWARD:OFFER'])
    expect(names.repeated('PRE_AWARD:OFFER:WITHDRAWN')).toBe(true)
    expect(names.repeated('PRE_AWARD:REVIEW:IN_REVIEW')).toBe(false)
  })
})
