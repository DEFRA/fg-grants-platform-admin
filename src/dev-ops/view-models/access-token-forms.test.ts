import {
  confirmsRevoke,
  missingDate,
  parseClientId,
  parseExpiry,
  parseNewToken,
  pastDate,
  toExpiryFieldErrors,
  toExpiryGroup,
  toIssueFieldErrors,
  toKeepOldOptions,
  unchangedExpiry
} from './access-token-forms.ts'

/** A winter afternoon in the UK. */
const winter = new Date('2026-11-10T15:00:00.000Z')
/** 00:30 BST on 1 Jul: still 30 Jun in UTC, already 1 Jul in the UK. */
const summerMidnight = new Date('2026-06-30T23:30:00.000Z')

describe('parseExpiry', () => {
  test('never is null', () => {
    expect(parseExpiry({ expiry: 'never', date: '' }, winter)).toEqual({
      ok: true,
      value: null
    })
  })

  test.each([
    ['30', '2026-12-10T23:59:59.000Z'],
    ['90', '2027-02-08T23:59:59.000Z'],
    ['365', '2027-11-10T23:59:59.000Z']
  ] as const)(
    'a %s-day preset ends at 23:59:59 UK time on that day',
    (expiry, expected) => {
      expect(parseExpiry({ expiry, date: '' }, winter)).toEqual({
        ok: true,
        value: expected
      })
    }
  )

  test('a preset counts its days from the UK date, and ends in summer time when it lands in summer', () => {
    expect(parseExpiry({ expiry: '30', date: '' }, summerMidnight)).toEqual({
      ok: true,
      value: '2026-07-31T22:59:59.000Z'
    })
  })

  test('a preset adds calendar days to the UK date in the hour after UK midnight in summer time', () => {
    // 00:30 BST on 1 Oct 2026 is still 30 Sep in UTC: 90 days from 1 Oct is 30 Dec.
    expect(
      parseExpiry(
        { expiry: '90', date: '' },
        new Date('2026-09-30T23:30:00.000Z')
      )
    ).toEqual({ ok: true, value: '2026-12-30T23:59:59.000Z' })
  })

  test('a preset adds calendar days across the change to summer time', () => {
    // 23:30 GMT on 1 Mar 2027: 30 days on is 31 Mar, in BST.
    expect(
      parseExpiry(
        { expiry: '30', date: '' },
        new Date('2027-03-01T23:30:00.000Z')
      )
    ).toEqual({ ok: true, value: '2027-03-31T22:59:59.000Z' })
  })

  test('a preset adds calendar days in the hour after UK midnight across the change to winter time', () => {
    // 00:30 BST on 25 Oct 2026, the day the clocks go back: 30 days on is 24 Nov, in GMT.
    expect(
      parseExpiry(
        { expiry: '30', date: '' },
        new Date('2026-10-24T23:30:00.000Z')
      )
    ).toEqual({ ok: true, value: '2026-11-24T23:59:59.000Z' })
  })

  test('a custom date ends at 23:59:59 UK time, across the clock change', () => {
    expect(
      parseExpiry({ expiry: 'custom', date: '2027-04-04' }, winter)
    ).toEqual({ ok: true, value: '2027-04-04T22:59:59.000Z' })
    expect(
      parseExpiry({ expiry: 'custom', date: '2027-02-04' }, winter)
    ).toEqual({ ok: true, value: '2027-02-04T23:59:59.000Z' })
  })

  test.each(['', '2027-02-30', 'tomorrow'])(
    'a custom date of %j asks for a date',
    (date) => {
      expect(parseExpiry({ expiry: 'custom', date }, winter)).toEqual({
        ok: false,
        errors: { date: missingDate }
      })
    }
  )

  test('today is taken, ending at 23:59:59 UK time', () => {
    expect(
      parseExpiry({ expiry: 'custom', date: '2026-07-01' }, summerMidnight)
    ).toEqual({ ok: true, value: '2026-07-01T22:59:59.000Z' })
  })

  test('a day the clock can’t place is no date, not a failure', () => {
    expect(
      parseExpiry({ expiry: 'custom', date: '0000-01-01' }, winter)
    ).toEqual({ ok: false, errors: { date: missingDate } })
  })

  test('a past date is left for GAS to refuse', () => {
    expect(
      parseExpiry({ expiry: 'custom', date: '2026-11-09' }, winter)
    ).toEqual({ ok: true, value: '2026-11-09T23:59:59.000Z' })
  })
})

describe('toExpiryGroup', () => {
  test('says where each choice lands, the custom date starting today', () => {
    const group = toExpiryGroup(
      'token-new-expiry',
      { expiry: '90', date: '' },
      {},
      winter
    )

    expect(group.options).toEqual([
      {
        value: 'never',
        text: 'Never',
        hint: 'Not recommended for a service.',
        checked: false
      },
      {
        value: '30',
        text: '30 days',
        hint: 'Ends 10 Dec 2026.',
        checked: false
      },
      { value: '90', text: '90 days', hint: 'Ends 8 Feb 2027.', checked: true },
      {
        value: '365',
        text: '1 year',
        hint: 'Ends 10 Nov 2027.',
        checked: false
      },
      { value: 'custom', text: 'Custom date', hint: null, checked: false }
    ])
    expect(group).toMatchObject({
      dateId: 'token-new-expiry-date',
      today: '2026-11-10',
      min: '2026-11-10',
      error: null,
      dateError: null
    })
  })

  test('carries the errors for the choices and the date box apart', () => {
    expect(
      toExpiryGroup(
        'g',
        { expiry: 'custom', date: '' },
        { date: missingDate },
        winter
      )
    ).toMatchObject({ error: null, dateError: missingDate, date: '' })
  })
})

