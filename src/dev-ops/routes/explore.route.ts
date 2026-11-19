import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute
} from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import type { ExplorePageData } from '../use-cases/explore-page.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import type { ExploreOwner } from '../use-cases/held-runs.ts'
import { pageMax } from '../use-cases/held-runs.ts'
import { runExploreUseCase } from '../use-cases/run-explore.use-case.ts'
import type {
  ExploredList,
  ExploreRunOutcome,
  ExploreWayIn
} from '../use-cases/run-explore.use-case.ts'
import {
  restoreExploreUseCase,
  viewExploreUseCase
} from '../use-cases/view-explore.use-case.ts'
import { toListAddress } from '../use-cases/list-bucket.use-case.ts'
import type { ListAddress } from '../use-cases/list-bucket.use-case.ts'
import { fromUrlQuery } from '../view-models/bucket-urls.ts'
import {
  exploreArrivalKey,
  explorePageCache,
  explorePath,
  goneStatusCode,
  postedMax,
  toExplorePage,
  toExploreStatusCode,
  toRunHref
} from '../view-models/explore-page.view-model.ts'
import { seeOther } from '../view-models/see-other.ts'
import { heldSearch, toSearchKey } from '../view-models/stored-search.ts'
import { toListWindow } from '../view-models/time-range.view-model.ts'
import { shellQuery, timesOf } from '../view-models/times.ts'

/** A session that has none saved yet is saved with this request, so its id, and so the runs it holds, last. */
const ownerOf = (request: Request): ExploreOwner => {
  if (!request.state[config.get('session.cache.name')]) {
    request.yar.touch()
  }

  return {
    session: request.yar.id,
    user: request.auth.credentials.user?.id ?? ''
  }
}

const takeArrival = (request: Request): string | null =>
  request.yar.flash(exploreArrivalKey).at(-1) ?? null

const draw = (
  request: Request,
  h: ResponseToolkit,
  page: ExplorePageData,
  arrived = false
) => {
  const input = {
    ...page,
    times: timesOf(request),
    now: new Date(),
    arrived,
    inPlace: request.headers['x-requested-with'] === 'gpa-load-more'
  }

  return h
    .view('explore', toExplorePage(input))
    .code(toExploreStatusCode(input))
}

/** A new run lands on its first window; Keep looking without script, on the window it names. */
const toHeldRedirect = (
  request: Request,
  h: ResponseToolkit,
  { id, page }: { id: string; page?: number }
) => {
  if (page === undefined) {
    request.yar.flash(exploreArrivalKey, id)
  }

  return h.redirect(toRunHref(id, page)).code(seeOther)
}

type Responder<K extends ExploreRunOutcome['kind']> = (
  request: Request,
  h: ResponseToolkit,
  outcome: Extract<ExploreRunOutcome, { kind: K }>,
  arrived: boolean
) => ResponseObject

const responders: { [K in ExploreRunOutcome['kind']]: Responder<K> } = {
  held: (request, h, outcome) => toHeldRedirect(request, h, outcome),
  restart: (_, h, { id }) => h.redirect(toRunHref(id)).code(seeOther),
  apart: (_, h, { id, page }) => h.redirect(toRunHref(id, page)).code(seeOther),
  gone: (_, h, { id }) =>
    h.response().code(goneStatusCode).header('location', toRunHref(id)),
  page: (request, h, { page }, arrived) => draw(request, h, page, arrived)
}

const respond = (
  request: Request,
  h: ResponseToolkit,
  outcome: ExploreRunOutcome,
  arrived = false
) =>
  (responders[outcome.kind] as Responder<ExploreRunOutcome['kind']>)(
    request,
    h,
    outcome,
    arrived
  )

interface PageQuery {
  run?: string
  page?: number
  through?: number
}

const viewOrRestore = (request: Request, { run, page, through }: PageQuery) => {
  const asker = { owner: ownerOf(request) }

  return through === undefined
    ? viewExploreUseCase({ ...asker, run: run ?? null, page: page ?? 1 })
    : restoreExploreUseCase({ ...asker, run: run!, through })
}

/** The first window of the run a Run just held: not a reload, another run, a later window or every window again. */
const isLanding = (arrival: string | null, query: PageQuery): boolean =>
  query.run !== undefined &&
  arrival === query.run &&
  query.page === undefined &&
  !query.through

/**
 * The editor, holding the default query unrun; or a run this session holds:
 * one window, or with `through` every window from the first through it. A
 * GET runs nothing else.
 */
