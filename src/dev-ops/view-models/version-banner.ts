import type {
  DefinitionFile,
  FetchStatus,
  VersionRef,
  VersionSummary
} from '../use-cases/definition-fetches.ts'
import type {
  BucketEntry,
  BucketFactValue,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import type { FactLine } from './record-page.view-model.ts'
import type { RecordType } from './record-type.ts'
import type { Words } from './words.ts'

export type VersionFileType = 'grant' | 'agreement' | 'payment' | 'workflow'

export type BannerTone = 'info' | 'warning' | 'error'

/** What the version page knows of its version: which files it has, and the service's own fetch of each. */
export interface VersionFiles extends VersionRef {
  status: VersionSummary['status']
  files: Partial<Record<VersionFileType, DefinitionFile>>
  /** Older backends leave it out. */
  s3Bucket?: string | null
}

/** The page's version, with every version of its record, newest first. */
export interface BannerVersion extends VersionFiles {
  versions: VersionSummary[]
}

export const fileOrder: VersionFileType[] = [
  'grant',
  'agreement',
  'payment',
  'workflow'
]

const fileNames: Record<VersionFileType, string> = {
  grant: 'Grant definition',
  agreement: 'Agreement definition',
  payment: 'Payment definition',
  workflow: 'Workflow definition'
}

const fileLabels: Record<VersionFileType, string> = {
  grant: 'Grant',
  agreement: 'Agreement',
  payment: 'Payment',
  workflow: 'Workflow'
}

/** The file the service fetches for itself and caps at five tries; the others it reads on demand, uncapped. */
const isMainFile = (type: VersionFileType): boolean =>
  type === 'grant' || type === 'workflow'

/** The service stops fetching the main file after this many failures, and marks it Failed the next time it needs the version. */
const maxFetchAttempts = 5

const fetchLabels: Record<string, string> = {
  grant: 'Fetch definitions',
  workflow: 'Fetch definition'
}

export const toFetchLabel = ({ itemId }: RecordType): string =>
  fetchLabels[itemId] ?? 'Fetch definitions'

const notLoaded = new Set<FetchStatus>(['pending', 'transient_error'])

/** Stored, but the service has not loaded it itself, so its own fetch status still says otherwise. */
const isStoredNotLoaded = ({ stored, fetchStatus }: DefinitionFile) =>
  stored && notLoaded.has(fetchStatus)

const majorOf = (version: string): string => version.split('.')[0]

interface Context {
  record: RecordType
  version: BannerVersion
  type: VersionFileType
  file: DefinitionFile
}

/** `bucket/key`, or nothing when either is unknown. */
const toWhere = ({ version, file }: Context): string | null =>
  version.s3Bucket && file.s3Key ? `${version.s3Bucket}/${file.s3Key}` : null

/** ": `error`.", or a bare full stop when the service kept no error. */
const errorTail = ({ file }: Context): Words =>
  file.fetchError ? [': ', { code: file.fetchError }, '.'] : ['.']

const lastFetchFailed = (context: Context): Words => {
  const where = toWhere(context)

  return [
    `${context.record.source}'s last fetch`,
    ...(where ? [' of ', { code: where }] : []),
    ' failed',
    ...errorTail(context)
  ]
}

const attemptWords = ({ type, file }: Context): string => {
  if (file.fetchAttempts === undefined) {
    return ''
  }

  return isMainFile(type)
    ? `, attempt ${file.fetchAttempts} of ${maxFetchAttempts}`
    : `, ${file.fetchAttempts} failed fetches in a row`
}

const isDraft = ({ version }: Context): boolean => version.status === 'draft'

/** A newer active version of the same major that is not Failed, which the service rolls forward to instead of this one. */
const hasNewerUsable = ({ version, versions }: BannerVersion): boolean => {
  const at = versions.findIndex((entry) => entry.version === version)

  return versions
    .slice(0, Math.max(at, 0))
    .some(
      (entry) =>
        entry.status === 'active' &&
        entry.fetchStatus !== 'permanent_error' &&
        majorOf(entry.version) === majorOf(version)
    )
}

/** The main file is fetched only for the newest usable version of a major; the others whenever an agreement or claim on the version needs them. */
const whenFetched = ({ record, type, version }: Context): string => {
  if (!isMainFile(type)) {
    return `${record.source} fetches it from S3 the first time an agreement or claim on ${version.version} needs it.`
  }

  const fetched = `${record.source} fetches it from S3 when it first needs it.`

  return hasNewerUsable(version)
    ? `${fetched} ${record.source} only uses the newest usable version in each major, so an older version's ${type} file is never fetched; that is normal.`
    : fetched
}

const notStoredYet = (context: Context): Words => {
  const first = `${fileNames[context.type]} not stored yet.`

  return isDraft(context)
    ? [first]
    : [
        first,
        ` ${whenFetched(context)} ${toFetchLabel(context.record)} stores it now.`
      ]
}

const retryWords = ({ record, type, file }: Context): string => {
  if (!isMainFile(type)) {
    return ` ${record.source} tries again each time it needs this file.`
  }

  return (file.fetchAttempts ?? 0) >= maxFetchAttempts
    ? ` ${record.source} won't fetch it again: it marks it Failed the next time it needs this version.`
    : ` ${record.source} tries again the next time it needs this version.`
}

const fetchError = (context: Context): Words => {
  const first = `${fileNames[context.type]}: fetch error${attemptWords(context)}.`

  return isDraft(context)
    ? [first]
    : [first, ' ', ...lastFetchFailed(context), retryWords(context)]
}

/** "Grants list", as the navigation names it. */
const listName = ({ listId }: RecordType): string =>
  `${listId.charAt(0).toUpperCase()}${listId.slice(1)} list`

const whenUsed = ({ record, type }: Context, many: boolean): string => {
  if (isMainFile(type)) {
    return ` ${record.source} ignores this copy and still fetches the file from S3 itself the first time it needs it.`
  }

  return many
    ? ` ${record.source} uses each stored copy the first time it needs it.`
    : ` ${record.source} uses this stored copy the first time it needs it.`
}

/** "Agreement and payment definitions". */
const namesOf = (types: VersionFileType[]): string => {
  if (types.length === 1) {
    return fileNames[types[0]]
  }

  const labels = types.map((type, at) =>
    at ? fileLabels[type].toLowerCase() : fileLabels[type]
  )

  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)} definitions`
}

/** One sentence for the stored files not yet loaded that the service treats alike. */
const storedNotLoaded = (context: Context, types: VersionFileType[]): Words => {
  const { record } = context
  const many = types.length > 1
  const them = many ? 'them' : 'it'
  const first = `${namesOf(types)} stored. ${record.source} hasn't loaded ${them} itself yet, so the ${listName(record)} shows ${them} as Not stored yet (or Fetch error).`

  return isDraft(context) ? [first] : [first, whenUsed(context, many)]
}

