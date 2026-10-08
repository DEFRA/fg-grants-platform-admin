import type { RequiredRoles } from './claims-access.ts'
import { resolveClaimsAccess } from './claims-access.ts'

describe('resolveClaimsAccess', () => {
  const claimsRoles: RequiredRoles = {
    allOf: ['ROLE_WMP', 'ROLE_WMP_CLAIMS'],
    anyOf: []
  }

  test('is full when no claims roles are configured', () => {
    expect(resolveClaimsAccess(['ANY'], null)).toBe('full')
    expect(resolveClaimsAccess(['ANY'], undefined)).toBe('full')
  })

  test('is full when user satisfies claimsRequiredRoles', () => {
    expect(
      resolveClaimsAccess(['ROLE_WMP', 'ROLE_WMP_CLAIMS'], claimsRoles)
    ).toBe('full')
  })

  test('is view-only when user has roles but not the claims roles', () => {
    expect(resolveClaimsAccess(['ROLE_WMP'], claimsRoles)).toBe('view-only')
    expect(resolveClaimsAccess(['ROLE_OTHER'], claimsRoles)).toBe('view-only')
  })

  test('is hidden when cwRoles is null (CW unreachable)', () => {
    expect(resolveClaimsAccess(null, claimsRoles)).toBe('hidden')
  })

  test('is hidden when cwRoles is empty array', () => {
    expect(resolveClaimsAccess([], claimsRoles)).toBe('hidden')
  })

  test('handles anyOf correctly', () => {
    const withAnyOf: RequiredRoles = {
      allOf: ['ROLE_WMP'],
      anyOf: ['ROLE_WMP_CLAIMS', 'ROLE_WMP_CLAIMS_ALT']
    }

    expect(
      resolveClaimsAccess(['ROLE_WMP', 'ROLE_WMP_CLAIMS'], withAnyOf)
    ).toBe('full')

    expect(
      resolveClaimsAccess(['ROLE_WMP', 'ROLE_WMP_CLAIMS_ALT'], withAnyOf)
    ).toBe('full')

    expect(resolveClaimsAccess(['ROLE_WMP'], withAnyOf)).toBe('view-only')
  })
})
