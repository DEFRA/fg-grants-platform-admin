import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { toGasRefusal } from '../use-cases/gas-refusal.ts'
import {
  addReferenceDataItemUseCase,
  changeReferenceDataItemUseCase,
  getDbReferenceDataUseCase,
  removeReferenceDataItemUseCase,
  type ReferenceDataChangeOutcome,
  type ReferenceDataItem
} from '../use-cases/reference-data.use-case.ts'
import {
  referenceDataSavedKey,
  toErrorSummary,
  toItemForm,
  toReferenceDataHref,
  toReferenceDataPage,
  toRefusalError,
  validateItem,
  type ItemFieldError,
  type ItemFieldKey
} from '../view-models/reference-data.view-model.ts'

interface SetParams {
  code: string
  name: string
}

interface ItemParams extends SetParams {
  itemCode: string
}

const setParams = Joi.object({
  code: Joi.string().required(),
  name: Joi.string().required()
})

const itemParams = setParams.keys({ itemCode: Joi.string().required() })

const newItemPayload = Joi.object({
  code: Joi.string().allow('').required(),
  description: Joi.string().allow('').required()
}).unknown(false)

const changeItemPayload = Joi.object({
  description: Joi.string().allow('').required()
}).unknown(false)

const base = '/grant-ops/grants/{code}/admin/reference-data/{name}'
const forbidden = 403
const badRequest = 400

/** GAS answers every refusal of access, or of a set it doesn't hold, for real. */
const respondToFailure = (error: unknown): never => {
  const refusal = toGasRefusal(error)

  if (refusal?.statusCode === forbidden) {
    throw Boom.forbidden(
      'You do not have access to administration for this grant'
    )
  }

  if (refusal) {
    throw new Boom.Boom(refusal.message, { statusCode: refusal.statusCode })
  }

  throw error
}

const loadSet = async ({ code, name }: SetParams) => {
  try {
    return await getDbReferenceDataUseCase(code, name)
  } catch (error) {
    return respondToFailure(error)
  }
}

const findItem = async (params: ItemParams) => {
  const set = await loadSet(params)
  const item = set.items.find(({ code }) => code === params.itemCode)

  if (!item) {
    throw Boom.notFound(
      `Reference data "${params.name}" has no item with code "${params.itemCode}"`
    )
  }

  return item
}

const savedAndBack = (
  request: Request,
  h: ResponseToolkit,
  { code, name }: SetParams,
  notice: string
) => {
  request.yar.flash(referenceDataSavedKey, notice)
  return h.redirect(toReferenceDataHref(code, name)).code(303)
}

interface ItemFormPage {
  heading: string
  submitText: string
  editableKeys: ItemFieldKey[]
}

const newItemPage: ItemFormPage = {
  heading: 'Add item',
  submitText: 'Add item',
  editableKeys: ['code', 'description']
}

const changeItemPage: ItemFormPage = {
  heading: 'Change item',
  submitText: 'Save changes',
  editableKeys: ['description']
}

const viewItemForm = (
  h: ResponseToolkit,
  { code, name }: SetParams,
  page: ItemFormPage,
  form: Partial<ReferenceDataItem>,
  errors: ItemFieldError[] = [],
  statusCode = 200
) =>
  h
    .view('reference-data-item', {
      pageTitle: `${errors.length ? 'Error: ' : ''}${page.heading}`,
      ...page,
      code,
      name,
      codeEditable: page.editableKeys.includes('code'),
      backHref: toReferenceDataHref(code, name),
      errorSummary: toErrorSummary(errors),
      form: toItemForm(form, errors)
    })
    .code(statusCode)

const refusedForm = (
  h: ResponseToolkit,
  params: SetParams,
  page: ItemFormPage,
  form: Partial<ReferenceDataItem>,
  outcome: Extract<ReferenceDataChangeOutcome, { outcome: 'refused' }>
) =>
  viewItemForm(
    h,
    params,
    page,
    form,
    [toRefusalError(outcome.statusCode, outcome.message)],
    outcome.statusCode
  )

export const viewReferenceDataRoute: ServerRoute = {
  method: 'GET',
  path: base,
  options: { validate: { params: setParams } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as SetParams
    const set = await loadSet(params)
    const [saved] = request.yar.flash(referenceDataSavedKey)

    return h.view(
      'reference-data',
      toReferenceDataPage(params.code, set, saved)
    )
  }
}

export const newReferenceDataItemRoute: ServerRoute = {
  method: 'GET',
  path: `${base}/new`,
  options: { validate: { params: setParams } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as SetParams
    await loadSet(params)

    return viewItemForm(h, params, newItemPage, {})
  }
}

export const addReferenceDataItemRoute: ServerRoute = {
  method: 'POST',
  path: `${base}/new`,
  options: { validate: { params: setParams, payload: newItemPayload } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as SetParams
    const form = request.payload as ReferenceDataItem
    const errors = validateItem(form, newItemPage.editableKeys)

    if (errors.length) {
      return viewItemForm(h, params, newItemPage, form, errors, badRequest)
    }

    const item = {
      code: form.code.trim(),
      description: form.description.trim()
    }
    const outcome = await addReferenceDataItemUseCase(
      params.code,
      params.name,
      item
    ).catch(respondToFailure)

    return outcome.outcome === 'saved'
      ? savedAndBack(request, h, params, `Added ${item.code}`)
      : refusedForm(h, params, newItemPage, form, outcome)
  }
}

export const changeReferenceDataItemRoute: ServerRoute = {
  method: 'GET',
  path: `${base}/items/{itemCode}/change`,
  options: { validate: { params: itemParams } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as ItemParams

    return viewItemForm(h, params, changeItemPage, await findItem(params))
  }
}

export const updateReferenceDataItemRoute: ServerRoute = {
  method: 'POST',
  path: `${base}/items/{itemCode}/change`,
  options: { validate: { params: itemParams, payload: changeItemPayload } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as ItemParams
    const { description } = request.payload as { description: string }
    const form = { code: params.itemCode, description }
    const errors = validateItem(form, changeItemPage.editableKeys)

    if (errors.length) {
      return viewItemForm(h, params, changeItemPage, form, errors, badRequest)
    }

    const outcome = await changeReferenceDataItemUseCase(
      params.code,
      params.name,
      params.itemCode,
      description.trim()
    ).catch(respondToFailure)

    return outcome.outcome === 'saved'
      ? savedAndBack(request, h, params, `Changed ${params.itemCode}`)
      : refusedForm(h, params, changeItemPage, form, outcome)
  }
}

export const removeReferenceDataItemRoute: ServerRoute = {
  method: 'GET',
  path: `${base}/items/{itemCode}/remove`,
  options: { validate: { params: itemParams } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as ItemParams
    const item = await findItem(params)

    return h.view('reference-data-remove', {
      pageTitle: `Remove ${item.code}`,
      code: params.code,
      name: params.name,
      item,
      backHref: toReferenceDataHref(params.code, params.name)
    })
  }
}

export const confirmRemoveReferenceDataItemRoute: ServerRoute = {
  method: 'POST',
  path: `${base}/items/{itemCode}/remove`,
  options: { validate: { params: itemParams } },
  async handler(request: Request, h: ResponseToolkit) {
    const params = request.params as unknown as ItemParams
    const outcome = await removeReferenceDataItemUseCase(
      params.code,
      params.name,
      params.itemCode
    ).catch(respondToFailure)

    if (outcome.outcome === 'refused') {
      throw new Boom.Boom(outcome.message, { statusCode: outcome.statusCode })
    }

    return savedAndBack(request, h, params, `Removed ${params.itemCode}`)
  }
}
