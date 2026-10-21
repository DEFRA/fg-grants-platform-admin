import Joi from 'joi'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const slugFilterSchema = Joi.string().max(refMax).pattern(slug)

const versionMax = 32

/** A config version, as the config broker publishes it. */
export const versionSchema = Joi.string()
  .max(versionMax)
  .pattern(/^\d+\.\d+\.\d+$/)
