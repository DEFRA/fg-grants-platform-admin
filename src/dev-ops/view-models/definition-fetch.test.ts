import type { DefinitionFetchFile } from '../use-cases/definition-fetches.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { grantType } from './grants-page.view-model.ts'
import type { VersionFiles } from './version-banner.ts'
import { workflowType } from './workflows-page.view-model.ts'

const page = '/dev-ops/grants/woodland-creation/2.0.0'

const header: VersionFiles = {
  code: 'woodland-creation',
  version: '2.0.0',
  status: 'active',
  s3Bucket: 'config-broker',
  files: {
    grant: {
      stored: false,
      fetchStatus: 'pending',
      s3Key: 'woodland-creation/2.0.0/gas/gas.json'
    },
    payment: { stored: false, fetchStatus: 'pending' }
  }
}

const stored = (file: DefinitionFetchFile['file']): DefinitionFetchFile => ({
  file,
  outcome: 'stored'
})

const failed = (
  file: string,
  reason: Extract<DefinitionFetchFile, { outcome: 'failed' }>['reason'],
  message: string | null = null
): DefinitionFetchFile => ({ file, outcome: 'failed', reason, message })

const fetched = (files: DefinitionFetchFile[], on: VersionFiles = header) =>
  toDefinitionFetchNotices(
    grantType,
    { outcome: 'fetched', files, page },
    page,
    on
  )

/** A notice as the page reads it, each code part in backticks. */
const said = ({ words }: { words: unknown[] }) =>
  words
    .map((part) =>
      typeof part === 'string' ? part : `\`${(part as { code: string }).code}\``
    )
    .join('')

describe('toDefinitionFetchNotices', () => {
  test('says nothing on a page no fetch has just landed on', () => {
    expect(
      toDefinitionFetchNotices(grantType, undefined, page, header)
    ).toEqual([])
  })

  test("drops a fetch's outcome that was meant for another version", () => {
    expect(
      toDefinitionFetchNotices(
        grantType,
        { outcome: 'fetched', files: [stored('grant')], page },
        '/dev-ops/grants/woodland-creation/1.2.0',
        header
      )
    ).toEqual([])
  })

  test('names every file stored in one line', () => {
    expect(
      fetched([stored('grant'), stored('agreement'), stored('payment')])
    ).toEqual([
      {
        role: 'success',
        words: ['Stored: grant, agreement and payment definitions.']
      }
    ])
  })

  test('says definition of one file stored', () => {
    expect(fetched([stored('payment')]).map(said)).toEqual([
      'Stored: payment definition.'
    ])
  })

  test('says nothing when every file was already stored', () => {
    expect(fetched([])).toEqual([])
  })

  test.each([
    [
      'missing',
      '`Definition file missing`. Pressing Fetch again fails the same way until the file is in S3.'
    ],
    [
      'forbidden',
      "`Definition file not readable by GAS`. GAS can't read the bucket; check its S3 access."
    ],
    ['timeout', '`S3 could not return the file`. Try again.'],
    [
      'unparseable',
      "`Definition file is not valid JSON`. This version's file will never load; publish a fixed version."
    ]
  ] as const)(
    'says where a file that failed as %s is, why, and what to do next',
    (reason, tail) => {
      const [notice] = fetched([failed('grant', reason)])

      expect(notice.role).toBe('error')
      expect(said(notice)).toBe(
        `Couldn't fetch the grant definition from \`config-broker/woodland-creation/2.0.0/gas/gas.json\`: ${tail} Nothing has changed.`
      )
    }
  )

  test("names an invalid file in GAS's own words, and leaves out a location it does not know", () => {
    const message = 'Definition is for "frps-private-beta", not "farm-payments"'

    expect(said(fetched([failed('payment', 'invalid', message)])[0])).toBe(
      `Couldn't fetch the payment definition: \`${message}\`. This version's file will never load; publish a fixed version. Nothing has changed.`
    )
  })

  test('says GAS gave no reason for an invalid file without a message', () => {
    expect(said(fetched([failed('payment', 'invalid')])[0])).toContain(
      ': `GAS refused the definition and gave no reason`.'
    )
  })

  test('names a reason it has no words for as the service gave it, and says to try again', () => {
    expect(
      said(
        fetched([
          failed('grant', 'throttled' as 'timeout'),
          failed('grant', 'timeout')
        ])[0]
      )
    ).toContain('`GAS gave reason throttled`. Try again.')
  })

  test('shows what was stored first, then one notice per file that failed', () => {
    expect(
      fetched([
        stored('grant'),
        failed('agreement', 'forbidden'),
        failed('payment', 'missing')
      ]).map(({ role, words }) => `${role}: ${String(words[0])}`)
    ).toEqual([
      'success: Stored: grant definition.',
      "error: Couldn't fetch the agreement definition",
      "error: Couldn't fetch the payment definition"
    ])
  })

  test('names CW for a workflow', () => {
    expect(
      said(
        toDefinitionFetchNotices(
          workflowType,
          {
            outcome: 'fetched',
            files: [failed('workflow', 'forbidden')],
            page
          },
          page,
          { ...header, files: {} }
        )[0]
      )
    ).toBe(
      "Couldn't fetch the workflow definition: `Definition file not readable by CW`. CW can't read the bucket; check its S3 access. Nothing has changed."
    )
  })

  test.each([
    [
      'not-found',
      'error',
      'Not fetched: GAS no longer has this version. Nothing has changed.'
    ],
    [
      'unavailable',
      'error',
      'Fetch failed: GAS could not finish it. Refresh to see what was stored.'
    ],
    [
      'timed-out',
      'warning',
      'Fetch status unknown: GAS did not answer in time. Refresh to check.'
    ]
  ] as const)(
    'says what a %s fetch means for what is stored',
    (outcome, role, text) => {
      expect(
        toDefinitionFetchNotices(
          grantType,
          { outcome, files: [], page },
          page,
          header
        )
      ).toEqual([{ role, words: [text] }])
    }
  )

  test('says nothing of an outcome this release has no words for', () => {
    expect(
      toDefinitionFetchNotices(
        grantType,
        {
          outcome: 'withdrawn' as DefinitionFetchFlash['outcome'],
          files: [],
          page
        },
        page,
        header
      )
    ).toEqual([])
  })
})
