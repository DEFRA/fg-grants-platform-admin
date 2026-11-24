import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  downloadExploreUseCase,
  downloadJsonUseCase
} from '../use-cases/download-explore.use-case.ts'
import type { ExploreLines } from '../use-cases/download-explore.use-case.ts'
import type { ExploreAnswer } from '../use-cases/explore-calls.ts'
import type { ExplorePageData } from '../use-cases/explore-page.ts'
import {
  toCsvFilename,
  toExploreCsv
} from '../view-models/explore-csv.view-model.ts'
import {
  toJsonFilename,
  toJsonStream
} from '../view-models/explore-json.view-model.ts'
import {
  exploreCsvPath,
  exploreJsonPath,
  explorePageCache,
  toExplorePage,
  toExploreStatusCode
} from '../view-models/explore-page.view-model.ts'
import { timesOf } from '../view-models/times.ts'

const askerOf = (request: Request) => ({
  owner: {
    session: request.yar.id,
    user: request.auth.credentials.user?.id ?? ''
  }
})

const toFile = (h: ResponseToolkit, answer: ExploreAnswer) =>
  h
    .response(toExploreCsv(answer))
    .type('text/csv; charset=utf-8')
    .header(
      'content-disposition',
      `attachment; filename="${toCsvFilename(answer)}"`
    )

const draw = (request: Request, h: ResponseToolkit, page: ExplorePageData) => {
  const input = {
    ...page,
    times: timesOf(request),
    now: new Date(),
    arrived: false
  }

  return h
    .view('explore', toExplorePage(input))
    .code(toExploreStatusCode(input))
}

/** The run's rows from the top to the furthest window read, read again as their own query, as a file that says which limit, if any, stopped it. */
export const downloadExploreRoute: ServerRoute = {
  method: 'POST',
  path: exploreCsvPath,
  options: {
    cache: explorePageCache,
    validate: {
      payload: Joi.object({ run: Joi.string().guid().required() })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { run } = request.payload as { run: string }
    const outcome = await downloadExploreUseCase({
      ...askerOf(request),
      run
    })

    return outcome.kind === 'file'
      ? toFile(h, outcome.answer)
      : draw(request, h, outcome.page)
  }
}

const toJsonAttachment = (h: ResponseToolkit, lines: ExploreLines) =>
  h
    .response(toJsonStream(lines.header, lines.lines, lines.show))
    .type('application/json; charset=utf-8')
    .header(
      'content-disposition',
      `attachment; filename="${toJsonFilename(lines.header.source)}"`
    )

/** The run's documents, each whole as stored, written as GAS streams them; a file that stops short says so in its last item. */
export const downloadJsonRoute: ServerRoute = {
  method: 'POST',
  path: exploreJsonPath,
  options: {
    cache: explorePageCache,
    validate: {
      payload: Joi.object({ run: Joi.string().guid().required() })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { run } = request.payload as { run: string }
    const outcome = await downloadJsonUseCase({ ...askerOf(request), run })

    return outcome.kind === 'lines'
      ? toJsonAttachment(h, outcome)
      : draw(request, h, outcome.page)
  }
}
