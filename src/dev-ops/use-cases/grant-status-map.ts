import type {
  GrantLifecycle,
  GrantVersionPage,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import { readRecord } from './record-reads.ts'
import type { RecordResult, RecordSectionError } from './record-reads.ts'

/** What GAS will do with the statuses a workflow sends, as far as the grant of the same code and version says. */
export type GrantStatusMap =
  | { outcome: 'found'; lifecycle: GrantLifecycle }
  | {
      outcome:
        | 'no-grant'
        | 'not-stored'
        | 'unreadable'
        | 'unavailable'
        | 'timed-out'
    }

const toFound = (
  lifecycle: GrantLifecycle | null | undefined,
  sectionErrors: RecordSectionError[]
): GrantStatusMap =>
  lifecycle && !sectionErrors.some(({ section }) => section === 'phases')
    ? { outcome: 'found', lifecycle }
    : { outcome: 'unavailable' }

const fromPage = ({
  header,
  lifecycle,
  problem,
  sectionErrors
}: GrantVersionPage): GrantStatusMap => {
  if (!header.files.grant.stored) {
    return { outcome: 'not-stored' }
  }

  if (typeof problem === 'string') {
    return { outcome: 'unreadable' }
  }

  return toFound(lifecycle, sectionErrors)
}

const fromResult = ({
  outcome,
  page
}: RecordResult<GrantVersionPage>): GrantStatusMap => {
  if (page) {
    return fromPage(page)
  }

  return outcome === 'timed-out' ? { outcome } : { outcome: 'unavailable' }
}

/** GAS's spelling of a grant code: a workflow code with capitals has no grant, so GAS is not asked. */
const grantCode = /^[a-z0-9-]+$/

export const readGrantStatusMap = async (
  ref: GrantVersionRef
): Promise<GrantStatusMap> => {
  if (!grantCode.test(ref.code)) {
    return { outcome: 'no-grant' }
  }

  const result = await readRecord(
    'grant version',
    () => findGrantVersionPage(ref, 'phases'),
    'GRANT_VERSION_NOT_FOUND'
  )

  return result.outcome === 'not-found'
    ? { outcome: 'no-grant' }
    : fromResult(result)
}
