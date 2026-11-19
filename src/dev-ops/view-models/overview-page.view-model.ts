import { statusCodes } from '../../common/status-codes.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type {
  ConfigFailed,
  DeadLetters,
  FailedVersion,
  ListLink,
  Overview,
  OverviewCount,
  OverviewPart,
  OverviewResult,
  OverviewSourceError,
  PerService,
  TokensExpiring,
  TopError,
  TopErrors
} from '../use-cases/get-overview.use-case.ts'
import type { ClientService } from '../use-cases/access-tokens.use-case.ts'
import { tokenStates } from './access-token-rows.ts'
import {
  clientServices,
  serviceWords,
  toClientsPath
} from './access-token-services.ts'
import { devOpsPath, overviewNavId } from './bucket-nav.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import { toDayTime, toTime, toTimes } from './times.ts'
import type { Times, TimeText } from './times.ts'
import { toFetchErrorDot } from './version-files.ts'
import type { StoredDot } from './version-files.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

const overviewNavActive = overviewNavId

/** The Overview is the admin's own root: the page sign-in lands on. */
export const overviewPath = devOpsPath

const topErrorsShown = 5

const counted = new Intl.NumberFormat('en-GB')

/** A count the service stopped at its cap is written with a plus: `10,000+`. */
export const toCount = ({ count, capped }: OverviewCount): string =>
  `${counted.format(count)}${capped ? '+' : ''}`

const shortName = (service: ClientService): string =>
  serviceWords[service].short

/** Who didn't answer: GAS, or CW behind it. */
const hopName = ({ hop }: OverviewSourceError): string =>
  hop === 'CW-BE' ? serviceWords.cw.short : serviceWords.gas.short

export interface SectionAlert {
  tone: 'danger'
  title: string
  text: string
}

const unaffected = 'The rest of the page is unaffected.'

const reasonTexts: Record<OverviewSourceError['reason'], string> = {
  UNREACHABLE: 'couldn’t be reached.',
  TIMED_OUT: 'didn’t answer in time.',
  ERRORED: 'answered with an error.'
}

const deadLettersName = 'dead letters'

/** What each part is called where it couldn't be loaded. */
type PartName = 'deadLetters' | 'topErrors' | 'configFailed' | 'tokensExpiring'

const partNouns: Record<PartName, Record<ClientService, string>> = {
  deadLetters: { gas: deadLettersName, cw: deadLettersName },
  topErrors: { gas: 'errors', cw: 'errors' },
  configFailed: { gas: 'grant versions', cw: 'workflow versions' },
  tokensExpiring: { gas: 'access tokens', cw: 'access tokens' }
}

/** Said where the part would be, naming the service that didn't answer; the rest of the page stays. */
export const toPartAlert = (
  part: PartName,
  service: ClientService,
  error: OverviewSourceError
): SectionAlert => ({
  tone: 'danger',
  title: `${shortName(service)}’s ${partNouns[part][service]} couldn’t be loaded.`,
  text: `${hopName(error)} ${reasonTexts[error.reason]} ${unaffected}`
})

interface Read<T> {
  service: ClientService
  data: T
}

const readParts = <T>(parts: PerService<T>): Read<T>[] =>
  clientServices.flatMap((service) => {
    const { data } = parts[service] as OverviewPart<T>

    return data === null ? [] : [{ service, data }]
  })

const partAlerts = <T>(part: PartName, parts: PerService<T>): SectionAlert[] =>
  clientServices.flatMap((service) => {
    const { sourceError } = parts[service] as OverviewPart<T>

    return sourceError === null ? [] : [toPartAlert(part, service, sourceError)]
  })

/** Both parts failed: nothing to draw a table of. */
const noneRead = <T>(parts: PerService<T>): boolean =>
  readParts(parts).length === 0

/** A list as GAS links it: Top errors with no time range (they are the current dead letters), a box's dead letters over the window. */
const toListHref = ({ path, query }: ListLink): string =>
  `${devOpsPath}/${path}?${new URLSearchParams(query).toString()}`

const toOptionalTime = (value: string | null, times: Times): TimeText | null =>
  value === null ? null : toTime(new Date(value), times)

export interface Figure {
  label: string
  /** Null when its part couldn't be read: a faint dash, never 0. */
  value: string | null
  trend: number[] | null
  trendLabel: string | null
  hint: string | null
  testId: string
}

const trendLabel = 'Dead letters every two hours, last 24 hours'

