import type { DefinitionFile } from '../repositories/config-versions.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'
import { grantType } from './grants-page.view-model.ts'
import { toBannerLines, toFileLines } from './version-banner.ts'
import type { VersionFiles } from './version-banner.ts'
import type { Words } from './words.ts'
import { workflowType } from './workflows-page.view-model.ts'

const version = (
  files: VersionFiles['files'],
  overrides: Partial<VersionFiles> = {}
): VersionFiles => ({
  code: 'qa-complex',
  version: '1.1.0',
  status: 'active',
  s3Bucket: 'config-broker-local',
  files,
  ...overrides
})

const file = (overrides: Partial<DefinitionFile>): DefinitionFile => ({
  stored: false,
  fetchStatus: 'pending',
  s3Key: 'qa-complex/1.1.0/gas/gas.json',
  ...overrides
})

/** A line as the page reads it, codes in backticks and bold in stars. */
const said = (words: Words): string =>
  words
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      return 'code' in part
        ? `\`${part.code}\``
        : `**${'strong' in part ? part.strong : part.link}**`
    })
    .join('')

const lines = (
  files: VersionFiles['files'],
  overrides = {},
  record = grantType
) => toBannerLines(record, version(files, overrides))?.lines.map(said)

describe('toBannerLines', () => {
  test('says a grant file not stored yet is fetched only for the newest usable version of its major', () => {
    expect(lines({ grant: file({}) })).toEqual([
      "Grant definition not stored yet. GAS fetches it from S3 when it first needs it. GAS only uses the newest usable version in each major, so an older version's grant file is never fetched; that is normal. Fetch definitions stores it now."
    ])
  })

  test('says nothing of files stored and loaded', () => {
    expect(
      toBannerLines(
        grantType,
        version({ grant: file({ stored: true, fetchStatus: 'fetched' }) })
      )
    ).toBeNull()
  })

  test('says an agreement or payment file not stored yet is fetched when an agreement or claim on the version needs it', () => {
    expect(lines({ agreement: file({}) })).toEqual([
      'Agreement definition not stored yet. GAS fetches it from S3 the first time an agreement or claim on 1.1.0 needs it. Fetch definitions stores it now.'
    ])
  })

  test("counts a grant file's attempts out of 5, with where and why its last fetch failed", () => {
    const result = toBannerLines(
      grantType,
      version({
        grant: file({
          fetchStatus: 'transient_error',
          fetchAttempts: 2,
          fetchError: 'S3 timed out'
        })
      })
    )

    expect(result?.tone).toBe('warning')
    expect(result?.lines.map(said)).toEqual([
      "Grant definition: fetch error, attempt 2 of 5. GAS's last fetch of `config-broker-local/qa-complex/1.1.0/gas/gas.json` failed: `S3 timed out`. GAS tries again the next time it needs this version."
    ])
  })

  test('says GAS will not fetch a grant file again at the fifth attempt, and marks it Failed', () => {
    expect(
      lines({
        grant: file({
          fetchStatus: 'transient_error',
          fetchAttempts: 5,
          fetchError: 'x'
        })
      })
    ).toEqual([
      "Grant definition: fetch error, attempt 5 of 5. GAS's last fetch of `config-broker-local/qa-complex/1.1.0/gas/gas.json` failed: `x`. GAS won't fetch it again: it marks it Failed the next time it needs this version."
    ])
  })

  test('counts failed fetches in a row for a payment file, which has no cap', () => {
    expect(
      lines({
        payment: file({
          fetchStatus: 'transient_error',
          fetchAttempts: 3,
          fetchError: 'x'
        })
      })
    ).toEqual([
      "Payment definition: fetch error, 3 failed fetches in a row. GAS's last fetch of `config-broker-local/qa-complex/1.1.0/gas/gas.json` failed: `x`. GAS tries again each time it needs this file."
    ])
  })

  test('leaves out the attempts, the location and the error when the backend has not got them', () => {
    expect(
      lines(
        {
          grant: {
            stored: false,
            fetchStatus: 'transient_error',
            fetchError: null
          }
        },
        { s3Bucket: null }
      )
    ).toEqual([
      "Grant definition: fetch error. GAS's last fetch failed. GAS tries again the next time it needs this version."
    ])
  })

  test('says a stored grant file not yet loaded is ignored by GAS, in an info tone', () => {
    const result = toBannerLines(
      grantType,
      version({ grant: file({ stored: true }) })
    )

    expect(result?.tone).toBe('info')
    expect(result?.lines.map(said)).toEqual([
      "Grant definition stored. GAS hasn't loaded it itself yet, so the Grants list shows it as Not stored yet (or Fetch error). GAS ignores this copy and still fetches the file from S3 itself the first time it needs it."
    ])
  })

  test('says a stored agreement file not yet loaded is used as stored', () => {
    expect(
      lines({
        agreement: file({ stored: true, fetchStatus: 'transient_error' })
      })?.[0]
    ).toMatch(/GAS uses this stored copy the first time it needs it\.$/)
  })

  test.each([
    [
      'grant',
      "Grant definition failed: `bad JSON`. GAS won't roll forward to this version: applications on 1.x use the newest usable 1.x version instead. If this is the newest version, calls that name no version (the allow list and administration) fail. Publish a fixed version."
    ],
    [
      'agreement',
      "Agreement definition failed: `bad JSON`. GAS won't use this agreement definition: new agreements use the newest usable 1.x one at or below 1.1.0, and actions before acceptance use the newest usable 1.x one. Publish a fixed version."
    ],
    [
      'payment',
      'Payment definition failed: `bad JSON`. Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.'
    ]
  ] as const)(
    'says what a Failed %s file stops, in the error tone',
    (type, text) => {
      const result = toBannerLines(
        grantType,
        version({
          [type]: file({
            fetchStatus: 'permanent_error',
            fetchError: 'bad JSON'
          })
        })
      )

      expect(result?.tone).toBe('error')
      expect(result?.lines.map(said)).toEqual([text])
    }
  )

  test('says a stored file GAS marked failed is still failed', () => {
    expect(
      lines({
        payment: file({
          stored: true,
          fetchStatus: 'permanent_error',
          fetchError: null
        })
      })?.[0]
    ).toBe(
      'Payment definition stored, but GAS marked it failed. Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.'
    )
  })

  test('names CW for a workflow file, and its own consequence', () => {
    expect(
      lines(
        {
          workflow: file({ fetchStatus: 'permanent_error', fetchError: null })
        },
        {},
        workflowType
      )
    ).toEqual([
      "Workflow definition failed. CW won't roll forward to this version: cases on 1.x use the newest usable 1.x version instead. Publish a fixed version."
    ])
    expect(lines({ workflow: file({}) }, {}, workflowType)?.[0]).toBe(
      "Workflow definition not stored yet. CW fetches it from S3 when it first needs it. CW only uses the newest usable version in each major, so an older version's workflow file is never fetched; that is normal. Fetch definition stores it now."
    )
  })

  test('opens a draft with the draft sentence, and stops its file sentences after their first', () => {
    expect(
      lines(
        {
          grant: file({}),
          payment: file({ fetchStatus: 'transient_error', fetchAttempts: 1 })
        },
        { status: 'draft' }
      )
    ).toEqual([
      "**Draft:** GAS won't pick this version for new work until the config broker publishes it as active. Fetch definitions stores its files now; once the version is active, GAS uses the stored agreement and payment files, and still fetches the grant file from S3 itself.",
      'Grant definition not stored yet.',
      'Payment definition: fetch error, 1 failed fetches in a row.'
    ])
  })

  test('on a draft, never says when GAS loads a stored file', () => {
    expect(
      lines(
        { grant: file({ stored: true }), agreement: file({ stored: true }) },
        { status: 'draft' }
      )?.slice(1)
    ).toEqual([
      "Grant definition stored. GAS hasn't loaded it itself yet, so the Grants list shows it as Not stored yet (or Fetch error).",
      "Agreement definition stored. GAS hasn't loaded it itself yet, so the Grants list shows it as Not stored yet (or Fetch error)."
    ])
  })

  test('takes the worst tone of its files, in file order', () => {
    const result = toBannerLines(
      grantType,
      version({
        payment: file({ fetchStatus: 'permanent_error' }),
        grant: file({ fetchStatus: 'transient_error' }),
        agreement: file({})
      })
    )

    expect(result?.tone).toBe('error')
    expect(result?.lines.map((line) => said(line).split(' ')[0])).toEqual([
      'Grant',
      'Agreement',
      'Payment'
    ])
  })
})

