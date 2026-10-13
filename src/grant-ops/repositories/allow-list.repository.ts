import { getFromGas, putToGas } from '../../common/gas.ts'

export interface AllowListGlobal {
  sbi: string[]
  crn: string[]
}

export interface GrantAllowList {
  grantCode: string
  global: AllowListGlobal
}

const allowListPath = (grantCode: string): string =>
  `/grant-admin/grants/${encodeURIComponent(grantCode)}/allow-list`

export const getGrantAllowList = async (
  grantCode: string
): Promise<GrantAllowList> =>
  getFromGas<GrantAllowList>(allowListPath(grantCode))

export const replaceGrantAllowList = async (
  grantCode: string,
  global: AllowListGlobal
): Promise<GrantAllowList> =>
  putToGas<GrantAllowList>(allowListPath(grantCode), {
    payload: { global }
  })
