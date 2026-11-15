import type {
  DefinitionFetchFile,
  DefinitionFile
} from '../use-cases/definition-fetches.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { agreementFallback, paymentNoFallback } from './definition-fallbacks.ts'
import { toFailureText, unansweredBy } from './failure-text.ts'
import { fileNames, fileOrder, toStoredState } from './version-files.ts'
import type {
  StoredState,
  VersionFiles,
  VersionFileType
} from './version-files.ts'
import type { Words } from './words.ts'
import { toVersionName } from './record-type.ts'

/** What the alert's one button does: fetch the files not stored, or reload the page. */
export interface AlertAction {
  kind: 'fetch' | 'refresh'
  text: string
  icon: string
  variant: 'primary' | 'default'
}

export interface VersionAlert {
  tone: 'info' | 'warning' | 'danger'
  title: string
  text: Words
  action: AlertAction | null
}

export interface Toast {
  tone: 'success' | 'warning'
  text: string
}

/** The grant page and the workflow page say the same things in their own words. */
interface Copy {
  source: string
  fetch: AlertAction
  retry: AlertAction
  notStored: (version: VersionFiles) => VersionAlert
  fetchError: (type: VersionFileType, file: DefinitionFile) => VersionAlert
  failed: (
    type: VersionFileType,
    file: DefinitionFile,
    version: VersionFiles
  ) => VersionAlert
  storedNotLoaded: VersionAlert
  stored: (name: string) => Toast
  /** @param service The one that didn't answer: GAS for its own silence, else the one GAS waited on. */
  timedOut: (service: string) => {
    alert: VersionAlert | null
    toast: Toast | null
  }
  unanswered: (failure: GasFailure) => VersionAlert
}

const refresh: AlertAction = {
  kind: 'refresh',
  text: 'Refresh',
  icon: 'refresh-cw',
  variant: 'default'
}

const publishFixed = 'Publish a fixed version.'

const notStoredYet = 'Not stored yet' satisfies StoredState

/** The service's own error, then what follows from it. */
const withError = (file: DefinitionFile, after: string): Words =>
  file.fetchError ? [{ code: file.fetchError }, `. ${after}`] : [after]

/** What a Failed agreement or payment file stops, in GAS's terms. */
const failedConsequences: Partial<
  Record<VersionFileType, (version: string) => string>
> = {
  agreement: (version) =>
    `${agreementFallback(version).failed} ${publishFixed}`,
  payment: () => `${paymentNoFallback} ${publishFixed}`
}

const failedFile = (
  type: VersionFileType,
  file: DefinitionFile,
  { version }: VersionFiles
): VersionAlert => ({
  tone: 'danger',
  title: file.fetchError
    ? `${fileNames[type]} failed: ${file.fetchError}.`
    : `${fileNames[type]} failed.`,
  text: [failedConsequences[type]?.(version) ?? ''],
  action: null
})

const grantFetchError = (type: VersionFileType): string =>
  type === 'grant'
    ? 'GAS tries again the next time it needs the file; after 5 failed fetches it marks it Failed.'
    : 'GAS tries again the next time it needs the file.'

type LaterFiles = 'agreement' | 'payment' | 'agreement,payment'

/** GAS stores these only once it creates an agreement or resolves a payment, so until then they are not stored, and that is normal. */
const laterFilesCopy: Record<
  LaterFiles,
  { title: string; text: string; fetch: string }
> = {
  agreement: {
    title: 'The agreement definition isn’t stored yet.',
    text: 'GAS stores it when it first creates an agreement for this version. Until then the Agreement tab waits for it; everything else is shown.',
    fetch: 'Fetch it now'
  },
  payment: {
    title: 'The payment definition isn’t stored yet.',
    text: 'GAS stores it when it first resolves a payment for this version. Until then the Payment tab waits for it; everything else is shown.',
    fetch: 'Fetch it now'
  },
  'agreement,payment': {
    title: 'The agreement and payment definitions aren’t stored yet.',
    text: 'GAS stores them when it first creates an agreement or resolves a payment for this version. Until then the Agreement and Payment tabs wait for them; everything else is shown.',
    fetch: 'Fetch them now'
  }
}

