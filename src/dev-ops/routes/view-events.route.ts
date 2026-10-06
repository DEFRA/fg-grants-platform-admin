import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import { eventEnumFilters } from '../view-models/event-filters.ts'
import { listPageCache, present } from '../view-models/list-filters.ts'
import type { EventsPageQuery } from '../view-models/events-page.view-model.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'
import {
  timeRangeFilters,
  toRangeInstants
} from '../view-models/time-range.view-model.ts'

const errorMax = 1024

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
  ...toRangeInstants({ from, to })
})

const toGasQuery = ({ range, ...gas }: EventsPageQuery): EventsQuery => gas

export const viewEventsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events',
  options: {
    cache: listPageCache,
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        ...eventEnumFilters,
        q: Joi.string().allow(''),
        error: Joi.string().allow('').max(errorMax),
        ...timeRangeFilters
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
