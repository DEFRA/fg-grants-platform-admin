import type { AllowListView } from '../repositories/allow-list.repository.ts'
import {
  isAllowListView,
  replaceGrantAllowList
} from '../repositories/allow-list.repository.ts'
import { replaceAllowListUseCase } from './replace-allow-list.use-case.ts'

vi.mock(
  import('../repositories/allow-list.repository.ts'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    replaceGrantAllowList: vi.fn()
  })
)

const form = { sbi: '900000002', crn: '9000000001' }

const view: AllowListView = {
  sbi: {
    key: 'sbi',
    label: 'Single Business Identifiers (SBIs)',
    value: '900000002',
    hint: 'One per line. 1 listed.'
  },
  crn: {
    key: 'crn',
    label: 'Customer Reference Numbers (CRNs)',
    value: '9000000001',
    hint: 'One per line. 1 listed.'
  },
  errorSummary: []
}

const invalidView = {
  sbi: { key: 'sbi', label: 'SBI', value: 'bad', hint: '', error: 'bad' },
  crn: { key: 'crn', label: 'CRN', value: '', hint: '' },
  errorSummary: [
    { text: 'bad', href: '#sbi', attributes: { 'data-error-line': 1 } }
  ]
}

const malformedViews: [string, object][] = [
  ['null fields and summary', { sbi: null, crn: null, errorSummary: null }],
  ['empty fields', { sbi: {}, crn: {}, errorSummary: [] }],
  ['a non-array summary', { ...view, errorSummary: 'bad' }],
  ['a null summary item', { ...view, errorSummary: [null] }],
  ['an incomplete summary item', { ...view, errorSummary: [{}] }],
  ...(['sbi', 'crn'] as const).flatMap<[string, object]>((key) => [
    [`a null ${key} field`, { ...view, [key]: null }],
    [
      `the wrong ${key} key`,
      { ...view, [key]: { ...view[key], key: 'other' } }
    ],
    [
      `a non-string ${key} error`,
      { ...view, [key]: { ...view[key], error: 1 } }
    ],
    ...(['label', 'value', 'hint'] as const).flatMap<[string, object]>(
      (property) => [
        [
          `a missing ${key} ${property}`,
          { ...view, [key]: { ...view[key], [property]: undefined } }
        ],
        [
          `a non-string ${key} ${property}`,
          { ...view, [key]: { ...view[key], [property]: 42 } }
        ]
      ]
    )
  ]),
  ...[
    { text: 42 },
    { href: null },
    { attributes: null },
    { attributes: {} },
    { attributes: { 'data-error-line': '1' } },
    { attributes: { 'data-error-line': 0 } },
    { attributes: { 'data-error-line': -1 } },
    { attributes: { 'data-error-line': 1.5 } }
  ].map<[string, object]>((properties) => [
    `a malformed summary item ${JSON.stringify(properties)}`,
    {
      ...invalidView,
      errorSummary: [{ ...invalidView.errorSummary[0], ...properties }]
    }
  ])
]

const gasError = (statusCode: number, payload?: object) =>
  Object.assign(new Error('Response Error'), {
    isBoom: true,
    output: { statusCode },
    data: { payload }
  })

describe('replaceAllowListUseCase', () => {
  test('returns the saved view on success', async () => {
    vi.mocked(replaceGrantAllowList).mockResolvedValue(view)

    await expect(replaceAllowListUseCase('woodland', form)).resolves.toEqual({
      outcome: 'saved',
      view
    })
    expect(replaceGrantAllowList).toHaveBeenCalledWith('woodland', form)
  })

  test('returns the shaped view GAS built for a validation failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, invalidView)
    )

    await expect(replaceAllowListUseCase('woodland', form)).resolves.toEqual({
      outcome: 'invalid',
      view: invalidView
    })
  })

  test.each([403, 404])(
    'returns a plain refusal for a %i that is not the shaped view',
    async (statusCode) => {
      const message = 'The allow list could not be saved'
      vi.mocked(replaceGrantAllowList).mockRejectedValue(
        gasError(statusCode, { message })
      )

      await expect(replaceAllowListUseCase('woodland', form)).resolves.toEqual({
        outcome: 'refused',
        refusal: {
          statusCode,
          message,
          errorCode: undefined,
          body: { message }
        }
      })
    }
  )

  test('returns a plain refusal for an unshaped 400', async () => {
    const message = 'Invalid request'
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, { message })
    )

    await expect(replaceAllowListUseCase('woodland', form)).resolves.toEqual({
      outcome: 'refused',
      refusal: {
        statusCode: 400,
        message,
        errorCode: undefined,
        body: { message }
      }
    })
  })

  test.each(malformedViews)(
    'returns a plain refusal for %s',
    async (_, body) => {
      vi.mocked(replaceGrantAllowList).mockRejectedValue(gasError(400, body))

      await expect(
        replaceAllowListUseCase('woodland', form)
      ).resolves.toMatchObject({
        outcome: 'refused',
        refusal: { statusCode: 400, body }
      })
    }
  )

  test('preserves additional GAS properties in a valid validation response', async () => {
    const extendedView = {
      ...invalidView,
      version: 2,
      sbi: { ...invalidView.sbi, extra: true },
      errorSummary: [{ ...invalidView.errorSummary[0], extra: true }]
    }
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(400, extendedView)
    )

    const outcome = await replaceAllowListUseCase('woodland', form)
    expect(outcome).toEqual({ outcome: 'invalid', view: extendedView })
  })

  test('rethrows a GAS server failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      gasError(500, { message: 'Service unavailable' })
    )

    await expect(replaceAllowListUseCase('woodland', form)).rejects.toThrow(
      'Response Error'
    )
  })

  test('rethrows a connection failure', async () => {
    vi.mocked(replaceGrantAllowList).mockRejectedValue(
      new Error('ECONNREFUSED')
    )

    await expect(replaceAllowListUseCase('woodland', form)).rejects.toThrow(
      'ECONNREFUSED'
    )
  })
})

describe('isAllowListView', () => {
  test('recognises a shaped allow-list view', () => {
    expect(isAllowListView(view)).toBe(true)
  })

  test.each([
    ['null', null],
    ['a string', 'oops'],
    ['missing errorSummary', { sbi: view.sbi, crn: view.crn }],
    ['a generic error body', { statusCode: 403, message: 'Forbidden' }]
  ])('rejects %s', (_, body) => {
    expect(isAllowListView(body)).toBe(false)
  })
})