const failedConsequences: Record<
  VersionFileType,
  (major: string, version: string) => string
> = {
  grant: (major) =>
    `GAS won't roll forward to this version: applications on ${major}.x use the newest usable ${major}.x version instead. If this is the newest version, calls that name no version (the allow list and administration) fail. Publish a fixed version.`,
  agreement: (major, version) =>
    `GAS won't use this agreement definition: new agreements use the newest usable ${major}.x one at or below ${version}, and actions before acceptance use the newest usable ${major}.x one. Publish a fixed version.`,
  payment: () =>
    'Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.',
  workflow: (major) =>
    `CW won't roll forward to this version: cases on ${major}.x use the newest usable ${major}.x version instead. Publish a fixed version.`
}

/** What a Failed file stops, in a sentence of its own: also a badge's title. */
const toFailedConsequence = (
  type: VersionFileType,
  { version }: VersionRef
): string => failedConsequences[type](majorOf(version), version)

const failed = (context: Context): Words => [
  `${fileNames[context.type]} ${context.file.stored ? `stored, but ${context.record.source} marked it failed` : 'failed'}`,
  ...errorTail(context),
  ` ${toFailedConsequence(context.type, context.version)}`
]

const unstoredWords = (context: Context): Words =>
  context.file.fetchStatus === 'transient_error'
    ? fetchError(context)
    : notStoredYet(context)

/** The one sentence a file needs, or none for a file stored and loaded. */
const toFileWords = (context: Context): Words | null => {
  if (context.file.fetchStatus === 'permanent_error') {
    return failed(context)
  }

  if (isStoredNotLoaded(context.file)) {
    return storedNotLoaded(context, [context.type])
  }

  return context.file.stored ? null : unstoredWords(context)
}

const toneOf = ({ stored, fetchStatus }: DefinitionFile): BannerTone => {
  if (fetchStatus === 'permanent_error') {
    return 'error'
  }

  return !stored && fetchStatus === 'transient_error' ? 'warning' : 'info'
}

const toneRank: BannerTone[] = ['info', 'warning', 'error']

const worstTone = (tones: BannerTone[]): BannerTone =>
  toneRank[Math.max(0, ...tones.map((tone) => toneRank.indexOf(tone)))]