export const viewExploreRoute: ServerRoute = {
  method: 'GET',
  path: explorePath,
  options: {
    cache: explorePageCache,
    validate: {
      query: Joi.object({
        run: Joi.string().max(64),
        page: Joi.number().integer().min(1).max(pageMax),
        through: Joi.number().integer().min(2).max(pageMax),
        ...shellQuery
      })
        .with('through', 'run')
        .without('through', 'page')
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = request.query as unknown as PageQuery
    const arrival = takeArrival(request)
    const outcome = await viewOrRestore(request, query)

    return respond(request, h, outcome, isLanding(arrival, query))
  }
}

interface RunPayload {
  q?: string
  pick?: string
  run?: string
  page?: number
  from?: string
  list: string
  find?: string
  record?: string
}

/** A list's own query string, a key with several values as a list of them. */
const toListParams = (list: string): Record<string, string | string[]> => {
  const params = new URLSearchParams(list)

  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key)

      return [key, values.length === 1 ? values[0] : values]
    })
  )
}

/** The list's path, its address's facts as typed, and its range as instants, as GAS finds the list by. */
const toListAt = (
  request: Request,
  path: string,
  list: string
): ListAddress => {
  const address = toListParams(list)

  return {
    ...toListAddress(path, address),
    ...toListWindow(address, timesOf(request).zone, new Date())
  }
}

/** The list GAS found, from the shell its answer carried: its filters from the address, and its search from the session. */
const toExploredList = (
  request: Request,
  { params, from, to }: ListAddress,
  bucketId: string
): ExploredList | null => {
  const bucket = shellCatalogue(request)?.buckets.find(
    ({ id }) => id === bucketId
  )

  return bucket
    ? {
        bucket,
        look: {
          facts: fromUrlQuery(bucket, params),
          window: { from, to },
          search: heldSearch(request, toSearchKey(bucket.path))
        }
      }
    : null
}

/** The fields a way in names are there: the payload's schema says which go together. */
type WayInPayload = Required<RunPayload>

/** Each way in by the field that names it, `pick` first: it wins over the `q` that comes with it. */
const waysIn: [
  keyof RunPayload,
  (request: Request, payload: WayInPayload) => ExploreWayIn
][] = [
  ['pick', (_, { pick }) => ({ kind: 'pick', pick })],
  [
    'run',
    (request, { run, page }) => ({
      kind: 'window',
      run,
      page,
      inPlace: request.headers['x-requested-with'] === 'gpa-load-more'
    })
  ],
  [
    'from',
    (request, { from, list }) => {
      const address = toListAt(request, from, list)

      return {
        kind: 'list',
        address,
        toList: (bucketId) => toExploredList(request, address, bucketId)
      }
    }
  ],
  ['find', (_, { find, record }) => ({ kind: 'find', find, record })],
  ['q', (_, { q }) => ({ kind: 'typed', q })]
]

const toWayIn = (request: Request, payload: RunPayload): ExploreWayIn => {
  const [, toNamed] = waysIn.find(([key]) => payload[key] !== undefined)!

  return toNamed(request, payload as WayInPayload)
}

/** A list's bucket id, as Open in Explore posts it. */
const bucketIdMax = 200

/** A post names exactly one way in, but for `pick`, which may come with the editor's `q`. */
const wayInFields = ['q', 'run', 'from', 'find']

/**
 * Every way into a run: the editor's Run, the Queries menu (whose items post
 * the editor's form, so `pick` wins over the `q` that comes with it), Keep
 * looking, a list's Open in Explore and a record's Find others.
 */
export const runExploreRoute: ServerRoute = {
  method: 'POST',
  path: explorePath,
  options: {
    cache: explorePageCache,
    validate: {
      payload: Joi.object({
        q: Joi.string().allow('').max(postedMax),
        pick: Joi.string().max(100),
        run: Joi.string().guid(),
        page: Joi.number().integer().min(2).max(pageMax),
        from: Joi.string().max(bucketIdMax),
        list: Joi.string().allow('').max(postedMax).default(''),
        find: Joi.string().max(100),
        record: Joi.string().max(2048)
      })
        .and('run', 'page')
        .with('find', 'record')
        .when(Joi.object({ pick: Joi.exist() }).unknown(), {
          otherwise: Joi.object().xor(...wayInFields)
        })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const outcome = await runExploreUseCase({
      owner: ownerOf(request),
      wayIn: toWayIn(request, request.payload as RunPayload)
    })

    return respond(request, h, outcome)
  }
}
