import type { AllowListView } from '../repositories/allow-list.repository.ts'
import { replaceGrantAllowList } from '../repositories/allow-list.repository.ts'
import {
  isAllowListView,
  replaceAllowListUseCase
} from './replace-allow-list.use-case.ts'

vi.mock(import('../repositories/allow-list.repository.ts'))

const form = { sbi: '106000033', crn: '1042000000' }

const view: AllowListView = {
  sbi: {
    key: 'sbi',
    label: 'Single Business Identifiers (SBIs)',
    value: '106000033',
    hint: 'One per line. 1 listed.'
  },
  crn: {
    key: 'crn',
    label: 'Customer Reference Numbers (CRNs)',
    value: '1042000000',
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
