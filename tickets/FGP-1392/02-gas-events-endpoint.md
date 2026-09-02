# Plan 02 — GAS `GET /grant-admin/events`

Repo to build in: `fg-gas-backend` (`/home/donatas/code/fg-gas-backend`).
Ticket (source of truth, do not edit): `tickets/FGP-1392.md` in `fg-grants-platform-admin`.
Relevant ticket sections: Behaviour → Request flow, Filtering, Field derivation; Data/interfaces → GAS and CW; Non-functional; Edge cases.
The ticket has been amended since this plan was first drafted — **all nine contract concerns raised here are RESOLVED in it**, and this plan matches the amended text.

Depends on Plan 01 (`src/common/paginate.js`, `inbox/outbox.repository.findPage`) and consumes the CW contract in Plan 03.

## Goal

One cursor-paginated, merged list of events from four sources — GAS inbox, GAS outbox, CW inbox, CW outbox (via CW actuators). Default = All (every status, both services, both boxes, domain and audit rows).

---

## Known code facts (verified against `fg-gas-backend` @ 2026-09-01)

### Layering and lint

- `eslint.config.js:66-77` — **routes** may import only `**/use-cases/**`, `**/services/**`, `**/schemas/**`, `**/common/logger.js`. A route must not import `common/config.js` or a repository.
- `eslint.config.js:91-105` — **use-cases** may import `**/events/**`, `**/common/**`, `**/repositories/**`, `**/models/**`, `**/use-cases/**`, `**/commands/**`, `**/services/**`.
- `eslint.config.js:112-125` — **services** may import `**/events/**`, `**/common/**`, `**/repositories/**`, `**/publishers/**`, `**/services/**`, `**/use-cases/**`.
- `eslint.config.js:39-65` — **repositories** may not import routes/subscribers/use-cases/services; importing `common/wreck.js` + `common/config.js` is fine.
- No zone restricts `src/grant-admin/**` from `src/grants/**`; `src/grant-admin/use-cases/find-claims.use-case.js:2-4` already imports `src/grants/repositories/…`.
- `eslint.config.js:18` — **`complexity: ["error", { max: 4 }]`**. The mapper, the pagination builder and the cursor decoder all have to be split into small named helpers or lint fails. `func-style: expression` (line 16) — arrow consts, not `function` declarations. `import-x/extensions: js always` — always write `.js` in imports. `import-x/no-default-export` — named exports only.

### HTTP surface

- `src/auth/auth.js:57-58` — strategy `"service"` is `server.auth.default(...)`, so a new route needs **no** `auth` option; a request with no/invalid bearer gets `401` (`auth.js:19-23`, `:47-49`). Satisfies the `401` AC for free.
- `src/server.js:44-52` — request validation `abortEarly: false`, `failAction` rethrows → a Joi query failure is a `400`.
- `src/server.js:14-38` — `onPreResponse` logs 4xx Boom responses; a Boom thrown anywhere in a use case renders as its own status. `Boom.badRequest("Cannot decode cursor")` → `400 {"message":"Cannot decode cursor"}`; `Boom.badGateway(...)` → `502`.
- `response: { schema }` is enforced with hapi's default `failAction: "error"` → an unexpected key or type in the payload is a **500**, not a warning. `modify` is not enabled, so the validated value is *not* written back: the use case must emit final wire values (ISO **strings**, not `Date`s).
- Query validation rejects unknown query keys by default → an unexpected param is a `400`.
- Existing shape to copy: `src/grant-admin/routes/get-claims.route.js` (`tags: ["api"]`, `validate`, `response.schema`, `logger.info` entry/exit) and `src/grants/routes/find-grants.route.js:12-16` (`.label(...)` on the response schema for swagger).
- `src/grant-admin/index.js:1-8` registers the route array; `src/main.js:15` registers the `grantAdmin` plugin. `src/grant-admin/index.test.js:19-25` asserts the **exact** route table — it must be updated when the route is added.

### Config

- `src/common/config.js:112-127` — `presence: "required"` + `process.exit(1)` on any missing var. Every new var must be `.optional()`. **This plan adds no new vars.**
- `src/common/config.js:87-88` → `config.cwBackend.url` / `.token` (`:201-204`), both `.optional()`, **currently unused anywhere in `src/`**. Unset in both vitest env blocks, so `undefined` in unit and integration tests.
- `src/common/config.js:148` → `config.outbox.outboxMaxRetries`; `:154` → `config.inbox.inboxMaxRetries`. Both `5` in `.env.example:23,27`; `5` in `vitest.config.js:34,38`; **`2` in `test/vitest.config.js:78,82`**.
- `src/common/config.js:174` → `config.sns.auditTopicArn`. **No longer needed by this plan** — audit rows are recognised structurally (ticket, Field derivation). Do not read it.
- `src/common/config.js:146` → `config.cdpEnvironment`; `:131` → `config.serviceName`. Also not needed — the namespace strip is a regex (below).
- `src/common/mongo-client.js:5-13` — `readPreference: "secondary"` only when `NODE_ENV === "production"`. The FE footer note is accurate for prod only.

### Event shapes (GAS side — raw Mongo documents from Plan 01)

Plan 01's `findPage` returns **raw projected documents**, no `mapDocument`, no model round-trip.

- **Inbox** projection (Plan 01, Step 3): `_id` (ObjectId), `messageId`, `type`, `source`, `status`, `completionAttempts`, `eventTime`, `lastResubmissionDate`, `completionDate`, `segregationRef`.
  `eventTime = props.event.time` (`src/grants/models/inbox.js:39`) — an ISO **string**; `null` on pre-backfill docs (`migrations/20260114140800-add-event-time-inbox.js`). `publicationDate` is deliberately **not** projected — it is overwritten on every save (`models/inbox.js:25`). `source ∈ {"AS","CW"}` in GAS (`src/grants/use-cases/save-inbox-message.use-case.js:9-12`); CW inbox rows carry `source: "GAS"`. `messageId = message.id`, `type = message.type` (`save-inbox-message.use-case.js:33-34`).
- **Outbox** projection (Plan 01, Step 4): `_id` (ObjectId), `target`, `event.id`, `event.type`, `event.audit.entities.entity`, `event.audit.entities.action`, `status`, `completionAttempts`, `publicationDate`, `lastResubmissionDate`, `completionDate`, `segregationRef`.
  `publicationDate` is a native **`Date`** (`src/grants/models/outbox.js:35`). Mongo returns the dotted keys **nested**, so the document reads `doc.event?.audit?.entities`. `entityid` and `audit.details` are never projected — a hard requirement of the ticket's "never … `audit.entities[].entityid` … or `audit.details`".
- `lastResubmissionDate` / `completionDate` are ISO **strings** or `null`/`undefined` on both models.
- **CloudEvent type namespace** (`src/common/cloud-event.js:27`): `` `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.${type}` ``. Strip with `/^cloud\.defra\.[^.]+\.[^.]+\./` rather than building the prefix from local config: CW rows carry CW's service name and possibly a different env label.
- **Legacy `io.onsite.*`** are real, non-namespaced CloudEvents produced by GAS: `io.onsite.agreement.status.updated` (`src/agreements/services/integrations/create-outbox-messages.js:5`, `source: "urn:service:agreement"`, `id: randomUUID()`, `time`, `data`) and `io.onsite.agreement.create-payment` (`src/payments/events/create-payment.event.js:8`). They are full CloudEvents — only the type *prefix* is unusual, so the regex simply does not match and the type is shown whole.
- **Audit outbox rows** (`src/common/write-audit-event.js:107-113`): `new Outbox({ event: payload, target: config.sns.auditTopicArn, segregationRef })` where `payload` (`:64-84`, then `stripNulls` `:36-48`) has **no `id`, no `type`, no `time`** — it carries `audit: { entities: [{ entity, action, entityid }], status, accounts, details }`, `datetime`, `correlationid`, `component`, `environment`. `entity`/`action` values come from `src/common/audit-constants.js` (`APPLICATION`, `AGREEMENT`, `GRANT`; `SUBMIT_APPLICATION`, `CREATE_AGREEMENT`, …), assembled at `src/common/with-audit.js:18`. Ordering and paging still work because `publicationDate` is always set.
- **`internal:message-bus`** (`src/common/internal-command-bus.js:3`) is a valid outbox `target` (`create-outbox-messages.js:46`, `create-agreement-command.use-case.js:34`, `agreement-status-command.helpers.js:15`). It contains a colon, so it must be special-cased **before** any "last ARN segment" rule (which would yield `message-bus`).
- **Dead-lettering**: `updateDeadEvents` sets `DEAD_LETTER` at `completionAttempts >= MAX_RETRIES` (`src/grants/repositories/inbox.repository.js:92`, `outbox.repository.js:155`), so `attempts >= maxAttempts` is the correct "in the red" condition the FE renders.

### The CW wire row (Plan 03 — pre-flattened, *not* a Mongo document)

This is the single biggest difference from the GAS side and drives the mapper design. Plan 03's repositories use `paginate`'s `mapDocument`, so the CW response rows carry **no `event` key at all**:

