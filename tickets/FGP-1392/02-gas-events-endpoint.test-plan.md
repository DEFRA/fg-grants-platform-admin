# Plan 02 — test plan for GAS `GET /grant-admin/events`

Repo under test: `fg-gas-backend`, worktree `/home/donatas/code/fg-gas-backend-fgp-1392`, branch `FGP-1392-gas`.
Companion to `02-gas-events-endpoint.md`. Derived from FGP-1392's acceptance criteria (Content, Pagination,
Failure states, Layout & scope), the plan's Steps 1-8 and its Risks 1-12.

## Scope under test

**In scope**

- `GET /grant-admin/events` end to end: query schema → route → use case → four-source fan-out →
  normalisers → merge → composite cursor → response schema.
- The composite cursor contract (`{ v: 1, gasInbox, gasOutbox, cwInbox, cwOutbox }`) and the per-source
  slice wire form shared with Plans 01 and 03.
- The CW actuator client (`cw-actuators.repository.js`): URL, bearer token, query string, envelope,
  failure vocabulary, and the guarantee that no CW response body reaches a log or a payload.
- Failure policy: one source down → `200` + `sourceErrors`; both GAS down → `502`; CW unconfigured →
  `"not configured"`; undecodable cursor → `400`.
- The payload rules: no `event`, `event.data`, `claimedBy`, `entityid`, `audit.details`, full ARN, or
  business identifier anywhere in the response.

**Out of scope here**

- Plan 01's `paginate`, `findPage` and the index migration — cited below, not re-tested.
- Plan 03's CW actuator implementation — stubbed at the HTTP boundary against its documented contract.
- The frontend page (`fg-grants-platform-admin`, Plan 04) — Europe/London formatting, badges, pager
  markup, `FCP.GrantOperationsAdmin` scoping.

## Existing coverage relied on (not duplicated)

| Area | Existing test | Note |
|---|---|---|
| Keyset paging, cursor codecs, `hasNextPage`/`hasPreviousPage`, no `countDocuments` | `src/common/paginate.test.js` (21 tests, Plan 01) | Plan 02 layers a composite cursor on top of these semantics |
| `inbox.findPage` projection, sort, filter, codecs | `src/grants/repositories/inbox.repository.test.js :: describe("findPage")` (Plan 01) | Proves `event`/`claimedBy`/`publicationDate` are never projected |
| `outbox.findPage` projection, sort, filter, codecs | `src/grants/repositories/outbox.repository.test.js :: describe("findPage")` (Plan 01) | Proves only `event.id`, `event.type`, `event.audit.entities.{entity,action}` are projected |
| Real-Mongo forward/backward paging, no dup/skip, tampered cursor → 400, hidden fields | `test/grants/event-pagination.test.js` (9 tests, Plan 01) | Per-source; Plan 02 adds the merged equivalents |
| `/grant-admin` plugin registration | `src/grant-admin/index.test.js` | Extended, not replaced |
| Default `service` auth strategy and 401 for a bad bearer | `src/auth/auth.js` + existing `/grant-admin` integration tests | Re-asserted once for this route |

## Test cases

Level: **U** = unit (`npm run test:unit`, `vitest --dir src`), **I** = integration (`npm run test:integration`,
real Mongo + containerised GAS + CW HTTP stub).
Status: **existing-before** = already covered by Plan 01 / repo tests; **added** = written by this work; **GAP** = not covered here (see the Gaps section).

