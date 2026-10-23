import type {
  DefinitionFetchFile,
  DefinitionFetchOutcome,
  DefinitionFetchResult
} from '../use-cases/definition-fetches.ts'
import type { RecordType } from './record-type.ts'
import type { VersionFiles, VersionFileType } from './version-banner.ts'
import { toAndList, toDefinitionNoun } from './words.ts'
import type { Words } from './words.ts'

export const definitionFetchNoticeKey = 'definitionFetchOutcome'

export interface DefinitionFetchFlash extends DefinitionFetchResult {
  /** A flash the redirect never delivered must not surface on another version. */
  page: string
}

export interface DefinitionFetchNotice {
  role: 'success' | 'warning' | 'error'
  words: Words
}

type FailedFile = Extract<DefinitionFetchFile, { outcome: 'failed' }>

const reasonTexts = (
  source: string
): Partial<Record<FailedFile['reason'], string>> => ({
  missing: 'Definition file missing',
  forbidden: `Definition file not readable by ${source}`,
  timeout: 'S3 could not return the file',
  unparseable: 'Definition file is not valid JSON'
})

/** An invalid file is named in the service's own words for what is wrong with it. */
const toReasonText = (
  { reason, message }: FailedFile,
  source: string
): string => {
  if (reason === 'invalid') {
    return message ?? `${source} refused the definition and gave no reason`
  }

  return reasonTexts(source)[reason] ?? `${source} gave reason ${reason}`
}

const nextSteps = (
  source: string
): Partial<Record<FailedFile['reason'], string>> => ({
  missing: 'Pressing Fetch again fails the same way until the file is in S3.',
  forbidden: `${source} can't read the bucket; check its S3 access.`,
  unparseable: "This version's file will never load; publish a fixed version.",
  invalid: "This version's file will never load; publish a fixed version."
})

/** A timeout stands for any other S3 error, and anything newer gets the same step. */
const toNextStep = ({ reason }: FailedFile, source: string): string =>
  nextSteps(source)[reason] ?? 'Try again.'

type CallNotice = (source: string) => DefinitionFetchNotice

const notice = (
  role: DefinitionFetchNotice['role'],
  text: string
): DefinitionFetchNotice => ({ role, words: [text] })

/** GPA calls GAS for every fetch, so a call that failed or went unanswered is GAS's, even on a workflow version. Partial: a session written by another release may name an outcome this one has no words for. */
const callNotices: Partial<Record<string, CallNotice>> = {
  'not-found': (source) =>
    notice(
      'error',
      `Not fetched: ${source} no longer has this version. Nothing has changed.`
    ),
  unavailable: () =>
    notice(
      'error',
      'Fetch failed: GAS could not finish it. Refresh to see what was stored.'
    ),
  'timed-out': () =>
    notice(
      'warning',
      'Fetch status unknown: GAS did not answer in time. Refresh to check.'
    )
} satisfies Record<Exclude<DefinitionFetchOutcome, 'fetched'>, CallNotice>

const toStoredNotice = (
  files: DefinitionFetchFile[]
): DefinitionFetchNotice[] =>
  files.length
    ? [
        notice(
          'success',
          `Stored: ${toAndList(files.map(({ file }) => file))} ${toDefinitionNoun(files.length)}.`
        )
      ]
    : []

/** Where the file is, from the page's own header; nothing when either part is unknown. */
const toLocation = ({ s3Bucket, files }: VersionFiles, file: string): Words => {
  const key = files[file as VersionFileType]?.s3Key

  return s3Bucket && key ? [' from ', { code: `${s3Bucket}/${key}` }] : []
}

const toFailedNotice = (
  file: FailedFile,
  source: string,
  header: VersionFiles
): DefinitionFetchNotice => ({
  role: 'error',
  words: [
    `Couldn't fetch the ${file.file} definition`,
    ...toLocation(header, file.file),
    ': ',
    { code: toReasonText(file, source) },
    `. ${toNextStep(file, source)} Nothing has changed.`
  ]
})

const toCallNotices = (
  outcome: string,
  source: string
): DefinitionFetchNotice[] => {
  const callNotice = callNotices[outcome]?.(source)

  return callNotice ? [callNotice] : []
}

const toFileNotices = (
  files: DefinitionFetchFile[],
  source: string,
  header: VersionFiles
): DefinitionFetchNotice[] => [
  ...toStoredNotice(files.filter(({ outcome }) => outcome === 'stored')),
  ...files
    .filter((file): file is FailedFile => file.outcome === 'failed')
    .map((file) => toFailedNotice(file, source, header))
]

/** What the service said of the fetch that has just landed on `page`, as it said it. */
export const toDefinitionFetchNotices = (
  { source }: RecordType,
  flash: DefinitionFetchFlash | undefined,
  page: string,
  header: VersionFiles
): DefinitionFetchNotice[] => {
  if (flash?.page !== page) {
    return []
  }

  return flash.outcome === 'fetched'
    ? toFileNotices(flash.files, source, header)
    : toCallNotices(flash.outcome, source)
}
