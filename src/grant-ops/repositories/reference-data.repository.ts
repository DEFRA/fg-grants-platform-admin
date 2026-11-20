import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  deleteFromGas,
  getFromGas,
  postToGas,
  putToGas
} from '../../common/gas.ts'

export type ReferenceDataSource = 'inline' | 'db' | 'endpoint'

export interface ReferenceDataSummary {
  name: string
  source: ReferenceDataSource
  editable: boolean
  itemCount?: number
}

export interface GrantReferenceData {
  grantCode: string
  referenceData: ReferenceDataSummary[]
}

export interface ReferenceDataItem {
  code: string
  description: string
}

export interface DbReferenceData {
  name: string
  items: ReferenceDataItem[]
  updatedAt: string | null
}

const source = Joi.string().valid('inline', 'db', 'endpoint').required()

const grantReferenceDataSchema = Joi.object({
  grantCode: Joi.string().required(),
  referenceData: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        source,
        editable: Joi.boolean().strict().required(),
        itemCount: Joi.number().integer().min(0)
      }).unknown(true)
    )
    .required()
})
  .unknown(true)
  .required()

const dbReferenceDataSchema = Joi.object({
  name: Joi.string().required(),
  items: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().required(),
        description: Joi.string().required()
      }).unknown(true)
    )
    .required(),
  updatedAt: Joi.string().allow(null).required()
})
  .unknown(true)
  .required()

const checked = <T>(schema: Joi.Schema, body: T, what: string): T => {
  if (schema.validate(body, { convert: false }).error) {
    throw Boom.badGateway(`GAS returned invalid ${what}`)
  }

  return body
}

const grantPath = (code: string): string =>
  `/grant-admin/grants/${encodeURIComponent(code)}/reference-data`

const setPath = (code: string, name: string): string =>
  `${grantPath(code)}/${encodeURIComponent(name)}`

const itemPath = (code: string, name: string, itemCode: string): string =>
  `${setPath(code, name)}/items/${encodeURIComponent(itemCode)}`

const checkedSet = (body: DbReferenceData): DbReferenceData =>
  checked(dbReferenceDataSchema, body, 'reference data')

export const listGrantReferenceData = async (
  code: string
): Promise<GrantReferenceData> =>
  checked(
    grantReferenceDataSchema,
    await getFromGas<GrantReferenceData>(grantPath(code)),
    'reference data list'
  )

export const getDbReferenceData = async (
  code: string,
  name: string
): Promise<DbReferenceData> =>
  checkedSet(await getFromGas<DbReferenceData>(setPath(code, name)))

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const addDbReferenceDataItem = async (
  code: string,
  name: string,
  item: ReferenceDataItem
): Promise<DbReferenceData> =>
  checkedSet(
    await postToGas<DbReferenceData>(`${setPath(code, name)}/items`, {
      payload: item
    })
  )

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const changeDbReferenceDataItem = async (
  code: string,
  name: string,
  itemCode: string,
  description: string
): Promise<DbReferenceData> =>
  checkedSet(
    await putToGas<DbReferenceData>(itemPath(code, name, itemCode), {
      payload: { description }
    })
  )

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const removeDbReferenceDataItem = async (
  code: string,
  name: string,
  itemCode: string
): Promise<DbReferenceData> =>
  checkedSet(
    await deleteFromGas<DbReferenceData>(itemPath(code, name, itemCode))
  )