const draftWords = ({ source, itemId }: RecordType): Words => [
  { strong: 'Draft:' },
  itemId === 'workflow'
    ? ` ${source} won't pick this version for new work until the config broker publishes it as active. Fetch definition stores its file now; once the version is active, ${source} still fetches the workflow file from S3 itself.`
    : ` ${source} won't pick this version for new work until the config broker publishes it as active. Fetch definitions stores its files now; once the version is active, ${source} uses the stored agreement and payment files, and still fetches the grant file from S3 itself.`
]

export interface BannerLines {
  tone: BannerTone
  lines: Words[]
}

/** Stored files not yet loaded that the service treats alike, side by side, as one. */
const joinsLast = (contexts: Context[], { type, file }: Context): boolean => {
  const last = contexts.at(-1)

  return (
    last !== undefined &&
    isStoredNotLoaded(last.file) &&
    isStoredNotLoaded(file) &&
    isMainFile(last.type) === isMainFile(type)
  )
}

const toGroups = (contexts: Context[]): Context[][] =>
  contexts.reduce<Context[][]>((groups, context) => {
    const last = groups.at(-1)

    return last && joinsLast(last, context)
      ? [...groups.slice(0, -1), [...last, context]]
      : [...groups, [context]]
  }, [])

const toGroupWords = (group: Context[]): Words | null =>
  group.length > 1
    ? storedNotLoaded(
        group[0],
        group.map(({ type }) => type)
      )
    : toFileWords(group[0])

/** One sentence per file that needs one, files in order, stored ones not yet loaded together; none when every file is stored and loaded. */
export const toBannerLines = (
  record: RecordType,
  version: BannerVersion
): BannerLines | null => {
  const contexts = fileOrder.flatMap((type) => {
    const file = version.files[type]

    return file ? [{ record, version, type, file }] : []
  })
  const files = toGroups(contexts).flatMap((group) => {
    const words = toGroupWords(group)

    return words
      ? [{ words, tone: worstTone(group.map(({ file }) => toneOf(file))) }]
      : []
  })

  if (!files.length) {
    return null
  }

  return {
    tone: worstTone(files.map(({ tone }) => tone)),
    lines: [
      ...(version.status === 'draft' ? [draftWords(record)] : []),
      ...files.map(({ words }) => words)
    ]
  }
}

/** The list's own Definition values, as the service declares them for its version list. */
const versionLists: Record<string, string> = {
  grant: 'gas.grants',
  workflow: 'cw.workflows'
}

const valuesOf = (
  { columns, facts }: BucketEntry,
  key: string
): BucketFactValue[] => {
  const column = columns.find((entry) => entry.key === key)

  return facts.find(({ name }) => name === column?.fact)?.values ?? []
}

/** The values of a column of the record's version list, as the service declares them; none without the catalogue. */
export const toListValues = (
  record: RecordType,
  catalogue: Catalogue | null,
  key: 'definition' | 'status'
): BucketFactValue[] => {
  const bucket = catalogue?.buckets.find(
    ({ id }) => id === versionLists[record.itemId]
  )

  return bucket ? valuesOf(bucket, key) : []
}

type FactBadge = NonNullable<FactLine['badges']>[number]

const toFetchBadge = (
  values: BucketFactValue[],
  fetchStatus: FetchStatus
): FactBadge[] =>
  values
    .filter(({ value }) => value === fetchStatus)
    .map(({ label, tone = 'neutral' }) => ({ status: label, role: tone }))

const toFileBadges = (
  type: VersionFileType,
  version: VersionFiles,
  values: BucketFactValue[],
  { stored, fetchStatus }: DefinitionFile
): FactBadge[] => {
  const shown = toFetchBadge(values, stored ? 'fetched' : fetchStatus)

  if (fetchStatus !== 'permanent_error') {
    return shown
  }

  const failed = toFetchBadge(values, fetchStatus).map((badge) => ({
    ...badge,
    title: toFailedConsequence(type, version)
  }))

  return stored ? [...shown, ...failed] : failed
}

const toFileLine = (
  record: RecordType,
  type: VersionFileType,
  version: VersionFiles,
  values: BucketFactValue[],
  file: DefinitionFile
): FactLine[] => {
  const badges = toFileBadges(type, version, values, file)

  return badges.length
    ? [
        {
          label: fileLabels[type],
          badges,
          note: isStoredNotLoaded(file)
            ? `not loaded by ${record.source} yet`
            : null
        }
      ]
    : []
}

/** One line per file the version has, in the list's own words: stored as the page sees it, and the service's own fetch where that says more. */
export const toFileLines = (
  record: RecordType,
  version: VersionFiles,
  catalogue: Catalogue | null
): FactLine[] => {
  const values = toListValues(record, catalogue, 'definition')

  return fileOrder.flatMap((type) => {
    const file = version.files[type]

    return file ? toFileLine(record, type, version, values, file) : []
  })
}