### Content (ticket AC → Content)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| C1 | No filters = All: rows from both GAS boxes, every status, newest first | I | `test/grant-admin/find-events.test.js :: returns every seeded row newest first with no filter` | added |
| C2 | No filters = All: every (poller-stable) status is listed, nothing hidden | I | `find-events.test.js :: returns rows of every stable status when no filter is given` | added |
| C3 | Rows from all four sources merge newest first | I | `find-events.test.js :: merges Caseworking rows with GAS rows newest first` | added |
| C4 | Four-source merge and 20-row take | U | `merge-event-pages.test.js :: orders rows from four sources newest first` / `takes exactly 20 when 80 rows are offered` | added |
| C5 | Tie-break `(createdAt desc, service, box, _id desc)` | U | `merge-event-pages.test.js :: breaks a createdAt tie on service, then box, then _id descending` | added |
| C6 | Outbox CloudEvent: `eventId = event.id`, namespace-stripped `type`, raw `fullType` | U | `map-event-row.test.js :: maps a GAS outbox CloudEvent row: …` | added |
| C7 | Inbox row: `eventId = messageId`, `source` kept, `target` null | U | `map-event-row.test.js :: maps a GAS inbox row: …` | added |
| C8 | Audit outbox row → `audit · APPLICATION.SUBMIT_APPLICATION`, `fullType` null, `_id` as `eventId` | U + I | `map-event-row.test.js :: derives audit · APPLICATION.SUBMIT_APPLICATION …` ; `find-events.test.js :: returns the audit outbox row with an audit type, a null fullType and its _id as eventId` | added |
| C9 | CW audit row recognised structurally from `auditEntities` alone (no audit ARN in config) | U + I | `map-event-row.test.js :: derives the same for a CW audit row from auditEntities alone …` ; `find-events.test.js :: derives an audit type from the auditEntities a Caseworking row carries` | added |
| C10 | Audit row with an empty `entities` array → type `-`, still listed | U | `map-event-row.test.js :: returns type - for an audit row with an empty entities array …` | added |
| C11 | Outbox row with no type and no audit entities → type `-` | U | `map-event-row.test.js :: returns type - for an outbox row with no type and no audit entities` | added |
| C12 | Legacy `io.onsite.*` types shown whole | U + I | `map-event-row.test.js :: keeps a legacy io.onsite.agreement.status.updated type whole …` / `… create-payment …` ; `find-events.test.js :: reduces internal:message-bus to internal and keeps a legacy io.onsite type whole` | added |
| C13 | SNS ARN reduced to topic name; `internal:message-bus` → `internal` | U + I | `map-event-row.test.js :: reduces a .fifo SNS ARN to its topic name …` / `… internal:message-bus to internal, not message-bus` ; `find-events.test.js :: reduces internal:message-bus to internal …` | added |
| C14 | `createdAt` falls back to the `_id` timestamp when `eventTime` is null | U + I | `map-event-row.test.js :: falls back to the _id timestamp when eventTime is null` ; `find-events.test.js :: falls back to the _id timestamp for an inbox row with no eventTime` | added |
| C15 | `createdAt` falls back when `publicationDate` is unparsable; `order` stays null | U | `map-event-row.test.js :: falls back to the _id timestamp when publicationDate is an unparsable string` / `keeps order null while createdAt shows the _id fallback` | added |
| C16 | `attempts`/`maxAttempts`: GAS from config, CW per row | U + I | `map-event-row.test.js :: uses GAS config for GAS maxAttempts and CW's per-row maxAttempts …` ; `find-events.use-case.test.js :: sets maxAttempts from inboxMaxRetries …` ; `find-events.test.js :: reports GAS maxAttempts from the service's own retry configuration` | added |
| C17 | `lastFailureAt` null on a FAILED row with no `lastResubmissionDate` | U | `map-event-row.test.js :: returns null lastFailureAt for a FAILED row with no lastResubmissionDate` | added |
| C18 | A status outside the six documented values is passed through, never a 500 | U + I | `find-events-response.schema.test.js :: accepts a status outside the six documented values` ; `find-events.route.test.js :: responds 200 for a row whose status is outside the six documented values` ; `find-events.test.js :: returns a row with an unrecognised status rather than failing the page` | added |
| C19 | `segregationRef` returned as stored | U + I | `map-event-row.test.js :: maps a GAS outbox CloudEvent row …` (full-row `toEqual`) ; asserted implicitly by the schema check in `find-events.test.js :: validates the merged payload …` | added |
| C20 | `?status=DEAD_LETTER` filters every source | U + I | `find-events.use-case.test.js :: passes status to all four sources` ; `find-events.test.js :: ?status=DEAD_LETTER returns only dead-lettered rows from both boxes` / `calls both actuators with the bearer token, pageSize 20, direction and the status filter` | added |
| C21 | `?service=gas` lists only GAS rows and never calls Caseworking | U + I | `find-events.use-case.test.js :: with service=gas queries only the two GAS sources …` ; `find-events.test.js :: ?service=gas makes no Caseworking call at all` (asserts the stub saw zero requests) | added |
| C22 | `?service=caseworking` lists only Caseworking rows | U + I | `find-events.use-case.test.js :: with service=caseworking queries only the two CW sources` ; `find-events.test.js :: ?service=caseworking returns only Caseworking rows` | added |
| C23 | `?status=BOGUS` / `?service=other` / `?direction=sideways` / unknown param → 400 | U + I | `find-events-query.schema.test.js` (4 cases) ; `find-events.route.test.js :: responds 400 for …` (4 cases) ; `find-events.test.js :: ?status=BOGUS responds 400` / `?service=other responds 400` | added |

