import { toCodeBreaks } from './code-text.ts'

describe('toCodeBreaks', () => {
  test('splits after each colon, underscore and slash', () => {
    expect(toCodeBreaks('PRE_AWARD:REVIEW/x')).toEqual([
      'PRE_',
      'AWARD:',
      'REVIEW/',
      'x'
    ])
  })

  test('splits a path after each dot and before each index, never inside a name', () => {
    expect(
      toCodeBreaks('$.payload.answers.landUse.totalHectares[0].areaHa')
    ).toEqual([
      '$.',
      'payload.',
      'answers.',
      'landUse.',
      'totalHectares',
      '[0].',
      'areaHa'
    ])
  })

  test('splits an expression after each opening bracket', () => {
    expect(toCodeBreaks('$sum($.items.amount)')).toEqual([
      '$sum(',
      '$.',
      'items.',
      'amount)'
    ])
  })

  test('keeps a version whole', () => {
    expect(toCodeBreaks('woodland@1.2.0')).toEqual(['woodland@1.2.0'])
  })

  test('keeps a code with no break as one part', () => {
    expect(toCodeBreaks('woodland')).toEqual(['woodland'])
  })

  test('leaves no empty part after a trailing break', () => {
    expect(toCodeBreaks('A::')).toEqual(['A:', ':'])
  })

  test('reads nothing as no parts, and a number as text', () => {
    expect(toCodeBreaks(null)).toEqual([])
    expect(toCodeBreaks(12)).toEqual(['12'])
  })
})