const isNotStored = (file: DefinitionFile | undefined): boolean =>
  file !== undefined && toStoredState(file) === notStoredYet

const isLaterFiles = (key: string): key is LaterFiles =>
  Object.hasOwn(laterFilesCopy, key)

const toLaterFiles = ({ files }: VersionFiles): LaterFiles | null => {
  const key = (['agreement', 'payment'] as const)
    .filter((type) => isNotStored(files[type]))
    .join(',')

  return isLaterFiles(key) ? key : null
}

/** Null unless the agreement or payment definition is what isn't stored. */
const laterFilesNotStored = (version: VersionFiles): VersionAlert | null => {
  const later = toLaterFiles(version)

  if (!later) {
    return null
  }

  const { title, text, fetch } = laterFilesCopy[later]

  return {
    tone: 'info',
    title,
    text: [text],
    action: { kind: 'fetch', text: fetch, icon: 'download', variant: 'default' }
  }
}

const grantCopy: Copy = {
  source: 'GAS',
  fetch: {
    kind: 'fetch',
    text: 'Fetch definitions',
    icon: 'download',
    variant: 'primary'
  },
  retry: {
    kind: 'fetch',
    text: 'Try again',
    icon: 'refresh-cw',
    variant: 'default'
  },
  notStored: (version) =>
    (version.files.grant && toStoredState(version.files.grant) === 'Stored'
      ? laterFilesNotStored(version)
      : null) ?? {
      tone: 'info',
      title: 'GAS fetches each definition from S3 when it first needs it.',
      text: [
        'Fetch them now to see the phases, questions and the rest. The Files list below shows which are stored.'
      ],
      action: grantCopy.fetch
    },
  fetchError: (type, file) => ({
    tone: 'warning',
    title:
      type === 'grant'
        ? 'GAS’s last fetch from S3 failed.'
        : `GAS’s last fetch of the ${fileNames[type].toLowerCase()} from S3 failed.`,
    text: withError(file, grantFetchError(type)),
    action: grantCopy.retry
  }),
  failed: (type, file, version) =>
    type === 'grant'
      ? {
          tone: 'danger',
          title: 'GAS won’t use this version.',
          text: file.fetchError
            ? [
                'It couldn’t fetch or read the grant definition: ',
                { code: file.fetchError },
                `. ${publishFixed}`
              ]
            : [
                `It couldn’t fetch or read the grant definition. ${publishFixed}`
              ],
          action: null
        }
      : failedFile(type, file, version),
  storedNotLoaded: {
    tone: 'info',
    title: 'Stored, not loaded by GAS yet.',
    text: [
      'Every file is stored. GAS loads them the next time it needs this version.'
    ],
    action: null
  },
  stored: (name) => ({
    tone: 'success',
    text: `Definitions stored for ${name}`
  }),
  timedOut: (service) => ({
    alert: {
      tone: 'warning',
      title: `Fetch status unknown: ${service} didn’t answer in time.`,
      text: [
        'The fetch may still have worked. Refresh to check before fetching again.'
      ],
      action: refresh
    },
    toast: null
  }),
  unanswered: (failure) => ({
    tone: 'danger',
    title: `The definitions couldn’t be fetched: ${toFailureText(failure, 'GAS')}`,
    text: ['Some files may have been stored. Refresh to check.'],
    action: refresh
  })
}