### Pagination (ticket AC → Pagination)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| P1 | Per-source keyset paging, forward and backward | U + I | `src/common/paginate.test.js` ; `test/grants/event-pagination.test.js` | existing-before |
| P2 | >20 rows → exactly 20 and `hasNextPage` | U + I | `merge-event-pages.test.js :: takes exactly 20 when 80 rows are offered` ; `find-events.test.js :: returns exactly 20 rows and hasNextPage when 25 are seeded` | added |
| P3 | Next then Previous returns the previous page's rows in the same order | I | `find-events.test.js :: Next then Previous returns the first page's rows in the same order` | added |
| P4 | Backward takes the 20 closest to the cursor and reverses to DESC | U | `merge-event-pages.test.js :: backward takes the 20 closest to the cursor and returns them newest first` | added |
| P5 | A row inserted between requests is neither duplicated nor skipped | I | `find-events.test.js :: a row inserted between two requests is neither duplicated nor skipped` | added |
| P6 | `startCursor` = newest row taken per source, `endCursor` = oldest | U | `merge-event-pages.test.js :: startCursor slice is the newest row taken from each source` / `endCursor slice is the oldest row taken from each source` / `backward slices point at the newest and oldest rows actually taken` | added |
| P7 | A source contributing no rows (outranked or filtered) keeps its incoming slice | U | `merge-event-pages.test.js :: a source that contributed no rows keeps its incoming slice in both cursors` | added |
| P8 | A failed source keeps its incoming slice (recovers mid-navigation) | U | `merge-event-pages.test.js :: a source absent from pages (failed) keeps its incoming slice` | added |
| P9 | Three sources exhausted, one with more → `hasNextPage` stays true and only that slice advances | U | `merge-event-pages.test.js :: three exhausted sources and one with more rows keeps hasNextPage true …` | added |
| P10 | `hasNextPage` from untaken rows **or** a source's own look-ahead; false when exhausted | U | `merge-event-pages.test.js` (3 `hasNextPage` cases) | added |
| P11 | First page has no Previous; a cursored forward page has one; backward always reports a Next | U | `merge-event-pages.test.js :: hasPreviousPage forward is false without an incoming cursor and true with one` / `backward reports hasNextPage true and derives hasPreviousPage from remaining rows` | added |
| P12 | Composite cursor round-trips; absent cursor = four null slices | U | `event-cursor.test.js :: round-trips a full composite cursor …` / `decodes an absent cursor to four null slices` | added |
| P13 | Per-source slice wire form (`{ eventTime, _id }` / `{ publicationDate, _id }`), null value kept as `null` | U | `event-cursor.test.js` (3 encode cases) | added |
| P14 | The cursor value is the verbatim stored sort key, never re-canonicalised (Risk 4) | U | `event-cursor.test.js :: passes a non-canonical ISO string through verbatim` ; `map-event-row.test.js :: uses the raw stored eventTime string as the cursor value without canonicalising it` | added |
| P15 | The per-source slice GAS mints is what that source's `paginate` receives on the next page | I | `find-events.test.js :: forwards the Caseworking slice of the composite cursor on the next page` (decodes the cursor the stub received) | added |
| P16 | Tampered cursor → `400 Cannot decode cursor` | U + I | `event-cursor.test.js` (6 rejection cases) ; `find-events.use-case.test.js :: throws Boom 400 for a tampered cursor before any source is queried` ; `find-events.route.test.js` ; `find-events.test.js :: a tampered cursor responds 400 Cannot decode cursor` | added |
| P17 | Unknown cursor `v` → `400 Cannot decode cursor` | U + I | `event-cursor.test.js :: rejects a cursor whose v is 2` / `rejects a cursor with no v` ; `find-events.test.js :: a cursor with an unknown version responds 400 Cannot decode cursor` | added |
| P18 | A tampered *slice* is rejected before any source is queried, not swallowed into `sourceErrors` | U | `event-cursor.test.js` (slice validation cases) ; `find-events.use-case.test.js :: throws Boom 400 … (asserts no repository was called)` | added |
| P19 | Empty page → null cursors, no pager flags | U + I | `merge-event-pages.test.js :: an empty page returns null cursors and hasNextPage false (forward)` ; `find-events.route.test.js` ; `find-events.test.js :: an empty database returns an empty page with null cursors` | added |
| P20 | GAS paging keeps working while Caseworking is down / unconfigured | I | `find-events.test.js :: still pages GAS rows while Caseworking is unavailable` ; `find-events-unconfigured.test.js :: still pages GAS rows while Caseworking is unconfigured` | added |

### Failure states (ticket AC → Failure states)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| F1 | CW unreachable (connection refused) → 200 + `sourceErrors` | U + I | `cw-actuators.repository.test.js :: describeError maps a transport error arriving as a Boom 502 …` ; `find-events.test.js :: a Caseworking connection failure returns GAS rows with a sourceError` | added |
| F2 | CW timeout → 200 + `sourceErrors` `"timeout"` | U + I | `cw-actuators.repository.test.js :: describeError maps a 504 …` / `… a 408 …` ; `find-events.test.js :: a Caseworking timeout returns GAS rows with a timeout sourceError` | added |
| F3 | CW `401` → treated as unavailable, response body not logged and not returned | U + I | `find-events.use-case.test.js :: never logs the CW error object` ; `cw-actuators.repository.test.js :: describeError never returns anything drawn from error.data.payload` ; `find-events.test.js :: a Caseworking 401 returns GAS rows with a sourceError and no response body anywhere` | added |
| F4 | CW `5xx` → 200 + `sourceErrors`, body not leaked | I | `find-events.test.js :: a Caseworking 500 returns GAS rows with a sourceError` | added |
| F5 | CW not configured → 200, two `"not configured"` entries, no HTTP call attempted | U + I | `find-events.use-case.test.js :: reports two not configured sourceErrors and makes no HTTP call …` ; `cw-actuators.repository.test.js :: isCwConfigured is false when the url/token is unset` ; `find-events-unconfigured.test.js :: returns GAS rows with two not configured sourceErrors and makes no HTTP call` (asserts the live stub received nothing) | added |
| F6 | `service=gas` + unconfigured CW → no CW `sourceErrors` at all | U + I | `find-events.use-case.test.js :: reports no CW sourceError when service=gas and the CW backend is unconfigured` ; `find-events-unconfigured.test.js :: reports no Caseworking sourceError when service=gas` | added |
| F7 | Exactly one GAS source failing → 200 with the other three sources' rows + a `gas` `sourceError` | U | `find-events.use-case.test.js :: returns 200 with a gas outbox sourceError when only the GAS outbox read rejects …` | added |
| F8 | Both GAS reads failing → `502` | U | `find-events.use-case.test.js :: throws Boom 502 when both GAS reads reject` ; `find-events.route.test.js :: responds 502 when the use case throws Boom.badGateway` | added |
| F9 | `sourceErrors` ordered gasInbox, gasOutbox, cwInbox, cwOutbox | U | `find-events.use-case.test.js :: orders sourceErrors gasInbox, gasOutbox, cwInbox, cwOutbox` | added |
| F10 | GAS failures logged with the error object, CW failures as a one-liner only (asymmetric logging) | U | `find-events.use-case.test.js :: never logs the CW error object` (+ `logger.error` asserted on the GAS path) | added |
| F11 | The CW client propagates its rejection rather than catching (failure policy lives in the use case) | U | `cw-actuators.repository.test.js :: propagates the wreck rejection unchanged` | added |

### Access, payload rules, contract (ticket AC → Access, Layout & scope; Data/interfaces)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| A1 | No/invalid service bearer token → `401` | I | `find-events.test.js :: responds 401 without a service bearer token` | added |
| A2 | Response carries no `event`, `event.data`, `claimedBy`, `entityid`, `details`, full ARN or payload identifier | U + I | `map-event-row.test.js :: never reads entityid or details from an audit entity` / `never emits event, event.data, claimedBy or kind even when present on the input` / `reduces a .fifo SNS ARN … and never emits a full ARN` ; `find-events.test.js :: returns no event, claimedBy, entityid, kind or full ARN anywhere in the payload` | added |
| A3 | Response schema rejects an unexpected key (`event`, `kind`) and a non-ISO `createdAt` | U | `find-events-response.schema.test.js` (4 rejection cases) | added |
| A4 | `response.schema` is enforced — an extra key is a 500, not a warning | U | `find-events.route.test.js :: responds 500 when the use case returns a row carrying an extra key` | added |
| A5 | A real merged page (GAS + CW, domain + audit + null-`eventTime` rows) validates against the published schema | I | `find-events.test.js :: validates the merged payload against the published response schema` | added |
| A6 | A mapped row satisfies the response schema (catches mapper/schema drift) | U | `map-event-row.test.js :: produces a row that satisfies the response schema` | added |
| A7 | `status` is a free string on the response, an enum on the query (Decision 6/9) | U | `find-events-response.schema.test.js :: accepts a status outside the six documented values` ; `find-events-query.schema.test.js :: rejects status=BOGUS` | added |
| A8 | Route registered on the plugin and on the default `service` strategy, `tags: ["api"]` | U + I | `src/grant-admin/index.test.js :: registers the admin events endpoint` ; `find-events.test.js :: swagger > documents GET /grant-admin/events with its response schema` | added |
| A9 | Route appears in swagger with the `FindEventsResponse` definition | I | `find-events.test.js :: swagger > documents GET /grant-admin/events with its response schema` | added |
| A10 | CW client: URL, `/actuators/{box}`, bearer token, `pageSize`, `direction`, optional `cursor`/`status` | U + I | `cw-actuators.repository.test.js` (5 request cases) ; `find-events.test.js :: calls both actuators with the bearer token, pageSize 20, direction and the status filter` | added |
| A11 | CW envelope tolerated with no `totalCount` and with missing `data`/`pagination` | U | `cw-actuators.repository.test.js :: tolerates an envelope with no totalCount` / `returns empty data when the envelope has none` / `… when there is no payload at all` | added |
| A12 | Two wire shapes, one derivation — a CW row is never read as if it were a Mongo document (Risk 11) | U | `map-event-row.test.js :: maps a CW inbox wire row …` / `maps a CW outbox wire row …` | added |
| A13 | Each source is asked for `pageSize: 20` (the `+1` look-ahead is `paginate`'s job) | U + I | `find-events.use-case.test.js :: with no filters queries all four sources with a null cursor and pageSize 20` ; `find-events.test.js :: calls both actuators with … pageSize 20 …` | added |

## Integration tests

All integration tests run under `test/vitest.config.js`: docker compose brings up Mongo (27018), floci
(4567) and a built GAS container (3001); `test/setup.js` also starts the **CW actuator stub** on the host
(4599) and boots GAS with `CW_BACKEND_URL=http://host.docker.internal:4599` and
`CW_BACKEND_TOKEN=cw-stub-token`. `test/cleanup.js` truncates `inbox`/`outbox` before every test.

