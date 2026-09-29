import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  formMaxBytes,
  toEditNote,
  toEditNoteProblem
} from '../use-cases/edit-payload-command.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import { eventPageCache } from '../view-models/event-page.view-model.ts'
import { toPayloadPage } from '../view-models/payload-edit-page.ts'

/** Longer than any query this app builds for itself, and still bounded. */
const fromMax = 2048

/** As the save route bounds it. */
const noteMax = 2000

interface ReviewPayload {
  text: string
  revision: number
  from: string
  back?: string
  retry?: string
  note: string
}

/** A save held back while the event could not be read comes back as the save would have: the note kept, and checked. */
const toSubmission = ({
  text,
  revision,
  from,
  back,
  retry,
  note
}: ReviewPayload): PayloadSubmission => {
  if (retry !== 'save') {
    return { text, revision, from, back: back === 'edit' }
  }

  const trimmed = toEditNote(note)

  return {
    text,
    revision,
    from,
    note: trimmed,
    noteProblem: toEditNoteProblem(trimmed)
  }
}

/**
 * Review changes, Back to editing, and Try again on changes the page held
 * while it could not read the event. Nothing is written, so the answer is
 * the page itself rather than a redirect: the text the operator typed goes
 * back to them in the page body, never in a url or the session. A refresh
 * asks to post it again, which is harmless.
 *
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out.
 */
export const reviewPayloadRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/payload/review',
  options: {
    cache: eventPageCache,
    payload: { maxBytes: formMaxBytes },
    validate: {
      params: Joi.object(eventAddress),
      // The text is not bounded here: a text over the bound is a sentence in
      // front of the editor, not a 400 in place of it.
      payload: Joi.object({
        text: Joi.string().allow('').default(''),
        revision: Joi.number().integer().min(0).required(),
        from: Joi.string().allow('').max(fromMax).default(''),
        back: Joi.string().valid('edit'),
        retry: Joi.string().valid('save'),
        // Back to editing posts the save form, note and all; only a retried save keeps it.
        note: Joi.string().allow('').max(noteMax).truncate().default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const result = await getEventUseCase(key)

    return h.view(
      'event',
      toPayloadPage(result, key, toSubmission(request.payload as ReviewPayload))
    )
  }
}
