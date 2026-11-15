import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { devOpsPath } from '../view-models/bucket-nav.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { backSchema, toFittingBack } from '../view-models/record-filters.ts'
import { seeOther } from '../view-models/see-other.ts'
import { toRangeInstants } from '../view-models/time-range.view-model.ts'
import {
  timesChoices,
  timesCookieName,
  shellQuery,
  timesOf,
  timesPath,
  toTimes,
  toTimesDialog
} from '../view-models/times.ts'
import type { Zone } from '../view-models/zoned-clock.ts'

const query = Joi.object({ back: backSchema, ...shellQuery })

/** Where the setting goes back to: the page it was opened from, or Dev Ops' front door. */
const toBack = (request: Request): string =>
  toSafeFrom(String(request.query.back ?? '')) || devOpsPath

const rangeKeys = new Set(['from', 'to'])

const base = 'http://dev-ops'

const toParam = (key: string, value: string, zone: Zone): string => {
  if (key === 'back') {
    return toFittingBack(withRangeInstants(value, zone))
  }

  return rangeKeys.has(key)
    ? (toRangeInstants({ [key]: value }, zone)[key as 'from' | 'to'] ?? value)
    : value
}

/**
 * A Custom range's boxes carry no zone and are read in the page's, so the page
 * gone back to names them as the instants they meant in the zone left behind,
 * and so does every page it goes back to.
 */
const withRangeInstants = (page: string, zone: Zone): string => {
  // A nested `back` is only ever checked by the page it leads to: one that is no address is carried on as it is.
  if (!URL.canParse(page, base)) {
    return page
  }

  const url = new URL(page, base)
  const params = [...url.searchParams]

  if (!params.some(([key]) => key === 'back' || rangeKeys.has(key))) {
    return page
  }

  const search = new URLSearchParams(
    params.map(([key, value]) => [key, toParam(key, value, zone)])
  ).toString()

  return `${url.pathname}?${search}`
}

/**
 * The Times address itself is no page: it goes back to the page it names, with
 * the dialog open. Signing in again after a save that met no session lands here.
 */
export const viewTimesRoute: ServerRoute = {
  method: 'GET',
  path: timesPath,
  options: { validate: { query } },
  handler(request: Request, h: ResponseToolkit) {
    return h.redirect(toTimesDialog(undefined, toBack(request)).href)
  }
}

/** Kept in a cookie like the theme; the page it goes back to is drawn again in the chosen zone. */
export const saveTimesRoute: ServerRoute = {
  method: 'POST',
  path: timesPath,
  options: {
    validate: {
      query,
      payload: Joi.object({
        times: Joi.string()
          .valid(...timesChoices)
          .required()
      })
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    const { times } = request.payload as { times: string }
    const was = timesOf(request)
    const back = toBack(request)

    return h
      .redirect(
        toTimes(times).zone === was.zone
          ? back
          : withRangeInstants(back, was.zone)
      )
      .state(timesCookieName, times)
      .code(seeOther)
  }
}