### `test/helpers/cw-stub.js` (new harness)

An in-process HTTP server standing in for `fg-cw-backend`'s `GET /actuators/inbox|outbox` (Plan 03).
It runs in the vitest global-setup process; tests drive it from the worker process over control endpoints:

- `POST /__reset` — back to two empty pages, request log cleared (called in `beforeEach`).
- `PUT /__control` — set per-box `mode` (`ok` | `unauthorized` | `error` | `down` | `timeout`), `data`, `pagination`.
- `GET /__requests` — every actuator request seen: box, path, query string, `authorization` header.
- `/actuators/{box}` — checks the bearer token, then answers per the box's mode. `down` destroys the
  socket (GAS sees a transport error); `timeout` never answers (GAS gives up on its own client timeout,
  shortened to 3 s for the test stack by `compose/compose.test-cw.yml`).

### `test/grant-admin/find-events.test.js` (new, 32 tests)

**Seeds** — directly into the containerised Mongo: GAS inbox rows (`messageId`, namespaced `type`,
`source: "CW"`, `eventTime`, `segregationRef`, plus `event.data.clientRef = "SECRET-REF"` and `claimedBy`
so the payload assertions have something to prove is excluded); GAS outbox rows (SNS ARN `target`, nested
CloudEvent, `Date` `publicationDate`); an audit outbox row carrying `entityid: "APP-SECRET-123"` and
`audit.details.query = "SECRET-DETAILS"`; an `internal:message-bus` row; a legacy `io.onsite.*` row; a row
with `eventTime: null`; a row with `status: "SOMETHING_ELSE"`; 25-row batches for paging. Caseworking rows
are seeded into the stub (`_id` 24-hex, `eventId`, `type`, `source`/`target`, `auditEntities`,
`completionAttempts`, `maxAttempts: 7`, `createdAt`).

