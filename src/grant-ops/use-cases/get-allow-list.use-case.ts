import Boom from '@hapi/boom'
import { getGrantAllowList } from '../repositories/allow-list.repository.ts'

export type { GrantAllowList } from '../repositories/allow-list.repository.ts'

const hasAdminAccess = (
  adminRole: string,
  cwRoles: string[] | null | undefined
): boolean =>
  Boolean(adminRole) && Array.isArray(cwRoles) && cwRoles.includes(adminRole)

/** The allow list for one grant, authorised against the caller's Caseworking roles. */
export const getAllowListUseCase = async (
  grantCode: string,
  cwRoles: string[] | null | undefined
) => {
  const allowList = await getGrantAllowList(grantCode)

  if (!hasAdminAccess(allowList.adminRole, cwRoles)) {
    throw Boom.forbidden(
      'You do not have access to administration for this grant'
    )
  }

  return allowList
}