| CW inbox row | CW outbox row |
|---|---|
| `_id` (**hex string**) | `_id` (hex string) |
| `eventId` (`messageId`, nullable) | `eventId` (`event.id`, **null on audit rows**) |
| `type` (raw full type, nullable) | `type` (raw `event.type`, **null on audit rows**) |
| `source` | `target` (**raw SNS ARN** — GAS reduces it) |
| — | `auditEntities` (`[{ entity, action }]` or `null`) |
| `segregationRef`, `status`, `completionAttempts`, `maxAttempts` | same |
| `createdAt` (**already-derived ISO string or null**) | `createdAt` (already-derived ISO string or null) |
| `lastFailureAt`, `completedAt` (ISO strings or null) | same |

Envelope: `{ data: [...], pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage } }` — **no `totalCount`** (Plan 03 adds `withTotal: false` to CW's `paginate`).

Two guarantees from Plan 03 the mapper leans on: `maxAttempts` is `required()` and an **integer** (stamped by CW's use case from its own retry config, parsed out of a `String`-format convict entry), and `auditEntities: []` is preserved as an empty array rather than collapsing to `null` — with `kind` gone, *presence of the array* is the only audit signal GAS has. CW **inbox** rows carry no `auditEntities` key at all.

Critically, CW's `createdAt` is produced by `toIsoOrNull` (Plan 03, Steps 2-3) which is a **passthrough for strings** and `.toISOString()` for Dates — i.e. bit-identical to what CW's own cursor codecs encode (`eventTime: { encode: (v) => v }`, `publicationDate: { encode: (v) => v.toISOString() }`). That is what makes GAS able to build CW cursors from CW rows (see Design → cursor value).

### `paginate` semantics inherited from Plan 01

- `limit(pageSize + 1)` is applied **inside** `paginate` — callers pass `pageSize: 20`, not 21 (ticket, Request flow step 3; Plan 01 Step 4 notes). Reading `pageSize + 1` docs per source is automatic and satisfies the non-functional budget.
- Forward: `hasNextPage = hasMore`, `hasPreviousPage = !!cursor`. Backward: operators mirrored, sort inverted, results reversed back to DESC; `hasNextPage = true`, `hasPreviousPage = hasMore`. Plan 01 Step 1 explicitly forbids "fixing" this — Plan 02's composite cursor depends on it.
- Cursor = `base64url(JSON({ …sortKeys }))`, decoded through per-key `codecs`; **any throw inside a codec's `decode` becomes `400 Cannot decode cursor`** — that is the tamper path for a non-hex `_id`.
- Keyset filter is the standard `$or` ladder. BSON orders `Null < Number < String < … < Date`, so a `$lt` on a string/Date boundary falls through into rows whose sort key is `null`, and `{ sortKey: null, _id: { $lt } }` orders that null group by `_id` — pre-backfill rows page correctly at the tail.
- Per-source codecs (Plan 01 Steps 3-4, mirrored by Plan 03):
  - inbox `eventTime`: `encode: (v) => v ?? null`, `decode: (v) => v ?? null` — **string in, string out**.
  - outbox `publicationDate`: `encode: (v) => v instanceof Date ? v.toISOString() : v`, `decode: (v) => new Date(v)`.
  - `_id`: `encode: (id) => id.toString()`, `decode: (hex) => ObjectId.createFromHexString(hex)`.

### `wreck`

- `src/common/wreck.js:5-8` — shared instance, `timeout: 3000`, **no retries**, `events: true`; a `preRequest` hook (lines 10-16) copies the trace id into `config.tracingHeader`.
- `node_modules/@hapi/wreck/lib/index.js:561-574` — `wreck.get` **throws** a Boom for any status ≥ 400 and attaches the **response body** at `err.data.payload` / `err.data.res`. Line 654 does the same for an unparsable body (`Boom.badGateway(err.message, { payload: buffer })`). Line 309: connect timeout → `Boom.gatewayTimeout("Client request timeout")` (504); line 421: read timeout → `Boom.clientTimeout()` (408); line 197: transport error (ECONNREFUSED) → `Boom.badGateway("Client request error")` (502).
  Two consequences: (a) **never log the error object** for a CW failure — only a derived one-liner; (b) an *uncaught* Boom from the CW call would render as that status on `/grant-admin/events` (a CW 401 would become a GAS 401), so the catch is load-bearing, not defensive.
- There is no `describeError` helper in this repo yet — one is introduced here.
- Prior art for wrapping wreck failures: `src/common/agreements/call-agreement-endpoint.js:20-56`.

### Tests

- Unit: `npm run test:unit` (`vitest --dir src`), env in `vitest.config.js:20-56` — no `CW_BACKEND_*`, retries 5. `restoreMocks/clearMocks/mockReset: true`.
- Route unit test pattern: `src/grant-admin/routes/get-claims.route.test.js` — bare `hapi.server()`, `server.route(...)`, `server.inject(...)`, use case `vi.mock`ed. The bare server has **no auth strategy**, so route unit tests exercise validation and wiring only, not `401`.
- Integration: `npm run test:integration` (`vitest --dir test`), real Mongo + floci via testcontainers (`test/setup.js`); `test/cleanup.js` clears `inbox`/`outbox` before every test; `test/helpers/wreck.js:12-17` injects `Authorization: Bearer 00000000-…`; `test/auth-setup.js` seeds the token. Env in `test/vitest.config.js` sets `INBOX/OUTBOX_MAX_RETRIES: 2` (lines 78-83) — assertions on GAS `maxAttempts` must expect **2** there.
- There is no `npm run migrate`; migrations run at boot from `src/grants/index.js:35-37`, so the containerised GAS has Plan 01's indexes.

---

## Design

### Sources

Four source keys, in this fixed order (used for `sourceErrors` ordering and merge tie-breaks):

| key | service | box | fetch | sort key inside its cursor |
|---|---|---|---|---|
| `gasInbox` | `gas` | `inbox` | `src/grants/repositories/inbox.repository.js` → `findPage` | `eventTime` (ISO **string**) |
| `gasOutbox` | `gas` | `outbox` | `src/grants/repositories/outbox.repository.js` → `findPage` | `publicationDate` (**`Date`** → ISO) |
| `cwInbox` | `caseworking` | `inbox` | `GET {cwBackend.url}/actuators/inbox` | `eventTime` |
| `cwOutbox` | `caseworking` | `outbox` | `GET {cwBackend.url}/actuators/outbox` | `publicationDate` |

`PAGE_SIZE = 20`. Every source is asked for `pageSize: 20` (its own `paginate` adds the +1 look-ahead) — **Decision 8**.

### The composite cursor

```
cursor = base64url(JSON.stringify({
  v: 1,
  gasInbox:  "<per-source cursor>" | null,
  gasOutbox: "<per-source cursor>" | null,
  cwInbox:   "<per-source cursor>" | null,
  cwOutbox:  "<per-source cursor>" | null,
}))
```

A **per-source cursor** is exactly what that source's own `paginate` expects to decode (**Decision 1**, now the ticket's Request flow §5):

```
base64url(JSON.stringify({ eventTime:       "<value>" | null, _id: "<24-hex>" }))   // inbox sources
base64url(JSON.stringify({ publicationDate: "<ISO>"   | null, _id: "<24-hex>" }))   // outbox sources
```

GAS **encodes** these itself (it needs to point at an arbitrary row, mid-page); each source's `paginate` **decodes** them with its own codecs. The wire form is the shared contract between Plans 01, 02 and 03. GAS therefore **ignores** the `pagination.startCursor` / `pagination.endCursor` each source returns and uses only `data` plus the two booleans.

#### The cursor value is the *verbatim* sort-key value, never a re-canonicalised one

Per source, the value GAS puts in a slice is:

| source | cursor value for a row |
|---|---|
| `gasInbox` | `doc.eventTime ?? null` — the raw stored **string**, byte-for-byte |
| `gasOutbox` | `doc.publicationDate instanceof Date ? doc.publicationDate.toISOString() : (doc.publicationDate ?? null)` |
| `cwInbox` / `cwOutbox` | `row.createdAt ?? null` — CW already emits exactly its own codec's encoded form |

This must **not** be confused with the response's `createdAt`, which is the *display* value and is normalised through `new Date(...)`. Inbox `eventTime` is compared **lexicographically as a string** by Mongo (Plan 01's codec is a passthrough). Canonicalising `"2026-06-16T10:00:00Z"` into `"2026-06-16T10:00:00.000Z"` before putting it in the cursor would move the keyset boundary past every row stored in the short form, silently skipping them. Two separate fields on the internal tuple: `cursorValue` (verbatim) and `createdAt` (display).

**Signatures** — `src/grant-admin/services/event-cursor.js`:

