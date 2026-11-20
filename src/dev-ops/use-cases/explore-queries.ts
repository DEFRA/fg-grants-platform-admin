import type { QueryError } from '../repositories/explore.repository.ts'
import type { BucketEntry } from '../repositories/buckets.repository.ts'
import { queueFact } from './list-bucket.use-case.ts'

/** Shown in the editor, not run, when the page opens on nothing else. */
export const defaultQuery = 'db.applications.find()'

/** The longest query GAS takes. */
export const queryMax = 4000

const tooLongError = `Shorten the query to ${queryMax.toLocaleString('en-GB')} characters or fewer.`

/** Where a query over the limit goes wrong, as GAS would say it: from the first character past it. */
const toTooLongError = (q: string): QueryError => ({
  message: tooLongError,
  at: queryMax,
  end: q.length
})

/** A query over the limit, refused as GAS refuses one that breaks the language; null for one GAS takes. */
export const toTooLong = (
  q: string
): {
  outcome: 'failed'
  failure: { kind: 'invalid'; error: QueryError }
} | null =>
  q.length > queryMax
    ? {
        outcome: 'failed',
        failure: { kind: 'invalid', error: toTooLongError(q) }
      }
    : null

/** A form post sends CRLF where the editor counts LF, so GAS's places line up with the editor's text. */
export const toQueryText = (q: string): string => q.replace(/\r\n?/g, '\n')

/** Text in quotes, as the language reads it back: a backslash escapes the next character, a line break included. */
export const toQuoted = (value: string): string =>
  `'${value.replace(/[\\'\n]/g, '\\$&')}'`

/** A path as a key: bare when it is a plain word, else quoted, as mongosh needs. */
const toKey = (path: string): string =>
  /^[A-Za-z_]\w*$/.test(path) ? path : toQuoted(path)

/** One value as itself, several as `$in`. */
const toTest = (path: string, values: string[]): string =>
  values.length === 1
    ? `${toKey(path)}: ${toQuoted(values[0])}`
    : `${toKey(path)}: { $in: [${values.map(toQuoted).join(', ')}] }`

const toObject = (entries: string[]): string =>
  entries.length ? `{ ${entries.join(', ')} }` : '{}'

const toSort = (sort?: string): string => (sort ? `.sort(${sort})` : '')

/** `db.<source>.find(` the filter and the projection, a line each `)`, then its sort. */
const toFind = ({
  from,
  filter,
  projection,
  sort
}: {
  from: string
  filter: string[]
  projection: string
  sort?: string
}): string =>
  [
    `db.${from}.find(`,
    `  ${toObject(filter)},`,
    `  ${projection}`,
    `)${toSort(sort)}`
  ].join('\n')

const day = 24 * 60 * 60 * 1000

const grasslandsDays = 30

const deadLettersDays = 7

/** The UTC day `days` before now, as an ISO date literal. */
const toDaysAgo = (now: Date, days: number): string =>
  `ISODate('${new Date(now.getTime() - days * day).toISOString().slice(0, 10)}')`

export interface Example {
  slug: string
  label: string
  q: string
}

