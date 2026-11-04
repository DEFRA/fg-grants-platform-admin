import {
  confirmsRevoke,
  parseClientId,
  parseExpiry,
  parseNewToken,
  toExpiryFieldErrors,
  toExpiryPicker,
  toExpirySummary,
  toIssueFieldErrors,
  toKeepOldChoices
} from './access-token-forms.ts'

const now = new Date('2026-11-04T13:50:00.000Z')

describe('parseExpiry', () => {
  test.each([
    ['never', '', null],
    ['30', '', '2026-12-04T23:59:59.000Z'],
    ['90', '', '2027-02-02T23:59:59.000Z'],
    ['365', '', '2027-11-04T23:59:59.000Z'],
    ['custom', '2027-01-31', '2027-01-31T23:59:59.000Z'],
    ['custom', '2026-11-04', '2026-11-04T23:59:59.000Z']
  ] as const)('reads %s %s as %s', (expiry, date, expiresAt) => {
    expect(parseExpiry({ expiry, date }, now)).toEqual({
      ok: true,
      value: expiresAt
    })
  })

  test.each([
    ['', 'Pick a date.'],
    ['31/01/2027', 'Pick a date.'],
    ['2027-02-31', 'Pick a date.'],
    ['2027-13-01', 'Pick a date.'],
    ['2027-01-00', 'Pick a date.'],
    ['2027-01-32', 'Pick a date.'],
    ['2026-11-03', 'Pick a date in the future.']
  ])('refuses a custom date of "%s"', (date, message) => {
    expect(parseExpiry({ expiry: 'custom', date }, now)).toEqual({
      ok: false,
      errors: { expiry: message }
    })
  })

  test('keeps the exact current expiry when the custom date is left on its day', () => {
    expect(
      parseExpiry(
        {
          expiry: 'custom',
          date: '2027-01-31',
          current: '2027-01-31T10:00:00.000Z'
        },
        now
      )
    ).toEqual({ ok: true, value: '2027-01-31T10:00:00.000Z' })
  })

  test('never keeps a current expiry that has passed: an untouched date does not revive', () => {
    expect(
      parseExpiry(
        {
          expiry: 'custom',
          date: '2026-11-04',
          current: '2026-11-04T09:00:00.000Z'
        },
        now
      )
    ).toEqual({ ok: false, errors: { expiry: 'Pick a date in the future.' } })
  })

  test('moves to the end of a new day when the custom date is changed', () => {
    expect(
      parseExpiry(
        {
          expiry: 'custom',
          date: '2027-02-01',
          current: '2027-01-31T10:00:00.000Z'
        },
        now
      )
    ).toEqual({ ok: true, value: '2027-02-01T23:59:59.000Z' })
  })

  test.each([
    [
      'in winter, when the UK keeps GMT',
      '2027-01-15',
      '2027-01-15T23:59:59.000Z'
    ],
    [
      'in summer, when the UK is an hour ahead',
      '2027-07-15',
      '2027-07-15T22:59:59.000Z'
    ]
  ])('ends a custom date at 23:59:59 UK time %s', (_name, date, expiresAt) => {
    expect(parseExpiry({ expiry: 'custom', date }, now)).toEqual({
      ok: true,
      value: expiresAt
    })
  })

  test('says a summer custom date as that day, not the next', () => {
    expect(toExpirySummary({ expiry: 'custom', date: '2027-07-15' }, now)).toBe(
      'Expires 15 Jul 2027.'
    )
  })

  test('ends a preset at 23:59:59 UK time on its day, taking the day from UK time', () => {
    expect(
      parseExpiry(
        { expiry: '30', date: '' },
        new Date('2027-06-10T22:30:00.000Z')
      )
    ).toEqual({ ok: true, value: '2027-07-10T22:59:59.000Z' })
  })

  test('keeps a current expiry by its UK day, though in UTC it falls on the day before', () => {
    expect(
      parseExpiry(
        {
          expiry: 'custom',
          date: '2027-07-16',
          current: '2027-07-15T23:30:00.000Z'
        },
        now
      )
    ).toEqual({ ok: true, value: '2027-07-15T23:30:00.000Z' })
  })

  test('ignores the date for a preset', () => {
    expect(parseExpiry({ expiry: 'never', date: 'nonsense' }, now)).toEqual({
      ok: true,
      value: null
    })
  })
})

describe('toExpirySummary', () => {
  test.each([
    ['never', '', 'Never expires.'],
    ['90', '', 'Expires 2 Feb 2027.'],
    ['custom', '2026-11-04', 'Expires 4 Nov 2026.'],
    ['custom', '', 'Pick a date.'],
    ['custom', '2026-11-03', 'Pick a date in the future.']
  ] as const)('sums up %s %s', (expiry, date, summary) => {
    expect(toExpirySummary({ expiry, date }, now)).toBe(summary)
  })
})

