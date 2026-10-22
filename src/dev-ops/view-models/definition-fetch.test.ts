import type { DefinitionFetchFile } from '../use-cases/definition-fetches.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { grantType } from './grants-page.view-model.ts'

const page = '/dev-ops/grants/woodland-creation/2.0.0'

const stored = (file: DefinitionFetchFile['file']): DefinitionFetchFile => ({
  file,
  outcome: 'stored'
})

const fetched = (files: DefinitionFetchFile[]) =>
  toDefinitionFetchNotices(grantType, { outcome: 'fetched', files, page }, page)

describe('toDefinitionFetchNotices', () => {
  test('says nothing on a page no fetch has just landed on', () => {
    expect(toDefinitionFetchNotices(grantType, undefined, page)).toEqual([])
  })

  test("drops a fetch's outcome that was meant for another version", () => {
    expect(
      toDefinitionFetchNotices(
        grantType,
        { outcome: 'fetched', files: [stored('grant')], page },
        '/dev-ops/grants/woodland-creation/1.2.0'
      )
    ).toEqual([])
  })

  test('names every file stored in one line', () => {
    expect(
      fetched([stored('grant'), stored('agreement'), stored('payment')])
    ).toEqual([
      {
        role: 'success',
        text: 'Fetched — grant, agreement and payment definitions stored.',
        reason: null,
        tail: ''
      }
    ])
  })

  test('says definition of one file stored', () => {
    expect(fetched([stored('payment')])).toEqual([
      {
        role: 'success',
        text: 'Fetched — payment definition stored.',
        reason: null,
        tail: ''
      }
    ])
  })

  test('says nothing when every file was already stored', () => {
    expect(fetched([])).toEqual([])
  })

  test.each([
    ['missing', 'Definition file missing'],
    ['forbidden', 'Definition file not readable by GAS'],
    ['timeout', 'S3 did not answer'],
    ['unparseable', 'Definition file is not valid JSON']
  ] as const)('names a file that failed as %s', (reason, text) => {
    expect(
      fetched([{ file: 'payment', outcome: 'failed', reason, message: null }])
    ).toEqual([
      {
        role: 'error',
        text: 'Not fetched — payment definition: ',
        reason: text,
        tail: '. Nothing has changed.'
      }
    ])
  })

  test("names an invalid file in GAS's own words", () => {
    const message = 'Agreement definition is missing "processes"'

    expect(
      fetched([
        { file: 'agreement', outcome: 'failed', reason: 'invalid', message }
      ])
    ).toEqual([
      {
        role: 'error',
        text: 'Not fetched — agreement definition: ',
        reason: message,
        tail: '. Nothing has changed.'
      }
    ])
  })

  test('shows what was stored first, then one alert per file that failed', () => {
    expect(
      fetched([
        stored('grant'),
        {
          file: 'agreement',
          outcome: 'failed',
          reason: 'forbidden',
          message: null
        },
        { file: 'payment', outcome: 'failed', reason: 'missing', message: null }
      ]).map(({ role, text }) => `${role}: ${text}`)
    ).toEqual([
      'success: Fetched — grant definition stored.',
      'error: Not fetched — agreement definition: ',
      'error: Not fetched — payment definition: '
    ])
  })

  test.each([
    [
      'not-found',
      'error',
      'Not fetched — GAS no longer has this version. Nothing has changed.'
    ],
    [
      'unavailable',
      'error',
      'Fetch failed — GAS could not finish it. Refresh to see what was stored.'
    ],
    [
      'timed-out',
      'warning',
      'Fetch status unknown — GAS did not answer in time. Refresh to check.'
    ]
  ] as const)(
    'says what a %s fetch means for what is stored',
    (outcome, role, text) => {
      expect(
        toDefinitionFetchNotices(grantType, { outcome, files: [], page }, page)
      ).toEqual([{ role, text, reason: null, tail: '' }])
    }
  )

  test('names the service the record comes from', () => {
    expect(
      toDefinitionFetchNotices(
        { ...grantType, source: 'CW' },
        { outcome: 'not-found', files: [], page },
        page
      )[0].text
    ).toBe('Not fetched — CW no longer has this version. Nothing has changed.')
  })

  test('says nothing of an outcome this release has no words for', () => {
    expect(
      toDefinitionFetchNotices(
        grantType,
        {
          outcome: 'withdrawn' as DefinitionFetchFlash['outcome'],
          files: [],
          page
        },
        page
      )
    ).toEqual([])
  })
})
