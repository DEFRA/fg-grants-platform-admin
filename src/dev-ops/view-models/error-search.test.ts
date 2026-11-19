import {
  errorKeyMax,
  isErrorSet,
  toErrorSearchError,
  toErrorTextMax,
  toErrorKey,
  toErrorText
} from './error-search.ts'

describe('toErrorKey', () => {
  test.each([
    'Error: Boom',
    'Error: ETIMEDOUT: connect <v>',
    'Error: Foo: bar',
    'TypeError: Cannot read properties of <v>',
    'TypeError',
    'Error',
    'No error recorded'
  ])('%s, shown and sent back unchanged, is the same key', (errorKey) => {
    expect(toErrorKey(toErrorText(errorKey), errorKey)).toBe(errorKey)
  })

  test.each([
    ['Boom', 'Error: Boom'],
    ['TypeError: Cannot read properties', 'TypeError: Cannot read properties'],
    ['Error: Boom', 'Error: Boom'],
    ['No error recorded', 'No error recorded']
  ])('%s, typed, or edited from the key shown, stands for %s', (text, key) => {
    expect(toErrorKey(text, '')).toBe(key)
    expect(toErrorKey(text, 'Error: Something else')).toBe(key)
  })
})

test.each([
  ['a thrown Error’s, with Error: put back', '', 113],
  ['one that names its error', 'TypeError: ', 120]
])(
  'typed text standing for %s fits GAS’s longest key, and the refusal says the most it can have',
  (_name, start, most) => {
    const fits = `${start}${'x'.repeat(most - start.length)}`

    expect(toErrorTextMax(fits, '')).toBe(most)
    expect(toErrorKey(fits, '')).toHaveLength(errorKeyMax)
    expect(toErrorSearchError(fits, '')).toBeNull()
    expect(toErrorSearchError(`${fits}x`, '')).toBe(
      `Enter an error of up to ${most} characters`
    )
  }
)

test('the no-error key is sent as typed, so all of GAS’s longest key is the field’s', () => {
  expect(toErrorTextMax('No error recorded', '')).toBe(errorKeyMax)
})

test('the shown text sent back unchanged is its own key, which fits as GAS cut it', () => {
  const shown = `Error: ${'x'.repeat(113)}`

  expect(toErrorSearchError(toErrorText(shown), shown)).toBeNull()
})

test('counts characters as GAS does, not UTF-16 units', () => {
  expect(toErrorSearchError('😀'.repeat(113), '')).toBeNull()
})

test('an error is set only under the key the list takes it under', () => {
  expect(isErrorSet({ error: 'Error: Boom' }, 'error')).toBe(true)
  expect(isErrorSet({ error: '' }, 'error')).toBe(false)
  expect(isErrorSet({ error: 'Error: Boom' }, 'status')).toBe(false)
  expect(isErrorSet({ error: 'Error: Boom' }, null)).toBe(false)
})
