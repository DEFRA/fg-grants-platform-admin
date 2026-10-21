import Joi from 'joi'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const slugFilterSchema = Joi.string().max(refMax).pattern(slug)