/** No line when there is nothing to draw: unread, or none counted. */
const toTrend = (data: DeadLetters | null) =>
  data?.count
    ? { trend: data.bars.map(({ count }) => count), trendLabel }
    : { trend: null, trendLabel: null }

const toDeadLetterFigure = (
  service: ClientService,
  { data }: OverviewPart<DeadLetters>
): Figure => ({
  label: `${shortName(service)} dead letters, last 24 hours`,
  value: data === null ? null : toCount(data),
  ...toTrend(data),
  hint: null,
  testId: `overview-figure-dead-letters-${service}`
})

/** Each service's count added up, with a plus when any service sent only its first; none unless both were read. */
const totalOf = <T>(
  parts: PerService<T>,
  countOf: (data: T) => number,
  cutOf: (data: T) => boolean = () => false
): string | null => {
  const read = readParts(parts)

  return read.length === clientServices.length
    ? toCount({
        count: read.reduce((sum, { data }) => sum + countOf(data), 0),
        capped: read.some(({ data }) => cutOf(data))
      })
    : null
}

/** The one service read, when the other wasn't: an empty state then speaks only for it. */
const onlyRead = <T>(parts: PerService<T>): ClientService | null => {
  const read = readParts(parts)

  return read.length === 1 ? read[0]!.service : null
}

const dayWords = (days: number): string =>
  `${days} ${days === 1 ? 'day' : 'days'}`

/** The window GAS counts each service's tokens over: one when they agree, else each service's own. */
const toTokenWindow = (overview: Overview): string | null => {
  const read = readParts(overview.tokensExpiring)
  const windows = new Set(read.map(({ data }) => data.withinDays))

  if (windows.size === 0) {
    return null
  }

  return windows.size === 1
    ? dayWords(read[0]!.data.withinDays)
    : read
        .map(
          ({ service, data }) =>
            `${dayWords(data.withinDays)} for ${shortName(service)}`
        )
        .join(' and ')
}

const withinText = (window: string | null): string | null =>
  window === null ? null : `within ${window}, or expired`

const toFigures = (overview: Overview): Figure[] => [
  toDeadLetterFigure('gas', overview.deadLetters.gas),
  toDeadLetterFigure('cw', overview.deadLetters.cw),
  {
    label: 'Config versions that failed',
    value: totalOf(
      overview.configFailed,
      ({ versions }) => versions.length,
      ({ more }) => more
    ),
    trend: null,
    trendLabel: null,
    hint: null,
    testId: 'overview-figure-config'
  },
  {
    label: 'Access tokens expiring',
    value: totalOf(overview.tokensExpiring, ({ tokens }) => tokens.length),
    trend: null,
    trendLabel: null,
    hint: withinText(toTokenWindow(overview)),
    testId: 'overview-figure-tokens'
  }
]

export interface TopErrorRow {
  /** Null for the dead letters that recorded no error. */
  error: string | null
  service: string
  event: string | null
  count: string
  lastSeen: TimeText | null
  href: string
}

export interface ListAction {
  text: string
  href: string
  testId: string
}

export interface TableEmpty {
  title: string
  text: string
}

export interface TopErrorsSection {
  alerts: SectionAlert[]
  rows: TopErrorRow[] | null
  empty: TableEmpty | null
  /** A summary met more kinds of error than it counts, so the ranking may miss some. */
  partial: string | null
}

/** The key both services store a dead letter that recorded no error under: a group like any other, said in plain words. */
const noErrorKey = 'No error recorded'

const byCount = (a: Read<TopError>, b: Read<TopError>): number =>
  b.data.count - a.data.count

/** The error a row names, null for the dead letters that recorded none; GAS keys a thrown Error as `Error: <message>`, and the row shows the message. */
const toErrorText = (errorKey: string | null): string | null =>
  errorKey === null || errorKey === noErrorKey
    ? null
    : errorKey.replace(/^Error: /, '')

const toTopErrorRow =
  (times: Times) =>
  ({ service, data }: Read<TopError>): TopErrorRow => ({
    error: toErrorText(data.errorKey),
    service: shortName(service),
    event: data.event?.label ?? null,
    count: toCount(data),
    lastSeen: toOptionalTime(data.lastAt, times),
    href: toListHref(data.list)
  })

const incompleteOf = (read: Read<TopErrors>[]): string | null => {
  const services = read
    .filter(({ data }) => !data.complete)
    .map(({ service }) => shortName(service))

  const counter = services.length > 1 ? 'they count' : 'it counts'

  return services.length
    ? `${services.join(' and ')} met more kinds of error than ${counter}, so this ranking may miss some.`
    : null
}

