import Joi from 'joi'

const refMax = 100

/** GAS's own spelling of a grant or workflow code, and of a reference. */
const slug = /^[a-z0-9-]+$/

export const slugFilterSchema = Joi.string().max(refMax).pattern(slug)

/** Longer than any list link this app builds for itself, and still bounded. */
export const fromMax = 2048

const backKey = 'back'

const carriesBack = (href: string): boolean =>
  new URL(href, 'http://record').searchParams.has(backKey)

/** The `back` a `back` carries, dropped from its innermost page, so a long trail still fits the schema. */
const dropInnermostBack = (back: string): string => {
  const url = new URL(back, 'http://record')
  const inner = url.searchParams.get(backKey)

  if (inner === null) {
    return url.pathname
  }

  const shorter = carriesBack(inner) ? dropInnermostBack(inner) : ''

  if (shorter === '') {
    url.searchParams.delete(backKey)
  } else {
    url.searchParams.set(backKey, shorter)
  }

  return `${url.pathname}${url.search}`
}

/** A `back` short enough to pass `backSchema`: its innermost `back` goes first, then the next. */
export const toFittingBack = (back: string): string =>
  back.length <= fromMax ? back : toFittingBack(dropInnermostBack(back))
