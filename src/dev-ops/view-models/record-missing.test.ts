import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import { grantType } from './grants-page.view-model.ts'
import { toRecordMissing } from './record-missing.ts'
import { workflowType } from './workflows-page.view-model.ts'
import { cwEvents, gasEvents } from '../use-cases/test-fixtures.ts'

const application = { code: 'frps-private-beta', clientRef: 'a7c-2f1-9e4' }
const aCase = { workflowCode: 'woodland', caseRef: 'f02-7d8-a61' }
const version = { code: 'woodland', version: '1.43.2' }
const request = {
  method: 'get',
  url: new URL('https://gpa.example/dev-ops/grants/woodland/1.43.2?tab=phases')
}
const grouped = { buckets: [gasEvents, cwEvents], sourceErrors: [] }
const asked = { request, catalogue: grouped }

describe('toRecordMissing', () => {
  test.each([
    [
      applicationType,
      application,
      'a7c-2f1-9e4',
      'GAS has no application a7c-2f1-9e4 for frps-private-beta.',
      'Check the reference and the grant — a reference belongs to one grant. Search for it from Applications.'
    ],
    [
      caseType,
      aCase,
      'f02-7d8-a61',
      'CW has no case f02-7d8-a61.',
      'Check the reference — it may belong to a case that was closed and replaced. Search for it from Cases.'
    ],
    [
      grantType,
      version,
      'woodland',
      'GAS has no record of woodland@1.43.2.',
      'Check the version. If it was published and GAS rejected it on arrival, its message is in GAS’s inbox as a dead letter, unless it has been purged.'
    ],
    [
      workflowType,
      version,
      'woodland',
      'CW has no record of woodland@1.43.2.',
      'Check the version. If it was published and CW rejected it on arrival, its message is in CW’s inbox as a dead letter, unless it has been purged.'
    ]
  ])(
    'says the service has no such $title',
    (record, key, title, messageTitle, text) => {
      const missing = toRecordMissing(record, key, 'not-found', asked)

      expect(missing.title).toBe(title)
      expect(missing.message).toEqual({ title: messageTitle, text })
    }
  )

  test.each([
    [grantType, '/dev-ops/events/gas', 'Search GAS’s inbox'],
    [workflowType, '/dev-ops/events/cw', 'Search CW’s inbox for woodland']
  ])(
    'offers a search of the inbox a refused $title version would be in, on the Events page with Inbox picked',
    (record, action, text) => {
      expect(
        toRecordMissing(record, version, 'not-found', asked).inboxSearch
      ).toEqual({
        action,
        hidden: [
          { name: 'ref-kind', value: 'ref' },
          { name: 'ref-value', value: 'woodland' },
          { name: 'queue', value: 'inbox' }
        ],
        text
      })
    }
  )

  test('offers no search for a source with no Events page', () => {
    expect(
      toRecordMissing(
        { ...grantType, source: 'Other' },
        version,
        'not-found',
        asked
      ).inboxSearch
    ).toBeNull()
  })

  test('offers no search when no list holds the inbox', () => {
    expect(
      toRecordMissing(grantType, version, 'not-found', {
        request,
        catalogue: null
      }).inboxSearch
    ).toBeNull()
  })

  test('tries the record’s own address again, keeping its query', () => {
    expect(
      toRecordMissing(grantType, version, 'unavailable', asked).retryHref
    ).toBe('/dev-ops/grants/woodland/1.43.2?tab=phases')
  })

  test('offers no search where there is no version to have been refused, or the record was only unreadable', () => {
    expect(
      toRecordMissing(applicationType, application, 'not-found', asked)
        .inboxSearch
    ).toBeNull()
    expect(
      toRecordMissing(grantType, version, 'unavailable', asked).inboxSearch
    ).toBeNull()
  })

  test.each([
    [
      applicationType,
      application,
      'unavailable',
      'application',
      'GAS answered with an error.'
    ],
    [
      applicationType,
      application,
      'timed-out',
      'application',
      'GAS timed out waiting for it.'
    ],
    [caseType, aCase, 'unavailable', 'case', 'GAS answered with an error.'],
    [caseType, aCase, 'timed-out', 'case', 'CW timed out waiting for it.'],
    [grantType, version, 'unavailable', 'grant', 'GAS answered with an error.'],
    [grantType, version, 'timed-out', 'grant', 'GAS timed out waiting for it.'],
    [
      workflowType,
      version,
      'unavailable',
      'workflow',
      'GAS answered with an error.'
    ],
    [
      workflowType,
      version,
      'timed-out',
      'workflow',
      'CW timed out waiting for it.'
    ]
  ] as const)(
    'says a $title is %s with no more known, as the event page does',
    (record, key, state, noun, reason) => {
      expect(toRecordMissing(record, key, state, asked).message).toEqual({
        title: `This ${noun} couldn’t be loaded.`,
        text: `${reason} Nothing has changed — try again in a moment.`
      })
    }
  )

  test.each([
    [caseType, aCase, { kind: 'not-connected' }, 'GAS couldn’t be reached.'],
    [
      workflowType,
      version,
      { kind: 'not-connected' },
      'GAS couldn’t be reached.'
    ],
    [
      applicationType,
      application,
      { kind: 'not-connected' },
      'GAS couldn’t be reached.'
    ],
    [grantType, version, { kind: 'not-connected' }, 'GAS couldn’t be reached.'],
    [caseType, aCase, { kind: 'cw-not-reached' }, 'CW couldn’t be reached.'],
    [
      caseType,
      aCase,
      { kind: 'errored', upstream: true },
      'CW answered with an error.'
    ],
    [
      workflowType,
      version,
      { kind: 'errored', upstream: true },
      'CW answered with an error.'
    ],
    [grantType, version, { kind: 'errored' }, 'GAS answered with an error.'],
    [caseType, aCase, { kind: 'no-answer' }, 'GAS timed out waiting for it.']
  ] as const)(
    'names the service a $title’s failed read is down to: %o',
    (record, key, failure, reason) => {
      expect(
        toRecordMissing(record, key, 'unavailable', asked, failure).message.text
      ).toBe(`${reason} Nothing has changed — try again in a moment.`)
    }
  )

  test.each([
    [
      applicationType,
      application,
      'not-found',
      'Not found – Application a7c-2f1-9e4'
    ],
    [grantType, version, 'not-found', 'Not found – Grant woodland@1.43.2'],
    [workflowType, version, 'timed-out', 'Workflow woodland@1.43.2'],
    [caseType, aCase, 'unavailable', 'Case f02-7d8-a61']
  ] as const)(
    'titles the tab for a $title',
    (record, key, state, pageTitle) => {
      expect(toRecordMissing(record, key, state, asked).pageTitle).toBe(
        pageTitle
      )
    }
  )
})
