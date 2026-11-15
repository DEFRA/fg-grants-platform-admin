import { toPosition, toStageKey } from './lifecycle-names.ts'
import { pickPosition } from './state-map.ts'

const positions = [
  toPosition('PRE_AWARD', 'REVIEW', 'IN_REVIEW'),
  toPosition('PRE_AWARD', 'DECISION', 'APPROVED'),
  toPosition('POST_AWARD', 'DECISION', 'CLOSED')
]

describe('pickPosition', () => {
  test.each([
    ['a full position', 'PRE_AWARD:DECISION:APPROVED', positions[1]],
    ['a bare status code', 'CLOSED', positions[2]],
    [
      'a stage, as its first status',
      toStageKey('POST_AWARD', 'DECISION'),
      positions[2]
    ]
  ])('picks %s', (_kind, asked, picked) => {
    expect(pickPosition(positions, asked, positions[0])).toBe(picked)
  })

  test.each([
    ['nothing asked', undefined],
    ['an unknown status', 'WITHDRAWN'],
    ['part of a code', 'OSED'],
    ['an unknown stage', 'PRE_AWARD:CLOSED']
  ])('falls back for %s', (_kind, asked) => {
    expect(pickPosition(positions, asked, positions[0])).toBe(positions[0])
  })
})
