import type { GrantAllowList } from '../repositories/allow-list.repository.ts'
import {
  toAllowListErrorSummary,
  toAllowListForm,
  validateAllowListForm
} from './allow-list-form.view-model.ts'

const persisted: GrantAllowList = {
  adminRole: 'ROLE_WOODLAND_ADMIN',
  grantCode: 'woodland',
  global: {
    sbi: ['106000033'],
    crn: ['1042000000']
  }
}

describe('validateAllowListForm', () => {
  test('normalises line endings, whitespace and blank lines', () => {
    expect(
      validateAllowListForm({
        sbi: ' 106000033\r\n\r106000044 \n\n',
        crn: ' 1042000000\r1042000011\r\n '
      })
    ).toEqual({
      global: {
        sbi: ['106000033', '106000044'],
        crn: ['1042000000', '1042000011']
      },
      errors: []
    })
  })

  test('accepts empty fields as an unrestricted allow list', () => {
    expect(validateAllowListForm({ sbi: '', crn: ' \n\r\n ' })).toEqual({
      global: { sbi: [], crn: [] },
      errors: []
    })
  })

  test('accepts identifiers with the exact required lengths', () => {
    expect(
      validateAllowListForm({ sbi: '106000033', crn: '1042000000' })
    ).toEqual({
      global: { sbi: ['106000033'], crn: ['1042000000'] },
      errors: []
    })
  })

  test.each([
    ['sbi', '10600003', 'SBI "10600003" on line 1 must be exactly 9 digits'],
    ['sbi', '10600003x', 'SBI "10600003x" on line 1 must be exactly 9 digits'],
    ['crn', '104200000', 'CRN "104200000" on line 1 must be exactly 10 digits'],
    [
      'crn',
      '104200000x',
      'CRN "104200000x" on line 1 must be exactly 10 digits'
    ]
  ] as const)('rejects an invalid %s', (key, value, message) => {
    const submission = { sbi: '', crn: '', [key]: value }

    expect(validateAllowListForm(submission)).toEqual({
      errors: [{ key, line: 1, message }]
    })
  })

  test.each([
    [
      'sbi',
      '106000033\n 106000033 ',
      'SBI "106000033" on line 2 is a duplicate of line 1'
    ],
    [
      'crn',
      '1042000000\r\n1042000000',
      'CRN "1042000000" on line 2 is a duplicate of line 1'
    ]
  ] as const)(
    'rejects duplicate %s values after trimming',
    (key, value, message) => {
      const submission = { sbi: '', crn: '', [key]: value }

      expect(validateAllowListForm(submission)).toEqual({
        errors: [{ key, line: 2, message }]
      })
    }
  )

  test('reports each invalid and duplicate line separately', () => {
    expect(validateAllowListForm({ sbi: 'invalid\ninvalid', crn: '' })).toEqual(
      {
        errors: [
          {
            key: 'sbi',
            line: 1,
            message: 'SBI "invalid" on line 1 must be exactly 9 digits'
          },
          {
            key: 'sbi',
            line: 2,
            message: 'SBI "invalid" on line 2 must be exactly 9 digits'
          },
          {
            key: 'sbi',
            line: 2,
            message: 'SBI "invalid" on line 2 is a duplicate of line 1'
          }
        ]
      }
    )
  })

  test('uses visible line numbers including blank lines', () => {
    expect(
      validateAllowListForm({
        sbi: '\n  106000033  \r\n\r106000033',
        crn: ''
      })
    ).toEqual({
      errors: [
        {
          key: 'sbi',
          line: 4,
          message: 'SBI "106000033" on line 4 is a duplicate of line 2'
        }
      ]
    })
  })

  test('reports both fields in SBI then CRN order without a payload', () => {
    expect(validateAllowListForm({ sbi: 'bad', crn: 'also bad' })).toEqual({
      errors: [
        {
          key: 'sbi',
          line: 1,
          message: 'SBI "bad" on line 1 must be exactly 9 digits'
        },
        {
          key: 'crn',
          line: 1,
          message: 'CRN "also bad" on line 1 must be exactly 10 digits'
        }
      ]
    })
  })
})

describe('toAllowListForm', () => {
  test('shows persisted identifiers one per line with singular counts', () => {
    expect(toAllowListForm(persisted)).toEqual({
      sbi: {
        key: 'sbi',
        label: 'Single Business Identifiers (SBIs)',
        value: '106000033',
        hint: 'One per line. 1 listed.',
        error: undefined
      },
      crn: {
        key: 'crn',
        label: 'Customer Reference Numbers (CRNs)',
        value: '1042000000',
        hint: 'One per line. 1 listed.',
        error: undefined
      }
    })
  })

  test('shows zero counts for an unrestricted allow list', () => {
    const form = toAllowListForm({
      grantCode: 'woodland',
      global: { sbi: [], crn: [] }
    })

    expect(form.sbi.hint).toBe('One per line. 0 listed.')
    expect(form.crn.hint).toBe('One per line. 0 listed.')
  })

  test('preserves submitted text and counts every nonblank line', () => {
    const submitted = {
      sbi: ' 106000033\r\n\r\n106000033 ',
      crn: 'bad\rvalue\n'
    }
    const errors = [
      { key: 'sbi' as const, line: 1, message: 'Duplicate SBI' },
      { key: 'crn' as const, line: 1, message: 'Invalid CRN' }
    ]

    expect(toAllowListForm(persisted, submitted, errors)).toMatchObject({
      sbi: {
        value: submitted.sbi,
        hint: 'One per line. 2 listed.',
        error: 'Duplicate SBI'
      },
      crn: {
        value: submitted.crn,
        hint: 'One per line. 2 listed.',
        error: 'Invalid CRN'
      }
    })
  })
})

describe('toAllowListErrorSummary', () => {
  test('links each error to its textarea', () => {
    expect(
      toAllowListErrorSummary([
        { key: 'sbi', line: 2, message: 'Invalid SBI' },
        { key: 'crn', line: 5, message: 'Invalid CRN' }
      ])
    ).toEqual([
      {
        text: 'Invalid SBI',
        href: '#sbi',
        attributes: { 'data-error-line': 2 }
      },
      {
        text: 'Invalid CRN',
        href: '#crn',
        attributes: { 'data-error-line': 5 }
      }
    ])
  })
})
