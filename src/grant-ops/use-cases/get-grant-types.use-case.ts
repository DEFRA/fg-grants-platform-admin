import { getGrantTypes } from '../repositories/grant-types.repository.ts'

export type {
  GrantType,
  GrantTypesView
} from '../repositories/grant-types.repository.ts'

/** The grant types the operator administers. GAS decides which, from the operator's Caseworking roles. */
export const getGrantTypesUseCase = getGrantTypes
