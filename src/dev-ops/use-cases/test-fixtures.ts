import type {
  BucketEntry,
  BucketFact,
  BucketSummary,
  Catalogue
} from './get-catalogue.use-case.ts'
import type { AgreementDefinition } from './get-grant-page.use-case.ts'

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
    {
      value: 'active',
      label: 'Active',
      tone: 'success',
      hint: 'Published by the config broker.'
    },
    {
      value: 'draft',
      label: 'Draft',
      tone: 'neutral',
      hint: 'Not yet published as active.'
    }
  ],
  toggle: null
}

/** As GAS declares them for a grant version's files. */
const fetchStatusValues: BucketFact['values'] = [
  {
    value: 'fetched',
    label: 'Stored',
    tone: 'success',
    hint: 'GAS has fetched every file of this version (grant, agreement, payment) itself.'
  },
  {
    value: 'pending',
    label: 'Not stored yet',
    tone: 'neutral',
    hint: "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet."
  },
  {
    value: 'transient_error',
    label: 'Fetch error',
    tone: 'warning',
    hint: "GAS's last fetch of at least one of this version's files from S3 failed."
  },
  {
    value: 'permanent_error',
    label: 'Failed',
    tone: 'error',
    hint: "GAS refused at least one of this version's files and won't use it."
  }
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
      name: 'worstFetchStatus',
      param: 'definition',
      label: 'Definition',
      values: fetchStatusValues,
      toggle: null
    }
  ],
  refs: [],
  indexes: [
    [],
    ['grantCode', 'status', 'worstFetchStatus'],
    ['status', 'worstFetchStatus']
  ],
  groupings: [],
  title: { label: 'Grant', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'worstFetchStatus'
    },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' }
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

/** As CW declares them for a workflow version's one file. */
const workflowFetchStatusValues: BucketFact['values'] = [
  {
    value: 'fetched',
    label: 'Stored',
    tone: 'success',
    hint: "CW has loaded this version's workflow definition."
  },
  {
    value: 'pending',
    label: 'Not stored yet',
    tone: 'neutral',
    hint: "This version's workflow definition isn't fetched by CW yet. CW fetches it from S3 when it first needs it, and only uses the newest usable Active version in each major, so an older version may never be fetched; that is normal. A workflow definition stored with Fetch definition shows here until CW loads it itself."
  },
  {
    value: 'transient_error',
    label: 'Fetch error',
    tone: 'warning',
    hint: "CW's last fetch of this version's workflow definition from S3 failed. CW tries again the next time it needs it; after 5 failed fetches it stops trying and marks it Failed the next time it needs this version. Open the version for the error."
  },
  {
    value: 'permanent_error',
    label: 'Failed',
    tone: 'error',
    hint: "CW couldn't fetch or read this version's workflow definition, or stopped after 5 failed fetches, and won't use it. Open the version to see why and what it affects; publish a fixed version."
  }
]

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
      values: workflowFetchStatusValues,
      toggle: null
    }
  ],
  indexes: [
    ['grantCode', 'status', 'fetchStatus'],
    ['status', 'fetchStatus']
  ],
  title: { label: 'Workflow', format: 'mono' },
  columns: [
    { key: 'version', label: 'Version', format: 'mono' },
    {
      key: 'definition',
      label: 'Definition',
      format: 'badge',
      fact: 'fetchStatus'
    },
    { key: 'status', label: 'Status', format: 'badge', fact: 'status' }
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

/** An agreement definition as GAS stores it (`agreements__definitions.definition`). */
export const agreementDefinition: AgreementDefinition = {
  code: 'woodland-creation',
  agreementNumberPrefix: 'WC',
  create: {
    target: 'offered',
    application: '$.input.answers',
    processes: ['GENERATE_OFFER']
  },
  states: {
    offered: {
      page: 'offered',
      on: {
        accept: {
          target: 'accepted',
          page: 'accept',
          validation: {
            required: [
              {
                name: 'confirm',
                value: '$.form.confirm',
                href: '#confirm',
                message: 'Confirm you have read the terms'
              }
            ]
          },
          processes: ['CREATE_AGREEMENT_PAYMENT']
        },
        withdraw: { target: 'withdrawn' },
        cancel: { target: 'cancelled' }
      }
    },
    accepted: {
      page: 'accepted',
      processes: ['GENERATE_OFFER'],
      on: { terminate: { target: 'terminated' } }
    },
    withdrawn: { page: 'withdrawn' },
    cancelled: {},
    terminated: { page: 'terminated' }
  },
  pages: {
    document: {
      title: 'Agreement document',
      layout: 'document',
      components: [{ component: 'heading' }],
      sections: [
        { id: 'parties' },
        { id: 'actions' },
        { id: 'payments' },
        { id: 'terms' }
      ]
    },
    offered: {
      title: 'Review your agreement offer',
      components: [
        { component: 'summary-list' },
        { component: 'button' },
        { component: 'summary-list' }
      ]
    },
    accept: {
      title: 'Accept your agreement offer',
      components: [{ component: 'form' }]
    }
  },
  processDefinitions: {
    GENERATE_OFFER: {
      type: 'endpoint',
      endpoint: {
        method: 'POST',
        service: 'LAND_DATA',
        path: '/api/v2/parcels/{sbi}'
      },
      request: { body: { sbi: '$.application.sbi' } },
      output: {
        offer: '$.response.offer',
        totalAmountPence: '$.response.totalAmountPence'
      }
    },
    FETCH_TERMS: {
      type: 'endpoint',
      endpoint: { method: 'GET', service: 'AGREEMENT_DOCS', path: '/terms' },
      request: { body: {} },
      output: { terms: '$.response.terms' }
    },
    CREATE_AGREEMENT_PAYMENT: { type: 'handler' }
  },
  templates: { terms: { standard: {}, welsh: {} } }
}
