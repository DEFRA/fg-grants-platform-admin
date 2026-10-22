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