/** Queries that answer on any amount of data: a busy source is read over a recent stretch of days only. */
export const toExamples = (now: Date): Example[] => {
  const today = toDaysAgo(now, 0)

  return [
    {
      slug: 'applications',
      label: 'Applications',
      q: 'db.applications.find()'
    },
    {
      slug: 'grasslands-last-30-days',
      label: `Grassland applications, last ${grasslandsDays} days`,
      q: `db.applications.find(\n  { code: 'grasslands', createdAt: { $gte: ${toDaysAgo(now, grasslandsDays)} } },\n  { clientRef: 1, 'phases.answers.applicant.business.name': 1, parcels: '$phases.answers.parcels.parcelId' }\n)`
    },
    {
      slug: 'business-any-version',
      label: 'A business, in any version',
      q: "db.applications.find(\n  { 'phases.answers.applicant.business.name': /hilltop/i },\n  { clientRef: 1, code: 1, 'phases.answers.applicant.business.name': 1, currentStatus: 1 }\n)"
    },
    {
      slug: 'woodland-stored-paths',
      label: 'Woodland applications: _id, SBI and agreements',
      q: "db.applications.find(\n  { code: 'woodland' },\n  { _id: 1, 'identifiers.sbi': 1, 'phases.answers.payments.agreement.quantity': 1, agreements: 1 }\n)"
    },
    {
      slug: 'woodland-answers',
      label: 'Woodland applications, whole answers',
      q: "db.applications.find(\n  { code: 'woodland' },\n  { clientRef: 1, 'phases.answers': 1 }\n)"
    },
    {
      slug: 'frps-parcels',
      label: 'FRPS applications’ parcels, through lists',
      q: "db.applications.find(\n  { code: 'frps-private-beta' },\n  { clientRef: 1, 'phases.answers.payments.parcel.parcelId': 1 }\n)"
    },
    {
      slug: 'frps-cases-by-status',
      label: 'FRPS cases by status, today',
      q: `db.cases.aggregate([\n  { $match: { workflowCode: 'frps-private-beta', createdAt: { $gte: ${today} } } },\n  { $group: { _id: '$currentStatus', cases: { $sum: 1 } } }\n])`
    },
    {
      slug: 'woodland-stages',
      label: 'Woodland case stages, today',
      q: `db.cases.distinct(\n  'currentStage',\n  { workflowCode: 'woodland', createdAt: { $gte: ${today} } }\n)`
    },
    {
      slug: 'dead-letters-by-event',
      label: `Dead letters by event, last ${deadLettersDays} days`,
      q: `db.events.aggregate([\n  { $match: { status: 'DEAD_LETTER', publicationDate: { $gte: ${toDaysAgo(now, deadLettersDays)} } } },\n  { $group: { _id: '$eventType', events: { $sum: 1 }, latest: { $max: '$publicationDate' } } },\n  { $sort: { events: -1 } }\n])`
    },
    {
      slug: 'grants-not-stored',
      label: 'Grant versions not stored yet',
      q: "db.grants.find(\n  { worstFetchStatus: { $ne: 'fetched' } },\n  { grantCode: 1, version: 1, status: 1, worstFetchStatus: 1 }\n)"
    },
    {
      slug: 'record-events',
      label: 'A record’s events',
      q: "db.events.find(\n  { refs: 'ref:<a reference>' },\n  { publicationDate: 1, service: 1, box: 1, eventType: 1, status: 1, 'lastError.message': 1 }\n)"
    },
    {
      slug: 'agreements-by-status',
      label: 'Agreements by status, with value',
      q: "db.agreements.aggregate([\n  { $group: { _id: '$state', agreements: { $sum: 1 }, pence: { $sum: '$totalAmountPence' } } }\n])"
    },
    {
      slug: 'payments-by-year',
      label: 'Payments by marketing year, with amount',
      q: "db.payments.aggregate([\n  { $group: { _id: '$marketingYear', payments: { $sum: 1 }, pence: { $sum: '$totalAmountPence' } } }\n])"
    }
  ]
}

export const findExample = (slug: string, now: Date): Example | null =>
  toExamples(now).find((example) => example.slug === slug) ?? null

interface ListSource {
  from: string
  /** The path its records are timed by. */
  time: string
  projection: string
  /** Events name their service, and their box when one queue is picked. */
  fixed: (bucket: BucketEntry, facts: ListLook['facts']) => string[]
}

const queuesOf = (facts: ListLook['facts']): string[] =>
  [facts[queueFact] ?? []].flat().filter(Boolean)

const serviceOf = (bucket: BucketEntry): string => {
  const [, service] = bucket.path.split('/')

  return `service: ${toQuoted(service.toUpperCase())}`
}

