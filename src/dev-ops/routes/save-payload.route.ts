import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import type { EditPayloadCheck } from '../use-cases/edit-payload-command.ts'
import {
  checkEditPayload,
  formMaxBytes
} from '../use-cases/edit-payload-command.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import type { PayloadReviewResult } from '../use-cases/review-payload.use-case.ts'
import { reviewPayloadUseCase } from '../use-cases/review-payload.use-case.ts'
import type { PayloadSave } from '../use-cases/save-event-payload.use-case.ts'
import { saveEventPayloadUseCase } from '../use-cases/save-event-payload.use-case.ts'
import { toActor } from '../../common/view-models/actor.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import type { EventPageAsks } from '../view-models/event-page.view-model.ts'
import {
  eventBannerId,
  eventPageCache,
  isProduction,
  redriveNoticeKey,
  toEventPage,
  toEventStatusCode,
  toSafeFrom,
  toSubmissionAsks
} from '../view-models/event-page.view-model.ts'
import { heldSavesKey, toHeldSaves } from '../view-models/held-saves.ts'
import { seeOther } from '../view-models/see-other.ts'
import { fromMax } from '../view-models/record-filters.ts'
import { timesOf } from '../view-models/times.ts'

/** Four times the limit the form enforces: past 500 is the operator's mistake, to be shown with the note in front of them. */
const noteMax = 2000

interface SavePayload {
  text: string
  revision: number
  back: string
  note: string
  then?: string
}

/** To the banner, which takes focus there: the form posted to `#payload`, which a bare Location would inherit. */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)
  const query = from === '' ? '' : `?back=${encodeURIComponent(from)}`

  return `${href}${query}#${eventBannerId}`
}

/** Trimmed, as it is kept for the form or sent. */
const checkedNote = (check: EditPayloadCheck): string =>
  check.kind === 'invalid' ? check.note : check.edit.note

const unattributed = {
  title:
    'Not saved — your account has no name or email to record against this change.',
  text: 'Nothing has changed.'
}

/** Back to the editor, where the held changes are drawn, with the page it was opened from. */
const toHeldRedirect = (key: EventKey, from: string): string => {
  const params = new URLSearchParams(from === '' ? {} : { back: from })

  params.set('edit', 'payload')

  return `${toEventHref(key)}?${params}#payload`
}

interface Save extends Omit<PayloadSave, 'redrive'> {
  submission: PayloadSubmission & { note: string }
  then: string | undefined
}

/**
 * A stale save is the editor again, over the event GAS answered with. One the
 * service didn't answer or failed holds its changes for the editor the 303
 * opens; the rest leave their outcome in the session and are followed by a 303.
 */
const save = async (
  request: Request,
  h: ResponseToolkit,
  { then, ...asked }: Save
) => {
  const { key, submission } = asked
  const from = toSafeFrom(submission.from)
  const saved = await saveEventPayloadUseCase({
    ...asked,
    redrive: then === 'redrive'
  })

  if (saved.kind === 'stale') {
    return viewReview(request, h, key, saved.review, submission)
  }

  if (saved.kind === 'held') {
    request.yar.set(
      heldSavesKey,
      toHeldSaves(
        request.yar.get(heldSavesKey),
        toEventHref(key),
        {
          failure: saved.failure,
          text: submission.text,
          revision: submission.revision,
          note: submission.note,
          then: then ?? ''
        },
        Date.now()
      )
    )

    return h.redirect(toHeldRedirect(key, from)).code(seeOther)
  }

  const { outcome, status, reason, failure, redrive } = saved.edit

  request.yar.flash(redriveNoticeKey, {
    outcome,
    status,
    reason,
    failure,
    redrive,
    action: 'edit',
    page: toEventHref(key)
  })

  return h.redirect(toRedirect(key, from)).code(seeOther)
}

/** The page drawn from the posted text: the review, the editor or the held changes. */
const viewReview = async (
  request: Request,
  h: ResponseToolkit,
  key: EventKey,
  review: PayloadReviewResult,
  submission: PayloadSubmission,
  extras: Pick<EventPageAsks, 'saveError'> = {}
) => {
  const page = toEventPage({
    result: review.result,
    key,
    times: timesOf(request),
    catalogue: shellCatalogue(request),
    prod: isProduction(config.get('environmentLabel')),
    ...toSubmissionAsks(review, key, submission, extras)
  })

  return h.view('events/event', page).code(toEventStatusCode(page))
}

const viewSubmission = async (
  request: Request,
  h: ResponseToolkit,
  key: EventKey,
  submission: PayloadSubmission,
  extras: Pick<EventPageAsks, 'saveError'> = {}
) =>
  viewReview(
    request,
    h,
    key,
    await reviewPayloadUseCase(key, submission),
    submission,
    extras
  )

/**
 * Save, and Save and redrive, in one call to GAS. The hidden text is read
 * again rather than trusted, since it came back from the browser. A rejected
 * form is the review again and a stale save the editor; the rest, an
 * unanswered or failed save's held changes among them, leave their outcome in
 * the session and are followed by a 303, as redrive and purge are.
 *
 * No CSRF token and no `options.auth`, for the reasons the redrive route
 * spells out.
 */
export const savePayloadRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/payload',
  options: {
    cache: eventPageCache,
    payload: { maxBytes: formMaxBytes },
    validate: {
      params: Joi.object(eventAddress),
      payload: Joi.object({
        text: Joi.string().allow('').default(''),
        revision: Joi.number().integer().min(0).required(),
        back: Joi.string().allow('').max(fromMax).default(''),
        // Truncated rather than refused: a pasted payload is a note to
        // shorten, and the form can only say so with the note in front of it.
        note: Joi.string().allow('').max(noteMax).truncate().default(''),
        then: Joi.string().valid('redrive')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const {
      text,
      revision,
      back: from,
      note,
      then
    } = request.payload as SavePayload
    const check = checkEditPayload({ text, revision, note })
    const submission = { text, revision, from, note: checkedNote(check) }

    if (check.kind === 'invalid') {
      return viewSubmission(request, h, key, {
        ...submission,
        noteProblem: check.noteProblem
      })
    }

    const actor = toActor(request)

    if (actor === undefined) {
      return viewSubmission(request, h, key, submission, {
        saveError: unattributed
      })
    }

    return save(request, h, {
      key,
      edit: check.edit,
      actor,
      submission,
      then
    })
  }
}
