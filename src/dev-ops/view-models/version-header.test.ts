import type { GrantVersionHeader } from '../use-cases/get-grant-page.use-case.ts'
import { grantType } from './grants-page.view-model.ts'
import { workflowType } from './workflows-page.view-model.ts'
import { toVersionHeader } from './version-header.ts'

const header = (
  overrides: Partial<GrantVersionHeader> = {}
): GrantVersionHeader => ({
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-10-10T16:25:00.000Z',
  files: { grant: { stored: true, fetchStatus: 'fetched' } },
  versions: [
    {
      version: '2.0.0',
      status: 'draft',
      receivedAt: '2026-10-15T10:04:00.000Z'
    },
    {
      version: '1.2.0',
      status: 'active',
      receivedAt: '2026-10-10T16:25:00.000Z'
    }
  ],
  counterpart: null,
  ...overrides
})

const notStored = { stored: false, fetchStatus: 'pending' } as const

describe('toVersionHeader', () => {
  test.each([
    ['active', 'Active', 'success'],
    ['draft', 'Draft', 'neutral']
  ] as const)('shows a %s version as %s', (status, label, role) => {
    expect(
      toVersionHeader(grantType, header({ status }), 'overview', '').status
    ).toEqual({ status: label, role })
  })

  test('switches between every version, newest first, as plain links on a small trigger', () => {
    const { switcher } = toVersionHeader(grantType, header(), 'overview', '')

    expect(switcher).toMatchObject({
      name: 'Version',
      label: 'Versions of woodland-creation',
      small: true,
      testId: 'grant-switcher',
      panelId: 'grant-switcher-panel'
    })
    expect(switcher.items).toEqual([
      {
        label: '2.0.0',
        status: { status: 'Draft', role: 'neutral' },
        aside: '15 Oct 11:04',
        href: '/dev-ops/grants/woodland-creation/2.0.0',
        active: false
      },
      {
        label: '1.2.0',
        status: { status: 'Active', role: 'success' },
        aside: '10 Oct 17:25',
        href: '/dev-ops/grants/woodland-creation/1.2.0',
        active: true
      }
    ])
    expect(switcher.items.some((item) => 'value' in item)).toBe(false)
  })

  test('shows a received time that is not a date as stored', () => {
    const { switcher } = toVersionHeader(
      grantType,
      header({
        versions: [{ version: '1.2.0', status: 'active', receivedAt: 'soon' }]
      }),
      'overview',
      ''
    )

    expect(switcher.items[0].aside).toBe('soon')
  })

  test('keeps the tab and the list it was opened from on every version', () => {
    const from = '/dev-ops/grants?status=draft'
    const { switcher } = toVersionHeader(grantType, header(), 'raw', from)

    expect(switcher.items.map(({ href }) => href)).toEqual([
      '/dev-ops/grants/woodland-creation/2.0.0?tab=raw&back=%2Fdev-ops%2Fgrants%3Fstatus%3Ddraft',
      '/dev-ops/grants/woodland-creation/1.2.0?tab=raw&back=%2Fdev-ops%2Fgrants%3Fstatus%3Ddraft'
    ])
  })

  test('has no banner when every file is stored', () => {
    expect(
      toVersionHeader(
        grantType,
        header({
          files: {
            grant: { stored: true, fetchStatus: 'fetched' },
            payment: { stored: true, fetchStatus: 'pending' }
          }
        }),
        'overview',
        ''
      ).banner
    ).toBeNull()
  })

  test.each([
    [
      'one file',
      { grant: { stored: true, fetchStatus: 'fetched' }, payment: notStored },
      'Payment definition not stored.'
    ],
    [
      'two files',
      { grant: notStored, payment: notStored },
      'Grant and payment definitions not stored.'
    ],
    [
      'three files, in the order grant, agreement, payment',
      { payment: notStored, agreement: notStored, grant: notStored },
      'Grant, agreement and payment definitions not stored.'
    ]
  ] as const)('names %s not stored', (_name, files, text) => {
    expect(
      toVersionHeader(grantType, header({ files }), 'overview', '').banner
    ).toMatchObject({ text })
  })

  test("says GAS won't use the version when a file not stored has failed for good", () => {
    expect(
      toVersionHeader(
        grantType,
        header({
          files: {
            grant: { stored: false, fetchStatus: 'permanent_error' },
            payment: notStored
          }
        }),
        'overview',
        ''
      ).banner
    ).toMatchObject({
      text: "Grant and payment definitions not stored. GAS won't use this version."
    })
  })

  test('says nothing of a stored file that failed for good', () => {
    expect(
      toVersionHeader(
        grantType,
        header({
          files: {
            grant: { stored: true, fetchStatus: 'permanent_error' },
            payment: notStored
          }
        }),
        'overview',
        ''
      ).banner
    ).toMatchObject({ text: 'Payment definition not stored.' })
  })

  test('posts the fetch for this version, coming back to the same tab and list', () => {
    const from = '/dev-ops/grants?status=draft'

    expect(
      toVersionHeader(
        grantType,
        header({ files: { grant: notStored } }),
        'raw',
        from
      ).banner
    ).toEqual({
      text: 'Grant definition not stored.',
      action: '/dev-ops/grants/woodland-creation/1.2.0/fetch',
      back: from,
      tab: 'raw'
    })
  })

  test.each([
    ['pending', 'Workflow definition not stored.'],
    [
      'permanent_error',
      "Workflow definition not stored. CW won't use this version."
    ]
  ] as const)(
    'names a %s workflow not stored, posting the fetch to the workflow page',
    (fetchStatus, text) => {
      expect(
        toVersionHeader(
          workflowType,
          { ...header(), files: { workflow: { stored: false, fetchStatus } } },
          'raw',
          ''
        ).banner
      ).toEqual({
        text,
        action: '/dev-ops/workflows/woodland-creation/1.2.0/fetch',
        back: '',
        tab: 'raw'
      })
    }
  )
})