const serviceAndBox = (
  bucket: BucketEntry,
  facts: ListLook['facts']
): string[] => {
  const queues = queuesOf(facts)

  return [
    serviceOf(bucket),
    ...(queues.length === 1 ? [`box: ${toQuoted(queues[0])}`] : [])
  ]
}

const events: ListSource = {
  from: 'events',
  time: 'publicationDate',
  projection:
    "{ publicationDate: 1, eventType: 1, status: 1, 'event.id': 1, 'lastError.message': 1 }",
  fixed: serviceAndBox
}

const listSources: Record<string, ListSource> = {
  'gas.applications': {
    from: 'applications',
    time: 'createdAt',
    projection: '{ clientRef: 1, code: 1, currentStatus: 1, createdAt: 1 }',
    fixed: () => []
  },
  'cw.cases': {
    from: 'cases',
    time: 'createdAt',
    projection:
      '{ caseRef: 1, workflowCode: 1, currentStatus: 1, createdAt: 1 }',
    fixed: () => []
  },
  'gas.grants': {
    from: 'grants',
    time: 'receivedAt',
    projection:
      '{ grantCode: 1, version: 1, status: 1, worstFetchStatus: 1, receivedAt: 1 }',
    fixed: () => []
  },
  'cw.workflows': {
    from: 'workflows',
    time: 'receivedAt',
    projection:
      '{ grantCode: 1, version: 1, status: 1, fetchStatus: 1, receivedAt: 1 }',
    fixed: () => []
  },
  'gas.events': events,
  'cw.events': events
}

/** Whether a list has an "Open in Explore". */
export const opensInExplore = (bucket: BucketEntry): boolean =>
  Object.hasOwn(listSources, bucket.id)

/** What a list shows: its facts by name, its time range as instants, and its search as stored. */
export interface ListLook {
  facts: Record<string, string | string[] | undefined>
  window: { from?: string; to?: string }
  search: string
}

/** A fact is stored under its name, which is its path, with the values as stored; the queue is the source's to say. */
const toFilterTests = (
  bucket: BucketEntry,
  facts: ListLook['facts']
): string[] =>
  bucket.facts.flatMap((fact) => {
    const value = facts[fact.name]

    return value?.length && fact.name !== queueFact
      ? [toTest(fact.name, [value].flat())]
      : []
  })

/** A list search is stored as `kind:value`, and found by the record's refs, which hold it trimmed and lower case. */
const toSearchTest = (search: string): string[] => {
  const at = search.indexOf(':')
  const value = search
    .slice(at + 1)
    .trim()
    .toLowerCase()

  return at < 1 || !value
    ? []
    : [toTest('refs', [`${search.slice(0, at)}:${value}`])]
}

const toRangeTests = (
  time: string,
  { from, to }: ListLook['window']
): string[] => {
  const bounds = [
    ...(from ? [`$gte: ISODate(${toQuoted(from)})`] : []),
    ...(to ? [`$lte: ISODate(${toQuoted(to)})`] : [])
  ]

  return bounds.length ? [`${time}: ${toObject(bounds)}`] : []
}

/** A list's filters, its time range and its search, as the query that finds the same records; null for a list Explore doesn't open. */
export const toListQuery = (
  bucket: BucketEntry,
  { facts, window, search }: ListLook
): string | null => {
  const source = listSources[bucket.id]

  return source
    ? toFind({
        from: source.from,
        filter: [
          ...source.fixed(bucket, facts),
          ...toFilterTests(bucket, facts),
          ...toRangeTests(source.time, window),
          ...toSearchTest(search)
        ],
        projection: source.projection,
        sort: `{ ${source.time}: -1 }`
      })
    : null
}

export type FindBy = 'business' | 'sbi'

/** What a record's Find others finds, and what of the record it finds by. */
export interface FindOthersItem {
  value: string
  label: string
  by: FindBy
  toQuery: (value: string) => string
}

const applicationBusiness = 'phases.answers.applicant.business.name'