const deadLetterWord = ({ count, capped }: OverviewCount): string =>
  count === 1 && !capped ? 'dead letter' : deadLettersName

/** Each box that has dead letters in the window, opening its list on exactly those: Top errors are the current ones, so these sit with the 24-hour figures. */
const toDeadLetterLinks = (overview: Overview): ListAction[] =>
  readParts(overview.deadLetters).flatMap(({ service, data }) =>
    data.lists
      .filter(({ count, capped }) => count > 0 || capped)
      .map((box) => ({
        text: `${shortName(service)} ${box.box}: ${toCount(box)} ${deadLetterWord(box)}, last 24 hours`,
        href: toListHref(box.list),
        testId: `overview-dead-letters-${service}-${box.box}`
      }))
  )

const toTopErrorsEmpty = (only: ClientService | null): TableEmpty =>
  only === null
    ? {
        title: 'No dead letters',
        text: 'Nothing is waiting as a dead letter in either service.'
      }
    : {
        title: `No ${shortName(only)} dead letters`,
        text: `Nothing is waiting as a dead letter in ${shortName(only)}.`
      }

const toTopErrors = (overview: Overview, times: Times): TopErrorsSection => {
  const read = readParts(overview.topErrors)
  const entries = read
    .flatMap(({ service, data }) =>
      data.entries.map((entry) => ({ service, data: entry }))
    )
    .toSorted(byCount)
    .slice(0, topErrorsShown)

  const none = noneRead(overview.topErrors)

  return {
    alerts: partAlerts('topErrors', overview.topErrors),
    rows: none ? null : entries.map(toTopErrorRow(times)),
    empty: none ? null : toTopErrorsEmpty(onlyRead(overview.topErrors)),
    partial: incompleteOf(read)
  }
}

export interface ConfigRow {
  version: string
  service: string
  type: string
  definition: StoredDot
  received: TimeText | null
  href: string
}

/** A service that sent only its first rows, and the list to find the rest in. */
export interface CutNote {
  text: string
  link: { text: string; href: string }
  testId: string
}

export interface TableSection<R> {
  alerts: SectionAlert[]
  /** Both null when neither service's part could be read. */
  rows: R[] | null
  empty: TableEmpty | null
  more: CutNote[]
}

const versionTypes: Record<
  ClientService,
  {
    type: string
    toHref: (ref: FailedVersion) => string
    list: { label: string; href: string }
  }
> = {
  gas: {
    type: 'Grant',
    toHref: toGrantHref,
    list: { label: 'Grants', href: grantType.path }
  },
  cw: {
    type: 'Workflow',
    toHref: toWorkflowHref,
    list: { label: 'Workflows', href: workflowType.path }
  }
}

const toConfigRow =
  (service: ClientService, times: Times) =>
  (version: FailedVersion): ConfigRow => ({
    version: `${version.code}@${version.version}`,
    service: shortName(service),
    type: versionTypes[service].type,
    definition: toFetchErrorDot(version.definition),
    received: toOptionalTime(version.receivedAt, times),
    href: versionTypes[service].toHref(version)
  })

/** The lists can't pick out a failed definition, so the link opens the service's whole list. */
const toCutNote = ({ service, data }: Read<ConfigFailed>): CutNote => {
  const { type, list } = versionTypes[service]
  const sent = data.versions.length

  return {
    text: `${shortName(service)} sent only the first ${counted.format(sent)} failed ${type.toLowerCase()} ${sent === 1 ? 'version' : 'versions'}.`,
    link: { text: `Find the rest in ${list.label}`, href: list.href },
    testId: `overview-config-more-${service}`
  }
}

const configKinds: Record<ClientService, string> = {
  gas: 'grant',
  cw: 'workflow'
}

const toConfigEmpty = (only: ClientService | null): TableEmpty =>
  only === null
    ? {
        title: 'Every active version is usable',
        text: 'No active grant or workflow definition has failed.'
      }
    : {
        title: `Every active ${configKinds[only]} version is usable`,
        text: `No active ${configKinds[only]} definition has failed.`
      }

const toConfigFailed = (
  overview: Overview,
  times: Times
): TableSection<ConfigRow> => {
  const read = readParts<ConfigFailed>(overview.configFailed)
  const none = noneRead(overview.configFailed)

  return {
    alerts: partAlerts('configFailed', overview.configFailed),
    rows: none
      ? null
      : read.flatMap(({ service, data }) =>
          data.versions.map(toConfigRow(service, times))
        ),
    empty: none ? null : toConfigEmpty(onlyRead(overview.configFailed)),
    more: read.filter(({ data }) => data.more).map(toCutNote)
  }
}

