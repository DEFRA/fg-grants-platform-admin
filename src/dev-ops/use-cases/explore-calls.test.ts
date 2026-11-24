import Boom from '@hapi/boom'

import { logger } from '../../common/logger.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore
} from '../repositories/explore.repository.ts'
import {
  checkExploreQuery,
  readExploreVocabulary,
  runExplore
} from './explore-calls.ts'

vi.mock(import('../repositories/explore.repository.ts'))
vi.mock(import('../../common/logger.ts'))

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

const connectionError = () =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  )

const vocabulary = { sources: [] }

const mongodSays =
  'The argument to $size must be an array, but was of type: missing'

describe('runExplore', () => {
  test('asks GAS to run the query', async () => {
    vi.mocked(queryExplore).mockResolvedValue({} as never)

    await runExplore({ query: 'db.cases.find()' })

    expect(queryExplore).toHaveBeenCalledExactlyOnceWith({
      query: 'db.cases.find()'
    })
  })

  test.each([
    [
      'a query that breaks the language',
      responseError(400, {
        reason: 'QUERY_INVALID',
        error: { message: 'Close the list with )', at: 4, end: 9 }
      }),
      {
        kind: 'invalid',
        error: { message: 'Close the list with )', at: 4, end: 9 }
      }
    ],
    [
      'an invalid answer with no place',
      responseError(400, {
        reason: 'QUERY_INVALID',
        error: { message: 'x', at: -1 }
      }),
      { kind: 'refused', service: 'GAS', message: null }
    ],
    [
      'mongod failing on a stored value, at the expression it failed on',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        refusal: 'MONGOD_ERROR',
        service: 'CW',
        message: mongodSays,
        error: { message: mongodSays, at: 40, end: 60 }
      }),
      { kind: 'invalid', error: { message: mongodSays, at: 40, end: 60 } }
    ],
    [
      'mongod failing with no place',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        refusal: 'MONGOD_ERROR',
        message: mongodSays
      }),
      { kind: 'refused', service: 'GAS', message: mongodSays }
    ],
    [
      'cells too large to show together',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        refusal: 'CELLS_TOO_LARGE',
        service: 'GAS',
        message:
          'These cells are too large to show together. Name fewer paths or set a lower .limit()'
      }),
      {
        kind: 'too-large',
        service: 'GAS',
        message:
          'These cells are too large to show together. Name fewer paths or set a lower .limit()'
      }
    ],
    [
      'Caseworking’s answer too large to read',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        refusal: 'ANSWER_TOO_LARGE',
        service: 'CW',
        message:
          'This answer is too large: set a lower .limit() or name fewer paths'
      }),
      {
        kind: 'too-large',
        service: 'CW',
        message:
          'This answer is too large: set a lower .limit() or name fewer paths'
      }
    ],
    [
      'a refusal',
      responseError(400, { reason: 'QUERY_REFUSED', message: 'Too big' }),
      { kind: 'refused', service: 'GAS', message: 'Too big' }
    ],
    [
      'a source too big to read in full, naming what it has too many of',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        message:
          'The Grant Application Service has too many agreements to read in full',
        service: 'GAS'
      }),
      {
        kind: 'refused',
        service: 'GAS',
        message:
          'The Grant Application Service has too many agreements to read in full'
      }
    ],
    [
      'too slow',
      responseError(408, { reason: 'QUERY_TOO_SLOW' }),
      { kind: 'too-slow', service: 'GAS', message: null }
    ],
    [
      'too slow in Caseworking',
      responseError(408, { reason: 'QUERY_TOO_SLOW', service: 'CW' }),
      { kind: 'too-slow', service: 'CW', message: null }
    ],
    [
      'a refusal by Caseworking',
      responseError(400, {
        reason: 'QUERY_REFUSED',
        service: 'CW',
        message: 'Too big'
      }),
      { kind: 'refused', service: 'CW', message: 'Too big' }
    ],
    [
      'a 403',
      responseError(403, { message: 'Forbidden' }),
      { kind: 'errored', service: 'GAS' }
    ],
    [
      'busy, from a GAS that doesn’t say why',
      responseError(429, { reason: 'QUERY_BUSY' }),
      { kind: 'busy', service: 'GAS' }
    ],
    [
      'busy with this person’s other query',
      responseError(429, {
        reason: 'QUERY_BUSY',
        refusal: 'BUSY',
        service: 'CW'
      }),
      { kind: 'busy', service: 'CW' }
    ],
    [
      'a service running as many queries as it can',
      responseError(429, {
        reason: 'QUERY_BUSY',
        refusal: 'FULL',
        service: 'CW'
      }),
      { kind: 'full', service: 'CW' }
    ],
    [
      'a 404',
      responseError(404, { statusCode: 404, error: 'Not Found' }),
      { kind: 'errored', service: 'GAS' }
    ],
    [
      'Caseworking unreachable',
      responseError(502, { hop: 'CW-BE', reason: 'UNREACHABLE' }),
      { kind: 'no-answer', service: 'CW', failure: { kind: 'cw-not-reached' } }
    ],
    [
      'Caseworking not answering in time',
      responseError(502, { hop: 'CW-BE', reason: 'TIMED_OUT' }),
      { kind: 'no-answer', service: 'CW', failure: { kind: 'timed-out' } }
    ],
    [
      'Caseworking erroring',
      responseError(502, { hop: 'CW-BE', reason: 'ERRORED' }),
      { kind: 'errored', service: 'CW' }
    ],
    [
      'Caseworking failing for a reason GAS names no other way',
      responseError(502, { hop: 'CW-BE', reason: 'SOMETHING_ELSE' }),
      { kind: 'errored', service: 'CW' }
    ],
    [
      'Caseworking refusing the query',
      responseError(502, { hop: 'CW-BE', reason: 'EXPLORE_QUERY_INVALID' }),
      { kind: 'refused', service: 'CW', message: null }
    ],
    [
      'GAS unable to reach Caseworking',
      responseError(502, { errorCode: 'CW_UNREACHABLE' }),
      { kind: 'no-answer', service: 'CW', failure: { kind: 'cw-not-reached' } }
    ],
    [
      'a GAS that can’t run queries for now',
      responseError(503, {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Service Unavailable'
      }),
      { kind: 'unavailable', service: 'GAS' }
    ],
    [
      'a 502 of GAS’s own',
      responseError(502),
      { kind: 'errored', service: 'GAS' }
    ],
    ['a 500', responseError(500), { kind: 'errored', service: 'GAS' }],
    ['a 401', responseError(401), { kind: 'errored', service: 'GAS' }],
    [
      'no connection',
      connectionError(),
      { kind: 'no-answer', service: 'GAS', failure: { kind: 'not-connected' } }
    ],
    [
      'no answer in time',
      Boom.gatewayTimeout('Client request timeout'),
      { kind: 'no-answer', service: 'GAS', failure: { kind: 'no-answer' } }
    ]
  ])('says how %s failed', async (_, error, failure) => {
    vi.mocked(queryExplore).mockRejectedValue(error)

    expect(await runExplore({ query: 'db.cases.find()' })).toEqual({
      result: { outcome: 'failed', failure },
      vocabulary: null
    })
  })

  test('takes the vocabulary out of the answer', async () => {
    vi.mocked(queryExplore).mockResolvedValue({
      rows: [],
      vocabulary
    } as never)

    expect(await runExplore({ query: 'db.cases.find()' })).toEqual({
      result: { outcome: 'read', answer: { rows: [] } },
      vocabulary
    })
  })

  test('has no vocabulary from an answer without one', async () => {
    vi.mocked(queryExplore).mockResolvedValue({ rows: [] } as never)

    expect(
      (await runExplore({ query: 'db.cases.find()' })).vocabulary
    ).toBeNull()
  })

  test('keeps the vocabulary a refusal carried', async () => {
    vi.mocked(queryExplore).mockRejectedValue(
      responseError(400, { reason: 'QUERY_REFUSED', vocabulary })
    )

    expect(await runExplore({ query: 'db.cases.find()' })).toEqual({
      result: {
        outcome: 'failed',
        failure: { kind: 'refused', service: 'GAS', message: null }
      },
      vocabulary
    })
  })

  test('warns of a failure of GAS’s by its message alone, never what it answered', async () => {
    vi.mocked(queryExplore).mockRejectedValue(
      responseError(500, { message: 'secret' })
    )

    await runExplore({ query: 'db.cases.find()' })

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Could not run an Explore query in fg-gas-backend: Error: Response Error: 500'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('warns of a GAS that can’t run queries for now', async () => {
    vi.mocked(queryExplore).mockRejectedValue(responseError(503))

    await runExplore({ query: 'db.cases.find()' })

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Could not run an Explore query in fg-gas-backend: Error: Response Error: 503'
    )
  })

  test.each([
    ['answered', () => vi.mocked(queryExplore).mockResolvedValue({} as never)],
    [
      'failed',
      () => vi.mocked(queryExplore).mockRejectedValue(responseError(500))
    ]
  ])('logs the call and its end as a pair when GAS %s', async (_, answer) => {
    answer()

    await runExplore({ query: 'db.cases.find()' })

    expect(vi.mocked(logger.info).mock.calls).toEqual([
      ['Asking fg-gas-backend to run an Explore query'],
      ['Finished: Asking fg-gas-backend to run an Explore query']
    ])
  })

  test('warns of a GAS 404 as an outage, and logs nothing for a query’s own mistakes', async () => {
    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(404, { statusCode: 404, error: 'Not Found' })
    )
    await runExplore({ query: 'db.cases.find()' })

    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(400, { reason: 'QUERY_REFUSED' })
    )
    await runExplore({ query: 'db.cases.find()' })

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Could not run an Explore query in fg-gas-backend: Error: Response Error: 404'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('checkExploreQuery', () => {
  test('asks GAS only to check', async () => {
    vi.mocked(checkExplore).mockResolvedValue({
      ok: true,
      source: 'cases',
      vocabulary
    })

    expect(await checkExploreQuery('db.cases.find()')).toEqual({
      result: { outcome: 'read', answer: { ok: true, source: 'cases' } },
      vocabulary
    })
    expect(checkExplore).toHaveBeenCalledExactlyOnceWith('db.cases.find()')
  })

  test('keeps the vocabulary a query that breaks the language carried', async () => {
    vi.mocked(checkExplore).mockRejectedValue(
      responseError(400, {
        reason: 'QUERY_INVALID',
        error: { message: 'Close the list with )', at: 4, end: 9 },
        vocabulary
      })
    )

    expect(await checkExploreQuery('db.cases.find(')).toEqual({
      result: {
        outcome: 'failed',
        failure: {
          kind: 'invalid',
          error: { message: 'Close the list with )', at: 4, end: 9 }
        }
      },
      vocabulary
    })
  })
})

describe('readExploreVocabulary', () => {
  test('says how GAS failed to give it', async () => {
    vi.mocked(findVocabulary).mockRejectedValue(connectionError())

    expect(await readExploreVocabulary()).toEqual({
      outcome: 'failed',
      failure: {
        kind: 'no-answer',
        service: 'GAS',
        failure: { kind: 'not-connected' }
      }
    })
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
  })
})
