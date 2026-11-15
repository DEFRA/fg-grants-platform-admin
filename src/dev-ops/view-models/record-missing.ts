import { statusCodes } from '../../common/status-codes.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import { timedOutWaiting, toFailureText } from './failure-text.ts'
import type { RecordType } from './record-type.ts'
import { toRetryHref, type RetryRequest } from './status-page.ts'

/** The three ways a record's page has nothing of the record to show. */
export type MissingState = 'unavailable' | 'timed-out' | 'not-found'

interface Message {
  title: string
  text: string
}

/** The address's params, by record: what names it on the page and in its messages. */
export type MissingKey = Record<string, string>

const versionNotFound = (source: string, { code, version }: MissingKey) => ({
  title: `${source} has no record of ${code}@${version}.`,
  text: `Check the version. If it was published and ${source} rejected it on arrival, its message is in ${source}’s inbox as a dead letter, unless it has been purged.`
})

const notFoundCopies: Record<string, (key: MissingKey) => Message> = {
  application: ({ code, clientRef }) => ({
    title: `GAS has no application ${clientRef} for ${code}.`,
    text: 'Check the reference and the grant — a reference belongs to one grant. Search for it from Applications.'
  }),
  case: ({ caseRef }) => ({
    title: `CW has no case ${caseRef}.`,
    text: 'Check the reference — it may belong to a case that was closed and replaced. Search for it from Cases.'
  }),
  grant: (key) => versionNotFound('GAS', key),
  workflow: (key) => versionNotFound('CW', key)
}

/** A read that says no more than its state: a timeout of the owning service, or an error GAS answered with. */
const failureOfState = (state: MissingState): GasFailure =>
  state === 'timed-out' ? { kind: 'timed-out' } : { kind: 'errored' }

/** A read that failed names the service it is down to, as the event page does. */
const toFailedMessage = (record: RecordType, failure: GasFailure): Message => ({
  title: `This ${record.itemId} couldn’t be loaded.`,
  text: `${toFailureText(failure, record.source, timedOutWaiting)} Nothing has changed — try again in a moment.`
})

/** A version that was never stored may be a message the service refused: its inbox holds it under the code. */
export interface InboxSearch {
  action: string
  code: string
  text: string
}

export interface RecordMissing {
  state: MissingState
  /** The record's name in its address: the reference, or the config's code. */
  title: string
  /** The browser tab's title. */
  pageTitle: string
  message: Message
  inboxSearch: InboxSearch | null
  retryHref: string
}

/** A grant's names the inbox; a workflow's the code it searches for too. */
const searchTexts: Record<string, (code: string) => string> = {
  grant: () => 'Search GAS’s inbox',
  workflow: (code) => `Search CW’s inbox for ${code}`
}

const toInboxSearch = (
  record: RecordType,
  key: MissingKey,
  state: MissingState
): InboxSearch | null =>
  state === 'not-found' && 'version' in key
    ? {
        action: `/dev-ops/events/${record.source.toLowerCase()}/inbox`,
        code: key.code,
        text: searchTexts[record.itemId](key.code)
      }
    : null

const messageFor = (
  record: RecordType,
  key: MissingKey,
  state: MissingState,
  failure: GasFailure | undefined
): Message =>
  state === 'not-found'
    ? notFoundCopies[record.itemId](key)
    : toFailedMessage(record, failure ?? failureOfState(state))

/** A config version is named `code@version`, as everywhere it is written. */
const nameOf = (record: RecordType, key: MissingKey): string =>
  'version' in key ? `${key.code}@${key.version}` : key[record.titleParam]

const toPageTitle = (
  record: RecordType,
  key: MissingKey,
  state: MissingState
): string =>
  `${state === 'not-found' ? 'Not found – ' : ''}${record.title} ${nameOf(record, key)}`

/** `failure` is how the read failed, when the caller knows: without it the state alone is said. */
export const toRecordMissing = (
  record: RecordType,
  key: MissingKey,
  state: MissingState,
  request: RetryRequest,
  failure?: GasFailure
): RecordMissing => ({
  state,
  title: key[record.titleParam],
  pageTitle: toPageTitle(record, key, state),
  message: messageFor(record, key, state, failure),
  inboxSearch: toInboxSearch(record, key, state),
  retryHref: toRetryHref(request, null)
})

/** A record the service could not answer for is no page of it: the status says why. */
export const missingStatusCodes: Record<MissingState, number> = {
  unavailable: statusCodes.serviceUnavailable,
  'timed-out': statusCodes.gatewayTimeout,
  'not-found': statusCodes.notFound
}
