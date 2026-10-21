import { toStampedEventName } from './event-names.ts'

describe('toStampedEventName', () => {
  test.each([
    ['UpdateCaseStatus', 'Update case status'],
    ['AgreementStatusChangedReport', 'Agreement status changed report'],
    ['Audit', 'Audit'],
    ['Unrecognised', 'Unrecognised']
  ])('shows %s as it is stored, spoken "%s"', (name, spoken) => {
    expect(toStampedEventName(name)).toEqual({ name, spoken })
  })

  test('shows a name it cannot split as it is, spoken the same', () => {
    expect(toStampedEventName('unknown')).toEqual({
      name: 'unknown',
      spoken: 'Unknown'
    })
  })
})
