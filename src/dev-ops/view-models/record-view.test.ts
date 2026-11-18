import { applicationOf, caseOf } from './record-view.ts'

describe('caseOf and applicationOf', () => {
  test("a case is named after its application's grant and keeps its ref", () => {
    expect(caseOf({ code: 'woodland', clientRef: 'gld-ssp-x9v' })).toEqual({
      workflowCode: 'woodland',
      caseRef: 'gld-ssp-x9v'
    })
  })

  test('an application is the one its case is named after', () => {
    expect(
      applicationOf({ workflowCode: 'woodland', caseRef: 'gld-ssp-x9v' })
    ).toEqual({ code: 'woodland', clientRef: 'gld-ssp-x9v' })
  })
})
