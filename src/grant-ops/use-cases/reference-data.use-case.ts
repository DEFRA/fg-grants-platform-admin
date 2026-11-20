import {
  addDbReferenceDataItem,
  changeDbReferenceDataItem,
  listGrantReferenceData,
  removeDbReferenceDataItem,
  viewReferenceData,
  type ReferenceDataItem
} from '../repositories/reference-data.repository.ts'
import { toGasRefusal } from './gas-refusal.ts'

export type {
  GrantReferenceData,
  ReferenceDataItem,
  ReferenceDataSummary,
  ReferenceDataView
} from '../repositories/reference-data.repository.ts'

/** GAS decides what an item may hold; a refusal it explains is the operator's to fix. */
export type ReferenceDataChangeOutcome =
  | { outcome: 'saved' }
  | { outcome: 'refused'; statusCode: number; message: string }

const badRequest = 400
const notFound = 404
const conflict = 409

const explainedStatuses = new Set([badRequest, notFound, conflict])

const outcomeOf = async (
  change: () => Promise<unknown>
): Promise<ReferenceDataChangeOutcome> => {
  try {
    await change()
    return { outcome: 'saved' }
  } catch (error) {
    const refusal = toGasRefusal(error)

    if (!refusal || !explainedStatuses.has(refusal.statusCode)) {
      throw error
    }

    return {
      outcome: 'refused',
      statusCode: refusal.statusCode,
      message: refusal.message
    }
  }
}

/** GAS enforces admin access on each of these calls for real. */
export const listGrantReferenceDataUseCase = listGrantReferenceData

export const viewReferenceDataUseCase = viewReferenceData

export const addReferenceDataItemUseCase = (
  code: string,
  name: string,
  item: ReferenceDataItem
) => outcomeOf(() => addDbReferenceDataItem(code, name, item))

export const changeReferenceDataItemUseCase = (
  code: string,
  name: string,
  itemCode: string,
  description: string
) =>
  outcomeOf(() => changeDbReferenceDataItem(code, name, itemCode, description))

export const removeReferenceDataItemUseCase = (
  code: string,
  name: string,
  itemCode: string
) => outcomeOf(() => removeDbReferenceDataItem(code, name, itemCode))
