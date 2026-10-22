import { toNotStored } from './version-page.ts'
import type { VersionFiles } from './version-banner.ts'

const version = (fetchStatus: 'pending' | 'permanent_error'): VersionFiles => ({
  code: 'qa-complex',
  version: '0.31.0',
  status: 'active',
  files: { grant: { stored: false, fetchStatus } }
})

describe('toNotStored', () => {
  test('says what the tab shows once its file is stored', () => {
    expect(toNotStored(version('pending'), 'questions', 'grant')).toEqual({
      file: 'grant',
      text: 'The questions appear once the grant definition is stored.'
    })
  })

  test('says a Failed file will show nothing, never that it will be stored', () => {
    expect(
      toNotStored(version('permanent_error'), 'questions', 'grant')?.text
    ).toBe(
      'The grant definition failed to load, so there is nothing to show. See the banner.'
    )
  })

  test('says nothing for a stored file, or a tab that needs none', () => {
    expect(
      toNotStored(
        {
          ...version('pending'),
          files: { grant: { stored: true, fetchStatus: 'pending' } }
        },
        'questions',
        'grant'
      )
    ).toBeNull()
    expect(toNotStored(version('pending'), 'events', null)).toBeNull()
  })
})
