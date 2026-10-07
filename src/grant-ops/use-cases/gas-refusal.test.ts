import Boom from '@hapi/boom'
import {
  isConfigurationChange,
  toConflictRefusal,
  toGasRefusal
} from './gas-refusal.ts'

const wreckError = (statusCode: number, payload?: object) =>
  Object.assign(new Error('Response Error'), {
    isBoom: true,
    output: { statusCode },
    data: payload ? { payload } : undefined
  })

describe('toGasRefusal', () => {
  test('reads the status and the message fg-gas-backend answered with', () => {
    expect(
      toGasRefusal(wreckError(409, { message: 'Already claimed' }))
    ).toEqual({
      statusCode: 409,
      message: 'Already claimed',
      errorCode: undefined
    })
  })

  test("falls back to the error's own message", () => {
    expect(toGasRefusal(Boom.notFound('No such entitlement'))).toEqual({
      statusCode: 404,
      message: 'No such entitlement'
    })
  })

  test('says the backend refused when there is no message at all', () => {
    expect(toGasRefusal(wreckError(422))).toEqual({
      statusCode: 422,
      message: 'The backend refused the request.'
    })
  })

  test('treats a server failure or a non-http error as no refusal', () => {
    expect(toGasRefusal(wreckError(503, { message: 'down' }))).toBeUndefined()
    expect(toGasRefusal(new Error('socket hang up'))).toBeUndefined()
    expect(toGasRefusal(undefined)).toBeUndefined()
  })
})

describe('the error code fg-gas-backend answered with', () => {
  test('is kept on the refusal', () => {
    expect(
      toGasRefusal(
        wreckError(409, {
          message: 'It has a claim against it',
          errorCode: 'ENTITLEMENT_CLAIMED'
        })
      )
    ).toMatchObject({ errorCode: 'ENTITLEMENT_CLAIMED' })
  })

  test('marks a configuration change as one to try again', () => {
    expect(
      isConfigurationChange({
        statusCode: 409,
        message: 'changed',
        errorCode: 'CONFIGURATION_CHANGED'
      })
    ).toBe(true)
    expect(
      isConfigurationChange({
        statusCode: 409,
        message: 'claimed',
        errorCode: 'ENTITLEMENT_CLAIMED'
      })
    ).toBe(false)
  })
})

describe('toConflictRefusal', () => {
  test('turns a conflict into a refusal for the page to explain', () => {
    expect(
      toConflictRefusal(wreckError(409, { message: 'Already claimed' }))
    ).toEqual({ kind: 'refusal', message: 'Already claimed' })
  })

  test('throws on anything that is not a conflict', () => {
    const notFound = wreckError(404, { message: 'missing' })

    expect(() => toConflictRefusal(notFound)).toThrow(notFound)
  })
})