describe('toFileLines', () => {
  test('gives each file the page sees stored a Stored badge, and the fetch status where it says more', () => {
    expect(
      toFileLines(
        grantType,
        version({
          grant: file({ stored: true, fetchStatus: 'fetched' }),
          agreement: file({ stored: true, fetchStatus: 'permanent_error' }),
          payment: file({ stored: true, fetchStatus: 'pending' })
        }),
        catalogue
      )
    ).toEqual([
      {
        label: 'Grant',
        badges: [{ status: 'Stored', role: 'success' }],
        note: null
      },
      {
        label: 'Agreement',
        badges: [
          { status: 'Stored', role: 'success' },
          {
            status: 'Failed',
            role: 'error',
            title:
              "GAS won't use this agreement definition: new agreements use the newest usable 1.x one at or below 1.1.0, and actions before acceptance use the newest usable 1.x one. Publish a fixed version."
          }
        ],
        note: null
      },
      {
        label: 'Payment',
        badges: [{ status: 'Stored', role: 'success' }],
        note: 'not loaded by GAS yet'
      }
    ])
  })

  test("gives a file not stored the list's word for its fetch status", () => {
    expect(
      toFileLines(
        grantType,
        version({
          grant: file({ fetchStatus: 'transient_error' }),
          payment: file({})
        }),
        catalogue
      ).map(
        ({ label, badges }) =>
          `${label} ${badges?.map(({ status }) => status).join(' ')}`
      )
    ).toEqual(['Grant Fetch error', 'Payment Not stored yet'])
  })

  test("takes CW's words for a workflow file from CW's list", () => {
    expect(
      toFileLines(
        workflowType,
        version({ workflow: file({ fetchStatus: 'transient_error' }) }),
        catalogue
      )
    ).toEqual([
      {
        label: 'Workflow',
        badges: [{ status: 'Fetch error', role: 'warning' }],
        note: null
      }
    ])
  })

  test('says nothing of the files without the catalogue to word them', () => {
    expect(toFileLines(grantType, version({ grant: file({}) }), null)).toEqual(
      []
    )
  })
})
