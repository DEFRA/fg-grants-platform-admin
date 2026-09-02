# Plan 04 — Admin FE `/dev-ops/events`

Repo: `fg-grants-platform-admin`, **on top of branch `FGP-1227-operations-daisyui`** (the daisyUI `dev-ops` app shell — it does not exist on `main`). Ticket: `tickets/FGP-1392.md` (Scope/In → fg-grants-platform-admin; Behaviour → Table columns; Acceptance criteria; Data/interfaces → FE). Consumes the Plan 02 contract (`GET /grant-admin/events`).

**Contract status: settled.** All six concerns raised against the first draft are resolved and the ticket has been amended; the decisions are recorded at the foot of this plan and are already applied throughout it.

## Goal
Server-rendered daisyUI table of merged GAS + Caseworking events with Previous/Next cursor links, `status`/`service` preserved across pages, empty / error / partial states, and Europe/London timestamps rendered on the server.

---

## Known code facts (verified against the code)

All paths relative to the repo root. Line numbers are from `FGP-1227-operations-daisyui` unless marked `main` (the two branches agree on everything outside `src/dev-ops`).

**Nunjucks / template resolution**
- `src/dev-ops/view-options.ts:16-30` builds the dev-ops app's own `nunjucks.Environment` with a `FileSystemLoader` over exactly two directories: `src/dev-ops/views` and `src/dev-ops/views/components`. No govuk-frontend, no `src/common/views`.
- The dev-ops environment registers **no filters and no globals** (contrast `src/server/plugins/views/engine.ts:37-43`, which adds them for the GDS environment). So `formatDate` (`src/common/views/filters/format-date.ts`, date-fns) is **not available** in a dev-ops template — all formatting happens in the view model. `date-fns@4.1.0` is a dependency but is not needed here; `Intl` covers it.
- `autoescape: true`, `throwOnUndefined: false`, `trimBlocks: true`, `lstripBlocks: true` (`view-options.ts:24-29`).
- Nunjucks **does** resolve relative includes: `heading/macro.njk:2` uses `{%- include "./template.njk" -%}` and works, because `FileSystemLoader.isRelative`/`resolve` resolve `./x` against the including template's directory. Verified by rendering through the same loader configuration.
- Page templates name components from the components root, without a prefix: `views/index.njk:3` → `{% from "heading/macro.njk" import heading %}`. Layout: `{% extends 'layouts/page.njk' %}` (`views/index.njk:1`).
- `layouts/page.njk` offers exactly two blocks: `header` (17) and `content` (29), plus `pageTitle` inside `<title>` (8). `<main>` is fixed at `class="container mx-auto max-w-4xl p-6"` (28) with **no block or class hook** to widen it — see Risks.
- `src/dev-ops/index.ts:11-17`: `server.views({ ...devOpsViewOptions, relativeTo: import.meta.dirname, path: 'views' })`, then `server.route(scopedTo('FCP.GrantOperationsAdmin', [viewDevOpsRoute]))`. A single engine (`njk`, `src/server/plugins/views/index.ts:26-33`) means vision appends `.njk`, so `h.view('events')` → `src/dev-ops/views/events.njk`.
- Vision merges the manager's `context` (`view-options.ts:32-35`: `serviceName`, `assetPath`, `getAssetPath`) under the per-view context; `h.view('events', {...})` keys win.

**Component convention**
- A component is a directory under `views/components/` holding `macro.njk` + `template.njk` (+ `template.test.ts`). `macro.njk` is always three lines: `{% macro name(params) %}{%- include "./template.njk" -%}{% endmacro %}`.
- Every component root element carries `data-testid="do-<name>…"` (`heading/template.njk:1`, `theme-toggle/template.njk:6`, `icon/all/moon.njk:4`).
- Icons live one file per icon at `views/components/icon/all/<name>.njk`, heroicons v2 24/solid copied verbatim, root `<svg>` carrying `{% if params.class %}` and `data-testid="do-icon-<name>"` (`icon/all/moon.njk`). `icon/macro.njk:2` includes `"./all/" + params.name + ".njk"`, so an unknown name throws `template not found` (asserted at `icon/template.test.ts:28-32`).
- `views/components/index.ts` is the client entry and only defines custom elements. A component with no behaviour adds nothing there — **status-badge and pager need no client JS**.

**Test kit**
- `src/dev-ops/test-utils.ts:25-49` — `render(name, params, block?, options?)` renders `{% from "<name>/macro.njk" import <camelCase(name)> %}` and returns a cheerio `CheerioAPI`. So `render('status-badge', {...})` calls macro `statusBadge`; `render('pager', {...})` calls `pager`. Params are `JSON.stringify`d into the call, so only JSON values may be passed (dates must already be strings).
- `mount()` (`test-utils.ts:62-84`) is only for components with a custom element; neither component here needs one, so **no `// @vitest-environment happy-dom` pragma** — plain node env (`vitest.config.ts:6`). The ticket now says "the existing dev-ops component kit — `test-utils.render` + cheerio" (`FGP-1392.md:208`).
- Route tests: `src/dev-ops/routes/view-dev-ops.route.test.ts` — `createServer()` → `server.register([devOps])` → `server.initialize()`, then `server.inject({ method, url, auth: { strategy: 'session', credentials: { user: { name }, scope: [...] } } })`. `src/grant-ops/routes/view-claims.route.test.ts:64-72` adds the cheerio idiom: `load(result as unknown as string)`.
- Mocking idiom is by module reference: `vi.mock(import('../use-cases/get-events.use-case.ts'))` (enforced by `vitest/prefer-import-in-mock`, `eslint.config.js:103`).
- `src/common/__mocks__/config.ts` and `__mocks__/logger.ts` exist; `vi.mock(import('../../common/logger.ts'))` picks up the logger stub with `info`/`error` spies.
- `package.json` test script: `AWS_EMF_ENVIRONMENT=Local TZ=UTC vitest run --coverage`.

**Backend call**
- `src/common/gas.ts:13-21` — `getFromGas<T>(path)` → `wreck.get<T>(config.get('gas.apiUrl') + path, { json: true, headers: { authorization: 'Bearer ' + config.get('gas.serviceToken') } })`, returns `payload`. Path segments must arrive already escaped.
- `src/common/wreck.ts:8-20` — shared client, **3000 ms timeout**, `json: true`, no retries; adds the CDP trace id on `preRequest`.
- `@hapi/wreck` throws on any status ≥ 400 (`node_modules/@hapi/wreck/lib/index.js:560-574`): a `Boom` with message `` `Response Error: ${statusCode} ${statusMessage}` ``, `output.statusCode`, and **`data.payload` holding the backend's response body** plus `data.res`. Never hand that error object to the logger. This is the path a GAS `400` (bogus `status`/`service`, tampered cursor) and a GAS `502` (both GAS reads down) both take.
- `src/common/logger.ts:22-31` — pino with `errorKey: 'error'`, `nesting: true`; `log.redact` defaults to `[]` outside production (`src/common/config.ts:158-165`). So `logger.error(err)` in a dev/test environment serialises `err.data.payload` verbatim.

**Routing / scope / validation**
- `src/server/plugins/auth/scoped-to.ts:12-19` sets `options.auth = { strategy: 'session', scope: [scope] }` **unless the route already declares `options.auth`** — the spread is `{ auth, ...route.options }`, so a route that sets `options.validate` and nothing else still gets `auth`, but a route that sets its own `options.auth` silently opts out of the scope. Declaring `validate` is safe; declaring `auth` is not. A comment on the route says so.
- `src/server/plugins/errors.ts:15-36` — `onPreResponse` turns any Boom into `h.view('error', …).code(statusCode)` rendered by the **root (GDS) views manager**. This is what a Joi *query* rejection produces, which is why the FE no longer validates the `status`/`service` enums (Decision 1).
- Joi resolves to `joi@18.2.1`, hoisted from `@defra/hapi-auth-oidc` (`package-lock.json:2412-2425`); it is **not** a declared dependency of this package, though `src/grant-ops/routes/view-claims.route.ts:3` already imports it. Follow the precedent; optionally add `"joi": "18.2.1"` to `dependencies`.
- Hapi's server-wide `routes.validate.options.abortEarly = false` (`src/server/index.ts:24-28`). Unknown query keys are still rejected by default → 400; only the *value* enums are relaxed.

**ESLint constraints that shape the code** (`eslint.config.js:28-67`)
- `complexity: ['error', { max: 4 }]` — keep mappers to lookup objects, not `if` chains, and split anything that grows a second condition.
- `func-style: ['error', 'expression']` — every function is a `const` arrow.
- `import-x/no-restricted-paths`: a **route** may import only `**/use-cases/**`, `**/view-models/**`, `common/config.ts`, `common/logger.ts` from `src/**` (external packages are unrestricted). A **use case** may import only `common/**`, `repositories/**`, other use cases. Therefore the route must get its types from the use case — `src/grant-ops/use-cases/get-claims.use-case.ts:4-10` shows the re-export idiom.
- `import-x/no-default-export`, `vitest/consistent-test-it` (`test`), `vitest/max-nested-describe: 1` — one flat `describe` per unit.

**Styling / build**
- `src/dev-ops/client/dev-ops.css:8-17` — `@import "tailwindcss" source(none); @source "../views"; @plugin "daisyui" { themes: light --default, dark --prefersdark; }`. Tailwind 4.3.3, daisyUI 5.7.20.
- **Verified empirically**: daisyUI 5 registers its components through `addComponents`/`addUtilities` (`node_modules/daisyui/index.js`), and Tailwind 4 tree-shakes them against the scanned candidate set. Compiling that exact CSS with candidates `['badge','table']` emits **no** `.badge-warning`, `.badge-info`, `.badge-error`, `.alert-warning`, `.join-item`, `.table-zebra` or `.text-error`; compiling with those names as candidates emits all of them. `@source "../views"` covers `src/dev-ops/views` **only** — a class name that exists solely in a `.ts` view model never reaches the stylesheet. The ticket now states this rule directly (`FGP-1392.md:89`).
- daisyUI 5.7.20 class names confirmed present: `table`, `table-zebra`, `table-sm|md|lg|xs|xl`, `table-pin-rows`, `table-pin-cols` (`components/table.css`); `badge`, `badge-{sm,md,lg,xs,xl}`, `badge-{ghost,info,warning,success,error,neutral,primary,…}`, `badge-{soft,outline,dash}` (`components/badge.css`); `alert`, `alert-{warning,error,success,info}`, `alert-{soft,outline,dash,horizontal,vertical}` (`components/alert.css`); `btn`, `btn-{sm,ghost,primary,…}` (`components/button.css`); `join`, `join-item`, `join-horizontal`, `join-vertical` (`utilities/join.css` — a utility in v5, not a component).
- `vite.config.ts:11-19` builds `dev-ops-css` from `src/dev-ops/client/dev-ops.css` and `dev-ops` from `src/dev-ops/views/components/index.ts`; no new entry is needed.

