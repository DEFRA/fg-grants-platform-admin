import Joi from 'joi'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const codeFilter = Joi.string().max(refMax).pattern(slug)

export const refFilter = Joi.string().max(refMax).pattern(slug)

/** What an operator types: trimmed and lowercased, as GAS stores refs; empty clears the search. */
export const searchedRef = Joi.string()
  .trim()
  .lowercase()
  .allow('')
  .max(refMax)
  .pattern(slug)

/** A box GAS would refuse: said beside the box, and never stored. */
export const searchedRefError =
  'Enter a reference using only letters, numbers and hyphens.'
