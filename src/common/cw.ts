import { config } from './config.ts'
import { logger } from './logger.ts'
import { wreck } from './wreck.ts'

interface CwAppRole {
  roleName: string
  from: string | null
  to: string | null
}

interface CwRolesResponse {
  appRoles: CwAppRole[]
}

/**
 * Fetches the active CW app role names for an Entra user. Returns `null` when
 * the call fails (network error, timeout, non-2xx), so a CW outage does not
 * block login for operators who never touch claims.
 */
export const getCwRoles = async (entraId: string): Promise<string[] | null> => {
  try {
    const url = `${config.get('cw.apiUrl')}/api/users/${encodeURIComponent(entraId)}/roles`

    const { payload } = await wreck.get<CwRolesResponse>(url, {
      json: true,
      timeout: config.get('cw.timeoutMs'),
      headers: {
        authorization: `Bearer ${config.get('cw.serviceToken')}`
      }
    })

    return payload.appRoles.map((role) => role.roleName)
  } catch (error) {
    logger.warn(
      error,
      `Failed to fetch CW roles for user ${entraId} - claims access will be unavailable this session`
    )

    return null
  }
}