const toSbiRef = (sbi: string): string => `sbi:${sbi.trim().toLowerCase()}`

export const findOthersItems: FindOthersItem[] = [
  {
    value: 'applications-by-business',
    label: 'Applications under this business name',
    by: 'business',
    toQuery: (business) =>
      toFind({
        from: 'applications',
        filter: [toTest(applicationBusiness, [business])],
        projection:
          '{ clientRef: 1, code: 1, currentConfigVersion: 1, currentStatus: 1, createdAt: 1 }',
        sort: '{ createdAt: -1 }'
      })
  },
  {
    value: 'cases-by-sbi',
    label: 'Cases for this business, by stage',
    by: 'sbi',
    toQuery: (sbi) =>
      [
        'db.cases.aggregate([',
        `  { $match: { ${toTest('refs', [toSbiRef(sbi)])} } },`,
        "  { $group: { _id: '$currentStage', cases: { $sum: 1 }, latest: { $max: '$createdAt' } } },",
        '  { $sort: { cases: -1 } }',
        '])'
      ].join('\n')
  },
  {
    value: 'payments-by-sbi',
    label: 'Payments to this business',
    by: 'sbi',
    toQuery: (sbi) =>
      toFind({
        from: 'payments',
        filter: [toTest('sbi', [sbi])],
        projection:
          "{ invoiceNumber: 1, 'source.agreementNumber': 1, 'agreement.code': 1, 'payments.status': 1, totalAmountPence: 1, 'payments.dueDate': 1 }",
        sort: "{ 'payments.dueDate': -1 }"
      })
  }
]

export const findOthersItem = (value: string): FindOthersItem | null =>
  findOthersItems.find((item) => item.value === value) ?? null

/** The record a Find others came from, by the path of its page. */
export interface FoundRecord {
  source: 'applications' | 'cases'
  noun: 'application' | 'case'
  /** Where its record keeps its code, its reference, its business name and its SBI. */
  paths: { code: string; ref: string; business: string; sbi: string }
  code: string
  ref: string
}

const recordPaths: [RegExp, Omit<FoundRecord, 'code' | 'ref'>][] = [
  [
    /^\/dev-ops\/applications\/([^/?#]+)\/([^/?#]+)$/,
    {
      source: 'applications',
      noun: 'application',
      paths: {
        code: 'code',
        ref: 'clientRef',
        business: applicationBusiness,
        sbi: 'identifiers.sbi'
      }
    }
  ],
  [
    /^\/dev-ops\/cases\/([^/?#]+)\/([^/?#]+)$/,
    {
      source: 'cases',
      noun: 'case',
      paths: {
        code: 'workflowCode',
        ref: 'caseRef',
        business: 'payload.answers.applicant.business.name',
        sbi: 'payload.identifiers.sbi'
      }
    }
  ]
]

const decoded = (part: string): string | null => {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

const toRecordAt = (
  path: string,
  [pattern, kind]: (typeof recordPaths)[number]
): FoundRecord | null => {
  const [, code, ref] = (pattern.exec(path) ?? []).map(decoded)

  return code && ref ? { ...kind, code, ref } : null
}

export const toFoundRecord = (path: string): FoundRecord | null =>
  recordPaths
    .map((recordPath) => toRecordAt(path, recordPath))
    .find((record) => record !== null) ?? null

/** The query that reads the one record's values, and which column holds each: GAS keys columns by their place, not their name. */
export interface RecordLookup {
  query: string
  columns: FindBy[]
}

const lookedUp: FindBy[] = ['business', 'sbi']

export const toLookup = ({
  paths,
  source,
  code,
  ref
}: FoundRecord): RecordLookup => ({
  query: `${toFind({
    from: source,
    filter: [toTest(paths.code, [code]), toTest(paths.ref, [ref])],
    projection: toObject(lookedUp.map((by) => `${by}: '$${paths[by]}'`))
  })}.limit(1)`,
  columns: lookedUp
})
