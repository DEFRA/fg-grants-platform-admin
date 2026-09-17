import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import { eventEnumFilters } from '../view-models/event-filters.ts'
import type { ZonedEdge } from '../view-models/event-formats.ts'
import { fromZonedInput } from '../view-models/event-formats.ts'
import type { EventsPageQuery } from '../view-models/events-page.view-model.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

const errorMax = 1024

/** A box may or may not carry seconds; `fromZonedInput` takes the full wall clock. */
const toWallClock = (value: string, seconds: string | undefined): string =>
  `${value}${seconds ? '' : ':00'}`

const toUtcDate = (value: string, seconds: string | undefined): Date =>
  new Date(`${toWallClock(value, seconds)}Z`)

/** `2026-02-30` silently rolls forward; an impossible month throws. Check both. */
const isRealDatetime = (
  value: string,
  seconds: string | undefined
): boolean => {
  const date = toUtcDate(value, seconds)

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(seconds ? value : `${value}:00`)
  )
}

const rangeBox = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    const match = datetimeLocal.exec(value)

    return match === null || isRealDatetime(value, match[1])
      ? value
      : helpers.error('any.invalid')
  })

/**
 * What a Custom box means. The digits carry no zone and the page fills them in
 * UK time, so they are read in UK time: typing 09:00 means 09:00 as the
 * operator means it.
 */
const toInstant = (
  value: string | undefined,
  edge: ZonedEdge
): string | undefined => {
  if (!value) {
    return undefined
  }

  const match = datetimeLocal.exec(value)

  return match === null || !isRealDatetime(value, match[1])
    ? value
    : fromZonedInput(toWallClock(value, match[1]), edge).toISOString()
}

const present = (name: string, value: string | undefined) =>
  value ? { [name]: value } : {}

const toQuery = ({
  q,
  error,
  from,
  to,
  cursor,
  ...rest
}: EventsPageQuery): EventsPageQuery => ({
  ...rest,
  ...present('cursor', cursor),
  ...present('q', q?.trim()),
  ...present('error', error),
  ...present('from', toInstant(from, 'earliest')),
  ...present('to', toInstant(to, 'latest'))
})

const toGasQuery = ({ range, ...gas }: EventsPageQuery): EventsQuery => gas

export const viewEventsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events',
  options: {
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        ...eventEnumFilters,
        q: Joi.string().allow(''),
        error: Joi.string().allow('').max(errorMax),
        from: rangeBox,
        to: rangeBox,
        range: Joi.string().allow('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = toQuery(request.query as unknown as EventsPageQuery)

    return h.view('events', {
      pageTitle: 'Events',
      ...toEventsPage(await getEventsUseCase(toGasQuery(query)), query)
    })
  }
}
