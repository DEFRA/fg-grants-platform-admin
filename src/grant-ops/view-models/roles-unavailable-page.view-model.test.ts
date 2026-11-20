import {
  rolesUnavailablePage,
  rolesUnavailableStatusCode
} from './roles-unavailable-page.view-model.ts'

describe('rolesUnavailablePage', () => {
  test('has a 503 heading', () => {
    expect(rolesUnavailablePage.heading).toBe(503)
  })

  test('titles the page after the problem', () => {
    expect(rolesUnavailablePage.pageTitle).toBe(
      'Caseworking roles could not be determined'
    )
  })

  test('tells the operator to try again later', () => {
    expect(rolesUnavailablePage.message).toContain('try again later')
  })
})

describe('rolesUnavailableStatusCode', () => {
  test('is 503', () => {
    expect(rolesUnavailableStatusCode).toBe(503)
  })
})