describe('the date box', () => {
  test('starts at its today, in UK days', () => {
    expect(
      toExpiryGroup('g', { expiry: '90', date: '' }, {}, summerMidnight)
    ).toMatchObject({ today: '2026-07-01', min: '2026-07-01' })
  })
})

describe('parseClientId', () => {
  test('trims what a paste brings along', () => {
    expect(parseClientId('  grants-ui ')).toEqual({
      ok: true,
      value: 'grants-ui'
    })
  })

  test.each(['', 'Grants-UI', 'grants_ui', 'grants ui'])(
    '%j breaks the name rule',
    (value) => {
      expect(parseClientId(value)).toEqual({
        ok: false,
        errors: {
          clientId: 'Use lowercase letters, digits and hyphens only.'
        }
      })
    }
  )

  test('takes 64 characters but not 65', () => {
    expect(parseClientId('a'.repeat(64)).ok).toBe(true)
    expect(parseClientId('a'.repeat(65))).toEqual({
      ok: false,
      errors: { clientId: 'Use 64 characters or fewer.' }
    })
  })
})

describe('parseNewToken', () => {
  test('shows every mistake at once', () => {
    expect(
      parseNewToken(
        { clientId: '', expiry: 'custom', date: '', confirmFor: '' },
        winter
      )
    ).toEqual({
      ok: false,
      errors: {
        clientId: 'Use lowercase letters, digits and hyphens only.',
        date: missingDate
      }
    })
  })

  test('answers the client and its expiry', () => {
    expect(
      parseNewToken(
        { clientId: 'grants-ui', expiry: 'never', date: '', confirmFor: '' },
        winter
      )
    ).toEqual({ ok: true, value: { clientId: 'grants-ui', expiresAt: null } })
  })
})

describe('the refusals a different answer can fix', () => {
  test('a name the service refuses goes on the client field', () => {
    expect(toIssueFieldErrors('API_CLIENT_INVALID_NAME', '90')).toEqual({
      clientId: 'Use lowercase letters, digits and hyphens only.'
    })
  })

  test('a refused expiry goes on the date box for a custom date, else on the choices', () => {
    expect(toIssueFieldErrors('API_TOKEN_INVALID_EXPIRY', 'custom')).toEqual({
      date: pastDate
    })
    expect(toExpiryFieldErrors('API_TOKEN_INVALID_EXPIRY', '30')).toEqual({
      expiry: pastDate
    })
  })

  test.each([
    ['EXPIRY_PAST', 'custom', { date: pastDate }],
    ['EXPIRY_PAST', '30', { expiry: pastDate }],
    ['EXPIRY_UNCHANGED', 'custom', { date: unchangedExpiry }],
    ['EXPIRY_UNCHANGED', 'never', { expiry: unchangedExpiry }]
  ])(
    'the service’s %s on a %s expiry goes on its field',
    (errorCode, expiry, errors) => {
      expect(toExpiryFieldErrors(errorCode, expiry)).toEqual(errors)
    }
  )

  test('any other code is none of a field’s', () => {
    expect(toIssueFieldErrors('API_TOKEN_DUPLICATE', '90')).toBeNull()
    expect(toIssueFieldErrors('API_CLIENT_EXISTS', '90')).toBeNull()
    expect(toIssueFieldErrors('EXPIRY_UNCHANGED', '90')).toBeNull()
    expect(toExpiryFieldErrors(null, '90')).toBeNull()
  })
})

describe('confirmsRevoke', () => {
  test('takes the client typed exactly, spaces aside', () => {
    expect(confirmsRevoke(' grants-ui ', 'grants-ui')).toBe(true)
    expect(confirmsRevoke('grants', 'grants-ui')).toBe(false)
    expect(confirmsRevoke('GRANTS-UI', 'grants-ui')).toBe(false)
  })
})

describe('toKeepOldOptions', () => {
  test('starts on Keep valid until end of tomorrow', () => {
    expect(
      toKeepOldOptions(null, undefined).map(({ value, checked, disabled }) => [
        value,
        checked,
        disabled
      ])
    ).toEqual([
      ['none', false, false],
      ['24h', true, false],
      ['7d', false, false]
    ])
  })

  test('comes back on the choice a refused rotation was sent with', () => {
    expect(
      toKeepOldOptions(null, '7d').find(({ checked }) => checked)?.value
    ).toBe('7d')
  })

  test('turns Expire immediately off for the token in use, saying why, and never starts on it', () => {
    const options = toKeepOldOptions(
      { reason: 'Not for the token in use.' },
      'none'
    )

    expect(options[0]).toMatchObject({
      value: 'none',
      checked: false,
      disabled: true,
      reason: 'Not for the token in use.'
    })
    expect(options[1].checked).toBe(true)
  })
})
