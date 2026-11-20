import Boom from '@hapi/boom'
import Joi from 'joi'

import {
  deleteFromGas,
  getFromGas,
  postToGas,
  putToGas
} from '../../common/gas.ts'

export type ReferenceDataSource = 'inline' | 'db' | 'endpoint'

export interface ReferenceDataItem {
  code: string
  description: string
}

/** One set as the admin page lists it: an endpoint set names its service but carries no items. */
export interface ReferenceDataSummary {
  name: string
  source: ReferenceDataSource
  editable: boolean
  service?: string
  items?: ReferenceDataItem[]
}

export interface GrantReferenceData {
  grantCode: string
  referenceData: ReferenceDataSummary[]
}

/** One set's current items, fetched now from whichever source it names. */
export interface ReferenceDataView extends ReferenceDataSummary {
  items: ReferenceDataItem[]
}

export interface DbReferenceData {
  name: string
  items: ReferenceDataItem[]
  updatedAt: string | null
}

const item = Joi.object({
  code: Joi.string().required(),
  description: Joi.string().required()
}).unknown(true)

const summary = {
  name: Joi.string().required(),
  source: Joi.string().valid('inline', 'db', 'endpoint').required(),
  editable: Joi.boolean().strict().required(),
  service: Joi.string()
}

const grantReferenceDataSchema = Joi.object({
  grantCode: Joi.string().required(),
  referenceData: Joi.array()
    .items(
      Joi.object({ ...summary, items: Joi.array().items(item) }).unknown(true)
    )
    .required()
})
  .unknown(true)
  .required()

const viewSchema = Joi.object({
  ...summary,
  items: Joi.array().items(item).required()
})
  .unknown(true)
  .required()

const dbReferenceDataSchema = Joi.object({
  name: Joi.string().required(),
  items: Joi.array().items(item).required(),
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

const checkedDbSet = (body: DbReferenceData): DbReferenceData =>
  checked(dbReferenceDataSchema, body, 'reference data')

export const listGrantReferenceData = async (
  code: string
): Promise<GrantReferenceData> =>
  checked(
    grantReferenceDataSchema,
    await getFromGas<GrantReferenceData>(grantPath(code)),
    'reference data list'
  )

/** For an endpoint set, GAS fetches from the service now: a 502 means the service didn't answer. */
export const viewReferenceData = async (
  code: string,
  name: string
): Promise<ReferenceDataView> =>
  checked(
    viewSchema,
    await getFromGas<ReferenceDataView>(setPath(code, name)),
    'reference data'
  )

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const addDbReferenceDataItem = async (
  code: string,
  name: string,
  newItem: ReferenceDataItem
): Promise<DbReferenceData> =>
  checkedDbSet(
    await postToGas<DbReferenceData>(`${setPath(code, name)}/items`, {
      payload: newItem
    })
  )

/** A non-2xx rejects with wreck's Boom unchanged: callers read the status and body from it. */
export const changeDbReferenceDataItem = async (
  code: string,
  name: string,
  itemCode: string,
  description: string
): Promise<DbReferenceData> =>
  checkedDbSet(
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
  checkedDbSet(
    await deleteFromGas<DbReferenceData>(itemPath(code, name, itemCode))
  )
