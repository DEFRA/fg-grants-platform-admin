import type {
  BucketEntry,
  BucketSummary,
  Catalogue
} from './get-catalogue.use-case.ts'

/** A bucket of events and a bucket of records, shaped as GAS's catalogue describes them. */
export const outboxBucket: BucketEntry = {
  id: 'gas.outbox',
  path: 'events/gas/outbox',
  label: 'GAS outbox',
  service: 'GAS',
  shortLabel: 'Outbox',
  icon: 'activity',
  order: 10,
  noun: { one: 'event', many: 'events' },
  time: { label: 'Created' },
  facts: [
    {
      name: 'status',
      param: 'status',
      label: 'Status',
      values: [
        { value: 'PUBLISHED', label: 'Queued', tone: 'neutral' },
        { value: 'DEAD_LETTER', label: 'Dead letter', tone: 'error' }
      ],
      toggle: null
    },
    {
      name: 'eventType',
      param: 'event',
      label: 'Event',
      values: [
        { value: 'UpdateCaseStatus', label: 'UpdateCaseStatus' },
        { value: 'Unrecognised', label: 'Unrecognised' }
      ],
      toggle: null
    },
    {
      name: 'grantCode',
      param: 'grant',
      label: 'Grant',
      values: null,
      toggle: null
    },
    {
      name: 'lastError.name',
      param: 'error',
      label: 'Error name',
      values: null,
      toggle: null
    }
  ],
  refs: [
    { kind: 'ref', label: 'Reference' },
    { kind: 'trace', label: 'Trace ID' }
  ],
  indexes: [[], ['status'], ['status', 'eventType']],
  groupings: ['status'],
  title: { label: 'Event', format: 'eventType' },
  columns: [
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' },
    { key: 'grantCode', label: 'Grant', format: 'mono' }
  ],
  audited: false,
  timeline: true,
  summaries: [],
  page: null,
  tab: null
}

/** The same list with an event type its toggle hides until the operator switches it on. */
export const toggledBucket: BucketEntry = {
  ...outboxBucket,
  facts: outboxBucket.facts.map((fact) =>
    fact.name === 'eventType'
      ? {
          ...fact,
          values: [
            { value: 'Audit', label: 'Audit', hidden: true },
            ...(fact.values ?? [])
          ],
          toggle: { label: 'Show audit events', param: 'audit' }
        }
      : fact
  )
}

export const errorsSummary: BucketSummary = {
  id: 'errors',
  label: 'Top errors',
  by: ['lastError.name', 'eventType'],
  among: { status: 'DEAD_LETTER' },
  top: 20,
  none: 'No error recorded'
}

/** The outbox with a hidden type and the Top errors summary, as an event list declares them. */
export const summarisedBucket: BucketEntry = {
  ...toggledBucket,
  summaries: [errorsSummary]
}

const eventsPage = { id: 'events', label: 'GAS events', shortLabel: 'Events' }

/** The outbox and the inbox as the two tabs of one page; the inbox searches by fewer kinds and hides nothing. */
export const pagedOutbox: BucketEntry = {
  ...toggledBucket,
  page: eventsPage,
  tab: 'Outbox'
}

export const pagedInbox: BucketEntry = {
  ...outboxBucket,
  id: 'gas.inbox',
  path: 'events/gas/inbox',
  label: 'GAS inbox',
  shortLabel: 'Inbox',
  time: { label: 'Received' },
  refs: [{ kind: 'trace', label: 'Trace ID' }],
  page: eventsPage,
  tab: 'Inbox'
}

export const applicationsBucket: BucketEntry = {
  id: 'gas.applications',
  path: 'applications',
  label: 'Applications',
  service: 'GAS',
  shortLabel: 'Applications',
  icon: 'file-text',
  order: 70,
  noun: { one: 'application', many: 'applications' },
  time: { label: 'Created' },
  facts: [
    {
      name: 'code',
      param: 'grant',
      label: 'Grant',
      values: [{ value: 'example-grant', label: 'example-grant' }],
      toggle: null
    },
    {
      name: 'archived',
      param: 'archived',
      label: 'Archived',
      values: [
        { value: 'true', label: 'Archived' },
        { value: 'false', label: 'Current' }
      ],
      toggle: null
    }
  ],
  refs: [{ kind: 'ref', label: 'Reference' }],
  indexes: [[], ['code']],
  groupings: [],
  title: { label: 'Reference', format: 'mono' },
  columns: [
    { key: 'code', label: 'Grant', format: 'mono' },
    { key: 'position', label: 'Status', format: 'position' }
  ],
  audited: true,
  timeline: false,
  summaries: [],
  page: null,
  tab: null
}

export const catalogue: Catalogue = {
  buckets: [outboxBucket, applicationsBucket],
  sourceErrors: []
}