**Asserts** — merged newest-first ordering across GAS and CW inbox/outbox; every stable status listed with
no filter; exactly 20 rows plus `hasNextPage` at 25; Next→Previous returns the first page identically; no
duplicate or skipped id when a row is inserted mid-walk; `?status=DEAD_LETTER` filters both boxes and is
forwarded to both actuators; `?service=gas` produces zero requests at the stub; `?service=caseworking`
returns only CW rows; the bearer token, `pageSize=20`, `direction` and `status` on every actuator call;
the CW cursor slice GAS mints decodes to `{ eventTime, _id }`; CW `401`/`500`/socket-destroy/timeout each
yield `200` plus the right `sourceErrors` message with no CW body anywhere in the payload; GAS paging
continues while CW is down; audit type derivation for both a GAS and a CW audit row; ARN reduction and
`internal`; `_id`-timestamp fallback; unrecognised status passed through; `attempts`/`maxAttempts`;
`400` for `?status=BOGUS`, `?service=other`, a tampered cursor and a `v: 2` cursor; `401` with a bad
bearer token; the full payload contains none of `"event"`, `claimedBy`, `entityid`, `"kind"`, `arn:aws`,
`SECRET-REF`, `APP-SECRET-123`, `SECRET-DETAILS`; the merged payload validates against
`findEventsResponseSchema`; and `/swagger.json` lists the route with its `FindEventsResponse` definition.

