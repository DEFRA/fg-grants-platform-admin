import Joi from 'joi'
import type { Schema } from 'joi'

import type { RecordType } from './record-type.ts'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const slugFilterSchema = Joi.string().max(refMax).pattern(slug)

const workflowCodeMax = 128

/** CW's spelling of a workflow code, capitals included. */
export const workflowCodeSchema = Joi.string()
  .max(workflowCodeMax)
  .pattern(/^[a-zA-Z0-9-]+$/)

const versionMax = 32

/** A config version, as the config broker publishes it. */
export const versionSchema = Joi.string()
  .max(versionMax)
  .pattern(/^\d+\.\d+\.\d+$/)

/** Longer than any list link this app builds for itself, and still bounded. */
const fromMax = 2048

// Checked by `toSafeFrom`: a bad one falls back to the admin's root, not an error page.
export const backSchema = Joi.string().allow('').max(fromMax)

export const recordTabSchema = ({ tabs }: RecordType) =>
  Joi.string().valid(...tabs.map(({ id }) => id))

/** Every param a record's URL names is required. */
export const recordParamsSchema = (params: Record<string, Schema>) =>
  Joi.object(
    Object.fromEntries(
      Object.entries(params).map(([name, schema]) => [name, schema.required()])
    )
  )
