import Boom from '@hapi/boom'
import Joi from 'joi'

import { getFromGas } from '../../common/gas.ts'

/** The Manage grants home screen's view, as GAS's grant-admin BFF builds it. */
export interface HomeView {
  grantTypeCount: number
}

const schema = Joi.object({
  grantTypeCount: Joi.number().integer().min(0).required()
})
  .unknown(true)
  .required()

const validate = (body: HomeView): HomeView => {
  if (schema.validate(body, { convert: false }).error) {
    throw Boom.badGateway('GAS returned an invalid home view')
  }
  return body
}

export const getHome = async (): Promise<HomeView> =>
  validate(await getFromGas<HomeView>('/grant-admin/home'))