### `test/grant-admin/find-events-unconfigured.test.js` (new, 3 tests)

The container is booted **with** `CW_BACKEND_*`, so the unconfigured path cannot be produced over HTTP —
the values are fixed at boot. The vitest worker process, however, has neither variable set, so this file
calls the real `findEventsUseCase` against the real containerised Mongo with nothing mocked.

**Seeds** — GAS inbox and outbox rows (and a 25-row batch for the paging case).
**Asserts** — GAS rows returned newest first; exactly two `{ service: "caseworking", message: "not configured" }`
entries; the live CW stub received **zero** requests; the page validates against the response schema;
`service=gas` reports no Caseworking `sourceError`; forward paging still works.

### `test/grants/event-pagination.test.js` (Plan 01, unchanged)

Per-source real-Mongo paging, cited above as P1 rather than duplicated.

## Gaps / not testable here

| ID | Gap | Why | Mitigation |
|---|---|---|---|
| G1 | `PUBLISHED`, `FAILED` and `RESUBMITTED` rows are not seeded in the integration suite | The containerised GAS runs its inbox/outbox pollers every 250 ms and rewrites exactly those three statuses (claim → `PROCESSING`, `FAILED` → `RESUBMITTED` → `PUBLISHED`, dead-letter). Seeding them makes any assertion racy | `status` is opaque passthrough in the mapper; covered by unit tests and by the `SOMETHING_ELSE` row proving no enum is applied. `?status=DEAD_LETTER` proves the filter reaches every source |
| G2 | "CW not configured" is not asserted over HTTP | `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are read once at container boot, so they cannot vary per test within one stack | Covered at the use-case level against real Mongo with the real config in `find-events-unconfigured.test.js` (F5/F6), plus unit coverage |
| G3 | Real `fg-cw-backend` actuators are not exercised | Plan 03 lands in a different repo, in parallel | The stub implements the documented contract exactly (envelope, `auditEntities`, `maxAttempts`, raw ARN, no `totalCount`); a contract drift would show as a Plan 03 test failure there |
| G4 | Latency budget (≤ 1 s merged page) and the 3 s CW blackhole cost (Risk 1) | No load harness in this repo | Bounded structurally: `pageSize: 20` per source, `Promise.allSettled`, one shared `wreck` timeout. Worth a manual check at acceptance |
| G5 | Clock skew between services changing visible order (Risk 3) | Not deterministically reproducible | Documented in the plan and the FE footer note; the tie-break rules are unit-tested |
| G6 | Production `readPreference: secondary` lag | `NODE_ENV !== "production"` in every test environment | Disclosed in the FE footer |
| G7 | Frontend rendering (Europe/London formatting, badges, pager hrefs, `FCP.GrantOperationsAdmin`) | Belongs to Plan 04 in `fg-grants-platform-admin` | Covered by that plan's component tests |

**Counts** — 61 test cases in the tables above: **1 existing-before** (P1, Plan 01's per-source paging), **60 added by this work**, **0 testable gaps left open** (G1-G7 are all non-testable-here with a stated mitigation).

## Run record

Node v24.15.0. Commands run from `/home/donatas/code/fg-gas-backend-fgp-1392`.

| Command | Result |
|---|---|
| `npm run lint` | pass — 0 errors, 0 warnings |
| `npm run test:unit -- --run` | pass — 171 files, 1786/1786 tests (126 added by Plan 02; 1660 before) |
| `npm run test:integration -- --run find-events` | pass — 2 files, 35/35 tests |
| `npm run test:integration -- --run` | pass — 35 files, 186 passed / 6 skipped (192) |

Unit tests added by Plan 02, by file:

| File | Tests |
|---|---|
| `src/grant-admin/schemas/find-events-query.schema.test.js` | 7 |
| `src/grant-admin/schemas/find-events-response.schema.test.js` | 10 |
| `src/grant-admin/services/event-cursor.test.js` | 18 |
| `src/grant-admin/services/map-event-row.test.js` | 24 |
| `src/grant-admin/services/merge-event-pages.test.js` | 18 |
| `src/grant-admin/repositories/cw-actuators.repository.test.js` | 20 |
| `src/grant-admin/use-cases/find-events.use-case.test.js` | 16 |
| `src/grant-admin/routes/find-events.route.test.js` | 12 |
| `src/grant-admin/index.test.js` | +1 (existing file extended) |
