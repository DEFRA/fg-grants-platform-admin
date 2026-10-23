import Boom from '@hapi/boom'
import Joi from 'joi'

import { getFromGas, putToGas } from '../../common/gas.ts'

export interface GrantSettingsView {
  grantCode: string
  open: boolean
}

const schema = Joi.object({
  grantCode: Joi.string().required(),
  open: Joi.boolean().strict().required()
})
  .unknown(true)
  .required()

const pathFor = (code: string) =>
  `/grant-admin/grants/${encodeURIComponent(code)}/settings`

const validate = (code: string, body: GrantSettingsView): GrantSettingsView => {
  if (
    schema.validate(body, { convert: false }).error ||
    body.grantCode !== code
  ) {
    throw Boom.badGateway('GAS returned invalid grant settings')
  }
  return body
}

export const getGrantSettings = async (
  code: string
): Promise<GrantSettingsView> =>
  validate(code, await getFromGas<GrantSettingsView>(pathFor(code)))

export const saveGrantSettings = async (
  code: string,
  open: boolean
): Promise<GrantSettingsView> =>
  validate(
    code,
    await putToGas<GrantSettingsView>(pathFor(code), { payload: { open } })
  )
