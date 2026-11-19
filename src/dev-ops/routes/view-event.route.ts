import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  eventPageCache,
  isProduction,
  purgeFormKey,
  redriveNoticeKey,
  toEventPage,
  toEventStatusCode,
  toHeldAsks
} from '../view-models/event-page.view-model.ts'
import { heldSavesKey, takeHeldSave } from '../view-models/held-saves.ts'
import { shellQuery, timesOf } from '../view-models/times.ts'

const spendHeldSave = (request: Request, eventHref: string) => {
  const saves = request.yar.get(heldSavesKey)

  if (!saves) {
    return null
  }

  const { held, kept } = takeHeldSave(saves, eventHref, Date.now())

  if (Object.keys(kept).length) {
    request.yar.set(heldSavesKey, kept)
  } else {
    request.yar.clear(heldSavesKey)
  }

  return held
}

export const viewEventRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}',
  options: {
    cache: eventPageCache,
    validate: {
      params: Joi.object(eventAddress),
      // `back` is checked by the view model: a bad one falls back to the event's own list, not an error page.
      query: Joi.object({
        // Fitted by the view model before it is echoed into a link: one too long to go back to is dropped.
        back: Joi.string().allow(''),
        confirm: Joi.string(),
        edit: Joi.string(),
        ...shellQuery
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    // Taken before the event is read, so a write's message, a rejected form
    // and a held save are spent on this render whatever the read then says.
    const [notice] = request.yar.flash(redriveNoticeKey)
    const [form] = request.yar.flash(purgeFormKey)
    const held = spendHeldSave(request, toEventHref(key))
    const result = await getEventUseCase(key)
    const page = toEventPage({
      result,
      key,
      times: timesOf(request),
      catalogue: shellCatalogue(request),
      prod: isProduction(config.get('environmentLabel')),
      query: request.query as EventPageQuery,
      notice,
      form,
      ...toHeldAsks(held, result)
    })

    return h.view('events/event', page).code(toEventStatusCode(page))
  }
}
