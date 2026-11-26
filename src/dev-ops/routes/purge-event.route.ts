import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { purgeEventUseCase } from '../use-cases/purge-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventQuery } from '../view-models/event-context.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import type { EventTab } from '../view-models/event-page.view-model.ts'
import {
  eventBannerId,
  eventTabMax,
  purgeFormKey,
  redriveNoticeKey,
  toEventTab,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { toPurgeFormError, toPurgeNote } from '../view-models/purge-form.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { seeOther } from '../view-models/see-other.ts'
import { fromMax } from '../view-models/record-filters.ts'

/** Long enough for any code the backends may add, short enough to be a code. */
const reasonMax = 64

/** Four times the limit the form enforces: past 500 is the operator's mistake, and the note is cut here so a pasted payload never reaches the session. */
const noteMax = 2000

interface PurgePayload {
  back: string
  tab: string
  reasonCode: string
  note: string
}

const bannerHash = `#${eventBannerId}`

/** A rejected form is handed back in the dialog, drawn open; a purge lands on the banner that says how it went. */
const toRedirect = (
  key: EventKey,
  from: string,
  tab: EventTab,
  reopen: boolean
): string =>
  reopen
    ? `${toEventHref(key)}${toEventQuery(from, tab, ['confirm', 'purge'])}`
    : `${toEventHref(key)}${toEventQuery(from, tab)}${bannerHash}`

/**
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out. The form is checked here as well as in the backends because this
 * is the only place that can put the operator back in front of what they typed.
 */
export const purgeEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/purge',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      payload: Joi.object({
        back: Joi.string().allow('').max(fromMax).default(''),
        tab: Joi.string().allow('').max(eventTabMax).default(''),
        // Bounded, not checked: an unknown code is "no reason chosen", which
        // is a sentence on the page rather than a 400 in front of it.
        reasonCode: Joi.string().allow('').max(reasonMax).default(''),
        // Truncated rather than refused: a pasted payload is a note to
        // shorten, and the form can only say so with the note in front of it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
        .empty(null)
        // Spelled out rather than `{}`: an object default is taken as written,
        // so its children's defaults never fire on the body-less POST hapi
        // hands a payload of `null`.
        .default({ back: '', tab: '', reasonCode: '', note: '' })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const {
      back: from,
      reasonCode,
      note,
      ...asked
    } = request.payload as PurgePayload
    const tab = toEventTab(asked.tab)
    const page = toEventHref(key)
    const submission = { reasonCode, note: toPurgeNote(note) }
    const error = toPurgeFormError(submission)
    const safeFrom = toSafeFrom(from)

    if (error !== null) {
      request.yar.flash(purgeFormKey, { ...submission, error, page })

      return h.redirect(toRedirect(key, safeFrom, tab, true)).code(seeOther)
    }

    const result = await purgeEventUseCase(key, submission, toActor(request))

    request.yar.flash(redriveNoticeKey, { ...result, action: 'purge', page })

    return h.redirect(toRedirect(key, safeFrom, tab, false)).code(seeOther)
  }
}
