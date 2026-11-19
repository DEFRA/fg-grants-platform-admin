import Boom from '@hapi/boom'
import Joi from 'joi'

import { getFromGas } from '../../common/gas.ts'

export interface GrantType {
  code: string
  name: string | null
}

/** The Grant Types screen's view, as GAS's grant-admin BFF builds it: only the grants the operator administers. */
export interface GrantTypesView {
  grantTypes: GrantType[]
}

const schema = Joi.object({
  grantTypes: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().required(),
        name: Joi.string().allow(null).required()
      }).unknown(true)
    )
    .required()
})
  .unknown(true)
  .required()

const validate = (body: GrantTypesView): GrantTypesView => {
  if (schema.validate(body, { convert: false }).error) {
    throw Boom.badGateway('GAS returned invalid grant types')
  }
  return body
}

export const getGrantTypes = async (): Promise<GrantTypesView> =>
  validate(await getFromGas<GrantTypesView>('/grant-admin/grants'))
