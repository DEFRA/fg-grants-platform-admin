import type { AllowListGlobal } from '../repositories/allow-list.repository.ts'
import { replaceGrantAllowList } from '../repositories/allow-list.repository.ts'
import type { GasRefusal } from './gas-refusal.ts'
import { toGasRefusal } from './gas-refusal.ts'

export type { AllowListGlobal } from '../repositories/allow-list.repository.ts'

export const replaceAllowListUseCase = async (
  grantCode: string,
  global: AllowListGlobal
): Promise<GasRefusal | undefined> => {
  try {
    await replaceGrantAllowList(grantCode, global)
    return undefined
  } catch (error) {
    const refusal = toGasRefusal(error)

    if (!refusal) {
      throw error
    }

    return refusal
  }
}