```js
export const CURSOR_VERSION = 1;
export const SOURCE_KEYS = ["gasInbox", "gasOutbox", "cwInbox", "cwOutbox"];

// key -> the sort field name used inside that source's per-source cursor
export const sortKeyFor = (sourceKey) => "eventTime" | "publicationDate";

// (sourceKey, { cursorValue: string|null, id: string }) -> per-source cursor string
export const encodeSourceCursor = (sourceKey, boundary) => string;

// slices object -> composite cursor string
export const encodeCompositeCursor = (slices) => string;

// composite cursor string|undefined -> { gasInbox, gasOutbox, cwInbox, cwOutbox } of string|null
// throws Boom.badRequest("Cannot decode cursor")
export const decodeCompositeCursor = (cursor) => slices;
```

`decodeCompositeCursor` validates **eagerly and completely**, before any source is queried:

1. `undefined`/`""` → all four slices `null`.
2. `JSON.parse(Buffer.from(cursor, "base64url").toString())` — `Buffer.from` never throws on garbage, so `JSON.parse` is the real guard; wrap in `try/catch`.
3. parsed must be a plain object and `parsed.v === CURSOR_VERSION` (else `400`; covers the ticket's "cursor `v` unknown" edge case).
4. each of the four keys must be `null`/absent or a string that itself base64url-JSON-decodes to `{ [sortKeyFor(key)]: string|null, _id: /^[0-9a-f]{24}$/ }`.

Step 4 matters: without it a tampered *slice* would only fail later, inside a source's `paginate` (or, for CW, inside CW), where `Promise.allSettled` would swallow the `Boom.badRequest` into `sourceErrors` and return a `200` instead of the `400` the AC demands. Validating the `_id` as 24 hex here also pre-empts `ObjectId.createFromHexString` throwing deep in the repository.

### Merge

Rows from all sources are collected as tuples so the merge never has to re-read the public row:

```js
{ key, order: number|null, cursorValue: string|null, id: "<24-hex>", row: <public event object> }
```

`order = Number.isNaN(Date.parse(cursorValue)) ? null : Date.parse(cursorValue)`.

Comparator (DESC = newest first), matching the ticket's `(createdAt desc, service, box, _id desc)` and each source's own `{ sortKey: -1, _id: -1 }`:

```js
const SERVICE_RANK = { gas: 0, caseworking: 1 };
const BOX_RANK = { inbox: 0, outbox: 1 };

// null orders last in DESC, exactly as BSON null does
const orderValue = (t) => t.order ?? -Infinity;

const compareDesc = (a, b) =>
  (orderValue(b) - orderValue(a)) ||
  (SERVICE_RANK[a.row.service] - SERVICE_RANK[b.row.service]) ||
  (BOX_RANK[a.row.box] - BOX_RANK[b.row.box]) ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);        // _id descending
```

`direction=backward` uses `compareAsc = (a, b) => -compareDesc(a, b)`, because backward asks each source for the rows *immediately newer* than its cursor: the merged page must take the **oldest 20** of those candidates (the ones closest to the cursor), then be reversed to DESC for the response.

### Slices, `hasNextPage`, `hasPreviousPage`

One rule covers both directions:

> Per source: `startCursor` slice = the **newest** row taken from that source; `endCursor` slice = the **oldest** row taken from that source. A source that contributed no rows to this page — because it was outranked, was filtered out, or failed — keeps its **incoming** slice unchanged for both.

Because `taken` is DESC for forward and ASC for backward, "newest/oldest" is `first/last` for forward and `last/first` for backward.

```
buildPagination({ slices, pages, taken, direction, hadCursor }):
  const isForward = direction !== "backward"
  const takenByKey = groupBy(taken, t => t.key)

  const start = {}, end = {}
  for (const key of SOURCE_KEYS):
      const t = takenByKey[key] ?? []
      if (t.length === 0):
          start[key] = slices[key]; end[key] = slices[key]; continue
      const newest = isForward ? t[0] : t[t.length - 1]
      const oldest = isForward ? t[t.length - 1] : t[0]
      start[key] = encodeSourceCursor(key, newest)
      end[key]   = encodeSourceCursor(key, oldest)

  // "more where that came from": rows this source returned but we didn't take,
  // or the source's own look-ahead in this direction.
  const anyRemaining = pages.some(p =>
      p.tuples.length > (takenByKey[p.key]?.length ?? 0) ||
      (isForward ? p.pagination.hasNextPage : p.pagination.hasPreviousPage))

  return {
    startCursor: taken.length ? encodeCompositeCursor(start) : null,
    endCursor:   taken.length ? encodeCompositeCursor(end)   : null,
    hasNextPage:     isForward ? anyRemaining : true,
    hasPreviousPage: isForward ? hadCursor    : anyRemaining,
  }
```

Why each part is right:

- **`hasPreviousPage` forward = `hadCursor`** mirrors `paginate`'s forward semantics and satisfies "Given the first page, then no Previous link".
- **`hasNextPage` backward = `true`** mirrors `paginate` — you arrived from a forward page, so one exists.
- **`anyRemaining`** is the ticket's "any source returned more". A source contributed `k` of the `n` rows it returned; if `n > k` the leftovers are strictly further from the cursor than the boundary, and the next page (queried from the boundary) picks them up. If `n === k`, only its own look-ahead flag can say. Both terms are needed: the first catches "outranked in this merge", the second "exhausted this fetch".
- A **failed** source is absent from `pages`, so it neither claims leftovers nor moves its slice — its rows simply reappear from the next page once it recovers (ticket's "Source recovers mid-navigation").
- **No duplicates or skips under interleaved insert**: each slice is a keyset position on a row that was actually returned to the client, so the next page's `$lt`/`$gt` starts strictly past it regardless of what was inserted meanwhile.

### Filters

- `status` → passed identically to all four sources (`findPage({ status })` filter; `?status=` on both CW calls).
- `service=gas` → only `gasInbox`/`gasOutbox` are queried; the CW slices carry through the incoming cursor untouched (`null` on a first page, which is the ticket's "left empty"), and **no CW `sourceErrors` are emitted** (AC: "Caseworking is not called"). Symmetrically for `service=caseworking`.
- Nothing else is filtered — audit rows, all six statuses, both boxes are in by default.
- The query enums are strict and GAS is the **single enum authority** (**Decision 9**): the FE forwards `status`/`service` unvalidated and renders GAS's `400` as its in-page alert.

### Failure handling (**Decisions 4 and 7**)

`Promise.allSettled` over the (2 or 4) selected sources.

| situation | result |
|---|---|
| a CW source rejects (timeout / 401 / 5xx / ECONNREFUSED / bad body) | `200`, `sourceErrors += { service: "caseworking", box, message: describeError(e) }` |
| `cwBackend.url` or `.token` unset, and `service` is not `gas` | `200`, one entry per CW box with `message: "not configured"`; **no HTTP call attempted** |
| **exactly one** GAS source rejects | `200` with the other three sources' rows, `sourceErrors += { service: "gas", box, message }` |
| **both** GAS sources reject | `throw Boom.badGateway("Events could not be loaded from GAS")` → `502` |
| composite cursor undecodable | `throw Boom.badRequest("Cannot decode cursor")` → `400` |

`describeError` yields a fixed, payload-free vocabulary: `"timeout"` (Boom 504/408), `` `HTTP ${statusCode}` `` (any other Boom — note ECONNREFUSED arrives as `HTTP 502`), `"not configured"`, else `"read failed"`.

Logging is asymmetric on purpose:

- **CW** failure → `logger.warn({ service, box }, \`caseworking ${box} unavailable: ${message}\`)`. Never the error object — it carries `err.data.payload`, the CW response body.
- **GAS** failure → `logger.error(error, \`gas ${box} read failed\`)`. This is our own database; the stack is worth keeping and there is no third-party payload in it.

---

## Deliverables

| # | File | Contents |
|---|---|---|
| 1 | `src/grant-admin/schemas/find-events-query.schema.js` | `findEventsQuerySchema`, `EVENT_STATUSES`, `EVENT_SERVICES` |
| 2 | `src/grant-admin/schemas/find-events-response.schema.js` | `findEventsResponseSchema` |
| 3 | `src/grant-admin/services/event-cursor.js` | composite + per-source cursor encode/decode |
| 4 | `src/grant-admin/services/map-event-row.js` | per-source normalisers + the one shared derivation |
| 5 | `src/grant-admin/services/merge-event-pages.js` | comparator, take-20, `buildPagination` |
| 6 | `src/grant-admin/repositories/cw-actuators.repository.js` | `findCwInboxPage`, `findCwOutboxPage`, `isCwConfigured`, `describeError` |
| 7 | `src/grant-admin/use-cases/find-events.use-case.js` | fan-out, merge, `sourceErrors`, `502` |
| 8 | `src/grant-admin/routes/find-events.route.js` | `GET /grant-admin/events` |
| 9 | `src/grant-admin/index.js` (+ `index.test.js`) | register the route |
| 10 | `.env.example` (+ `README.md`, optional) | note that `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are now consumed |
| 11 | `test/grant-admin/find-events.test.js` | integration |

Nothing in `src/grants/**` changes in this plan — `findPage` and the migration are Plan 01. **No `kind` field anywhere** (**Decision 2**).

---

## Steps

### Step 0 — Prerequisite check (no code)

Confirm Plan 01 has landed and that the interfaces this plan compiles against exist:

```js
findPage({ cursor, direction, pageSize, status })
  -> { data: [ …raw projected docs… ],
       pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage } }
```

with the inbox `eventTime` codec a **string passthrough** and the outbox `publicationDate` codec `Date ↔ ISO`. If Plan 01 has not landed, Steps 1-5 and 8 are still buildable; Steps 6-7 stub the GAS sources. Plan 03 need not have landed — the CW sources simply report `not configured`.

### Step 1 — Schemas

`src/grant-admin/schemas/find-events-query.schema.js`:

```js
import Joi from "joi";

export const EVENT_STATUSES = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
];

export const EVENT_SERVICES = ["gas", "caseworking"];

// GAS is the single enum authority: the admin frontend forwards `status` and
// `service` unvalidated and renders the 400 from here as its in-page alert.
// No status and no service means All: every status, both services, both boxes,
// domain and audit rows. The cursor is a keyset position, so it stays decodable
// under any filter and is deliberately not bound to the filter it was issued under.
export const findEventsQuerySchema = Joi.object({
  cursor: Joi.string().optional(),
  direction: Joi.string().valid("forward", "backward").default("forward"),
  status: Joi.string()
    .valid(...EVENT_STATUSES)
    .optional(),
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .optional(),
}).label("FindEventsQuery");
```

`src/grant-admin/schemas/find-events-response.schema.js` (verbatim):

```js
import Joi from "joi";
import { EVENT_SERVICES } from "./find-events-query.schema.js";

const EVENT_BOXES = ["inbox", "outbox"];

// One row of the merged inbox/outbox list. Deliberately generic: never the
// event payload (`event`, `event.data`), never `claimedBy`, never a full ARN,
// never an audit `entityid` or `details`, and no business identifier lifted out
// of a payload - those belong to the Inspect story. There is no `kind`: audit
// rows are recognised structurally in the mapper and announce themselves
// through `type` ("audit · <entity>.<action>") and a null `fullType`.
// Every field is required so a mapping gap fails a test rather than rendering
// as a blank cell.
const event = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  id: Joi.string().required().example("665f1c2e9a1b2c3d4e5f6a7b"),
  eventId: Joi.string().required(),
  type: Joi.string().required().example("case.status.updated"),
  fullType: Joi.string()
    .allow(null)
    .required()
    .example("cloud.defra.prd.fg-gas-backend.case.update.status"),
  source: Joi.string().allow(null).required(),
  target: Joi.string().allow(null).required(),
  segregationRef: Joi.string().allow(null).required(),
  // Validated as a free string, not an enum: the documented values are
  // PUBLISHED, PROCESSING, FAILED, RESUBMITTED, COMPLETED and DEAD_LETTER, but
  // one unexpected document must not fail response validation and 500 the whole
  // page. The frontend renders anything unrecognised with a ghost badge.
  status: Joi.string().required().example("DEAD_LETTER"),
  // Never null: both models default completionAttempts to 1 on insert, GAS knows its own
  // caps from config and CW returns maxAttempts per row (required in Plan 03's schema).
  attempts: Joi.number().integer().min(1).required(),
  maxAttempts: Joi.number().integer().min(1).required(),
  createdAt: Joi.string().isoDate().required(),
  lastFailureAt: Joi.string().isoDate().allow(null).required(),
  completedAt: Joi.string().isoDate().allow(null).required(),
}).label("Event");

// Opaque, composite and versioned: one keyset position per source. Null on an
// empty page so the frontend renders no pager.
const pagination = Joi.object({
  startCursor: Joi.string().allow(null).required(),
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
  hasPreviousPage: Joi.boolean().required(),
}).label("EventPagination");

// A source that could not be read - either service, either box. `message` is a
// fixed one-liner ("timeout", "HTTP 401", "not configured", "read failed") and
// never a response body.
const sourceError = Joi.object({
  service: Joi.string()
    .valid(...EVENT_SERVICES)
    .required(),
  box: Joi.string()
    .valid(...EVENT_BOXES)
    .required(),
  message: Joi.string().required(),
}).label("EventSourceError");

export const findEventsResponseSchema = Joi.object({
  events: Joi.array().items(event).required(),
  pagination: pagination.required(),
  sourceErrors: Joi.array().items(sourceError).required(),
}).label("FindEventsResponse");
```

Tests — `find-events-response.schema.test.js`:
- "accepts the ticket's example payload verbatim"
- "accepts null source, target, segregationRef, fullType, lastFailureAt and completedAt"
- "accepts a status outside the six documented values" (Decision 6 — the anti-500 guarantee)
- "rejects a payload carrying an `event` key"
- "rejects a payload carrying a `kind` key" (Decision 2 — proves the field is gone, not merely unused)
- "rejects a `createdAt` that is not ISO-8601"
- "accepts an empty page with null cursors"
- "accepts a gas sourceError as well as a caseworking one" (Decision 4)

Tests — `find-events-query.schema.test.js`:
- "defaults direction to forward when absent"
- "accepts no status and no service (All)"
- "rejects status=BOGUS" / "rejects service=other" / "rejects direction=sideways"
- "rejects an unknown query parameter"

### Step 2 — `src/grant-admin/services/event-cursor.js`

Implement the five exports from Design. Keep each helper under complexity 4: `parseJsonCursor`, `assertSlice`, `readSlices`.

Tests — `event-cursor.test.js`:
- "encodes a per-source inbox cursor as base64url `{ eventTime, _id }`" (decode and compare the object, not the string)
- "encodes a per-source outbox cursor as base64url `{ publicationDate, _id }`"
- "encodes a null cursor value as `null` rather than omitting the key"
- "passes a non-canonical ISO string through verbatim" (`"2026-06-16T10:00:00Z"` stays exactly that — the anti-canonicalisation guarantee)
- "round-trips a full composite cursor through encode then decode"
- "decodes an absent cursor to four null slices"
- "rejects a tampered cursor with Boom 400 `Cannot decode cursor`"
- "rejects a cursor whose `v` is 2" / "rejects a cursor with no `v`"
- "rejects a composite whose `gasInbox` slice is not a decodable per-source cursor"
- "rejects a per-source slice missing `_id`"
- "rejects a per-source slice whose `_id` is not 24 hex characters"
- "rejects a per-source slice keyed on the wrong sort field"

### Step 3 — `src/grant-admin/services/map-event-row.js`

Two wire shapes feed one derivation. Normalise first, then derive:

```js
// GAS raw Mongo document -> intermediate
export const normaliseGasInbox  = (doc) => intermediate;
export const normaliseGasOutbox = (doc) => intermediate;
// CW wire row -> intermediate
export const normaliseCwInbox   = (row) => intermediate;
export const normaliseCwOutbox  = (row) => intermediate;

// intermediate + identity -> the tuple the merge and cursor consume
export const toEventTuple = ({ key, service, box, intermediate }) =>
  ({ key, order, cursorValue, id, row });
```

The **intermediate** is deliberately uniform:

```js
{
  id,              // 24-hex string
  cursorValue,     // verbatim sort-key value, or null  (see Design)
  eventId,         // string | null
  fullTypeRaw,     // string | null
  auditEntities,   // [{ entity, action }] | null
  source,          // string | null   (inbox only)
  target,          // raw ARN / "internal:message-bus" | null   (outbox only)
  segregationRef, status, attempts, maxAttempts,
  lastFailureAt, completedAt,          // ISO strings or null
}
```

Per-source normalisers:

| field | `normaliseGasInbox(doc)` | `normaliseGasOutbox(doc)` | `normaliseCwInbox(row)` | `normaliseCwOutbox(row)` |
|---|---|---|---|---|
| `id` | `doc._id.toString()` | `doc._id.toString()` | `row._id` | `row._id` |
| `cursorValue` | `doc.eventTime ?? null` | `toIsoIfDate(doc.publicationDate)` | `row.createdAt ?? null` | `row.createdAt ?? null` |
| `eventId` | `doc.messageId ?? null` | `doc.event?.id ?? null` | `row.eventId ?? null` | `row.eventId ?? null` |
| `fullTypeRaw` | `doc.type ?? null` | `doc.event?.type ?? null` | `row.type ?? null` | `row.type ?? null` |
| `auditEntities` | `null` | `doc.event?.audit?.entities ?? null` | `null` | `row.auditEntities ?? null` |
| `source` | `doc.source ?? null` | `null` | `row.source ?? null` | `null` |
| `target` | `null` | `doc.target ?? null` | `null` | `row.target ?? null` |
| `maxAttempts` | `config.inbox.inboxMaxRetries` | `config.outbox.outboxMaxRetries` | `row.maxAttempts ?? null` | `row.maxAttempts ?? null` |
| `attempts` | `doc.completionAttempts` (always present — model default 1) | same | `row.completionAttempts` | same |
| `lastFailureAt` / `completedAt` | `toIso(doc.lastResubmissionDate)` / `toIso(doc.completionDate)` | same | `row.lastFailureAt ?? null` / `row.completedAt ?? null` | same |

**Decision 3**: CW rows use CW's own per-row `maxAttempts`; GAS rows use GAS config. The GAS normalisers are the only place `config` is read, so pass the two numbers in as parameters and keep the module pure — `vitest.config.js` sets them, but injection keeps the tests free of `vi.mock("config.js")`.

Shared derivation helpers (each trivially under complexity 4):

```js
const NAMESPACE = /^cloud\.defra\.[^.]+\.[^.]+\./;
const INTERNAL_BUS = "internal:message-bus";
const NO_TYPE = "-";

const toIso = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const toIsoIfDate = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));
const idTimestamp = (id) => new Date(parseInt(id.slice(0, 8), 16) * 1000).toISOString();
const isAudit = (i) => Array.isArray(i.auditEntities);
const auditType = (entities) => {
  const e = entities[0];
  return e?.entity && e?.action ? `audit · ${e.entity}.${e.action}` : NO_TYPE;
};
const shortType = (full) => full?.replace(NAMESPACE, "") || null;
const targetName = (t) => (!t ? null : t === INTERNAL_BUS ? "internal" : t.slice(t.lastIndexOf(":") + 1));
```

`toEventTuple` then derives, per the ticket's Field derivation table:

| output field | rule |
|---|---|
| `createdAt` | `toIso(cursorValue) ?? idTimestamp(id)` |
| `order` | `toIso(cursorValue)` → epoch ms, else `null` |
| `eventId` | `intermediate.eventId ?? id` (audit and legacy rows without one fall back to `_id`) |
| `type` | `isAudit(i) ? auditType(i.auditEntities) : (shortType(i.fullTypeRaw) ?? NO_TYPE)` |
| `fullType` | `isAudit(i) ? null : (i.fullTypeRaw ?? null)` (**Decisions 2 and 5**) |
| `source` | `i.source` |
| `target` | `targetName(i.target)` |
| `segregationRef` / `status` / `attempts` / `maxAttempts` | passthrough |
| `lastFailureAt` / `completedAt` | passthrough (already ISO or null) |

`isAudit` keys off `Array.isArray(auditEntities)`, so an **empty** `entities` array is still an audit row: `fullType` null and `type` `-` (ticket, Edge cases: "An audit row with an empty `entities` array → Type `-`; still listed"). `config.sns.auditTopicArn` is never consulted — the structural test is what makes CW audit rows classify correctly.

Tests — `map-event-row.test.js`:
- "maps a GAS outbox CloudEvent row: eventId from event.id, namespace stripped from type, full type preserved in fullType"
- "maps a GAS inbox row: eventId from messageId, source AS, target null"
- "maps a CW inbox wire row: hex _id passed through, createdAt used verbatim as the cursor value"
- "maps a CW outbox wire row: reduces the raw ARN to a topic name"
- "keeps a legacy `io.onsite.agreement.status.updated` type whole in both `type` and `fullType`"
- "keeps a legacy `io.onsite.agreement.create-payment` type whole"
- "derives `audit · APPLICATION.SUBMIT_APPLICATION` and a null fullType for a GAS audit outbox row"
- "derives the same for a CW audit row from `auditEntities` alone, with no audit ARN in config"
- "falls back to `_id` for `eventId` on an audit row"
- "returns type `-` for an audit row with an empty entities array, and still returns the row"
- "returns type `-` for an outbox row with no type and no audit entities"
- "never reads `entityid` or `details` from an audit entity" (feed both; assert absent from `JSON.stringify(row)`)
- "reduces `internal:message-bus` to `internal`, not `message-bus`"
- "reduces a `.fifo` SNS ARN to its topic name and never emits a full ARN"
- "falls back to the `_id` timestamp when `eventTime` is null"
- "falls back to the `_id` timestamp when `publicationDate` is an unparsable string"
- "keeps `order` null while `createdAt` shows the `_id` fallback"
- "uses the raw stored eventTime string as the cursor value without canonicalising it"
- "uses GAS config for GAS maxAttempts and CW's per-row maxAttempts for CW rows"
- "returns null `lastFailureAt` for a FAILED row with no `lastResubmissionDate`"
- "produces a row that satisfies the response schema" (validate against the schema — catches drift)
- "never emits `event`, `event.data`, `claimedBy` or `kind` even when present on the input"

### Step 4 — `src/grant-admin/services/merge-event-pages.js`

```js
export const PAGE_SIZE = 20;
export const compareDesc = (a, b) => number;
export const mergePages = ({ pages, direction }) => ({ taken, events });
export const buildPagination = ({ slices, pages, taken, direction, hadCursor }) => pagination;
```

`pages` is `[{ key, tuples, pagination }]` for successful sources only. `mergePages` sorts with `compareDesc` (forward) or its negation (backward), slices to `PAGE_SIZE`, and returns `events` = `taken.map(t => t.row)`, reversed when backward.

Tests — `merge-event-pages.test.js`:
- "orders rows from four sources newest first"
- "breaks a createdAt tie on service, then box, then _id descending"
- "orders rows with a null order key last"
- "takes exactly 20 when 80 rows are offered"
- "backward takes the 20 closest to the cursor and returns them newest first"
- "startCursor slice is the newest row taken from each source"
- "endCursor slice is the oldest row taken from each source"
- "a source that contributed no rows keeps its incoming slice in both cursors"
- "a source absent from `pages` (failed) keeps its incoming slice"
- "hasNextPage is true when one source has untaken rows even though every source's look-ahead is false"
- "hasNextPage is true when a source's own hasNextPage is true and all its rows were taken"
- "hasNextPage is false when every source is exhausted"
- "hasPreviousPage forward is false without an incoming cursor and true with one"
- "backward reports hasNextPage true and derives hasPreviousPage from remaining rows"
- "an empty page returns null cursors and hasNextPage false (forward)"
- "three exhausted sources and one with more rows keeps hasNextPage true and the next endCursor advances only that source's slice"

### Step 5 — `src/grant-admin/repositories/cw-actuators.repository.js`

```js
export const isCwConfigured = () => Boolean(config.cwBackend.url && config.cwBackend.token);
export const describeError = (error) => string;                 // exported for tests
export const findCwInboxPage  = async ({ cursor, direction, status, pageSize }) => ({ data, pagination });
export const findCwOutboxPage = async ({ cursor, direction, status, pageSize }) => ({ data, pagination });
```

- URL built with `new URL(\`/actuators/${box}\`, config.cwBackend.url)`; params `pageSize`, `direction`, and `cursor`/`status` only when set.
- `wreck.get(url, { json: true, headers: { authorization: \`Bearer ${config.cwBackend.token}\` } })`; returns `{ data: payload.data ?? [], pagination: payload.pagination ?? {} }`.
- **Does not catch** — the use case catches through `Promise.allSettled` and turns the rejection into a `sourceError`. This keeps the repository free of logging and the failure policy in one place.
- 3 s timeout and no retries come from the shared `wreck` (`src/common/wreck.js:5-8`); do not create a second Wreck instance.

Tests — `cw-actuators.repository.test.js` (`vi.mock("../../common/wreck.js")`, `vi.mock("../../common/config.js")`):
- "calls /actuators/inbox with pageSize 20, direction and the bearer token"
- "omits cursor and status from the query string when not supplied"
- "passes cursor and status through verbatim"
- "returns data and pagination from the response envelope"
- "returns empty data when the envelope has none"
- "tolerates an envelope with no totalCount" (Plan 03 drops it)
- "propagates the wreck rejection unchanged"
- "isCwConfigured is false when the url is unset" / "…when the token is unset"
- "describeError maps a 504 gateway timeout to `timeout`"
- "describeError maps a 408 client timeout to `timeout`"
- "describeError maps a Boom 401 to `HTTP 401`"
- "describeError maps a plain Error to `read failed`"
- "describeError never returns anything drawn from `error.data.payload`" (build a Boom carrying a body; assert the body's text is absent from the result)

### Step 6 — `src/grant-admin/use-cases/find-events.use-case.js`

```js
export const findEventsUseCase = async ({ cursor, direction, status, service }) => ({
  events, pagination, sourceErrors,
});
```

Flow, matching the Design pseudocode:

1. `const slices = decodeCompositeCursor(cursor)` — before any I/O, so a tampered cursor is a clean `400`.
2. `const selected = SOURCES.filter(s => !service || s.service === service)`.
3. Drop the CW sources (recording `not configured` `sourceErrors`) when `!isCwConfigured()` and they were selected.
4. `Promise.allSettled(selected.map(s => s.fetch({ cursor: slices[s.key], direction, status, pageSize: PAGE_SIZE })))`.
5. Split into `pages` (fulfilled — rows run through the source's normaliser then `toEventTuple`, with `config.inbox.inboxMaxRetries` / `config.outbox.outboxMaxRetries` supplied for the GAS sources) and `sourceErrors` (rejected — `describeError`, logged per the asymmetric rule in Design). `sourceErrors` is emitted in `SOURCE_KEYS` order.
6. If **both** GAS sources were selected and both rejected → `throw Boom.badGateway("Events could not be loaded from GAS")`. Exactly one → carry on with a `gas` `sourceError`.
7. `mergePages` → `buildPagination` → return.

Entry/exit `logger.info` lines per the README logging convention; nothing from a document in any log line.

Tests — `find-events.use-case.test.js` (mock the two GAS repositories, the CW repository, `config.js` and `logger.js`):
- "with no filters queries all four sources with a null cursor and pageSize 20"
- "merges rows from four sources newest first and returns 20"
- "passes the per-source slice from a composite cursor to each source"
- "passes `status` to all four sources"
- "with service=gas queries only the two GAS sources and reports no sourceErrors"
- "with service=caseworking queries only the two CW sources"
- "reports a caseworking sourceError and still returns GAS rows when the CW inbox call rejects"
- "reports two `not configured` sourceErrors and makes no HTTP call when the CW backend is unconfigured"
- "reports no CW sourceError when service=gas and the CW backend is unconfigured"
- "returns 200 with a `{service:'gas', box:'outbox'}` sourceError when only the GAS outbox read rejects, and still returns the other three sources' rows"
- "throws Boom 502 when both GAS reads reject"
- "throws Boom 400 for a tampered cursor before any source is queried" (assert the repository mocks were not called)
- "sets maxAttempts from inboxMaxRetries for GAS inbox rows and from the CW row for CW rows"
- "orders sourceErrors gasInbox, gasOutbox, cwInbox, cwOutbox"
- "never logs the CW error object" (spy on `logger.warn`; assert the first arg has no `data`/`payload`)
- "returns an empty page with null cursors when every source is empty"

### Step 7 — Route + registration

`src/grant-admin/routes/find-events.route.js`:

```js
import { logger } from "../../common/logger.js";
import { findEventsQuerySchema } from "../schemas/find-events-query.schema.js";
import { findEventsResponseSchema } from "../schemas/find-events-response.schema.js";
import { findEventsUseCase } from "../use-cases/find-events.use-case.js";

export const findEventsRoute = {
  method: "GET",
  path: "/grant-admin/events",
  options: {
    description:
      "Admin: merged GAS and Caseworking inbox/outbox events, newest first",
    tags: ["api"],
    validate: { query: findEventsQuerySchema },
    response: { schema: findEventsResponseSchema },
  },
  async handler(request) {
    const { cursor, direction, status, service } = request.query;
    logger.info(`Find events (direction ${direction})`);
    const page = await findEventsUseCase({ cursor, direction, status, service });
    logger.info(`Finished: Find events (${page.events.length} rows)`);
    return page;
  },
};
```

No `auth` option — the default `service` strategy applies (`src/auth/auth.js:57-58`). No `config` import (lint zone).

Update `src/grant-admin/index.js` to `server.route([getClaimsRoute, findEventsRoute])` and extend `src/grant-admin/index.test.js:19-25`, which asserts the exact route table.

Tests — `find-events.route.test.js` (pattern of `get-claims.route.test.js`):
- "returns the use case's page as the response body"
- "defaults direction to forward"
- "forwards cursor, direction, status and service to the use case"
- "responds 400 for status=BOGUS" / "for service=other" / "for direction=sideways" / "for an unknown query parameter"
- "responds 400 with `Cannot decode cursor` when the use case throws that Boom"
- "responds 502 when the use case throws Boom.badGateway"
- "responds 200 for a row whose status is outside the six documented values" (Decision 6)
- "responds 500 when the use case returns a row carrying an extra key" (proves `response.schema` is enforced — the no-payload guarantee has teeth)
- "returns an empty page with null cursors and no pager flags"

`src/grant-admin/index.test.js`:
- "registers the admin events endpoint" — route table contains `get /grant-admin/events`

### Step 8 — Integration (`test/grant-admin/find-events.test.js`)

Real Mongo via `MongoClient.connect(env.MONGO_URI)`, the running containerised GAS, `test/helpers/wreck.js` for the authenticated request. `vi.mock` the CW repository (or stand up a tiny local HTTP stub) to exercise up/down/401 without CW.

Seed inbox and outbox rows covering all six statuses plus: one audit outbox row (`event.audit.entities: [{entity:"APPLICATION",action:"SUBMIT_APPLICATION"}]`), one `internal:message-bus` row, one legacy `io.onsite.*` row, one inbox row with `eventTime: null`, one row with `status: "SOMETHING_ELSE"`.

- "returns every seeded row newest first with no filter"
- "returns exactly 20 rows and hasNextPage when 25 are seeded"
- "Next then Previous returns the first page's rows in the same order"
- "a row inserted between two requests is neither duplicated nor skipped"
- "?status=DEAD_LETTER returns only dead-lettered rows from both boxes"
- "?service=gas returns only GAS rows and does not call the CW repository"
- "?status=BOGUS responds 400" / "a tampered cursor responds 400 `Cannot decode cursor`"
- "a CW timeout returns GAS rows with a caseworking sourceError"
- "a CW 401 returns GAS rows with a caseworking sourceError and no body in the log"
- "an unconfigured CW backend returns GAS rows with two `not configured` sourceErrors"
- "the audit outbox row is returned with type `audit · APPLICATION.SUBMIT_APPLICATION`, a null fullType and its `_id` as eventId"
- "a row with an unrecognised status is returned rather than failing the page"
- "GAS maxAttempts is 2 in this environment" (`test/vitest.config.js:78,82`)
- "no response row contains `event`, `claimedBy`, `entityid`, `kind` or a full ARN" (assert over `JSON.stringify(body)`)
- "an empty database returns an empty page with null cursors"

### Step 9 — Finish

- `npm run lint` (watch `complexity: max 4`), `npm run test:unit`, `npm run test:integration`.
- Boot locally and check `GET /documentation` renders the new operation (`tags: ["api"]`) with the `FindEventsResponse` label.
- `.env.example`: annotate `CW_BACKEND_URL` / `CW_BACKEND_TOKEN` (lines 54-61) to say they are now read by `/grant-admin/events`. Do **not** make them required (`src/common/config.js:112-127`).
- Confirm with the platform team that both vars are set in CDP secrets per environment; without them the endpoint works but always reports two `not configured` `sourceErrors`.

---

## Risks / gotchas

1. **3 s timeout, four parallel calls.** Only two of the four are HTTP, both issued together, so the worst case is ~3 s plus the Mongo reads — not 6 s. But the ticket's ≤ 1 s target only holds with CW healthy: a CW blackhole makes every page take 3 s, and there are **no retries** (`src/common/wreck.js:5-8`), so a single blip shows the warning banner. There is no route-level timeout on the GAS reads, so a slow secondary is unbounded; consider a follow-up if that bites.
2. **Backward paging across sources.** A source that contributed nothing to a backward page keeps its incoming slice — correct, but it means a recovered source's rows only appear from the next page, never retro-fitted (the ticket accepts this). Backward always reports `hasNextPage: true` (mirroring `paginate`), so an empty backward page still renders a Next link that returns you where you were. Deliberate; call it out at review.
3. **Clock skew between services.** `createdAt` for an **inbox** row is the *producer's* CloudEvent `time` (`src/grants/models/inbox.js:39`), while for an **outbox** row it is the *writer's* insert time (`src/grants/models/outbox.js:35`). Merging GAS and CW mixes four clocks: a CW row can legitimately sort above a GAS row that was written later. Paging stays correct (the keyset is per source), but the visible order is only as good as NTP. The FE footer note covers it; do not "fix" it by re-timestamping.
4. **Cursor value vs displayed `createdAt`.** These are two fields on the tuple for a reason. Inbox `eventTime` is compared **lexicographically as a string** by Mongo (Plan 01's codec is a passthrough, and so is CW's). Canonicalising a non-canonical stored value before putting it in a cursor moves the keyset boundary and silently skips rows. Conversely the *displayed* `createdAt` normalises and falls back to the `_id` timestamp when the raw value is missing — so a pre-backfill row is ordered last (BSON `null` sorts below every string/date) but displayed with a much newer timestamp, and the page looks out of order for those rows. Both behaviours are intended; the tests in Steps 2-3 pin them.
5. **Lexicographic vs chronological string order.** GAS-minted `eventTime` values come from `new Date().toISOString()` (`src/common/cloud-event.js:10`) and are canonical, so lexicographic order equals chronological order. A third-party producer sending `+01:00` offsets or second-precision timestamps would break that equivalence for the *inbox* sources only — Mongo would order them lexicographically while the merge comparator (which parses to epoch ms) would disagree. Not worth defending against now; worth knowing if AS ever changes its envelope.
6. **Audit row volume.** Every audited write inserts an outbox row (`src/common/write-audit-event.js:107-113`), and they are never purged. On the default-All page audit rows will likely dominate and crowd out the domain rows an operator is looking for. In scope as ticketed ("audit rows included"), and the ticket's Open questions already park a domain/audit filter for the filter story — flag it at acceptance in case a default is wanted sooner.
7. **Optional `cwBackend` config.** `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are `.optional()` (`src/common/config.js:87-88`) and unset in `vitest.config.js` and `test/vitest.config.js`, so tests and local dev see `undefined`. `new URL(path, undefined)` throws a `TypeError`, so guard with `isCwConfigured()` before building the URL — otherwise a missing var turns into a crash rather than the `not configured` `sourceError` the ticket now specifies.
8. **`wreck` attaches the CW response body to its error.** `err.data.payload` on any status ≥ 400 (`node_modules/@hapi/wreck/lib/index.js:561-574`) and on an unparsable body (line 654). Logging the error object leaks a CW payload into OpenSearch — exactly what the ticket's non-functional forbids. Log `describeError(err)` only for CW. And the catch is not optional: an uncaught Boom 401 from the CW call renders as a **401 on `/grant-admin/events`**, breaking the "still 200" AC in the most confusing way possible.
9. **`complexity: max 4`** (`eslint.config.js:18`). The mapper and `buildPagination` will fail lint if written as one function each; the helper breakdown in Steps 3-4 is not stylistic.
10. **Response validation is a 500.** `response.schema` failures use hapi's default `failAction: "error"`, and `modify` is off, so `Date` objects in `createdAt`/`lastFailureAt`/`completedAt` fail `Joi.string().isoDate()` and take down the whole page. Emit ISO strings from the use case. This is also why `status` is `Joi.string()` (Decision 6) — the one field whose values come straight from data we do not control.
11. **Two wire shapes, one derivation.** The CW rows are pre-flattened by Plan 03's `mapDocument` (`_id` is a hex string, `createdAt` is already derived, there is no `event` key, `target` is a raw ARN). Writing a single mapper that reaches for `doc.event?.id` on a CW row silently yields `null` for every CW event id. The normaliser layer in Step 3 exists precisely to stop that, and the "maps a CW … wire row" tests are the guard.
12. **Plan 03 landing late.** GAS's half is independently shippable: without `CW_BACKEND_*` the CW sources report `not configured` and every AC except the CW-specific ones passes. Do not block on FGP-1227.

---

## Acceptance (from ticket)

All AC under **Content**, **Pagination** and **Failure states** that concern the endpoint, plus the Layout & scope rule "the response payload contains no `event`, `event.data`, `claimedBy`, full ARN values, or any business identifier from a payload" — enforced by the response schema (Step 1), the projections (Plan 01 / Plan 03) and the integration assertion in Step 8. The `401` AC is satisfied by the default `service` strategy (`src/auth/auth.js:57-58`).

---

## Contract concerns — all RESOLVED

1. **Composite cursor slice contents — RESOLVED (accepted).** Each slice is that source's own `paginate` cursor (`{ eventTime, _id }` for an inbox, `{ publicationDate, _id }` for an outbox, encoded with that source's codecs), not a service-neutral `{ createdAt, _id }`. The ticket's Request flow §5 now says exactly this. The outer envelope `{ v: 1, gasInbox, … }` and the `v`-unknown → `400` rule are unchanged.
2. **`kind` — RESOLVED (dropped from the contract).** There is no `kind` field in the response. GAS could not derive it for CW rows anyway: CW publishes audit to `CW__SNS__AUDIT_TOPIC_ARN` (`fg-cw-backend/src/common/config.js:145-149`), an ARN GAS has no config entry for. Audit rows are now recognised **structurally** — `event.audit.entities` present on a GAS document, `auditEntities` present on a CW row — and announce themselves through `type` (`audit · <entity>.<action>`) and a null `fullType`. Only `entity` and `action` are ever read; `entityid` and `details` are not even projected (Plan 01 Step 4, Plan 03 Step 3). A `kind` filter is parked for the filter story and the ticket notes the mapper can add the field back in one line.
3. **`maxAttempts` for Caseworking rows — RESOLVED (accepted).** CW returns `maxAttempts` per row (Plan 03 projection, from CW's own `INBOX_MAX_RETRIES`/`OUTBOX_MAX_RETRIES`). GAS uses that value for CW rows and `config.inbox.inboxMaxRetries` / `config.outbox.outboxMaxRetries` for its own. The interim "apply GAS's constants to CW rows" behaviour is removed.
4. **One GAS source failing — RESOLVED (accepted).** Exactly one GAS source failing → `200` with the other sources' rows and `sourceErrors: [{ service: "gas", box, message }]`. Both failing → `502`. The response schema's `service` enum already admits `gas`, and the FE alert text is now source-agnostic ("Some event sources are unavailable: …").
5. **`fullType` — RESOLVED (accepted).** Raw `type` / `event.type`, `null` for audit rows. Now in the ticket's derivation table.
6. **Response `status` — RESOLVED (accepted).** `Joi.string()`, with the six values documented in the schema comment and in the ticket's Data/interfaces note. A rogue status renders with a ghost badge and never 500s the page (ticket AC and Edge cases both cover it).
7. **Unconfigured CW — RESOLVED (accepted as "unconfigured = sourceErrors").** With `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` unset — true in every environment today — both CW sources report `sourceErrors[].message = "not configured"`, `200`, no HTTP call attempted. Same envelope as unavailable; the FE shows the same warning alert.
8. **Per-page read budget — RESOLVED.** Sources pass `pageSize: 20`; `paginate` adds the `+1` look-ahead itself, so each source reads at most 21 documents. The ticket's Request flow §3 now spells this out, and Plan 01 Step 4 forbids `findPage` pre-adding the extra row.
9. **Invalid `?status` / `?service` — RESOLVED.** The FE forwards them unvalidated; GAS's Joi `400` is the single enum authority and the FE renders it as the in-page error alert. The query schema here stays strict.

Nothing outstanding. One optional future refinement (not a blocker, not ticketed): if CW ever returned a per-row `cursor`, GAS would no longer need to encode CW cursors itself and the shared wire-form coupling in concern 1 would disappear.

---

## Implementation notes

Built in the existing worktree `/home/donatas/code/fg-gas-backend-fgp-1392`, branch `FGP-1392-gas`,
on top of Plan 01's uncommitted changes. Nothing committed or pushed. Node v24.15.0 (mise-managed;
`~/.nvm` does not exist on this machine, so `nvm use` was not available — `node`/`npm` are already on
`PATH` at 24.x, which satisfies the repo's `engines: >=24`).

Companion document: **`02-gas-events-endpoint.test-plan.md`** — AC-to-test matrix (61 cases: 1
existing-before, 60 added, 0 testable gaps open), integration-file inventory, gaps with reasons, run record.

### Files added — `src/`

- `src/grant-admin/schemas/find-events-query.schema.js` — `findEventsQuerySchema`, `EVENT_STATUSES`,
  `EVENT_SERVICES`. Verbatim from Step 1.
- `src/grant-admin/schemas/find-events-response.schema.js` — `findEventsResponseSchema`. Verbatim from
  Step 1: `status` as `Joi.string()`, `attempts`/`maxAttempts` required integers `min(1)`, no `kind`.
- `src/grant-admin/services/event-cursor.js` — `CURSOR_VERSION`, `SOURCE_KEYS`, `sortKeyFor`,
  `encodeSourceCursor`, `encodeCompositeCursor`, `decodeCompositeCursor`. Eager, complete slice
  validation (plain object, `v === 1`, per-key sort field, 24-hex `_id`) → `Boom.badRequest("Cannot
  decode cursor")`.
- `src/grant-admin/services/map-event-row.js` — four normalisers plus `toEventTuple`. Audit detection is
  structural (`Array.isArray(auditEntities)`); only `entity`/`action` are ever read; `fullType` is null
  for audit rows; `config.sns.auditTopicArn` is never consulted; GAS max-attempts are injected as a
  parameter so the module stays pure.
- `src/grant-admin/services/merge-event-pages.js` — `PAGE_SIZE`, `compareDesc`, `compareAsc`,
  `mergePages`, `buildPagination`.
- `src/grant-admin/repositories/cw-actuators.repository.js` — `isCwConfigured`, `describeError`,
  `notConfiguredMessage`, `findCwInboxPage`, `findCwOutboxPage`. Shared `wreck`, bearer
  `config.cwBackend.token`, no catch (the use case owns the failure policy), no logging.
- `src/grant-admin/use-cases/find-events.use-case.js` — decode → select → `Promise.allSettled` →
  split → 502 guard → merge → paginate. Asymmetric logging (CW: one-liner only; GAS: the error object).
- `src/grant-admin/routes/find-events.route.js` — `GET /grant-admin/events`, no `auth` option,
  `tags: ["api"]`, `validate.query`, `response.schema`.
- Unit tests beside each of the above (7 + 10 + 18 + 24 + 18 + 20 + 16 + 12 = 125 new cases).

### Files added — `test/`

- `test/helpers/cw-stub.js` — an in-process HTTP stand-in for CW's `/actuators/inbox|outbox`, started by
  the vitest global setup and driven from the test workers over `POST /__reset`, `PUT /__control`,
  `GET /__requests`. Modes: `ok`, `unauthorized`, `error`, `down` (socket destroyed), `timeout` (never
  answers). Records the bearer token and query string of every request.
- `compose/compose.test-cw.yml` — test-only compose override adding `CW_BACKEND_URL`,
  `CW_BACKEND_TOKEN` and a shortened `HTTP_CLIENT_TIMEOUT_MS` to the `gas` service. Kept out of
  `compose/compose.gas.yml` deliberately: `CW_BACKEND_URL` is `Joi.string().uri().optional()`, so an
  empty interpolated value would fail validation and stop the service booting for anyone running
  `docker compose up` without the vars.
- `test/grant-admin/find-events.test.js` — 32 HTTP integration tests against the containerised GAS with
  the CW stub live.
- `test/grant-admin/find-events-unconfigured.test.js` — 3 tests calling the real use case against the
  real containerised Mongo with `CW_BACKEND_*` genuinely unset in this process (the only way to reach
  the "not configured" path, since the container's config is fixed at boot).

### Files changed

- `src/grant-admin/index.js` — registers `[getClaimsRoute, findEventsRoute]`.
- `src/grant-admin/index.test.js` — exact route table updated, plus a `registers the admin events
  endpoint` case.
- `test/setup.js` — starts/stops the CW stub and passes `CW_BACKEND_URL`,
  `CW_BACKEND_TOKEN`, `HTTP_CLIENT_TIMEOUT_MS` into the compose environment; the compose environment is
  now built from `["compose.yml", "compose/compose.test-cw.yml"]`.
- `test/vitest.config.js` — `CW_STUB_PORT = 4599`, `CW_BACKEND_TOKEN: "cw-stub-token"`,
  `HTTP_CLIENT_TIMEOUT_MS: "3000"` (all consumed by the harness, not by the worker process's own config).
- `.env.example` — the `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` comment block now says they are read by
  `GET /grant-admin/events` and what happens when they are unset. Still commented out; still optional.

Nothing in `src/grants/**` was touched.

### Test results

| Command | Result |
|---|---|
| `npm run lint` | **pass** — 0 errors, 0 warnings |
| `npm run test:unit -- --run` | **pass** — 171 files, **1786/1786** (1660 before this plan) |
| `npm run test:integration -- --run find-events` | **pass** — 2 files, **35/35** |
| `npm run test:integration -- --run` | **pass** — 35 files, **186 passed / 6 skipped (192)** |

Swagger verified against the running container: `/swagger.json` lists `/grant-admin/events` with the
`FindEventsResponse`, `Event`, `EventPagination` and `EventSourceError` definitions. This is now a
permanent assertion (`find-events.test.js :: swagger > documents GET /grant-admin/events with its
response schema`) rather than a manual check.

### Deviations from the plan

1. **`describeError` reads only `error.output.statusCode`** via a `statusOf` helper, and a new
   `notConfiguredMessage()` export keeps the `"not configured"` literal in the repository beside the rest
   of the failure vocabulary rather than duplicating it in the use case.
2. **Extra helpers for `complexity: max 4`** (Risk 9, as predicted). `orNull`, `isMissing`,
   `deriveEventId`, `deriveCreatedAt`, `toOrder`, `buildRow`, `compareOrder`/`compareService`/
   `compareBox`/`compareIdDesc`, `buildSlices`, `hasRemaining`, `anyRemaining`, `toCursors`, `toPage`,
   `splitResults`, `logSourceFailure`, `assertGasAvailable`, `fetchAll`, `isValidSlice`, `readSlice`.
   No `eslint-disable` was added anywhere. `??` and `?.` both count towards the metric, which is why the
   normalisers funnel through `orNull` and `normaliseGasOutbox` destructures `doc.event ?? {}` once.
3. **`toIso` guards null/undefined explicitly.** The plan's sketch (`new Date(value)`) would return
   `1970-01-01T00:00:00.000Z` for `eventTime: null` instead of falling through to the `_id` timestamp,
   contradicting the plan's own "falls back to the `_id` timestamp when `eventTime` is null" test.
4. **Integration `maxAttempts` is 5, not 2.** The plan expected `2` from `test/vitest.config.js:78,82`,
   but those values configure the *vitest worker process*; the containerised GAS reads `.env`
   (`INBOX/OUTBOX_MAX_RETRIES=5`). The test asserts 5 and says why. `test/vitest.config.js`'s value does
   apply to `find-events-unconfigured.test.js`, which runs in-process — it does not assert on the cap.
5. **`PUBLISHED` / `FAILED` / `RESUBMITTED` rows are not seeded in the HTTP integration file.** The
   containerised GAS runs its pollers every 250 ms and rewrites exactly those three statuses, so any
   assertion over them is racy. `COMPLETED`, `DEAD_LETTER`, `PROCESSING` (no `claimExpiresAt`) and a
   deliberately unknown `SOMETHING_ELSE` are used instead; `status` is opaque passthrough in the mapper
   and is unit-tested. Recorded as G1 in the test plan.
6. **CW is stubbed at the HTTP boundary, not mocked.** The plan offered "`vi.mock` the CW repository (or
   stand up a tiny local HTTP stub)"; `vi.mock` cannot work here because GAS runs in a container, so the
   stub was built (`test/helpers/cw-stub.js`) and wired into the harness. This is why `test/setup.js`,
   `test/vitest.config.js` and a new test-only compose override were touched.
7. **The "CW not configured" case moved to a second integration file.** With the container booted
   against the stub, CW is configured for the whole HTTP suite. `find-events-unconfigured.test.js`
   reaches the path honestly — real Mongo, real use case, real config, nothing mocked — and additionally
   asserts the live stub received zero requests. Recorded as G2 in the test plan.
8. **CW stub port is 4599, not the 4568 first chosen.** 4568 collided with another suite running on the
   same machine.
9. **The timeout integration test raises its own client timeout to 15 s.** GAS waits out its (test-stack)
   3 s CW timeout, which exceeds the shared test wreck client's 3 s default.

### Skipped / not done

- **Risk 1's latency budget (≤ 1 s merged page) was not measured** — no load harness in this repo, and the
  worst case (a CW blackhole) is structurally bounded by the shared `wreck` timeout. Worth a manual check
  at acceptance. (G4 in the test plan.)
- **The platform-team confirmation that `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are set in CDP secrets per
  environment** (Step 9's last bullet) is a human action, not code. Until it happens the endpoint answers
  `200` with two `not configured` `sourceErrors`, exactly as ticketed.
- **`README.md` was not changed** — the `.env.example` comment block carries the note, and the optional
  README bullet in Deliverable 10 adds nothing the schema comment does not already say.
- Real `fg-cw-backend` actuators were not exercised (Plan 03 is in flight in another repo). The stub
  implements its documented contract exactly. (G3.)
- Nothing committed or pushed, as instructed.

---

## Addendum (2026-09-02): `traceId` on every event row

Added so the admin events page can link a row to its logs (see 04's own addendum).

- **Projections.** `src/grants/repositories/inbox.repository.js` adds `traceparent: 1` to
  `listProjection`; `outbox.repository.js` adds `"event.traceparent": 1`. Nothing else about `event`
  changed — the header comments were updated to match, since the inbox one previously listed `traceparent`
  among the fields never projected.
- **Derivation, in the shared mapper.** `map-event-row.js` gains `deriveTraceId`, the only place the
  guess is made: a value matching `/^[0-9a-f]{2}-([0-9a-f]{32})-/i` yields its capture group (OpenSearch's
  `trace.id` holds only the trace-id half of a W3C traceparent); anything else — a bare CDP request id —
  is already what OpenSearch indexes and is passed through untouched. All four normalisers feed it:
  GAS inbox from `doc.traceparent`, GAS outbox from `event.traceparent`, and both CW normalisers from the
  top-level `traceparent` CW's own `mapDocument` has already flattened. Audit rows carry no traceparent,
  so `traceId` is `null` for them; their `correlationid` is never read.
- **Schema.** `traceId: Joi.string().allow(null).required()` on the `Event` object.
- **Tests.** Mapper tests cover all four sources, upper-case W3C, a bare id, a wrong-length trace-id
  passed through whole, absent/null/empty, GAS and CW audit rows, and a "takes only traceparent from an
  event that also carries a payload" leakage case. Schema tests cover required/null/bare-id/non-string and
  reject a row carrying a raw `traceparent`. Both repository test suites assert the new projection key and
  that the outbox projects no `event.*` key beyond the five allowed. The CW stub's wire rows in
  `test/grant-admin/find-events.test.js` now carry `traceparent`, and the integration suite gains GAS-side
  and CW-side derivation cases plus a `traceparent`/`corr-1` addition to the leakage list.
- **Verification.** `npm run lint` clean; `npm run test:unit` **171 files / 1808 tests green**;
  `npm run test:integration` **36 files / 203 tests green** (Docker, from the worktree).
  One pre-existing assertion in `test/grants/event-pagination.test.js` had to be widened: it pinned the
  exact projected key list, which now legitimately includes `traceparent`.