**The response, as Plan 02 will emit it** (`tickets/FGP-1392/02-gas-events-endpoint.md`, response schema step; `FGP-1392.md:153-181`)
- No `kind` field. Audit rows are identified structurally *in GAS*, and reach the FE only as a derived `type` of the form `audit · APPLICATION.CREATE`. The FE has no audit concept at all.
- `status` is validated as a plain **string**, not an enum, so one unexpected document cannot fail the page. The FE's ghost fallback is therefore live code, not a defensive dead branch (`FGP-1392.md:111`, `:145`).
- `fullType` is `string | null` (`null` for audit rows). No column shows it; it is carried for completeness.
- `attempts` and `maxAttempts` are `Joi.number().integer().min(1).required()` — **never null** (decided after review; Plan 02 schema tightened). `maxAttempts` arrives per row for every source, including CW's own retry cap. The FE helpers below still tolerate `null`/`undefined` defensively because the FE must never render `null / 5`, but the TypeScript types are plain `number`.
- `sourceErrors` is a **required array** (empty when every source answered), and its `service` admits `"gas"` as well as `"caseworking"`: exactly one GAS source failing is a `200` with a banner, and only *both* GAS reads failing is a `502`. An unconfigured CW — true in every environment today — reports `message: "not configured"` for both CW boxes.
- `pagination.startCursor` / `endCursor` are `string | null` (null on an empty page).
- Every other field is `required`, so a mapping gap fails GAS's own response schema rather than reaching the FE as a blank cell.

