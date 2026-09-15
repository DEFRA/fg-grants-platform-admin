import { toEventName } from './event-names.ts'

describe('toEventName', () => {
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

  test('shows the name in PascalCase and speaks it spaced', () => {
    const { name, spoken } = toEventName('io.onsite.agreement.status.updated')

    expect(name).toMatch(/^([A-Z][a-z]+)+$/)
    expect(name).not.toContain(' ')
    expect(spoken).toBe('Agreement status updated')
    expect(spoken.replace(/\s+/g, '').toLowerCase()).toBe(name.toLowerCase())
  })

  test.each([
    'cloud.defra.prd.fg-gas-backend.case.update.status',
    'cloud.defra.dev.fg-gas-backend.case.update.status',
    'cloud.defra.local.fg-cw-backend.case.update.status'
  ])('strips the namespace off %s before the lookup', (type) => {
    expect(toEventName(type).name).toBe('UpdateCaseStatus')
  })

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

  test('shows the type as it came when no words are left in it', () => {
    expect(toEventName('.')).toEqual({ name: '.', spoken: '.' })
    expect(toEventName('')).toEqual({ name: '', spoken: '' })
  })
})
