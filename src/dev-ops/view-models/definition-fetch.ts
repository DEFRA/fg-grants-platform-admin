import type {
  DefinitionFetchFile,
  DefinitionFetchOutcome,
  DefinitionFetchResult
} from '../use-cases/fetch-grant-definitions.use-case.ts'
import type { RecordType } from './record-type.ts'
import { toAndList } from './version-header.ts'

export const definitionFetchNoticeKey = 'definitionFetchOutcome'

export interface DefinitionFetchFlash extends DefinitionFetchResult {
  /** A flash the redirect never delivered must not surface on another version. */
  page: string
}

/** `reason` sits between `text` and `tail`, in mono. */
export interface DefinitionFetchNotice {
  role: 'success' | 'warning' | 'error'
  text: string
  reason: string | null
  tail: string
}

type FailedFile = Extract<DefinitionFetchFile, { outcome: 'failed' }>

const reasonTexts = (
  source: string
): Partial<Record<FailedFile['reason'], string>> => ({
  missing: 'Definition file missing',
  forbidden: `Definition file not readable by ${source}`,
  timeout: 'S3 did not answer',
  unparseable: 'Definition file is not valid JSON'
})

/** An invalid file is named in the service's own words for what is wrong with it. */
const toReasonText = (
  { reason, message }: FailedFile,
  source: string
): string =>
  (reason === 'invalid' ? message : reasonTexts(source)[reason]) ?? reason

type CallNotice = (
  source: string
) => Pick<DefinitionFetchNotice, 'role' | 'text'>

/** Partial: a session written by another release may name an outcome this one has no words for. */
const callNotices: Partial<Record<string, CallNotice>> = {
  'not-found': (source) => ({
    role: 'error',
    text: `Not fetched — ${source} no longer has this version. Nothing has changed.`
  }),
  unavailable: (source) => ({
    role: 'error',
    text: `Fetch failed — ${source} could not finish it. Refresh to see what was stored.`
  }),
  'timed-out': (source) => ({
    role: 'warning',
    text: `Fetch status unknown — ${source} did not answer in time. Refresh to check.`
  })
} satisfies Record<Exclude<DefinitionFetchOutcome, 'fetched'>, CallNotice>

const toStoredNotice = (
  files: DefinitionFetchFile[]
): DefinitionFetchNotice[] =>
  files.length
    ? [
        {
          role: 'success',
          text: `Fetched — ${toAndList(files.map(({ file }) => file))} definition${files.length > 1 ? 's' : ''} stored.`,
          reason: null,
          tail: ''
        }
      ]
    : []

const toFailedNotice = (
  file: FailedFile,
  source: string
): DefinitionFetchNotice => ({
  role: 'error',
  text: `Not fetched — ${file.file} definition: `,
  reason: toReasonText(file, source),
  tail: '. Nothing has changed.'
})

const toCallNotices = (
  outcome: string,
  source: string
): DefinitionFetchNotice[] => {
  const callNotice = callNotices[outcome]?.(source)

  return callNotice ? [{ ...callNotice, reason: null, tail: '' }] : []
}

const toFileNotices = (
  files: DefinitionFetchFile[],
  source: string
): DefinitionFetchNotice[] => [
  ...toStoredNotice(files.filter(({ outcome }) => outcome === 'stored')),
  ...files
    .filter((file): file is FailedFile => file.outcome === 'failed')
    .map((file) => toFailedNotice(file, source))
]

/** What the service said of the fetch that has just landed on `page`, as it said it. */
export const toDefinitionFetchNotices = (
  { source }: RecordType,
  notice: DefinitionFetchFlash | undefined,
  page: string
): DefinitionFetchNotice[] => {
  if (notice?.page !== page) {
    return []
  }

  return notice.outcome === 'fetched'
    ? toFileNotices(notice.files, source)
    : toCallNotices(notice.outcome, source)
}
