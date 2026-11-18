import { grantType } from './grants-page.view-model.ts'
import { toVersionName, toVersionPath } from './record-type.ts'

const ref = { code: 'woodland creation', version: '1.2.0' }

describe('a config version', () => {
  test('is named code@version', () => {
    expect(toVersionName(ref)).toBe('woodland creation@1.2.0')
  })

  test('has its page at its code and version under its record’s path', () => {
    expect(toVersionPath(grantType, ref)).toBe(
      '/dev-ops/grants/woodland%20creation/1.2.0'
    )
  })
})
