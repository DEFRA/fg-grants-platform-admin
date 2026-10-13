import type {
  AllowListFormSubmission,
  AllowListView
} from '../repositories/allow-list.repository.ts'
import { replaceGrantAllowList } from '../repositories/allow-list.repository.ts'
import type { GasRefusal } from './gas-refusal.ts'
import { toGasRefusal } from './gas-refusal.ts'

export type { AllowListFormSubmission } from '../repositories/allow-list.repository.ts'

export type ReplaceAllowListOutcome =
  | { outcome: 'saved'; view: AllowListView }
  | { outcome: 'invalid'; view: AllowListView }
  | { outcome: 'refused'; refusal: GasRefusal }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const viewKeys = ['sbi', 'crn', 'errorSummary'] as const

/** Not in the repository: this is pure shape-checking on an already-read body, nothing to mock out. */
export const isAllowListView = (body: unknown): body is AllowListView =>
  isObject(body) && viewKeys.every((key) => key in body)

/**
 * GAS's grant-admin BFF already shapes a refused save into the view itself
 * (field errors, error summary) - this reads that straight off the refusal's
 * body rather than re-deciding anything about it. Anything GAS refuses in a
 * shape other than that view (403/404/an unshaped 400) is handed back as a
 * plain refusal for the route to interpret.
 */
const toOutcome = (refusal: GasRefusal): ReplaceAllowListOutcome =>
  refusal.statusCode === 400 && isAllowListView(refusal.body)
    ? { outcome: 'invalid', view: refusal.body }
    : { outcome: 'refused', refusal }

export const replaceAllowListUseCase = async (
  grantCode: string,
  form: AllowListFormSubmission
): Promise<ReplaceAllowListOutcome> => {
  try {
    const view = await replaceGrantAllowList(grantCode, form)
    return { outcome: 'saved', view }
  } catch (error) {
    const refusal = toGasRefusal(error)
    if (!refusal) throw error

    return toOutcome(refusal)
  }
}