**Timestamp formatting — verified on node 24.15 (the repo's engine is `>=24`)**
```js
new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', timeZoneName: 'short'
})
```
- `2026-06-16T10:00:00Z` → `16 Jun 2026, 11:00:00 BST` ✔ (`FGP-1392.md:106`)
- `2026-01-16T10:00:00Z` → `16 Jan 2026, 10:00:00 GMT` ✔ (`FGP-1392.md:106`)
- Output is identical with `TZ=UTC` (the test script) and with `TZ` unset, because `timeZone` is explicit — the tests are not relying on the ambient zone.
- `day: '2-digit'` pads (`06 Jan 2026`); `day: 'numeric'` gives `6 Jun 2026`. Padded is chosen for column alignment; a test pins it either way.
- `hourCycle: 'h23'` is specified rather than `hour12: false` (equivalent on this ICU, but `hour12` can degrade to `h24`/`24:00` on other builds). Do not pass both.
- `format(new Date('nope'))` **throws `RangeError: Invalid time value`** — guard on `Number.isNaN(date.getTime())`.
- Nunjucks autoescape verified against the real loader config: a value containing `<script>` is escaped; a literal `&` in template source is left alone; an interpolated href's `&` becomes `&amp;`, and cheerio's `.attr('href')` decodes it back — so route tests can assert the plain `…&direction=forward` string, but a raw-string assertion on `result` would see `&amp;`.

---

## Deliverables

| # | File | What |
|---|---|---|
| 1 | `src/common/describe-error.ts` (+ `.test.ts`) | One-line error description; never touches `error.data` |
| 2 | `src/dev-ops/repositories/events.repository.ts` (+ `.test.ts`) | `findEvents(query)` → `getFromGas`; all contract types |
| 3 | `src/dev-ops/use-cases/get-events.use-case.ts` (+ `.test.ts`) | Pass-through + any failure → `unavailable`; type re-exports |
| 4 | `src/dev-ops/view-models/events-page.view-model.ts` (+ `.test.ts`) | Rows, labels, formatting, badge roles, pager hrefs, banner text, states |
| 5 | `src/dev-ops/routes/view-events.route.ts` (+ `.test.ts`) | Joi query (plain strings), `h.view('events', …)` |
| 6 | `src/dev-ops/index.ts` | Register `viewEventsRoute` inside the existing `scopedTo` call |
| 7 | `src/dev-ops/views/events.njk` | The page |
| 8 | `src/dev-ops/views/components/status-badge/{macro,template}.njk` (+ `template.test.ts`) | Status badge; owns the literal daisyUI classes |
| 9 | `src/dev-ops/views/components/pager/{macro,template}.njk` (+ `template.test.ts`) | Previous/Next |
| 10 | `src/dev-ops/views/components/icon/all/arrow-path.njk` | The ↻ glyph (heroicons v2 24/solid `arrow-path`) |
| 11 | `src/dev-ops/views/index.njk` | Link to `/dev-ops/events` |

No change to `dev-ops.css`, `vite.config.ts`, `view-options.ts`, `layouts/page.njk` or `components/index.ts`.

---

## Steps

### Step 1 — `src/common/describe-error.ts`

```ts
/**
 * One line describing a failure, safe to log.
 *
 * @hapi/wreck answers a non-2xx with a Boom carrying `data.payload` — the
 * backend's response body — and `data.res`. The logger nests error objects
 * (src/common/logger.ts) and redacts nothing outside production, so handing it
 * such an error would write a payload we promised never to write. Only the
 * name and message leave this function.
 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error'
```

`describe-error.test.ts`
- `test('describes an error by its name and message')`
- `test('describes a wreck response error without its payload')` — build `Object.assign(new Error('Response Error: 400 Bad Request'), { data: { payload: { message: 'Cannot decode cursor' }, res: {} } })`; assert the result is exactly `'Error: Response Error: 400 Bad Request'` and `expect(result).not.toContain('Cannot decode cursor')`
- `test('describes a thrown non-error')` — `describeError('boom')` → `'Unknown error'`

### Step 2 — `src/dev-ops/repositories/events.repository.ts`

Types verbatim. Note what is deliberately **not** an enum: `status` (Plan 02 emits it as a string so one odd document cannot fail the page) and the four query parameters (Decision 1 — the FE forwards them unvalidated).

```ts
import { getFromGas } from '../../common/gas.ts'

export type EventService = 'gas' | 'caseworking'
export type EventBox = 'inbox' | 'outbox'

/**
 * The six statuses both services write today. `Event.status` is a plain string,
 * not this union: the endpoint passes a status through as written so a single
 * unexpected document cannot fail the whole page, and the badge map falls back
 * to a neutral role for anything it does not recognise. This union names what
 * is known, for the map and its tests, without narrowing the wire type.
 */
export type KnownEventStatus =
  | 'PUBLISHED'
  | 'PROCESSING'
  | 'FAILED'
  | 'RESUBMITTED'
  | 'COMPLETED'
  | 'DEAD_LETTER'

/** One inbox or outbox row, generic message plumbing only — never payload. */
export interface Event {
  service: EventService
  box: EventBox
  id: string
  eventId: string
  /** Short type, or `audit · APPLICATION.CREATE` for an audit row, or `-`. */
  type: string
  /** The un-stripped CloudEvent type; null for an audit row. */
  fullType: string | null
  source: string | null
  target: string | null
  segregationRef: string | null
  status: string
  attempts: number
  maxAttempts: number | null
  createdAt: string
  lastFailureAt: string | null
  completedAt: string | null
}

export interface EventsPagination {
  // Null on an empty page: there is no row to take a keyset position from.
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

/**
 * A source that could not be read. `service` admits `gas`: exactly one GAS
 * source failing is a partial page, not an outage — only both GAS reads
 * failing is a 502. `message` is a fixed one-liner from the endpoint
 * ("timeout", "HTTP 401", "not configured"), never a response body.
 */
export interface SourceError {
  service: EventService
  box: EventBox
  message: string
}

export interface EventsPage {
  events: Event[]
  pagination: EventsPagination
  sourceErrors: SourceError[]
}

/**
 * The four parameters the page and the endpoint share, as plain strings. The
 * page does not police the enums — GAS owns them, answers 400 for a value it
 * does not know, and that 400 surfaces as this page's error alert. Validating
 * here would instead hand the user the shared govuk error page.
 */
export interface EventsQuery {
  cursor?: string
  direction?: string
  status?: string
  service?: string
}

const toSearch = (query: EventsQuery): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined)
  )

  return params.size ? `?${params}` : ''
}

export const findEvents = async (query: EventsQuery): Promise<EventsPage> =>
  getFromGas<EventsPage>(`/grant-admin/events${toSearch(query)}`)
```

`URLSearchParams` percent-encodes each value, satisfying `getFromGas`'s "already escaped" contract (`src/common/gas.ts:12`) — and, with the enums no longer checked, it is the only thing standing between an arbitrary query string and the outbound URL, so it matters more than before.

`events.repository.test.ts` — `vi.mock(import('../../common/gas.ts'))`, `vi.mocked(getFromGas).mockResolvedValue(page)`:
- `test('reads the events page from fg-gas-backend')`
- `test('asks for the unfiltered page when given no parameters')` → `'/grant-admin/events'` (no `?`)
- `test('forwards the cursor, direction, status and service')` → `'/grant-admin/events?cursor=eyJ2IjoxfQ&direction=forward&status=DEAD_LETTER&service=gas'`
- `test('leaves out a parameter that was not given')` → only `?status=FAILED`
- `test('forwards a status the endpoint may reject')` → `?status=BOGUS` reaches the URL unchanged
- `test('escapes a cursor containing url characters')` → a cursor of `a+b/c=` encodes as `a%2Bb%2Fc%3D`
- `test('escapes a status containing url characters')` → `?status=a%26b=c` (nothing can break out of the query string)
- `test('returns the page the backend answers with')`

### Step 3 — `src/dev-ops/use-cases/get-events.use-case.ts`

```ts
import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { EventsPage, EventsQuery } from '../repositories/events.repository.ts'
import { findEvents } from '../repositories/events.repository.ts'

export type {
  Event,
  EventBox,
  EventService,
  EventsPage,
  EventsPagination,
  EventsQuery,
  KnownEventStatus,
  SourceError
} from '../repositories/events.repository.ts'

export interface EventsResult {
  page: EventsPage
  /**
   * The whole read failed — distinct from a page that is merely missing a
   * source, which the endpoint reports as `page.sourceErrors` with a 200.
   */
  unavailable: boolean
}

const noPage: EventsPage = {
  events: [],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false
  },
  sourceErrors: []
}

/**
 * The events page, or an honest empty one.
 *
 * Every failure the endpoint can answer with is the same fact to this page: it
 * could not be read. A 400 for a query GAS does not accept, a 400 for a
 * tampered cursor, a 401 for an expired service token, a 502 for both GAS
 * reads down, a timeout — all render the page with one alert on it, rather
 * than the shared error page taking over a screen an operator opened
 * precisely because something is broken.
 */
export const getEventsUseCase = async (
  query: EventsQuery
): Promise<EventsResult> => {
  try {
    return { page: await findEvents(query), unavailable: false }
  } catch (error) {
    logger.error(`Could not read events from fg-gas-backend: ${describeError(error)}`)

    return { page: noPage, unavailable: true }
  }
}
```

`get-events.use-case.test.ts` — `vi.mock(import('../repositories/events.repository.ts'))`, `vi.mock(import('../../common/logger.ts'))`:
- `test('returns the page the repository read')`
- `test('reports a page it read as available')` → `unavailable === false`
- `test('asks for the page the caller asked for')` → `findEvents` called once with the query
- `test('reports the page unavailable when the query is one the endpoint refuses')` → reject with a wreck `400`
- `test('reports the page unavailable when the cursor cannot be decoded')` → reject with a `400 Cannot decode cursor`
- `test('reports the page unavailable when both GAS reads fail')` → reject with a wreck `502`
- `test('returns an empty page when the backend fails')` → `events: []`, `sourceErrors: []`, all pagination flags false, cursors null
- `test('logs one line naming the failure')` → `expect(logger.error).toHaveBeenCalledWith('Could not read events from fg-gas-backend: Error: Response Error: 502 Bad Gateway')`
- `test('never logs the backend response body')` — reject with a wreck-shaped Boom whose `data.payload` is `{ message: 'mongo connection string' }`; assert `logger.error` was called with a `string` and `expect(String(vi.mocked(logger.error).mock.calls[0][0])).not.toContain('mongo')`

### Step 4 — `src/dev-ops/view-models/events-page.view-model.ts`

```ts
import type {
  Event,
  EventsQuery,
  EventsResult,
  SourceError
} from '../use-cases/get-events.use-case.ts'

/**
 * The badge roles this page uses, named by meaning rather than by class. The
 * literal daisyUI class for each lives in status-badge/template.njk, because
 * Tailwind scans views/ for candidates and a class name spelled only in
 * TypeScript is purged from the stylesheet without a word of warning.
 */
export type BadgeRole = 'ghost' | 'info' | 'warning' | 'success' | 'error'

export interface EventRow {
  eventId: string
  type: string
  segregationRef: string | null
  /** e.g. `GAS · Outbox → cw__sns__update_status_fifo` */
  source: string
  isDeadLetter: boolean
  /** e.g. `16 Jun 2026, 11:00:00 BST` */
  createdAt: string
  /** e.g. `3 / 5`, or `-` when the endpoint reported no attempt count. */
  attempts: string
  attemptsAtMax: boolean
  /** Formatted, or `-` when the row has never failed. */
  lastFailureAt: string
  hasFailed: boolean
  /** The raw status, shown as written whether or not it is one we know. */
  status: string
  statusRole: BadgeRole
  statusRetrying: boolean
}

export interface EventsPageModel {
  rows: EventRow[]
  previousHref: string | null
  nextHref: string | null
  /** `CW · Inbox, CW · Outbox` — empty when every source answered. */
  unavailableSources: string
  /** Nothing could be read at all. */
  unavailable: boolean
}

const serviceLabels: Record<string, string> = { gas: 'GAS', caseworking: 'CW' }
const boxLabels: Record<string, string> = { inbox: 'Inbox', outbox: 'Outbox' }

/**
 * Colour and the retry glyph, by status.
 *
 * `PUBLISHED` is queued and healthy, so it is deliberately quiet; `PROCESSING`
 * is in flight; amber is reserved for the two states that are actually
 * retrying, which is what an operator is scanning for. A status the endpoint
 * passes through that we have never seen falls to `ghost` rather than to a
 * blank cell — an unknown state is still worth seeing.
 */
const statusBadges: Record<string, { role: BadgeRole; retrying: boolean }> = {
  PUBLISHED: { role: 'ghost', retrying: false },
  PROCESSING: { role: 'info', retrying: false },
  FAILED: { role: 'warning', retrying: true },
  RESUBMITTED: { role: 'warning', retrying: true },
  COMPLETED: { role: 'success', retrying: false },
  DEAD_LETTER: { role: 'error', retrying: false }
}

const unknownStatus = { role: 'ghost' as BadgeRole, retrying: false }

/**
 * Europe/London with the zone abbreviation, built once. The zone is named
 * explicitly rather than taken from the process, so the same string is
 * rendered on a UTC container as on a developer's laptop.
 */
const londonTimestamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short'
})

export const toTimestamp = (value: string | null): string => {
  const date = new Date(value ?? '')

  // Intl throws on an unparseable date; a dash is more use than a 500.
  return Number.isNaN(date.getTime()) ? '-' : londonTimestamp.format(date)
}

/** `GAS · Inbox ← CW`, `GAS · Outbox → cw__sns__update_status_fifo`. */
export const toSourceLabel = ({ service, box, source, target }: Event): string => {
  const label = toSourceName({ service, box })
  const peer = box === 'inbox' ? source : target
  const arrow = box === 'inbox' ? '←' : '→'

  return peer ? `${label} ${arrow} ${peer}` : label
}

/** `GAS · Inbox` — the half of the label the alert and the table share. */
const toSourceName = ({ service, box }: { service: string; box: string }) =>
  `${serviceLabels[service] ?? service} · ${boxLabels[box] ?? box}`

// Both counts are nullable on the wire, so neither is assumed.
// Defensive: the contract says both are always integers, but a wrong answer here is silent.
const toAttempts = (attempts?: number | null, maxAttempts?: number | null) =>
  attempts == null ? '-' : `${attempts} / ${maxAttempts ?? '?'}`

const isAtMaxAttempts = (attempts?: number | null, maxAttempts?: number | null) =>
  attempts != null && maxAttempts != null && attempts >= maxAttempts

const toRow = (event: Event): EventRow => {
  const badge = statusBadges[event.status] ?? unknownStatus

  return {
    eventId: event.eventId,
    type: event.type,
    segregationRef: event.segregationRef,
    source: toSourceLabel(event),
    isDeadLetter: event.status === 'DEAD_LETTER',
    createdAt: toTimestamp(event.createdAt),
    attempts: toAttempts(event.attempts, event.maxAttempts),
    attemptsAtMax: isAtMaxAttempts(event.attempts, event.maxAttempts),
    lastFailureAt: toTimestamp(event.lastFailureAt),
    hasFailed: event.lastFailureAt !== null,
    status: event.status,
    statusRole: badge.role,
    statusRetrying: badge.retrying
  }
}

/**
 * Which sources are missing, in the vocabulary the Source column already uses.
 * Any source can fail, GAS included, so the alert names what is actually gone
 * rather than assuming Caseworking.
 */
const toUnavailableSources = (sourceErrors: SourceError[] = []): string =>
  sourceErrors.map(toSourceName).join(', ')

/**
 * A page keeps the filter it was opened with. The cursor is only a keyset
 * position, so `status` and `service` have to be carried on the link or the
 * next page quietly widens to All.
 */
const toHref = (
  cursor: string | null,
  direction: 'forward' | 'backward',
  { status, service }: EventsQuery
): string | null => {
  if (!cursor) {
    return null
  }

  const params = new URLSearchParams({ cursor, direction })

  if (status) {
    params.set('status', status)
  }
  if (service) {
    params.set('service', service)
  }

  return `/dev-ops/events?${params}`
}

export const toEventsPage = (
  { page, unavailable }: EventsResult,
  query: EventsQuery
): EventsPageModel => {
  const { events, pagination, sourceErrors } = page

  return {
    rows: events.map(toRow),
    previousHref: pagination.hasPreviousPage
      ? toHref(pagination.startCursor, 'backward', query)
      : null,
    nextHref: pagination.hasNextPage
      ? toHref(pagination.endCursor, 'forward', query)
      : null,
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable
  }
}
```

`sourceErrors` is required by the contract; the `= []` default on `toUnavailableSources` costs nothing and keeps an older or stubbed backend from throwing. The template branches on `unavailableSources` being non-empty, so the model exposes one string rather than a boolean plus a list.

Complexity: `toSourceLabel` 3, `toAttempts` 2, `isAtMaxAttempts` 1, `toRow` 2, `toHref` 3, `toEventsPage` 3 — all inside `max: 4`.

`events-page.view-model.test.ts` — fixture helpers `event(overrides)`, `result(events, pagination?, sourceErrors?)`, `model(...)`. **No `kind` in any fixture.**

*Timestamps*
- `test('formats a summer timestamp in British Summer Time')` → `16 Jun 2026, 11:00:00 BST` (from `2026-06-16T10:00:00.000Z`)
- `test('formats a winter timestamp in Greenwich Mean Time')` → `16 Jan 2026, 10:00:00 GMT` (from `2026-01-16T10:00:00.000Z`)
- `test('pads a single digit day')` → `06 Jan 2026, 00:00:00 GMT`
- `test('formats the last failure the same way as the creation time')`
- `test('shows a dash when a row has never failed')` → `lastFailureAt === '-'`, `hasFailed === false`
- `test('shows a dash rather than throwing on an unparseable timestamp')`

*Status badges — all six roles plus the fallback*
- `test('leaves a published row quiet')` → `{ statusRole: 'ghost', statusRetrying: false }`
- `test('marks a processing row as in flight')` → `{ statusRole: 'info', statusRetrying: false }`
- `test('marks a failed row as retrying')` → `{ statusRole: 'warning', statusRetrying: true }`
- `test('marks a resubmitted row as retrying')` → `{ statusRole: 'warning', statusRetrying: true }`
- `test('marks a completed row as done')` → `{ statusRole: 'success', statusRetrying: false }`
- `test('marks a dead letter row as failed')` → `{ statusRole: 'error', statusRetrying: false }`
- `test('falls back to a quiet badge for a status it does not know')` → `event({ status: 'QUARANTINED' })` → `ghost`, not retrying
- `test('keeps the raw status as the badge text')` → `row.status === 'QUARANTINED'`

*Source label*
- `test('names a GAS inbox row by where it came from')` → `GAS · Inbox ← CW`
- `test('names a GAS outbox row by the topic it goes to')` → `GAS · Outbox → cw__sns__update_status_fifo`
- `test('names a Caseworking inbox row')` → `CW · Inbox ← GAS`
- `test('names a Caseworking audit outbox row by its topic')` → `CW · Outbox → cw__sns__audit_fifo` (Decision 3 — the real topic, not the word "audit")
- `test('names an outbox row bound for the internal bus')` → `GAS · Outbox → internal`
- `test('drops the arrow when a row names no counterpart')` → `GAS · Inbox`

*DLQ / attempts / refs*
- `test('marks a dead letter row for the DLQ badge')` → `isDeadLetter === true`
- `test('leaves any other row unmarked')`
- `test('counts attempts against the maximum')` → `'3 / 5'`, `attemptsAtMax === false`
- `test('marks a row at its maximum attempts')` → `'5 / 5'`, `attemptsAtMax === true`
- `test('marks a row past its maximum attempts')` → `'6 / 5'`, true
- `test('counts against the maximum the row carries')` → `maxAttempts: 2` (a Caseworking row under a different retry cap) → `'2 / 2'`, at max
- `test('shows a dash if an attempt count is ever missing')` → `attempts: undefined` (cast; contract says never) → `'-'`, not at max — defensive only
- `test('shows a question mark when the endpoint reported no maximum')` → `maxAttempts: null` → `'3 / ?'`, not at max
- `test('carries the segregation reference through')` → `GLD-9B2-BWS-grasslands`
- `test('carries an audit row as the endpoint derived it')` → `eventId` is the `_id`, `type` is `audit · APPLICATION.CREATE`, `fullType` is `null`
- `test('carries a row whose type could not be derived')` → `type: '-'`

*Pager*
- `test('links Next to the end cursor')` → `/dev-ops/events?cursor=END&direction=forward`
- `test('links Previous to the start cursor')` → `/dev-ops/events?cursor=START&direction=backward`
- `test('keeps the status filter on both links')` → both hrefs end `&status=DEAD_LETTER`
- `test('keeps the service filter on both links')` → both hrefs end `&service=gas`
- `test('keeps both filters on the links')` → `…&status=FAILED&service=caseworking`
- `test('offers no Previous link on the first page')` → `previousHref === null`
- `test('offers no Next link on the last page')` → `nextHref === null`
- `test('offers no link when a flag is set but no cursor was issued')` → cursor `null` → href `null`
- `test('percent-encodes a cursor')` → cursor `a+b/c=` → `cursor=a%2Bb%2Fc%3D`

*States*
- `test('names nothing when every source answered')` → `unavailableSources === ''`
- `test('names both Caseworking sources when Caseworking is unconfigured')` → `CW · Inbox, CW · Outbox`
- `test('names a GAS source when one GAS read failed')` → `GAS · Outbox`
- `test('names sources from both services when each lost one')` → `GAS · Inbox, CW · Outbox`
- `test('reports the page unavailable when it could not be read')`
- `test('has no rows when nothing was found')` → `rows` empty, both hrefs null, `unavailableSources === ''`

### Step 5 — `src/dev-ops/routes/view-events.route.ts`

```ts
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'

/**
 * Every parameter is optional and unconstrained beyond being a string. No
 * filter is All, which is the page an operator opens by default.
 *
 * The enums are deliberately not repeated here. fg-gas-backend owns them and
 * answers 400 for a value it does not accept — including a tampered cursor —
 * and this app turns that into the page's own error alert. Validating the
 * values here would instead replace the whole screen with the shared govuk
 * error page (src/server/plugins/errors.ts), which is a worse answer for an
 * operator who reached this page because something is already wrong. Unknown
 * *keys* are still rejected by Joi's default, which catches a typo'd link.
 *
 * No `options.auth` here on purpose: src/dev-ops/index.ts registers this route
 * through `scopedTo('FCP.GrantOperationsAdmin', …)`, and that helper only
 * applies the scope to a route that declares none of its own. Adding an `auth`
 * key below would silently unscope the page.
 */
export const viewEventsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events',
  options: {
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        direction: Joi.string(),
        status: Joi.string(),
        service: Joi.string()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = request.query as unknown as EventsQuery

    return h.view('events', {
      pageTitle: 'Events',
      ...toEventsPage(await getEventsUseCase(query), query)
    })
  }
}
```

### Step 6 — register it

`src/dev-ops/index.ts`: import `viewEventsRoute` and extend the existing call to
`server.route(scopedTo('FCP.GrantOperationsAdmin', [viewDevOpsRoute, viewEventsRoute]))`.

### Step 7 — `src/dev-ops/views/events.njk`

```njk
{% extends 'layouts/page.njk' %}

{% from "heading/macro.njk" import heading %}
{% from "pager/macro.njk" import pager %}
{% from "status-badge/macro.njk" import statusBadge %}

{% block content %}
  {{ heading({
    text: pageTitle,
    caption: "Inbox and outbox messages across GAS and Caseworking"
  }) }}

  {% if unavailable %}
    <div role="alert" class="alert alert-error mb-4" data-testid="events-error">
      <span>Events could not be loaded from GAS.</span>
    </div>
  {% endif %}

  {% if unavailableSources %}
    <div role="alert" class="alert alert-warning mb-4" data-testid="events-partial">
      <span>Some event sources are unavailable: {{ unavailableSources }}. Showing the rest.</span>
    </div>
  {% endif %}

  {% if rows | length %}
    {# The table scrolls inside this box, not the page: six columns of ids do
       not fit a phone, and a body that scrolls sideways loses the header. #}
    <div class="overflow-x-auto rounded-box bg-base-100 shadow-sm" data-testid="events-scroller">
      <table class="table table-zebra table-sm" data-testid="events-table">
        <thead>
          <tr>
            <th scope="col">Event ID / Type</th>
            <th scope="col">Source</th>
            <th scope="col">Created At</th>
            <th scope="col">Attempts</th>
            <th scope="col">Last Failure</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {% for row in rows %}
            <tr data-testid="event-row">
              <td>
                <div class="font-mono text-primary" data-testid="event-id">{{ row.eventId }}</div>
                <div data-testid="event-type">{{ row.type }}</div>
                {% if row.segregationRef %}
                  <div class="font-mono text-xs opacity-70" data-testid="event-segregation-ref">{{ row.segregationRef }}</div>
                {% endif %}
              </td>
              <td class="whitespace-nowrap" data-testid="event-source">
                {{ row.source }}
                {% if row.isDeadLetter %}
                  <span class="badge badge-error badge-sm" data-testid="event-dlq">DLQ</span>
                {% endif %}
              </td>
              <td class="whitespace-nowrap" data-testid="event-created-at">{{ row.createdAt }}</td>
              {# Tailwind reads this file, so both class names are written out. #}
              {% if row.attemptsAtMax %}
                <td class="whitespace-nowrap text-error font-bold" data-testid="event-attempts">{{ row.attempts }}</td>
              {% else %}
                <td class="whitespace-nowrap" data-testid="event-attempts">{{ row.attempts }}</td>
              {% endif %}
              {% if row.hasFailed %}
                <td class="whitespace-nowrap text-error" data-testid="event-last-failure">{{ row.lastFailureAt }}</td>
              {% else %}
                <td class="whitespace-nowrap" data-testid="event-last-failure">{{ row.lastFailureAt }}</td>
              {% endif %}
              <td data-testid="event-status">
                {{ statusBadge({
                  status: row.status,
                  role: row.statusRole,
                  retrying: row.statusRetrying
                }) }}
              </td>
            </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>

    {{ pager({ previousHref: previousHref, nextHref: nextHref }) }}
  {% elif not unavailable %}
    <p data-testid="events-empty">No events found.</p>
  {% endif %}

  <p class="mt-4 text-xs opacity-70" data-testid="events-footnote">
    Data may be a few seconds behind (read from a secondary).
  </p>
{% endblock %}
```

### Step 8 — `status-badge` component

`views/components/status-badge/macro.njk`
```njk
{% macro statusBadge(params) %}
    {%- include "./template.njk" -%}
{% endmacro %}
```

`views/components/status-badge/template.njk`
```njk
{% from "icon/macro.njk" import icon %}

{# The daisyUI colour classes are spelled out here rather than composed in the
   view model, because Tailwind scans this directory for candidates
   (src/dev-ops/client/dev-ops.css) — a class name only a .ts file ever spells
   is tree-shaken out of the stylesheet and the badge renders grey with no
   build error and no failing test. The view model names the role; this file
   owns the class. #}
{% set roles = {
  ghost: "badge-ghost",
  info: "badge-info",
  warning: "badge-warning",
  success: "badge-success",
  error: "badge-error"
} %}
<span class="badge badge-sm {{ roles[params.role] | default("badge-ghost", true) }}" data-testid="do-status-badge">
  {% if params.retrying %}
    {{ icon({ name: 'arrow-path', class: 'h-3 w-3' }) }}
  {% endif %}
  {{ params.status }}
</span>
```

`views/components/icon/all/arrow-path.njk` — heroicons v2 `24/solid/arrow-path.svg`, copied verbatim into the shape of `moon.njk`, with `data-testid="do-icon-arrow-path"`.

`status-badge/template.test.ts` — `render('status-badge', {...})`:
- `test('shows the raw status as the badge text')` → `'DEAD_LETTER'`
- `test('renders a quiet badge for the ghost role')` → class is `badge badge-sm badge-ghost`
- `test('renders an informational badge')` → `badge-info`
- `test('renders a warning badge')` → `badge-warning`
- `test('renders a success badge')` → `badge-success`
- `test('renders an error badge')` → `badge-error`
- `test('falls back to a quiet badge for a role it does not know')` → `badge-ghost`
- `test('falls back to a quiet badge when no role is given')` → `badge-ghost`
- `test('shows the retry icon for a retrying status')` → `[data-testid="do-icon-arrow-path"]` has length 1
- `test('omits the retry icon otherwise')` → length 0
- `test('shows a status it has no role for')` → `render('status-badge', { status: 'QUARANTINED', role: 'ghost' })` renders the text
- `test('escapes a status containing markup')` → `$('script')` has length 0

`icon/template.test.ts` — add `test('renders the retry icon as an inline svg')`.

### Step 9 — `pager` component

`views/components/pager/macro.njk` — same three lines, macro `pager`.

`views/components/pager/template.njk`
```njk
{% if params.previousHref or params.nextHref %}
  <nav class="join mt-4" aria-label="Pagination" data-testid="do-pager">
    {% if params.previousHref %}
      <a class="join-item btn btn-sm" rel="prev" href="{{ params.previousHref }}" data-testid="do-pager-previous">Previous</a>
    {% endif %}
    {% if params.nextHref %}
      <a class="join-item btn btn-sm" rel="next" href="{{ params.nextHref }}" data-testid="do-pager-next">Next</a>
    {% endif %}
  </nav>
{% endif %}
```

`pager/template.test.ts`:
- `test('offers both links when there is a page either side')`
- `test('offers only Next on the first page')` → previous length 0
- `test('offers only Previous on the last page')` → next length 0
- `test('renders nothing when there is neither')` → `[data-testid="do-pager"]` length 0
- `test('names the navigation for assistive technology')` → `aria-label="Pagination"`, `rel` values
- `test('keeps the whole query string of the href it is given')` → `attr('href')` equals `/dev-ops/events?cursor=END&direction=forward&status=DEAD_LETTER` (cheerio decodes the escaped `&`)

### Step 10 — `views/index.njk`

Add a card action linking to the page, e.g. inside the existing `card-actions`:
`<a class="btn" href="/dev-ops/events">Events</a>`.

### Step 11 — route tests

`src/dev-ops/routes/view-events.route.test.ts` — `vi.mock(import('../use-cases/get-events.use-case.ts'))`, server built as in `view-dev-ops.route.test.ts`, cheerio helper as in `view-claims.route.test.ts:64-72`. Fixtures carry no `kind`.

*Access (AC — Access, Layout & scope)*
- `test('redirects an anonymous user to login')` → 302 → `/auth/login`
- `test('forbids a signed in user holding only the applications admin role')` → 403
- `test('forbids a signed in user holding no roles')` → 403
- `test('renders the page for the operations admin role')` → 200

*Query handling (Decision 1)*
- `test('asks for the unfiltered page when no parameters are given')` → use case called with `{}`
- `test('forwards the cursor, direction, status and service')`
- `test('forwards a status the endpoint does not know')` → `?status=BOGUS` → 200, use case called with `{ status: 'BOGUS' }`
- `test('forwards a service the endpoint does not know')` → `?service=other` → 200, use case called with `{ service: 'other' }`
- `test('forwards a direction the endpoint does not know')` → `?direction=sideways` → 200
- `test('shows the error alert when the endpoint refuses the query')` → `?status=BOGUS` with the use case reporting `unavailable` → 200, `alert-error` present, **not** the shared error page (assert `$('.govuk-heading-xl')` has length 0 and `$('[data-testid="events-error"]')` has length 1)
- `test('rejects a query parameter it does not know')` → `?page=2` → 400 (unknown *keys* are still refused; only the value enums were relaxed)

*Content*
- `test('titles the page Events')` → `$('title')` contains `'Events |'`
- `test('heads the table with the six columns in order')` → `['Event ID / Type','Source','Created At','Attempts','Last Failure','Status']`
- `test('renders a row for every event')`
- `test('shows the event id, type and segregation reference together')`
- `test('shows the created time in Europe/London')` → `16 Jun 2026, 11:00:00 BST`
- `test('names an outbox row by the topic it goes to')` → `GAS · Outbox → cw__sns__update_status_fifo`
- `test('shows an audit row as the endpoint derived it')` → id is the `_id`, type `audit · APPLICATION.CREATE`, source `GAS · Outbox → cw__sns__audit_fifo`
- `test('badges a dead letter row red and flags the queue')` → `[data-testid="event-dlq"]` text `DLQ`, status badge class contains `badge-error`
- `test('badges a published row quietly')` → `badge-ghost`
- `test('badges a processing row as in flight')` → `badge-info`
- `test('badges a retrying row amber with the retry icon')` → `badge-warning` + `[data-testid="do-icon-arrow-path"]`
- `test('badges a completed row green')` → `badge-success`
- `test('badges a status it does not know quietly and still shows it')` → `badge-ghost`, text `QUARANTINED`, status 200
- `test('reddens the attempts of a row at its maximum')` → `5 / 5`, class contains `text-error font-bold`
- `test('shows a dash for a row that never failed')`
- `test('escapes a segregation reference containing markup')` → `$('script')` length 0

*Pagination*
- `test('links Previous and Next to the cursors the endpoint issued')`
- `test('keeps the status filter on both links')` → hrefs contain `status=DEAD_LETTER`
- `test('keeps the service filter on both links')`
- `test('omits Previous on the first page')`
- `test('omits Next on the last page')`
- `test('omits the pager when there are no events')`

*Failure states*
- `test('names the unavailable sources when Caseworking is not configured')` → `alert-warning` reading `Some event sources are unavailable: CW · Inbox, CW · Outbox. Showing the rest.`, rows still render
- `test('names a GAS source when one GAS read failed')` → alert names `GAS · Outbox`, the other three sources' rows render
- `test('keeps the pager working on a partial page')` → Next still rendered alongside the warning
- `test('shows the error alert when the page could not be read')` → `alert-error`, status still 200, no table
- `test('tells the user when there are no events')` → `No events found.`, no pager, no alerts

*Layout & scope*
- `test('scrolls the table inside its own container')` → `$('[data-testid="events-scroller"]').hasClass('overflow-x-auto')` and the table is inside it
- `test('offers no actions, filter controls, counts or purge')` → assert absence of `button`, `select`, `[data-testid^="events-count"]`
- `test('footnotes that the data may lag')`

---

## Acceptance (from ticket)
Everything under **Access**, **Content** (the FE half), **Pagination** (link generation), **Failure states** and **Layout & scope**. The endpoint-side ACs belong to Plan 02.

---

## Risks / gotchas

1. **Branch dependency.** `src/dev-ops` exists only on `FGP-1227-operations-daisyui`; nothing in this plan applies to `main`. Branch from it (or rebase onto it once merged). If FGP-1227 is re-cut, `layouts/page.njk`, `view-options.ts`, `test-utils.ts` and `client/dev-ops.css` can all move under this work's feet.
2. **Tailwind's content scan is the sharpest trap here.** `@source "../views"` (`client/dev-ops.css:9`) scans `src/dev-ops/views` only, and daisyUI 5 component classes are tree-shaken like any utility (verified: compiling with candidates `badge`,`table` alone emits no `.badge-warning`/`.badge-info`/`.table-zebra`). A class name emitted from a `.ts` view model renders as unstyled markup with **no build error and no test failure** — the component tests assert on the class attribute, which is present either way. This is why the role→class map lives in `status-badge/template.njk` and why the two conditional `<td>` variants in `events.njk` are spelled out rather than built by string concatenation. Anyone tempted to "simplify" either back into TypeScript must also add `@source "../view-models";` to `dev-ops.css`.
3. **The FE no longer guards the query.** With the enums gone (Decision 1), any string reaches the outbound URL. `URLSearchParams` (Step 2) is the only escaping; keep it, and keep the "escapes a status containing url characters" test. Joi still rejects unknown *keys*, which is what catches a typo'd link.
4. **Autoescape covers the hostile strings, but only interpolated ones.** `autoescape: true` (`view-options.ts:26`) escapes `segregationRef`, `type`, `eventId`, `source`, `unavailableSources` and the status text — verified. A literal `&` in template source is *not* escaped, and an interpolated href's `&` becomes `&amp;`, which cheerio's `.attr()` decodes back. Assert hrefs through cheerio, never against the raw response string. Never introduce `| safe` on any of these fields — `status` in particular is now an unvalidated passthrough from a Mongo document.
5. **Long ids and horizontal scroll.** `layouts/page.njk:28` fixes `<main>` at `max-w-4xl` and exposes no block to widen it. Six columns carrying a 36-char UUID, a 24-char ObjectId, a long topic name and two 27-char timestamps will scroll horizontally on a desktop, not just a phone. The AC is still met (the scroller, not the body, scrolls). Widening means editing an FGP-1227 file — a `{% block main %}` or a `mainClasses` block — which is a change to agree with whoever owns that branch, not to make silently.
6. **Timeout budget.** `wreck` is fixed at 3000 ms for every call (`src/common/wreck.ts:8-20`) and `getFromGas` exposes no per-call override (`src/common/gas.ts:13-21`). GAS's own fan-out allows each of two CW actuator calls up to 3 s in parallel, plus two Mongo keyset reads. A CW source that hangs to its own timeout can therefore push GAS past the FE's 3 s, and the FE turns a page GAS would have returned as *partial* into a whole-page `unavailable` alert — the opposite of the intended degradation. Watch this in the local walkthrough; if it bites, the fix is a per-call timeout parameter on `getFromGas`, which is a shared helper used by grant-ops.
7. **Error payloads in logs.** `@hapi/wreck` attaches the backend's response body to the thrown Boom as `error.data.payload` (`node_modules/@hapi/wreck/lib/index.js:565-574`), and pino here nests error objects (`errorKey: 'error'`, `nesting: true`) and redacts nothing outside production (`src/common/config.ts:158-165`). `logger.error(error)` would therefore write a GAS error body straight to the log — exactly what the Non-functional section forbids. Always `logger.error(\`… ${describeError(error)}\`)`, never the error itself, and keep the "never logs the backend response body" test.
8. **`joi` is not a declared dependency** — it resolves at `18.2.1` hoisted from `@defra/hapi-auth-oidc` (`package-lock.json:2412-2425`). `src/grant-ops/routes/view-claims.route.ts:3` already relies on this. A dedupe or a bump in that transitive dep could break the build; consider adding `"joi": "18.2.1"` to `dependencies` while here.
9. **ESLint will push back on shape, not just style.** `complexity: max 4` and `func-style: expression` (`eslint.config.js:29-30`) rule out an `if`/`else if` chain for the status map and are why `toAttempts`/`isAtMaxAttempts` are separate one-liners; `import-x/no-restricted-paths` (37-67) means the route may not import the repository, so `EventsQuery` and friends must be re-exported through the use case.
10. **Counts must never be null.** The contract now requires both `attempts` and `maxAttempts` as integers ≥ 1; the FE helpers still guard against a missing value because `${null} / 5` would render literally and `null >= 5` is `false` — a silent wrong answer rather than a crash.
11. **The warning banner is the normal state today.** `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are unset in every environment, so until FGP-1227 lands every page shows `Some event sources are unavailable: CW · Inbox, CW · Outbox. Showing the rest.` That is the correct rendering, not a bug — no route or component test may assume an empty `unavailableSources`.
12. **`CW` in the banner.** The alert reuses the Source column's vocabulary (`CW · Inbox`) so an operator matches the banner to the rows. If the review prefers the word spelled out in prose, it is one entry in `serviceLabels` — but changing it there also changes the table.

---

## Contract concerns — all RESOLVED

1. **`?status=BOGUS`: FE 400 vs in-page alert — RESOLVED as (b), forward unvalidated.** The FE route accepts `cursor`, `direction`, `status`, `service` as optional plain strings, enforces none of the enums, and forwards them; GAS's `400` surfaces through the existing `unavailable` path as the page's error alert. The enum lives in one place (GAS), and an operator diagnosing an outage keeps the page they opened instead of the shared govuk error screen (`src/server/plugins/errors.ts:29-35`). Ticket amended at `:105` and `:189`. Applied in Steps 2, 3, 5 and the route tests.
2. **Badge palette — RESOLVED, accepted with the proposed re-colour.** `PUBLISHED → badge-ghost` (queued, healthy), `PROCESSING → badge-info`, `FAILED`/`RESUBMITTED → badge-warning` + ↻, `COMPLETED → badge-success`, `DEAD_LETTER → badge-error`, anything unrecognised → `badge-ghost`. Amber now means "retrying", which is what the page is scanned for. Ticket amended at `:89` and `:110`. Applied in Step 4's `statusBadges`, Step 8's `roles` map, and both test lists.
3. **Source column shows the real topic — RESOLVED, accepted.** `GAS · Outbox → cw__sns__audit_fifo`, never the word "audit"; the Behaviour table's `audit` was shorthand. Tests assert topic names.
4. **Where the badge class lives — RESOLVED, accepted.** The view model owns the *role* (`BadgeRole`), `status-badge/template.njk` owns the literal daisyUI class. Ticket now states the rule and the reason at `:89` and `:189`.
5. **Component test kit — RESOLVED, accepted.** "The existing dev-ops component kit — `test-utils.render` + cheerio; no DOM needed for markup-only components" (`FGP-1392.md:208`). No happy-dom pragma in either component test.
6. **`scopedTo` footgun — RESOLVED, noted in code.** The route deliberately declares no `options.auth`, and its docblock (Step 5) says why: `scoped-to.ts:13-18` spreads `{ auth, ...route.options }`, so a route that names its own `auth` silently loses the scope. The two 403 tests are the only thing that would catch it.

**Contract changes absorbed from Plan 02** (not concerns — decisions taken there, applied here):
- `kind` is **dropped** from the response. Removed from `Event`, from every fixture and from the audit-row assertions; the FE learns a row is an audit row only from its derived `type`. A `kind` filter is parked with the filter-controls story (`FGP-1392.md:218`).
- `fullType` is nullable (`null` for audit rows). Typed `string | null`; no column shows it.
- `status` is a plain string on the wire, so the ghost fallback is live code with a real test (`FGP-1392.md:111`, `:145`), not a defensive dead branch.
- `sourceErrors[].service` admits `"gas"`: exactly one GAS source failing is a `200` with the banner; only both GAS reads failing is a `502`. An unconfigured CW reports `message: "not configured"`. The banner text is therefore generic and built from the list — `Some event sources are unavailable: <service · box, …>. Showing the rest.` — rather than naming Caseworking unconditionally.
- `maxAttempts` arrives per row for all four sources, so a Caseworking row under a different retry cap colours correctly. No FE change beyond fixtures and the `2 / 2` test.

---

## Implementation notes

Implemented 2026-09-01 in worktree `/home/donatas/code/fg-grants-platform-admin-fgp-1392`, branch
`FGP-1392-events-page`, **based on `origin/main` @ `44e78ac`** ("FGP-1227: Add daisyUI dev-ops app with
componentised views (#8)"). The branch was first cut from `FGP-1227-operations-daisyui` (`96248be`) and then
re-based onto `origin/main` mid-implementation when the dev-ops shell was squash-merged;
`git diff 96248be 44e78ac` is empty, so every "known code fact" in this plan holds unchanged against main.
Nothing is committed — the work is left in the worktree as uncommitted/untracked changes.

Node 24.15.0 (mise, `.nvmrc` asks for v24.14.1; `engines` is `>=24`). There is no `~/.nvm` on this machine, so
the setup command's `source ~/.nvm/nvm.sh && nvm use` was replaced by the ambient mise-managed node.
`npm ci` ran clean.

### Files added

| File | Notes |
|---|---|
| `src/common/describe-error.ts` (+ `.test.ts`) | Step 1, verbatim. 3 tests. |
| `src/dev-ops/repositories/events.repository.ts` (+ `.test.ts`) | Step 2, verbatim (types and `toSearch` exactly as written; `tsc` accepts the `Object.entries(...).filter(...)` argument as-is, so no cast was needed). 8 tests. |
| `src/dev-ops/use-cases/get-events.use-case.ts` (+ `.test.ts`) | Step 3, verbatim (only prettier reflow of the import and the `logger.error` template literal). 9 tests. |
| `src/dev-ops/view-models/events-page.view-model.ts` (+ `.test.ts`) | Step 4, verbatim apart from moving `toSourceName` above `toSourceLabel` (it is a `const` arrow used by it — `func-style: expression` means the original order is a TDZ error at module load, not just a lint preference) and prettier reflow of `isAtMaxAttempts`. 46 tests. |
| `src/dev-ops/routes/view-events.route.ts` (+ `.test.ts`) | Steps 5 and 11, verbatim. 41 tests. |
| `src/dev-ops/views/events.njk` | Step 7, verbatim. |
| `src/dev-ops/views/components/status-badge/{macro,template}.njk` (+ `template.test.ts`) | Steps 8, verbatim. 12 tests. |
| `src/dev-ops/views/components/pager/{macro,template}.njk` (+ `template.test.ts`) | Step 9, verbatim. 6 tests. |
| `src/dev-ops/views/components/icon/all/arrow-path.njk` | heroicons v2 24/solid `arrow-path`, in the shape of `moon.njk`, `data-testid="do-icon-arrow-path"`. |

### Files changed

- `src/dev-ops/index.ts` — imports `viewEventsRoute` and registers it inside the existing
  `scopedTo('FCP.GrantOperationsAdmin', [viewDevOpsRoute, viewEventsRoute])` call. Nothing else touched.
- `src/dev-ops/views/index.njk` — one card action: `<a class="btn" href="/dev-ops/events">Events</a>`,
  added before the existing (unchanged) `btn btn-primary` Sign out.
- `src/dev-ops/views/components/icon/template.test.ts` — one added test,
  `renders the retry icon as an inline svg`.

Untouched as the plan required: `dev-ops.css`, `vite.config.ts`, `view-options.ts`, `layouts/page.njk`,
`components/index.ts`, `package.json`, `package-lock.json`.

### Results

| Command | Result |
|---|---|
| `npm run typecheck` | pass (0 errors) |
| `npm run lint` (`lint:js` + `lint:scss`) | pass (0 errors, 0 warnings) |
| `npm run format:check` | pass after one `npm run format` (5 new files were reflowed) |
| `npm test` | **40 files, 278 tests, all passing** (baseline on `origin/main` was 33 files / 152 tests, measured by stashing the change). 7 new suites and 126 new tests: describe-error 3, repository 8, use case 9, view model 46, route 41, status-badge 12, pager 6, plus 1 added to the icon suite. Coverage 99.43% stmts / 94.65% branch / 100% funcs. |
| `npm run build:frontend` | pass, `.public/assets/dev-ops-css-c0ycZK69.css` 58.01 kB |
| CSS grep | every literal is present exactly once in the built stylesheet: `badge-info`, `badge-warning`, `badge-error`, `badge-success`, `badge-ghost`, `badge-sm`, `table-zebra`, `table-sm`, `join`, `join-item`, `alert-warning`, `alert-error`, `text-error`, `text-primary`, `font-mono`, `font-bold`, `whitespace-nowrap`, `overflow-x-auto`, `rounded-box`, `h-3`, `w-3`. The Tailwind content-scan rule held — no class literal was assembled in TypeScript. |

### Deviations from the plan (all small, all recorded)

1. **`toSourceName` moved above `toSourceLabel`** in the view model. As printed in Step 4, `toSourceLabel` is
   declared before the `const toSourceName` it calls; because `func-style: expression` forces `const` arrows,
   that ordering throws a TDZ `ReferenceError` the first time a row is mapped. Pure reordering, no behaviour
   change.
2. **Repository test `escapes a status containing url characters`** expects
   `?status=a%26b%3Dc`, not the plan's `?status=a%26b=c`. `URLSearchParams` percent-encodes `=` inside a value
   as well as `&` (verified on node 24.15). The plan's expectation was simply mis-transcribed; the behaviour it
   was asserting — that nothing can break out of the query string — is what the test now pins, more strictly.
3. **Route test `escapes a segregation reference containing markup`** asserts
   `$('[data-testid="event-segregation-ref"]').find('script')` is empty and the cell's text is the literal
   `<script>alert(1)</script>`, rather than the plan's document-wide `$('script')` length 0.
   `layouts/page.njk:31` carries the app's own `<script type="module">`, so the document-wide assertion fails on
   a correctly-escaped page. Scoping it to the cell tests the same thing and cannot be passed by an empty page.
4. **Optional item skipped: `"joi": "18.2.1"` was not added to `dependencies`** (Risk 8 / Known-fact "Joi
   resolves hoisted from `@defra/hapi-auth-oidc`"). The plan calls it optional and it would touch
   `package.json` + `package-lock.json` beyond this story's surface; the route follows the existing precedent
   at `src/grant-ops/routes/view-claims.route.ts:3`. Worth raising separately.

### Known gaps

- Two uncovered branches in `events-page.view-model.ts:96` — the `serviceLabels[service] ?? service` and
  `boxLabels[box] ?? box` fallbacks for a service or box outside the wire unions. Unreachable through the
  typed API without a cast, not in the plan's test list, and there is no coverage threshold configured; left
  as-is deliberately.
- No manual/local walkthrough was possible: `GET /grant-admin/events` (Plan 02) does not exist yet, so
  everything here is built against the documented JSON shape with fixtures and a mocked repository. Risk 6
  (the 3 s shared `wreck` timeout turning a *partial* GAS page into a whole-page `unavailable`) is therefore
  still untested against a real backend.
- Risk 5 stands unaddressed by design: `<main>` is still `max-w-4xl`, so the six columns scroll horizontally
  inside `[data-testid="events-scroller"]` on desktop too. Widening means editing a file owned by the
  dev-ops shell, which the plan says not to do silently.

### Follow-up: test plan and gap closure

A cross-referenced test plan now lives beside this one at
`tickets/FGP-1392/04-admin-fe-events-page.test-plan.md` — scope under test, 122 rows derived from the
ticket's ACs and this plan's steps/risks (each naming a real `file :: test name`), a
"Not covered here — needs the backend" section (N-1..N-8) with manual steps for once Plan 02 is deployed,
and a run record. Pre-existing tests it relies on rather than repeating are cited explicitly:
`scoped-to.test.ts` (all three), `gas.test.ts`, `wreck.test.ts`, `errors.test.ts :: renders the "Bad Request"
page`, `view-dev-ops.route.test.ts`, and the dev-ops component kit's own `heading` / `icon` tests.

Every gap the first pass reported is now closed by a real test:

- **The two defensive branches at `events-page.view-model.ts:96`** (`serviceLabels[service] ?? service`,
  `boxLabels[box] ?? box`) — three tests in `events-page.view-model.test.ts`:
  `names a service it has no label for by the name the endpoint used`,
  `names a box it has no label for by the name the endpoint used`, and
  `names an unavailable source it has no label for as the endpoint named it`. Casts through
  `as unknown as EventService`/`EventBox` because the wire types name only the four sources we know.
- **Escaping for every user-influenced cell** — `view-events.route.test.ts` gains
  `escapes an event id containing markup`, `escapes a type containing markup`,
  `escapes a target containing markup`, `escapes a source containing markup`,
  `escapes a status containing markup`, `escapes an unavailable source name containing markup`, and
  `never renders a script the endpoint sent, anywhere on the page` (every field hostile at once; the page must
  carry exactly one `<script>`, the layout's own module tag). `events-page.view-model.test.ts` adds
  `leaves markup in an unavailable source name for the template to escape`, pinning that escaping stays
  nunjucks' job rather than migrating into the model.
  `sourceErrors[].message` is never rendered at all — the banner is built from `service`/`box` only — and the
  all-hostile test passes a hostile `message` to prove it reaches no markup.

Two shaping notes from writing them. The escaping tests share an `escapingOf($, testId)` helper that returns
**facts** (`{ cells, scripts, text }`) rather than asserting inside itself, because `vitest/expect-expect`
counts assertions lexically and a helper that owns the `expect` fails the lint. And the earlier
document-wide `$('script')` assertion could not simply be repeated per field: `layouts/page.njk:31` carries
the app's own module script, so the per-cell assertions scope to the cell and only SEC-8 counts scripts
document-wide, expecting exactly one.

**Re-run after the additions** (same worktree, node 24.15.0):

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings (after reshaping the helper for `vitest/expect-expect`) |
| `npm run format:check` | pass, after one `npm run format` |
| `npm test` | **40 files, 289 tests, all passing** (was 278; +11). Coverage 99.43% stmts / **96.18%** branch (was 94.65%) / 100% funcs / 99.41% lines |
| scoped coverage of this story's code | **100% statements, 100% branches (44/44), 100% functions, 100% lines** across `src/dev-ops/**` + `describe-error.ts` |
| `npm run build:frontend` | pass, `dev-ops-css-c0ycZK69.css` 58.01 kB; the 30-class grep finds every literal, `badge-info` included |

The only branch still uncovered repo-wide outside pre-existing `main.ts`/`config.ts` is
`src/grant-ops/view-models/claims-page.view-model.ts:115` (`banner.summary ?? {}`), which predates this work
and belongs to the claims page.

No commits, no pushes; changes remain in the worktree. Nothing outside it was touched except the two files in
`tickets/FGP-1392/`.

---

## Design rework (Claude Design handoff)

The page shipped above was reworked to match the Claude Design handoff
(`devops-event-monitoring-dashboard/project/Event Stream.dc.html`, an HTML prototype with an inline logic
script carrying the exact styles, copy, formats and per-row derivations). The prototype's structure and its
`sc-if`/`sc-for` machinery were **not** copied — only the visual output was recreated, on daisyUI 5.7.20
utility/component classes wherever an equivalent exists, with three rules of custom CSS where none does.

### Product decisions applied (these override the prototype where they conflict)

1. **Route column = the Compact variant only.** Line 1 is the human hop in full names
   (`GAS → Caseworking`), line 2 the small mono provenance (`outbox · via cw__sns__update_status_fifo`, or
   `inbox`). The prototype's other three variants (Lane, From/To, Text) and their toggle are not built.
   Derivation follows the prototype's `route(e)`, with one departure: an outbox target matching no prefix is
   named **as the endpoint wrote it** rather than flattened to `unknown` — flattening would hide the one
   string a developer would grep for. `unknown` is kept for the case with no target at all, and for an inbox
   row naming no producer.
2. **Shell unchanged.** No sidebar, no review-scope/state toggles, no avatar — canvas exploration controls.
   `layouts/page.njk` is untouched, so `<main>` is still `max-w-4xl` (see Deviations).
3. **No client-side JavaScript.** Event ids are plain mono text in the base content colour — no copy
   affordance, no toast, no `text-primary` (R12). Relative timestamps carry their absolute value in the
   native `title` attribute alone.
4. **No header source chips and no "sources n of 4" badge.** The existing alert-only behaviour stays. The
   follow-ups view (count cards, tabs, status select, Inspect/Retry) is not built.

### What changed

| File | Change |
|---|---|
| `src/dev-ops/view-models/events-page.view-model.ts` | `EventRow` reshaped: `source` → `routeHeadline` + `routeDetail`; `createdAt`/`lastFailureAt` become **relative** strings with `createdAtTitle`/`lastFailureAtTitle` beside them; `isCompleted` and `isDeadLetter` added for the two row treatments. New `subtitle` on the page model. `toEventsPage` takes an optional third argument, `now`, so the relative times a test asserts are the times it set up. |
| `src/dev-ops/views/events.njk` | Rebuilt: in-page header (h1 + subtitle), warning alert then error alert with the prototype's inline SVGs, table inside a `rounded-box` / `border-base-300` / `bg-base-100` card with `overflow-hidden`, inner `overflow-x-auto`, `table table-sm min-w-[66rem]`, column widths per the prototype's `<th>`s, empty state inside the card, lag note beneath it. |
| `src/dev-ops/views/components/status-badge/template.njk` | Mono, uppercase, 10.5px; the retry marker is now a trailing `↻` glyph rather than an inline icon (an svg does not sit on a 10.5px mono line without a fight). |
| `src/dev-ops/views/components/pager/template.njk` | Moved inside the card: top hairline, `btn btn-sm btn-ghost`, `← Previous` left and `Next →` held hard right by `ml-auto`. Hrefs, cursors, `rel` and testids unchanged. |
| `src/dev-ops/views/components/icon/all/exclamation-triangle.njk`, `…/exclamation-circle.njk` | New; the prototype's own stroked 24-grid alert icons, so the pair reads as one set. |
| `src/dev-ops/views/components/icon/all/arrow-path.njk` | **Deleted** — the glyph replaced its only caller. |
| `src/dev-ops/client/dev-ops.css` | Three rules Tailwind has no utility for: `.do-event-row-completed > td { opacity: .55 }` (on the cells, so a row treatment never fights a background), `.do-event-row-dead-letter` tinted `color-mix(in oklab, var(--color-error), transparent 95%)`, and `.do-timestamp` (1px dotted underline + `cursor: help`). |

Column order is now **Event ID / Type · Status · Route · Created At · Attempts · Last Failure**. The identity
cell reads event id (mono 12px), short type (13px semibold), then `segregationRef` (11px muted) — shown on
**every** row that has one, not only failing ones, because Ctrl+F is this page's only search (M2). The DLQ
chip is gone (R5): the badge plus the row tint carry it. Attempts are right-aligned mono, error and bold at
the maximum, otherwise `text-base-content/75`. Created At and Last Failure are relative
(`45s ago` / `22m ago` / `3h 12m ago` / `2d ago`, per the prototype's `rel()`, computed server-side at render
time), dotted-underlined, with `title` = ISO UTC + `   ·   ` + the Europe/London absolute the page used to
show. Last Failure is `text-error` when present and a plain, un-underlined `-` when not. The subtitle states
the active filter (`Filtered: status DEAD_LETTER, service gas.`) or says there is none.

### Test deltas — 289 → **340** (+51), all passing

| File | Before | After | What moved |
|---|---|---|---|
| `events-page.view-model.test.ts` | 50 | 71 | +21. All four `rel()` thresholds plus both boundaries (59s/60s), a day count dropping its spare hours, a future-skewed clock clamping to `0s ago`; both title formats in BST and GMT; the `No failure recorded` title; route derivation for outbox `cw__`/`gas__`/`internal`/`audit`/unrecognised/absent targets and inbox `GAS`/`CW`/`AS`/absent sources, plus an unknown service and an unknown box; `isCompleted`/`isDeadLetter`; four subtitle variants including "a cursor is not a filter"; the default-clock fallback. Removed: the absolute-format tests the relative column replaces, and the `isDeadLetter` → DLQ-chip tests. |
| `view-events.route.test.ts` | 48 | 72 | +24. New column order and a six-column shape assertion; relative time and both `title`s in the markup; `do-timestamp` present on a real time and absent on `-`; route headline/detail for outbox and inbox; row-treatment classes; segregationRef on a healthy row and absent when null; id is plain text (no `text-primary`, no handler, not a link); no DLQ chip; retry glyph rather than icon; card framing, pager inside the card with its new copy, no placeholder span for a missing direction; empty state inside the card and no card at all when unreadable; alert icons; subtitle variants; no script and no inline handler; source health reported by the alert alone. |
| `status-badge/template.test.ts` | 12 | 13 | +1. Class assertions gain the mono/uppercase/10.5px treatment; the two icon tests become glyph tests, plus one pinning that the badge carries no svg. |
| `pager/template.test.ts` | 6 | 10 | +4. Link copy, both button class strings, the top hairline, and Next held right with no Previous. |
| `icon/template.test.ts` | 5 | 6 | +1. The `arrow-path` test is replaced by one per new alert icon. |

`events-page.view-model.ts` is back to **100% statements / branches / functions / lines** (the `?? ''` guard
in the timestamp helper became unreachable once a null failure short-circuits to a fixed value, so it was
removed rather than left uncovered).

### Run results (same worktree, node 24, `FGP-1392-events-page`)

| Command | Result |
|---|---|
| `npm run typecheck` | pass, 0 errors |
| `npm run lint` | pass, 0 errors, 0 warnings. Two `complexity > 4` errors on the first cut of the route derivation were fixed by splitting it into `toNamedTarget` / `toDestination` / `toInboxRoute` / `toOutboxRoute`. |
| `npm run format:check` | pass, after one `npm run format` |
| `npm test` | **40 files, 340 tests, all passing.** Coverage 99.49% stmts / 96.2% branch / 100% funcs / 99.46% lines; the only branch left uncovered outside pre-existing `main.ts`/`config.ts` is `grant-ops/view-models/claims-page.view-model.ts:115`, which predates this work. |
| `npm run build:frontend` | pass, `dev-ops-css-COVRiiyv.css` 61.84 kB (was 58.01 kB). All **71** class literals the page relies on were grepped out of the emitted stylesheet — every `badge-*`, `alert-*`, `btn-*`, the arbitrary sizes (`text-[10.5px]`, `text-[12.5px]`, `leading-[1.45]`, `min-w-[66rem]`), the four `text-base-content/n` opacities, and the three custom `do-*` rules. None missing. |
| dev server | Restarted from the worktree (`AWS_EMF_ENVIRONMENT=Local node --env-file=…/run/fe.env ./src/main.ts`, pid recorded in `run/fe.pid`). `/health` → 200; `/dev-ops/events` → 302 to `/auth/login` as expected for an anonymous request; the Vite-served `dev-ops.css` carries the three custom rules and `badge-info`. GAS at :3102 answers 200. |

### Deviations from the prototype, and why

- **`<main>` is still `max-w-4xl`**, so the 66rem table scrolls inside its card even on a wide screen. The
  prototype is a full-width 1440px canvas, but widening means editing `layouts/page.njk`, which the shell
  decision above (and Risk 5 in the first pass) says not to do silently. It is a one-line change whenever
  someone wants it.
- **No cursor label in the pager.** The prototype prints a truncated base64 `cursor=…` between the two
  links; it is debug affordance on a canvas, and printing a keyset position at operators is noise.
- **`table-zebra` dropped**, matching the prototype: the two row treatments (dimmed COMPLETED, tinted
  DEAD_LETTER) are the only banding the design wants, and zebra fights the tint.
- **The subtitle keeps its lead sentence when a filter is on** — "Inbox and outbox messages across GAS and
  Caseworking. Filtered: status DEAD_LETTER, service gas." — rather than replacing the whole line with the
  filter clause. The clause reads verbatim as specified; the lead is what tells a cold reader what the page
  is.
- **An unrecognised outbox target is named, not flattened**, as noted under decision 1.

No commits, no pushes. Nothing outside the worktree was touched except this file.

**Post-rework correction (2026-09-02):** the Route label for inbox source `AS` is `Agreements`, not the prototype's `Application Svc` — `AS` is `messageSource.AgreementService` in fg-gas-backend (`save-inbox-message.use-case.js:10`). View model + tests updated.

---

## Addendum (2026-09-02): per-row trace link into the CDP logs explorer

Each row that carries a `traceId` now shows a fourth line in the Event ID / Type cell — a small muted
monospace link that opens the OpenSearch (CDP logs) Discover view **in a new tab**, pre-filtered to that
trace. A row with no trace id renders nothing at all there, not even a dash.

- **Config.** `logs.explorerBaseUrl` (`LOGS_EXPLORER_BASE_URL`, `format: String`, `default: ''`). Empty is
  the off switch: no base url, no links anywhere on the page. Set for the local runtime in
  `run/fe.env` only — no repo `.env` was touched.
- **URL, built in the view model** (`events-page.view-model.ts`, `toTraceHref`/`buildTraceHref`). Fixed
  rison blob lifted from a working Discover query, with three dynamic parts: the saved search
  (`fg-gas-backend-app` for `service: gas`, `fg-cw-backend-app` for `caseworking`, used both as the
  `/#/view/<id>` segment and the `savedSearch:` key), a ±6h window around the row's `createdAt` written as
  ISO strings with raw colons inside rison single quotes, and the trace id inside the kuery
  `query:'trace.id:%22<id>%22'` — `%22` is a literal, because the kuery's double quotes have to survive as
  url-encoded characters inside the single-quoted rison string. The `indexPattern` id is the one from the
  GAS example; it may well differ for the CW saved search, but the saved search is what OpenSearch
  resolves and it carries its own pattern (noted in a code comment).
- **Escaping.** `toRisonString` escapes rison's two syntax characters first (`!` → `!!`, `'` → `!'`) and
  then `encodeURIComponent`s the result — which leaves `!` and `'` alone, so the escapes survive. A hostile
  trace id can therefore neither close the rison string nor break out of the href; nunjucks' autoescaping
  handles the attribute itself.
- **Row model.** `traceHref: string | null`, plus `traceId` (full, for the link's `title`) and
  `traceIdShort` (first 12 characters, what the link shows). `Event` in
  `repositories/events.repository.ts` gains `traceId: string | null`. The route is unchanged.
- **Template.** `<a href target="_blank" rel="noopener noreferrer" title="{{ row.traceId }}"
  class="link link-hover font-mono text-[10.5px] text-base-content/55">trace: … ↗</a>`, guarded by
  `{% if row.traceHref %}`. Still no client-side JS on this page.
- **Tests.** 14 view-model cases (exact url for GAS, CW saved search, `%22` quoting, ±6h window including
  across a date boundary, null trace id, unset/blank base url, unparseable `createdAt`, bare CDP id,
  url-encoding of a hostile id, rison `'` and `!` escaping, short/full id) and 8 route/template cases
  (`target`/`rel`/href, short text with full title, nothing rendered when null, nothing when unconfigured,
  CW saved search, one link per row that has an id, breakout attempt, markup escaping).
- **Verification.** `npm run typecheck`, `npm run lint`, `npm run format` all clean;
  `npm test` **40 files / 363 tests green** (was 340); `npm run build:frontend` emits `.link` and
  `.link-hover` into `dev-ops-css` (63.52 kB, was 61.84 kB). One `complexity > 4` lint error on the first
  cut of `toTraceHref` was fixed by splitting the window construction out of the href construction.
- **Chain check.** All three services restarted from their worktrees; `/health` 200 on 3199 (CW), 3102
  (GAS), 3103 (FE). `GET /grant-admin/events` returns `traceId` on every row with `sourceErrors: []`.
  The unfiltered first page happened to be 20 recent GAS-inbox `DEAD_LETTER` rows from an e2e run, none of
  which carry a traceparent, so **0/20 non-null there**; `?status=COMPLETED` gives 3/20 and
  `?service=caseworking` gives 2/20, with real bare-32-hex CDP ids (e.g.
  `f3c0efede381e3158e8a2048d4aa5eef`). Across the dev dump, 22139/34414 GAS inbox, 66595/100333 GAS outbox,
  6801/9007 CW inbox and 8590/99436 CW outbox documents carry a traceparent.

**Trace-link revision (2026-09-02):** the Discover link is now cross-service — plain Discover on the shared index pattern (no per-service saved search, no container filter), columns `container_name,message,log.level,trace.id`, so one click shows the full journey of a trace across GAS/CW/anything else. `savedSearches` map removed from the view model.
