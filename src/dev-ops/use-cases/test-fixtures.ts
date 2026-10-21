import type {
  BucketEntry,
  BucketFact,
  BucketSummary,
  Catalogue
} from './get-catalogue.use-case.ts'
import type { WorkflowDefinition } from './get-workflow-page.use-case.ts'

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

const versionStatusFact: BucketFact = {
  name: 'status',
  param: 'status',
  label: 'Status',
  values: [
    { value: 'active', label: 'Active', tone: 'success' },
    { value: 'draft', label: 'Draft', tone: 'neutral' }
  ],
  toggle: null
}

const fetchStatusValues: BucketFact['values'] = [
  { value: 'fetched', label: 'Fetched', tone: 'success' },
  { value: 'pending', label: 'Not fetched', tone: 'info' },
  { value: 'transient_error', label: 'Retrying', tone: 'warning' },
  { value: 'permanent_error', label: 'Failed', tone: 'error' }
]

/** Config versions as GAS lists them: one row per grant code and version. */
export const grantsBucket: BucketEntry = {
  id: 'gas.grants',
  path: 'grants',
  label: 'Grants',
  service: 'GAS',
  shortLabel: 'Grants',
  icon: 'scroll-text',
  order: 75,
  noun: { one: 'grant version', many: 'grant versions' },
  time: { label: 'Received' },
  facts: [
    {
      name: 'grantCode',
      param: 'grant',
      label: 'Grant',
      values: [
        { value: 'hedgerow-restoration', label: 'hedgerow-restoration' },
        { value: 'woodland-creation', label: 'woodland-creation' }
      ],
      toggle: null
    },
    versionStatusFact,
    {
      name: 'definitions.grant.fetchStatus',
      param: 'definition',
      label: 'Definition',
      values: fetchStatusValues,
      toggle: null
    }
  ],
  refs: [],
  indexes: [
    [],
    ['grantCode', 'status', 'definitions.grant.fetchStatus'],
    ['status', 'definitions.grant.fetchStatus']
  ],
  groupings: [],
  title: { label: 'Grant', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'definitions.grant.fetchStatus'
    }
  ],
  audited: false,
  timeline: false,
  summaries: [],
  page: null,
  tab: null
}

export const casesBucket: BucketEntry = {
  ...applicationsBucket,
  id: 'cw.cases',
  path: 'cases',
  label: 'Cases',
  service: 'CW',
  shortLabel: 'Cases',
  icon: 'folder',
  order: 80,
  noun: { one: 'case', many: 'cases' }
}

/** Config versions as CW lists them, through GAS; CW keeps one fetch status per version. */
export const workflowsBucket: BucketEntry = {
  ...grantsBucket,
  id: 'cw.workflows',
  path: 'workflows',
  label: 'Workflows',
  service: 'CW',
  shortLabel: 'Workflows',
  icon: 'workflow',
  order: 85,
  noun: { one: 'workflow version', many: 'workflow versions' },
  facts: [
    {
      name: 'grantCode',
      param: 'workflow',
      label: 'Workflow',
      values: [{ value: 'woodland-creation', label: 'woodland-creation' }],
      toggle: null
    },
    versionStatusFact,
    {
      name: 'fetchStatus',
      param: 'definition',
      label: 'Definition',
      values: fetchStatusValues,
      toggle: null
    }
  ],
  indexes: [
    [],
    ['grantCode', 'status', 'fetchStatus'],
    ['status', 'fetchStatus']
  ],
  title: { label: 'Workflow', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'fetchStatus'
    }
  ]
}

export const catalogue: Catalogue = {
  buckets: [
    outboxBucket,
    applicationsBucket,
    grantsBucket,
    casesBucket,
    workflowsBucket
  ],
  sourceErrors: []
}

/** The prototype's `woodland-creation@1.2.0`, as GAS answers its definition read. */
export const woodlandDefinition: WorkflowDefinition = {
  workflow: {
    pages: {
      cases: {
        details: {
          banner: {
            title: { text: '$.payload.answers.businessName', type: 'string' },
            summary: {
              sbi: {
                label: 'SBI',
                text: '$.payload.identifiers.sbi',
                type: 'string'
              },
              reference: {
                label: 'Reference',
                text: '$.caseRef',
                type: 'string'
              },
              hectares: {
                label: 'Area (ha)',
                text: '$.payload.answers.hectares',
                type: 'number'
              },
              submitted: {
                label: 'Submitted',
                text: '$.payload.submittedAt',
                type: 'date',
                format: 'dd MMM yyyy'
              }
            }
          },
          tabs: {
            'case-details': { content: [{ component: 'summary-list' }] },
            'land-parcels': {
              link: { text: 'Land', index: 2 },
              action: { parcels: 'REFRESH_PARCELS' },
              content: [{ component: 'table' }]
            },
            agreements: {
              link: { text: 'Agreement', index: 5 },
              renderIf: '$.supplementaryData.agreements',
              content: [{ component: 'table' }]
            }
          }
        }
      }
    },
    endpoints: [
      {
        code: 'land-parcels',
        service: 'LAND_DATA',
        path: '/api/v2/parcels/{sbi}',
        method: 'GET'
      },
      {
        code: 'recalculate',
        service: 'PAYMENT_CALC',
        path: '/api/v1/calculate',
        method: 'POST'
      }
    ],
    externalActions: [
      {
        code: 'RECALCULATE',
        name: 'Recalculate payment',
        description: 'Ask the land service for a new payment figure.',
        display: true,
        endpoint: { code: 'recalculate' },
        target: {
          targetNode: 'payment',
          dataType: 'OBJECT',
          position: null,
          place: 'append'
        }
      },
      {
        code: 'REFRESH_PARCELS',
        name: 'Refresh land parcels',
        display: false,
        endpoint: {
          code: 'land-parcels',
          endpointParams: { PATH: { sbi: '$.payload.identifiers.sbi' } }
        },
        target: null
      }
    ]
  },
  addresses: [
    {
      code: 'land-parcels',
      service: 'LAND_DATA',
      url: 'https://land-data.example/api/v2/parcels/{sbi}'
    },
    { code: 'recalculate', service: 'PAYMENT_CALC', url: null }
  ]
}