describe('toExpiryPicker', () => {
  test('checks the chosen option and offers no day before today', () => {
    expect(
      toExpiryPicker('p', { expiry: '90', date: '' }, undefined, now)
    ).toEqual({
      id: 'p',
      choices: [
        { value: 'never', label: 'Never', checked: false },
        { value: '30', label: '30 days', checked: false },
        { value: '90', label: '90 days', checked: true },
        { value: '365', label: '1 year', checked: false },
        { value: 'custom', label: 'Custom date', checked: false }
      ],
      date: '',
      min: '2026-11-04',
      summary: 'Expires 2 Feb 2027.',
      error: null,
      current: '',
      resetTo: '90',
      resetDate: ''
    })
  })

  test('says an error the server sent instead of the summary', () => {
    const picker = toExpiryPicker(
      'p',
      { expiry: 'custom', date: '2026-01-01' },
      'Pick a date in the future.',
      now
    )

    expect(picker.summary).toBe('Pick a date in the future.')
    expect(picker.error).toBe('Pick a date in the future.')
  })
})

describe('parseClientId', () => {
  test.each([
    ['grants-ui', 'grants-ui'],
    ['  grants-ui  ', 'grants-ui'],
    ['a'.repeat(64), 'a'.repeat(64)]
  ])('accepts "%s"', (value, clientId) => {
    expect(parseClientId(value)).toEqual({ ok: true, value: clientId })
  })

  test.each([
    ['', 'Enter a client ID.'],
    ['   ', 'Enter a client ID.'],
    ['Grants_UI', 'Use lowercase letters, digits and hyphens only.'],
    ['grants ui', 'Use lowercase letters, digits and hyphens only.'],
    ['a'.repeat(65), 'Use 64 characters or fewer.']
  ])('refuses "%s"', (value, message) => {
    expect(parseClientId(value)).toEqual({
      ok: false,
      errors: { clientId: message }
    })
  })
})

describe('parseNewToken', () => {
  test('reads a client and an expiry', () => {
    expect(
      parseNewToken({ clientId: 'grants-ui', expiry: 'never', date: '' }, now)
    ).toEqual({ ok: true, value: { clientId: 'grants-ui', expiresAt: null } })
  })

  test('says every mistake at once', () => {
    expect(
      parseNewToken({ clientId: 'Bad', expiry: 'custom', date: '' }, now)
    ).toEqual({
      ok: false,
      errors: {
        clientId: 'Use lowercase letters, digits and hyphens only.',
        expiry: 'Pick a date.'
      }
    })
  })
})

describe('toIssueFieldErrors', () => {
  test.each([
    ['API_CLIENT_INVALID_NAME', 'clientId'],
    ['API_CLIENT_EXISTS', 'clientId'],
    ['API_CLIENT_NOT_FOUND', 'clientId'],
    ['API_TOKEN_INVALID_EXPIRY', 'expiry']
  ])('puts %s on the %s field', (errorCode, field) => {
    expect(Object.keys(toIssueFieldErrors(errorCode) ?? {})).toEqual([field])
  })

  test.each([['API_TOKEN_DUPLICATE'], [null]])(
    'has no field for %s',
    (errorCode) => {
      expect(toIssueFieldErrors(errorCode)).toBeNull()
    }
  )
})

describe('toExpiryFieldErrors', () => {
  test('puts a refused expiry on the picker, and nothing else', () => {
    expect(toExpiryFieldErrors('API_TOKEN_INVALID_EXPIRY')).toEqual({
      expiry: 'Pick a date in the future.'
    })
    expect(toExpiryFieldErrors('API_TOKEN_IN_USE')).toBeNull()
  })
})

describe('confirmsRevoke', () => {
  test.each([
    ['grants-ui', true],
    [' grants-ui ', true],
    ['grants-u', false],
    ['GRANTS-UI', false],
    ['', false]
  ])('reads "%s" as %s', (typed, confirmed) => {
    expect(confirmsRevoke(typed, 'grants-ui')).toBe(confirmed)
  })
})

describe('toKeepOldChoices', () => {
  test('offers all three, keeping the old token 24 hours by default', () => {
    expect(
      toKeepOldChoices(false).map(({ value, checked }) => [value, checked])
    ).toEqual([
      ['none', false],
      ['24h', true],
      ['7d', false]
    ])
  })

  test('comes back on the choice a refused rotation was sent with, starting afresh on 24 hours', () => {
    expect(
      toKeepOldChoices(false, '7d').map(({ value, checked, resetChecked }) => [
        value,
        checked,
        resetChecked
      ])
    ).toEqual([
      ['none', false, false],
      ['24h', false, true],
      ['7d', true, false]
    ])
  })

  test('never comes back checked on a choice it offers disabled', () => {
    expect(
      toKeepOldChoices(true, 'none').map(({ value, checked }) => [
        value,
        checked
      ])
    ).toEqual([
      ['none', false],
      ['24h', true],
      ['7d', false]
    ])
  })

  test('offers the token in use no immediate end, disabled rather than hidden', () => {
    expect(
      toKeepOldChoices(true).map(({ value, disabled }) => [value, disabled])
    ).toEqual([
      ['none', true],
      ['24h', false],
      ['7d', false]
    ])
  })
})
