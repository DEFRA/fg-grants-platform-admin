import { describeError } from './describe-error.ts'

describe('describeError', () => {
  test('describes an error by its name and message', () => {
    expect(describeError(new TypeError('not a function'))).toBe(
      'TypeError: not a function'
    )
  })

  test('describes a wreck response error without its payload', () => {
    const error = Object.assign(new Error('Response Error: 400 Bad Request'), {
      data: { payload: { message: 'Cannot decode cursor' }, res: {} }
    })

    const result = describeError(error)

    expect(result).toBe('Error: Response Error: 400 Bad Request')
    expect(result).not.toContain('Cannot decode cursor')
  })

  test('describes a thrown non-error', () => {
    expect(describeError('boom')).toBe('Unknown error')
  })
})