const workflowCopy: Copy = {
  source: 'CW',
  fetch: {
    kind: 'fetch',
    text: 'Fetch definition',
    icon: 'download',
    variant: 'primary'
  },
  retry: {
    kind: 'fetch',
    text: 'Try again',
    icon: 'download',
    variant: 'default'
  },
  notStored: () => ({
    tone: 'info',
    title: 'CW fetches this definition from S3 when it first needs it.',
    text: ['Fetch it now to see its phases, tasks, pages and integrations.'],
    action: workflowCopy.fetch
  }),
  fetchError: (_type, file) => ({
    tone: 'warning',
    title: 'CW’s last fetch from S3 failed.',
    text: withError(file, 'CW tries again the next time it needs it.'),
    action: workflowCopy.retry
  }),
  failed: (_type, file) => ({
    tone: 'danger',
    title: 'CW won’t use this definition.',
    text: withError(file, publishFixed),
    action: null
  }),
  storedNotLoaded: {
    tone: 'info',
    title: 'Stored, not loaded by CW yet.',
    text: ['CW loads it the next time it needs this version.'],
    action: null
  },
  stored: (name) => ({
    tone: 'success',
    text: `Definition stored for ${name}`
  }),
  timedOut: (service) => ({
    alert: null,
    toast: {
      tone: 'warning',
      text: `${service} didn’t answer in time — refresh to check`
    }
  }),
  unanswered: (failure) => ({
    tone: 'danger',
    title: `The definition couldn’t be fetched: ${toFailureText(failure, 'CW')}`,
    text: ['Refresh to check whether it was stored.'],
    action: refresh
  })
}

export const versionCopies = { grant: grantCopy, workflow: workflowCopy }

export type VersionKind = keyof typeof versionCopies

interface Present {
  type: VersionFileType
  file: DefinitionFile
  state: StoredState
}

const presentFiles = ({ files }: VersionFiles): Present[] =>
  fileOrder.flatMap((type) => {
    const file = files[type]

    return file ? [{ type, file, state: toStoredState(file) }] : []
  })

/** Stored, but the service hasn't loaded it itself, so its own fetch status still says otherwise. */
const isStoredNotLoaded = ({ file }: Present): boolean =>
  file.stored && file.fetchStatus !== 'fetched'

const byState = (present: Present[], state: StoredState) =>
  present.find((entry) => entry.state === state)

type FileRule = (
  copy: Copy,
  present: Present[],
  version: VersionFiles
) => VersionAlert | null

/** Worst first: the first rule that has something to say is the alert. */
const fileRules: FileRule[] = [
  (copy, present, version) => {
    const failed = byState(present, 'Failed')

    return failed ? copy.failed(failed.type, failed.file, version) : null
  },
  (copy, present) => {
    const failing = byState(present, 'Fetch error')

    return failing ? copy.fetchError(failing.type, failing.file) : null
  },
  (copy, present, version) =>
    byState(present, notStoredYet) ? copy.notStored(version) : null,
  (copy, present) =>
    present.some(isStoredNotLoaded) ? copy.storedNotLoaded : null
]

/** What each rule says of the files, worst first. */
const toFileFindings = (kind: VersionKind, version: VersionFiles) => {
  const copy = versionCopies[kind]
  const present = presentFiles(version)

  return fileRules
    .map((rule) => rule(copy, present, version))
    .filter((alert): alert is VersionAlert => alert !== null)
}

const toFetchUnder = (
  worst: VersionAlert,
  rest: VersionAlert[],
  version: VersionFiles
): VersionAlert[] =>
  worst.action === null && canFetch(version)
    ? rest.filter(({ action }) => action).slice(0, 1)
    : []

/**
 * The worst alert the files need; none when every file is stored and loaded.
 * A worst alert with nothing to press, while a file can still be fetched, has
 * the next one that can fetch it under it, so the page always offers the fetch.
 */
export const toFileAlerts = (
  kind: VersionKind,
  version: VersionFiles
): VersionAlert[] => {
  const [worst, ...rest] = toFileFindings(kind, version)

  return worst ? [worst, ...toFetchUnder(worst, rest, version)] : []
}

/** Whether any file can still be fetched: one Failed is refused again, as it is not stored. */
export const canFetch = (version: VersionFiles): boolean =>
  presentFiles(version).some(
    ({ state }) => state === notStoredYet || state === 'Fetch error'
  )

