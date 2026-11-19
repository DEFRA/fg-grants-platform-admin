import type { CasePage } from '../use-cases/get-case-page.use-case.ts'
import { toCasePage } from './case-page.view-model.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'
import { toTimes } from './times.ts'

const empty = { phase: null, stage: null, status: null }

const page: CasePage = {
  header: {
    caseRef: 'a1',
    workflowCode: 'woodland',
    position: { phase: 'PRE_AWARD', stage: 'REVIEW', status: 'IN_REVIEW' },
    names: null,
    closed: false,
    closedAt: null,
    counterpart: { exists: true },
    fetchedAt: '2026-10-13T15:00:00.000Z'
  },
  overview: {
    workflowCode: 'woodland',
    originalConfigVersion: null,
    currentConfigVersion: '1.0.0',
    createdAt: '2026-10-13T14:04:09.000Z',
    closed: false,
    closedAt: null,
    series: null,
    storedBytes: null
  },
  sourceErrors: [],
  sectionErrors: []
}

const options = { from: '', times: toTimes('utc'), catalogue }

describe('toCasePage', () => {
  test('is a case with no data only when CW sent neither its position nor its dates', () => {
    const noPosition = toCasePage(
      { ...page, header: { ...page.header, position: empty } },
      'overview',
      options
    )
    const nothing = toCasePage(
      {
        ...page,
        header: { ...page.header, position: empty },
        overview: { ...page.overview!, createdAt: null }
      },
      'overview',
      options
    )

    expect(noPosition.alert).toBeNull()
    expect(noPosition.overview).toMatchObject({
      application: { kind: 'link' }
    })
    expect(nothing.alert?.title).toBe('CW returned no data for this case.')
  })

  test('says nothing of the data on the other tabs', () => {
    expect(
      toCasePage(
        {
          ...page,
          header: { ...page.header, position: empty },
          overview: undefined
        },
        'raw',
        options
      ).alert
    ).toBeNull()
  })

  test("searches every application when GAS's catalogue has no Applications list", () => {
    const { overview } = toCasePage(
      { ...page, header: { ...page.header, counterpart: { exists: false } } },
      'overview',
      { ...options, catalogue: null }
    )

    expect(overview).toMatchObject({
      application: {
        kind: 'missing',
        button: { text: 'Search applications', href: '/dev-ops/applications' }
      }
    })
  })

  test('links the workflow version the case is on, as its version', () => {
    expect(toCasePage(page, 'overview', options).overview).toMatchObject({
      details: {
        version: {
          text: 'woodland@1.0.0',
          href: expect.stringMatching(
            /^\/dev-ops\/workflows\/woodland\/1\.0\.0\?/
          )
        }
      }
    })
  })
})
