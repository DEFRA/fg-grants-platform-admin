import { toEventName } from './event-names.ts'

describe('toEventName', () => {
  // Every type in the local estate: GAS outbox and inbox, CW inbox and
  // outbox. Commands read as imperatives, notifications in the past tense.
  test.each([
    ['agreement.create', 'CreateAgreement', 'Create agreement'],
    [
      'agreement.status.update',
      'UpdateAgreementStatus',
      'Update agreement status'
    ],
    [
      'agreement.status.updated',
      'AgreementStatusUpdated',
      'Agreement status updated'
    ],
    ['application.created', 'ApplicationCreated', 'Application created'],
    [
      'application.status.updated',
      'ApplicationStatusUpdated',
      'Application status updated'
    ],
    ['case.create', 'CreateCase', 'Create case'],
    ['case.update.status', 'UpdateCaseStatus', 'Update case status'],
    ['case.status.updated', 'CaseStatusUpdated', 'Case status updated'],
    [
      'io.onsite.agreement.create-payment',
      'CreateAgreementPayment',
      'Create agreement payment'
    ],
    [
      'io.onsite.agreement.status.updated',
      'AgreementStatusUpdated',
      'Agreement status updated'
    ],
    ['audit', 'AuditRecord', 'Audit record'],
    ['unknown', 'NoTypeRecorded', 'No type recorded']
  ])('names %s as %s, spoken "%s"', (type, name, spoken) => {
    expect(toEventName(type)).toEqual({ name, spoken })
  })

  // Shown in PascalCase, one word with no spaces; a screen reader gets the
  // same words spaced, so the name is not read as one mashed word.
  test('shows the name in PascalCase and speaks it spaced', () => {
    const { name, spoken } = toEventName('io.onsite.agreement.status.updated')

    expect(name).toMatch(/^([A-Z][a-z]+)+$/)
    expect(name).not.toContain(' ')
    expect(spoken).toBe('Agreement status updated')
    expect(spoken.replace(/\s+/g, '').toLowerCase()).toBe(name.toLowerCase())
  })

  // fg-gas-backend strips the namespace already; a type that ever arrives
  // whole must still find its name, whatever environment it names.
  test.each([
    'cloud.defra.prd.fg-gas-backend.case.update.status',
    'cloud.defra.dev.fg-gas-backend.case.update.status',
    'cloud.defra.local.fg-cw-backend.case.update.status'
  ])('strips the namespace off %s before the lookup', (type) => {
    expect(toEventName(type).name).toBe('UpdateCaseStatus')
  })

  // A type the table has never seen still reads as words, by the same rule:
  // its last three meaningful segments, split on their separators.
  test.each([
    [
      'grant.application.submitted',
      'GrantApplicationSubmitted',
      'Grant application submitted'
    ],
    [
      'io.onsite.agreement.payment-failed',
      'AgreementPaymentFailed',
      'Agreement payment failed'
    ],
    [
      'cloud.defra.prd.fg-gas-backend.grant_payment.status.changed',
      'GrantPaymentStatusChanged',
      'Grant payment status changed'
    ],
    ['Payment.REQUESTED', 'PaymentRequested', 'Payment requested'],
    ['heartbeat', 'Heartbeat', 'Heartbeat']
  ])('humanises the unknown %s as %s', (type, name, spoken) => {
    expect(toEventName(type)).toEqual({ name, spoken })
  })

  test('finds no words for a type spelled like an inherited key', () => {
    expect(toEventName('constructor')).toEqual({
      name: 'Constructor',
      spoken: 'Constructor'
    })
  })

  // Never empty: an empty name is an empty cell, which reads as a row the
  // page failed to draw.
  test('shows the type as it came when no words are left in it', () => {
    expect(toEventName('.')).toEqual({ name: '.', spoken: '.' })
    expect(toEventName('')).toEqual({ name: '', spoken: '' })
  })
})