type FailedFetch = Extract<DefinitionFetchFile, { outcome: 'failed' }>

/** A sentence that names the service whose fetch it is. */
type Say = (source: string) => string

type Says = Partial<Record<FailedFetch['reason'], Say>>

const reasonTexts: Says = {
  missing: () => 'the file isn’t in S3',
  forbidden: (source) => `${source} can’t read the bucket`,
  timeout: () => 'S3 couldn’t return the file',
  unparseable: () => 'the file isn’t valid JSON'
}

const nextSteps: Says = {
  missing: () => 'Fetching again fails the same way until the file is in S3.',
  forbidden: (source) => `Check ${source}’s S3 access.`,
  unparseable: () => publishFixed,
  invalid: () => publishFixed
}

const sayFor = (says: Says, reason: string, otherwise: Say): Say =>
  says[reason as FailedFetch['reason']] ?? otherwise

/** An invalid file is named in the service's own words for what is wrong with it. */
const invalidOf =
  ({ message }: FailedFetch): Say =>
  (source) =>
    message ?? `${source} refused the definition and gave no reason`

const reasonOf = (source: string, file: FailedFetch): string =>
  (file.reason === 'invalid'
    ? invalidOf(file)
    : sayFor(
        reasonTexts,
        file.reason,
        (who) => `${who} gave the reason ${file.reason}`
      ))(source)

const fileWordOf = (file: string): string =>
  fileNames[file as VersionFileType]?.toLowerCase() ?? `${file} definition`

/** The service keeps no state for a fetch Dev Ops asked for, so the page says what came back, and offers it again while it can. */
const toFailedFetchAlert =
  ({ source, retry }: Copy, canRetry: boolean) =>
  (file: FailedFetch, at: number): VersionAlert => ({
    tone: 'danger',
    title: `The ${fileWordOf(file.file)} couldn’t be fetched: ${reasonOf(source, file)}.`,
    text: [
      `${sayFor(nextSteps, file.reason, () => 'Try again.')(source)} Nothing has changed.`
    ],
    action: at === 0 && canRetry ? retry : null
  })

export interface FetchOutcome {
  /** In place of the files' own alert: what the fetch did is the news. */
  alerts: VersionAlert[]
  toast: Toast | null
}

const noOutcome: FetchOutcome = { alerts: [], toast: null }

const isFailedFetch = (file: DefinitionFetchFile): file is FailedFetch =>
  file.outcome === 'failed'

const toFetchedOutcome = (
  copy: Copy,
  files: DefinitionFetchFile[],
  version: VersionFiles
): FetchOutcome => ({
  alerts: files
    .filter(isFailedFetch)
    .map(toFailedFetchAlert(copy, canFetch(version))),
  toast: files.some(({ outcome }) => outcome === 'stored')
    ? copy.stored(toVersionName(version))
    : null
})

const toTimedOutOutcome = (
  copy: Copy,
  failure: GasFailure | undefined
): FetchOutcome => {
  const { alert, toast } = copy.timedOut(
    unansweredBy(failure ?? { kind: 'timed-out' }, copy.source)
  )

  return { alerts: alert ? [alert] : [], toast }
}

const toUnansweredOutcome = (
  copy: Copy,
  { outcome, failure }: DefinitionFetchFlash
): FetchOutcome =>
  outcome === 'timed-out'
    ? toTimedOutOutcome(copy, failure)
    : {
        alerts: [copy.unanswered(failure ?? { kind: 'errored' })],
        toast: null
      }

/** What the fetch that has just landed on `page` did; nothing for a flash meant for another version. */
export const toFetchOutcome = (
  kind: VersionKind,
  flash: DefinitionFetchFlash | undefined,
  page: string,
  version: VersionFiles
): FetchOutcome => {
  if (flash?.page !== page) {
    return noOutcome
  }

  const copy = versionCopies[kind]

  return flash.outcome === 'fetched'
    ? toFetchedOutcome(copy, flash.files, version)
    : toUnansweredOutcome(copy, flash)
}