export interface TokenRow {
  client: string | null
  service: string
  status: { text: string; tone: string }
  expires: TimeText | null
  href: string
}

/** An expiry is a UK day by rule, written as one whatever Times says, as the tokens page writes it. */
const ukTimes = toTimes('uk')

/** GAS sends only active tokens within its window and expired ones, so the status alone says which: no second window rule here. */
const toTokenStatus = ({ status }: TokensExpiring['tokens'][number]) =>
  status === 'EXPIRED' ? tokenStates.expired : tokenStates.expiring

const toTokenRow =
  (service: ClientService) =>
  (token: TokensExpiring['tokens'][number]): TokenRow => ({
    client: token.clientId,
    service: shortName(service),
    status: toTokenStatus(token),
    expires:
      token.expiresAt === null
        ? null
        : toDayTime(new Date(token.expiresAt), ukTimes),
    href: `${toClientsPath(service)}?token=${encodeURIComponent(token.tokenId)}`
  })

const toTokensEmpty = (
  only: ClientService | null,
  window: string
): TableEmpty =>
  only === null
    ? {
        title: 'No tokens expiring or expired',
        text: `Nothing expires in the next ${window}, and nothing has expired.`
      }
    : {
        title: `No ${shortName(only)} tokens expiring or expired`,
        text: `Nothing in ${shortName(only)} expires in the next ${window}, and nothing has expired.`
      }

const toTokensExpiring = (overview: Overview): TableSection<TokenRow> => {
  const window = toTokenWindow(overview)

  return {
    alerts: partAlerts('tokensExpiring', overview.tokensExpiring),
    rows:
      window === null
        ? null
        : readParts(overview.tokensExpiring).flatMap(({ service, data }) =>
            data.tokens.map(toTokenRow(service))
          ),
    empty:
      window === null
        ? null
        : toTokensEmpty(onlyRead(overview.tokensExpiring), window),
    more: []
  }
}

export interface PageAlert extends SectionAlert {
  retryHref: string
}

const failureTexts: Record<GasFailure['kind'], string> = {
  'not-connected':
    'GAS couldn’t be reached. Nothing has changed — try again in a moment.',
  'cw-not-reached':
    'CW couldn’t be reached. Nothing has changed — try again in a moment.',
  refused: 'GAS refused the request. Nothing has changed.',
  errored:
    'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.',
  'timed-out':
    'GAS didn’t answer in time. Nothing has changed — try again in a moment.',
  'no-answer':
    'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
}

const toPageAlert = ({ failure }: { failure: GasFailure }): PageAlert => ({
  tone: 'danger',
  title: 'The overview couldn’t be loaded.',
  text: failureTexts[failure.kind],
  retryHref: overviewPath
})

export interface OverviewSections {
  figures: Figure[]
  topErrors: TopErrorsSection
  deadLetterAlerts: SectionAlert[]
  deadLetterLinks: ListAction[]
  configFailed: TableSection<ConfigRow>
  tokensExpiring: TableSection<TokenRow>
}

export interface OverviewPage {
  pageTitle: string
  meta: string[]
  navActive: string
  alert: PageAlert | null
  sections: OverviewSections | null
}

const toSections = (overview: Overview, times: Times): OverviewSections => ({
  figures: toFigures(overview),
  topErrors: toTopErrors(overview, times),
  deadLetterAlerts: partAlerts('deadLetters', overview.deadLetters),
  deadLetterLinks: toDeadLetterLinks(overview),
  configFailed: toConfigFailed(overview, times),
  tokensExpiring: toTokensExpiring(overview)
})

export const toOverviewPage = (
  result: OverviewResult,
  { times }: { times: Times }
): OverviewPage => ({
  pageTitle: 'Overview',
  meta: ['Grant Application Service and Caseworking'],
  navActive: overviewNavActive,
  ...(result.outcome === 'read'
    ? { alert: null, sections: toSections(result.overview, times) }
    : { alert: toPageAlert(result), sections: null })
})

/** 503 for an overview that couldn't be read, as a list that couldn't. */
export const toOverviewStatusCode = ({ outcome }: OverviewResult): number =>
  outcome === 'failed' ? statusCodes.serviceUnavailable : statusCodes.ok
