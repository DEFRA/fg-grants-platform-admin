# Plan 03 — CW `GET /actuators/inbox` and `GET /actuators/outbox` (FGP-1227, repointed)

Repo: **`fg-cw-backend`** (all paths below are relative to it unless prefixed).
Ticket: `fg-grants-platform-admin/tickets/FGP-1392.md` — sections *Data / interfaces → CW* (line 182-183) and *Related tickets → FGP-1227* (line 219-220). **Blocks Plan 02** (the GAS `/grant-admin/events` half).

## Goal

Expose CW's `inbox` and `outbox` collections as two cursor-paginated, service-token-protected actuator endpoints returning **generic event fields only** — never `event`, `event.data`, `claimedBy`, `audit.entities[].entityid` or `audit.details` — so fg-gas-backend can merge them with its own boxes.

**Contract is settled.** All six concerns raised against the first draft have been decided by the ticket author and the ticket amended; see *Contract decisions* at the foot of this plan. In short: CW returns `auditEntities` as `[{ entity, action }]` only, returns `maxAttempts` per row from CW's own retry config, returns the raw SNS ARN in `target`, and returns **no `kind` field** (audit rows are recognised structurally by GAS from the presence of `auditEntities`).

---

## Verified code facts

Everything below was read from the repo; `file:line` is the evidence. Correct any of these only against the code, not against memory.

### Pagination

- `src/common/paginate.js` is the only pagination helper. `paginate(collection, opts)` takes
  `{ filter, cursor, direction, sort, pageSize, codecs, project, mapDocument }`.
- It **always** runs `countDocuments(opts.filter)` in a `Promise.all` (`src/common/paginate.js:71-79`) and **always** returns `totalCount` in `pagination` (`:107`). **There is no option to skip it today** — the ticket's "no `countDocuments`" (FGP-1392 line 190) requires adding one. Step 1 below.
- `ensureTieBreaker` appends `_id` with the direction of the **last** sort key when `sort` has no `_id` (`:44-52`), so `sort: { eventTime: -1 }` becomes `{ eventTime: -1, _id: -1 }` automatically. Passing `_id: -1` explicitly is also fine and is what the ticket names — do it explicitly so the index and the sort read identically.
- Cursors are `base64url(JSON.stringify({ <sortKey>: codec.encode(doc[key]), ... }))` (`:3-9`). **Every sort key must be present in `project`** or `encodeCursor` reads `undefined`.
- A bad cursor throws `Boom.badRequest("Cannot decode cursor")` (`:21`) → HTTP 400. Matches the ticket AC.
- Cursors are computed from the **raw** docs, before `mapDocument` (`:96-102`; test `src/common/paginate.test.js:291` "cursors are based on original docs not mapped data"). So `mapDocument` may flatten/rename freely.
- `hasNextPage` / `hasPreviousPage` semantics (`:103-106`): forward → `hasMore` / `!!cursor`; backward → `true` / `hasMore`.
- The only existing caller is `src/cases/repositories/case.repository.js:176-215` (`findAll`). Copy its shape: module-level `cursorCodecs` object (`:118-139`) with per-field `{ encode, decode }`, an inline `project` of `1`s, and an inline `mapDocument`. Its `_id` codec is exactly `{ encode: (v) => v.toHexString(), decode: (v) => new ObjectId(v) }` (`:135-138`).
- `pageSize` is *not* a query param on `/cases`; `find-cases.use-case.js:105` hardcodes `pageSize: 20`. Our routes take it from the query.

### Field types (checked against the models, not assumed)

| Field | inbox | outbox |
|---|---|---|
| `_id` | `ObjectId` (driver assigns when `toDocument()` yields `_id: undefined` — `node_modules/mongodb/lib/utils.js:1060` `document._id == null`) | `ObjectId`, same |
| `eventTime` | **ISO string**, set from `props.event.time` (`src/cases/models/inbox.js:38`); backfilled by `migrations/20260120093100-inbox-add-event-time.js:14` (`$set: { eventTime: "$event.time" }`) | *does not exist* |
| `publicationDate` | **ISO string** — `props.publicationDate \|\| new Date().toISOString()` (`src/cases/models/inbox.js:25`) | **`Date`** — `props.publicationDate \|\| new Date()` (`src/cases/models/outbox.js:35`) |
| `lastResubmissionDate` | ISO string or `null` (`inbox.js:32`, `markAsFailed` `:53`) | ISO string or `undefined` (`outbox.js:38` — no `\|\| null` default) |
| `completionDate` | ISO string or `null` (`inbox.js:34`) | ISO string or `undefined` (`outbox.js:41`) |
| `type` | top-level `type` **and** `event.type` | **no top-level `type`** — only `event.type` (`outbox.js:66-77` `toDocument` has no `type`) |
| `messageId` | present (`inbox.js:31`) | absent |
| `source` | present; **always `"GAS"`** — the only two callers of `saveInboxMessageUseCase` pass `messageSource.Gas` (`src/cases/use-cases/save-inbox-message.use-case.js:10`, used by `create-new-case.subscriber.js:11` and `update-case-status-agreement.subscriber.js:11`) | absent |
| `target` | absent | present; a full SNS ARN, or the audit topic ARN `config.get("aws.sns.auditTopicArn")` (`src/common/write-audit-event.js:79`) |
| `segregationRef` | required | required |
| `completionAttempts` | number, defaults `1` | number, defaults `1` |
| `claimedBy` / `claimedAt` / `claimExpiresAt` | present — **must never be projected** | same |

- Statuses are identical six values in both models: `InboxStatus` (`src/cases/models/inbox.js:118-125`) and `OutboxStatus` (`src/cases/models/outbox.js:5-12`) — `PUBLISHED, PROCESSING, FAILED, RESUBMITTED, COMPLETED, DEAD_LETTER`.
- **Audit rows live in `outbox`.** `writeAuditEvent` inserts an `Outbox` whose `event` is the audit payload, not a CloudEvent (`src/common/write-audit-event.js:73-84`). Its shape is `{ datetime, version, application, component, environment, correlationid, ip, security, audit: { entities, accounts, status, details } }` (`:32-56`). It has **no `id` and no `type`** — which is precisely why GAS recognises audit rows structurally (FGP-1392 line 69).
  Two sub-fields of that payload are business data and must never leave CW:
  - `event.audit.details` holds arbitrary use-case data — `view-case-list.use-case.js:24-25` puts the whole request query and a security context in it.
  - `event.audit.entities[].entityid` is an application/agreement/user/case reference — see `src/users/use-cases/login-user.use-case.js` (idpId), `src/users/use-cases/update-user.use-case.js` (userId), `src/users/use-cases/update-role.use-case.js` (role code); the shape is `{ entity, action, entityid }` throughout (e.g. `src/common/write-audit-event.test.js:121`).
  A Mongo projection of `"event.audit.entities": 1` returns the **whole** entity objects including `entityid`, so `entityid` must be stripped in `mapDocument`. Projection alone is not sufficient.
- Every CW use case wrapped in `withAudit` writes one audit outbox row per call (`src/common/with-audit.js`). See *Risks*.

### Auth / surfaces

- `PUBLIC_API_STRATEGY = "public-api"`, scheme `"service-token"` (`src/server/plugins/auth/public-api.js:5-7`), registered in `src/server/plugins/auth/index.js:12-13`. Server default is `entra` (`:18`).
- Credentials on success: `{ service: record.client, tokenId: record.id }` (`public-api.js:44-46`).
- Swagger security is declared **per route**, not globally: `plugins: { "hapi-swagger": { security: [{ serviceToken: [] }] } }`. The `serviceToken` definition is merged into `securityDefinitions` in `src/server/plugins/swagger.js:26` via `serviceTokenSecurity` (`public-api.js:11-19`). The global `security` block is `[{ jwt: [] }]` (`swagger.js:29-33`), so a public-API route must override it.
- `auth: "public-api"` and `tags: ["api", "public-api"]` are **string literals** because the ESLint zone `target: "**/routes/**"` only excepts `**/use-cases/**`, `**/schemas/**`, `**/common/**` (`eslint.config.js:48-55`) — a route file cannot import `src/server/plugins/auth/public-api.js`. README documents this at lines 402-427.
- Use-case zone excepts `**/common/**`, `**/repositories/**`, `**/models/**`, `**/publishers/**`, `**/use-cases/**`, `**/events/**` (`eslint.config.js:69-82`) — so `src/actuators/use-cases/*.js` **may** import `src/cases/repositories/{inbox,outbox}.repository.js`. Good: no new repository files needed.
- Other lint rules that bite: `func-style: expression` (use `const x = () => {}`, never `function`), `complexity: max 4`, `import-x/no-default-export`, `import-x/extensions: always`.

### Actuators module as it stands

- `src/actuators/index.js` — 8 lines, registers `[findBoxesRoute]` under plugin name `"actuators"`. Registered in `src/main.js:20` alongside `cases` and `users` (**not** in `src/server/index.js`).
- `src/actuators/routes/find-boxes.route.js` — the placeholder, returns `{ boxes: [], caller: request.auth.credentials.service }`.
- `src/actuators/index.test.js` — a unit test that `vi.mock("../common/mongo-client.js")`, builds a real server, registers the plugin, and has two cases:
  1. `"registers the find-boxes route"` — asserts `server.table().map(r => r.path)` contains `/actuators/boxes`. **This one must be rewritten.**
  2. `"keeps every /actuators/* route on the public API strategy"` — filters `server.table()` by `r.path.startsWith("/actuators")` (`:29`), asserts `routes.length > 0`, then `expect(route.settings.auth.strategies).toEqual([PUBLIC_API_STRATEGY])` for each (`:34`). **Leave this untouched** — it picks up new routes automatically and is the guard README:426 describes.
- There is **no** `src/actuators/use-cases/` or `src/actuators/schemas/` directory yet. Create both.

### Integration tests

- Runner: `npm run test:integration` → `test/vitest.config.js`, which spins the whole docker compose stack via `test/setup.js` and waits on `/health`.
- **Service token in tests**: `test/helpers/service-token.js` exports the constants `SERVICE_CLIENT = "test-client"` and `SERVICE_TOKEN = "0f9a3c7e-4b21-4d0a-9c6e-8a1d2f3b4c5d"`. `test/vitest.config.js:12` computes `SERVICE_ACCESS_TOKEN_HASH = \`${SERVICE_CLIENT}:${hashToken(SERVICE_TOKEN)}\`` and passes it into the container env (`:60`, forwarded by `test/setup.js:22` into `DockerComposeEnvironment`). The app seeds it on boot in `src/main.js:23` (`seedAccessToken()`), so tests just send `Bearer ${SERVICE_TOKEN}`. Nothing to add.
- `test/helpers/wreck.js` defaults `authorization` to a freshly-minted **Entra** token; pass `headers: { authorization: ... }` explicitly for a service token, and `authorization: null` to send none (`wreck.js:35-41`).
- `test/cleanup.js` truncates `inbox` and `outbox` in a global `beforeEach` (`:18-19`), so each test seeds its own rows.
- Seeding style: connect with `MongoClient` in `beforeAll` and `insertMany` plain documents — see `test/cases/inbox-service.test.js:20-27, 49-60`. **Do not** reuse `Inbox.createMock` for actuator fixtures: its default `_id` is the string `"1234"` (`src/cases/models/inbox.js:102`), which breaks the `_id.toHexString()` cursor codec.

---

## Design decisions (settled)

1. **No new repository files.** Add `findPage` to the existing `src/cases/repositories/{inbox,outbox}.repository.js`. Actuator use cases import them (allowed by the ESLint zone).
2. **`mapDocument` flattens.** The wire row has **no `event` key at all** — `event.id` → `eventId`, `event.type` → `type`, `event.audit.entities` → `auditEntities`. This is required for FGP-1392 AC line 131 ("contains no `event`") to hold literally.
2a. **`auditEntities` is rebuilt, not passed through.** Each entity is reduced to exactly `{ entity, action }`; `entityid` and every other key are dropped in `mapDocument`. `auditEntities` is `null` on non-audit rows and an array (possibly empty) on audit rows — that presence/absence is the *only* signal GAS uses to identify an audit row, so it must never be `null` for an audit row with an empty `entities` array (FGP-1392 edge case: "an audit row with an empty `entities` array → Type `-`; still listed").
2b. **`maxAttempts` is injected by the use case, not stored per document.** It is a single integer read once from CW's own config — `config.get("inbox.inboxMaxRetries")` / `config.get("outbox.outboxMaxRetries")` (`src/common/config.js:236-241, 262-267`) — and stamped onto every row of the page. Nothing about it is persisted or projected.
2c. **No `kind` field.** The contract has none; GAS derives audit-ness from `auditEntities`. Do not add one "for convenience" — the ticket's open questions note it can be reintroduced in one line if a later filter story needs it.
3. **All timestamps go out as ISO-8601 strings.** `outbox.publicationDate` is a `Date`, `inbox.eventTime` is a string; normalise both so GAS receives one type (FGP-1392 line 178).
4. **`totalCount` is dropped by an opt-out in `paginate.js`** (`withTotal: false`), not stripped in the use case, so the `countDocuments` round-trip genuinely does not happen (FGP-1392 line 190).
5. **Response schema is declared but not enforced.** No route in the repo currently sets `response.schema` (only `response.status[400]`, e.g. `src/cases/routes/find-workflows.route.js:10-14`). Declaring it gives hapi-swagger a documented payload; `failAction: "log"` keeps a schema drift from turning into a 500 for GAS.
6. **The six-value enum is on the *query*, not the *response*.** The `status` query param is `Joi.valid(...)` over the six (an unknown value must 400 — FGP-1392 line 139). The response row's `status` is a plain `Joi.string()`, so one rogue document written by an older deploy cannot fail a whole page (FGP-1392 edge case: "a status value outside the six → passed through as a string … never a 500").

---

## Steps

### Step 1 — `paginate.js`: opt out of `countDocuments`

**File:** `src/common/paginate.js`

Add two module-level helpers above `paginate` and use them; keep the existing `// eslint-disable-next-line complexity` on `paginate`.

```javascript
const countTotal = (collection, opts) =>
  opts.withTotal === false ? undefined : collection.countDocuments(opts.filter);

const withTotalCount = (pagination, totalCount) =>
  totalCount === undefined ? pagination : { ...pagination, totalCount };
```

Replace the `Promise.all` (currently `:71-79`) with:

```javascript
  const [docs, totalCount] = await Promise.all([
    collection
      .find(filter)
      .project(opts.project)
      .sort(effectiveSort)
      .limit(opts.pageSize + 1)
      .toArray(),
    countTotal(collection, opts),
  ]);
```

and the returned object (currently `:92-109`) with:

```javascript
  return {
    data: opts.mapDocument ? docs.map(opts.mapDocument) : docs,
    pagination: withTotalCount(
      {
        startCursor: hasDocs
          ? encodeCursor(docs.at(0), sortKeys, opts.codecs)
          : null,

        endCursor: hasDocs
          ? encodeCursor(docs.at(-1), sortKeys, opts.codecs)
          : null,

        hasNextPage: isForward ? hasMore : true,
        hasPreviousPage: isForward ? !!cursor : hasMore,
      },
      totalCount,
    ),
  };
```

Default is unchanged (`withTotal` absent → count runs → `totalCount` present), so `case.repository.js` and every existing `paginate.test.js` case keep passing.

**Tests — `src/common/paginate.test.js`**, new `describe("withTotal")` block (the existing mock collection factory `makeCollection(docs, totalCount)` at `:22-36` already stubs `countDocuments`):
- `"omits totalCount and does not count when withTotal is false"` — `expect(col.countDocuments).not.toHaveBeenCalled()`; `expect(result.pagination).not.toHaveProperty("totalCount")`.
- `"still counts when withTotal is omitted"` — guards the default.
- `"still counts when withTotal is true"`.
- `"returns totalCount 0 without treating it as absent"` — `makeCollection([], 0)` with `withTotal` omitted must still expose `totalCount: 0`.

### Step 2 — `inbox.repository.js` → `findPage`

**File:** `src/cases/repositories/inbox.repository.js` (append; keep existing exports untouched)

Add imports at the top (`ObjectId` from `mongodb`, `paginate` from `../../common/paginate.js`).

```javascript
const toIsoOrNull = (value) =>
  value instanceof Date ? value.toISOString() : (value ?? null);

const inboxCursorCodecs = {
  eventTime: {
    encode: (v) => v,
    decode: (v) => v,
  },
  _id: {
    encode: (v) => v.toHexString(),
    decode: (v) => new ObjectId(v),
  },
};

export const findPage = ({ cursor, direction, pageSize, status }) =>
  paginate(db.collection(collection), {
    filter: status ? { status } : {},
    cursor,
    direction,
    sort: { eventTime: -1, _id: -1 },
    pageSize,
    withTotal: false,
    codecs: inboxCursorCodecs,
    project: {
      _id: 1,
      messageId: 1,
      type: 1,
      source: 1,
      segregationRef: 1,
      status: 1,
      completionAttempts: 1,
      eventTime: 1,
      lastResubmissionDate: 1,
      completionDate: 1,
    },
    mapDocument: (doc) => ({
      _id: doc._id.toHexString(),
      eventId: doc.messageId ?? null,
      type: doc.type ?? null,
      source: doc.source ?? null,
      segregationRef: doc.segregationRef ?? null,
      status: doc.status,
      completionAttempts: doc.completionAttempts ?? null,
      createdAt: toIsoOrNull(doc.eventTime),
      lastFailureAt: toIsoOrNull(doc.lastResubmissionDate),
      completedAt: toIsoOrNull(doc.completionDate),
    }),
  });
```

Signature: `findPage({ cursor?: string, direction: "forward"|"backward", pageSize: number, status?: string }) => Promise<{ data: Row[], pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage } }>`.

**Tests — new `src/cases/repositories/inbox.repository.test.js`** (or a `describe("findPage")` appended if one exists). Mock `../../common/paginate.js` and `../../common/mongo-client.js` with `vi.mock`, assert on the opts object handed to `paginate`:
- `"sorts newest first with an _id tie-break"` → `sort` is `{ eventTime: -1, _id: -1 }`.
- `"skips the total count"` → `withTotal: false`.
- `"filters by status when given"` / `"uses an empty filter when status is absent"`.
- `"projects only the generic fields"` → deep-equal the `project` object; explicitly `expect(opts.project).not.toHaveProperty("event")` and `...("claimedBy")`.
- `"maps messageId to eventId"`, `"maps eventTime to createdAt"`, `"maps lastResubmissionDate to lastFailureAt"`, `"maps completionDate to completedAt"`.
- `"renders _id as a hex string"`.
- `"normalises a Date eventTime to ISO"` and `"passes an ISO string eventTime through"`.
- `"returns null rather than undefined for absent optional fields"`.
- `"encodes and decodes _id cursor values as ObjectIds"` → exercise `opts.codecs._id` directly both ways.

### Step 3 — `outbox.repository.js` → `findPage`

**File:** `src/cases/repositories/outbox.repository.js` (append)

```javascript
const toIsoOrNull = (value) =>
  value instanceof Date ? value.toISOString() : (value ?? null);

// audit entity objects also carry `entityid` - an application/agreement/user
// reference. Rebuild each entity from the two keys the contract allows rather
// than passing the projected object through.
const toAuditEntities = (entities) =>
  entities
    ? entities.map(({ entity, action }) => ({ entity, action }))
    : null;

const outboxCursorCodecs = {
  publicationDate: {
    encode: (v) => v.toISOString(),
    decode: (v) => new Date(v),
  },
  _id: {
    encode: (v) => v.toHexString(),
    decode: (v) => new ObjectId(v),
  },
};

export const findPage = ({ cursor, direction, pageSize, status }) =>
  paginate(db.collection(collection), {
    filter: status ? { status } : {},
    cursor,
    direction,
    sort: { publicationDate: -1, _id: -1 },
    pageSize,
    withTotal: false,
    codecs: outboxCursorCodecs,
    project: {
      _id: 1,
      "event.id": 1,
      "event.type": 1,
      "event.audit.entities": 1,
      target: 1,
      segregationRef: 1,
      status: 1,
      completionAttempts: 1,
      publicationDate: 1,
      lastResubmissionDate: 1,
      completionDate: 1,
    },
    mapDocument: (doc) => ({
      _id: doc._id.toHexString(),
      eventId: doc.event?.id ?? null,
      type: doc.event?.type ?? null,
      auditEntities: toAuditEntities(doc.event?.audit?.entities),
      target: doc.target ?? null,
      segregationRef: doc.segregationRef ?? null,
      status: doc.status,
      completionAttempts: doc.completionAttempts ?? null,
      createdAt: toIsoOrNull(doc.publicationDate),
      lastFailureAt: toIsoOrNull(doc.lastResubmissionDate),
      completedAt: toIsoOrNull(doc.completionDate),
    }),
  });
```

Note the dotted projection keys: Mongo returns them **nested** (`{ event: { id, type, audit: { entities } } }`), which is why `mapDocument` reads `doc.event?.…` and the flattened row carries no `event`.

**Tests — `src/cases/repositories/outbox.repository.test.js`**, same shape as Step 2 plus:
- `"projects only event.id, event.type and event.audit.entities"` — and assert `event.data` / `event.audit.details` are **not** in the projection.
- `"maps a CloudEvent row to eventId and type"`.
- `"maps an audit row to null eventId, null type and its audit entities"` — fixture `{ event: { audit: { entities: [{ entity: "CASE", action: "CREATE_CASE", entityid: "665f1c2e9a1b2c3d4e5f6a7b" }] } } }`.
- `"strips entityid from every audit entity"` — the row above must map to exactly `[{ entity: "CASE", action: "CREATE_CASE" }]`; assert with `toEqual` (not `toMatchObject`) so an extra key fails, and additionally `expect(Object.keys(row.auditEntities[0])).toEqual(["entity", "action"])`.
- `"keeps an empty audit entities array as an array, not null"` — `{ event: { audit: { entities: [] } } }` → `auditEntities: []`, because presence is how GAS recognises an audit row.
- `"returns null auditEntities for a CloudEvent row"`.
- `"never returns audit details"` — fixture with `event.audit.details` present; assert `JSON.stringify(row)` does not match `/details/`.
- `"converts a Date publicationDate to an ISO string"`.
- `"encodes and decodes publicationDate cursor values as Dates"` — `codecs.publicationDate.encode(new Date(...))` round-trips.

### Step 4 — Use cases

**Files:** `src/actuators/use-cases/find-inbox-page.use-case.js`, `src/actuators/use-cases/find-outbox-page.use-case.js` (new directory).

This is where `maxAttempts` is stamped on: the retry cap is CW's own configuration, one integer for the whole collection, so it belongs in the use case and never in a document or a projection.

```javascript
import { findPage } from "../../cases/repositories/inbox.repository.js";
import { config } from "../../common/config.js";

const MAX_ATTEMPTS = parseInt(config.get("inbox.inboxMaxRetries"));

export const findInboxPageUseCase = async ({
  cursor,
  direction,
  pageSize,
  status,
}) => {
  const page = await findPage({ cursor, direction, pageSize, status });

  return {
    ...page,
    data: page.data.map((row) => ({ ...row, maxAttempts: MAX_ATTEMPTS })),
  };
};
```

…and the outbox twin as `findOutboxPageUseCase`, importing `../../cases/repositories/outbox.repository.js` and reading `config.get("outbox.outboxMaxRetries")`.

Notes:
- `config.get(...)` returns a **String** here (`src/common/config.js:236-241, 262-267` declare `format: String, default: null`), hence `parseInt` — exactly as `inbox.repository.js:6` and `outbox.repository.js:9` already do.
- Module-level `parseInt` matches house style, and both unit and integration runs already supply the env (`vitest.config.js:16,20` and `test/vitest.config.js:51,55` set `OUTBOX_MAX_RETRIES: 5` / `INBOX_MAX_RETRIES: 5`). If a test needs a different cap, `vi.mock("../../common/config.js")` before importing.
- The use-case layer may import `**/common/**` and `**/repositories/**` (`eslint.config.js:69-82`), so both imports are legal from `src/actuators/use-cases/`.

**Tests** — `src/actuators/use-cases/find-inbox-page.use-case.test.js` and `…/find-outbox-page.use-case.test.js`, `vi.mock` the repository (and `../../common/config.js` where the cap is asserted):
- `"passes cursor, direction, pageSize and status through"`.
- `"returns the repository pagination envelope unchanged"` — `pagination` is identical to the repository's, including the absence of `totalCount`.
- `"stamps maxAttempts on every row"` — a two-row page, both rows carry the configured integer.
- `"reads maxAttempts from the inbox retry config"` (inbox file) / `"…from the outbox retry config"` (outbox file) — assert the config key actually consulted, so the two files cannot be copy-pasted into reading the same cap.
- `"returns maxAttempts as a number, not a string"` — guards the `parseInt`.
- `"returns an empty data array untouched when the page is empty"`.

### Step 5 — Response schemas

**File:** `src/actuators/schemas/box-page-response.schema.js`

```javascript
import Joi from "joi";

const pagination = Joi.object({
  startCursor: Joi.string().allow(null).required(),
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
  hasPreviousPage: Joi.boolean().required(),
});

const commonRow = {
  _id: Joi.string().required(),
  eventId: Joi.string().allow(null).required(),
  type: Joi.string().allow(null).required(),
  segregationRef: Joi.string().allow(null).required(),
  // deliberately a plain string, not the six-value enum: one rogue document
  // must not fail the whole page. The *query* enum is the strict one.
  status: Joi.string()
    .required()
    .example("DEAD_LETTER")
    .description("PUBLISHED|PROCESSING|FAILED|RESUBMITTED|COMPLETED|DEAD_LETTER"),
  completionAttempts: Joi.number().integer().allow(null).required(),
  maxAttempts: Joi.number().integer().required(),
  createdAt: Joi.string().isoDate().allow(null).required(),
  lastFailureAt: Joi.string().isoDate().allow(null).required(),
  completedAt: Joi.string().isoDate().allow(null).required(),
};

// exactly two keys - `entityid` is an application/agreement reference and is
// never returned, so this object must not be `.unknown(true)`
const auditEntity = Joi.object({
  entity: Joi.string().required(),
  action: Joi.string().required(),
}).label("AuditEntity");

export const inboxPageResponseSchema = Joi.object({
  data: Joi.array()
    .items(
      Joi.object({
        ...commonRow,
        source: Joi.string().allow(null).required(),
      }).label("InboxEvent"),
    )
    .required(),
  pagination: pagination.required(),
}).label("InboxPageResponse");

export const outboxPageResponseSchema = Joi.object({
  data: Joi.array()
    .items(
      Joi.object({
        ...commonRow,
        target: Joi.string().allow(null).required(),
        auditEntities: Joi.array().items(auditEntity).allow(null).required(),
      }).label("OutboxEvent"),
    )
    .required(),
  pagination: pagination.required(),
}).label("OutboxPageResponse");
```

There is deliberately **no `kind`** key: the contract has none, and GAS recognises audit rows by `auditEntities` being non-`null`.

`.label(...)` matters: hapi-swagger names the definition from it (cf. `src/cases/schemas/common.schema.js:11`, `src/cases/schemas/responses/find-workflows-response.schema.js:8`).

**Tests — `src/actuators/schemas/box-page-response.schema.test.js`:**
- `"accepts a full inbox row"` / `"accepts a full outbox CloudEvent row"` / `"accepts an audit outbox row with null eventId and type"`.
- `"accepts nulls for every optional timestamp"`.
- `"requires maxAttempts on every row"` — omitting it fails.
- `"rejects a non-integer maxAttempts"`.
- `"accepts a status outside the six values"` — asserts the deliberate looseness (FGP-1392 edge case "never a 500").
- `"rejects an audit entity carrying entityid"` — `{ entity, action, entityid }` must fail; this is the schema-level backstop for the mapper.
- `"accepts an empty auditEntities array"` and `"accepts a null auditEntities"`.
- `"rejects a row carrying an event object"` — proves `unknown` keys are refused at row level.
- `"rejects a row carrying a kind key"` — the contract has no `kind`.

### Step 6 — Routes

**Files:** `src/actuators/routes/find-inbox.route.js`, `src/actuators/routes/find-outbox.route.js`

```javascript
import Joi from "joi";
import { inboxPageResponseSchema } from "../schemas/box-page-response.schema.js";
import { findInboxPageUseCase } from "../use-cases/find-inbox-page.use-case.js";

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

export const findInboxRoute = {
  method: "GET",
  path: "/actuators/inbox",
  options: {
    description: "List inbox events, newest first",
    auth: "public-api",
    tags: ["api", "public-api"],
    plugins: {
      "hapi-swagger": { security: [{ serviceToken: [] }] },
    },
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        direction: Joi.string().valid("forward", "backward").default("forward"),
        pageSize: Joi.number()
          .integer()
          .min(MIN_PAGE_SIZE)
          .max(MAX_PAGE_SIZE)
          .default(DEFAULT_PAGE_SIZE),
        status: Joi.string().valid(
          "PUBLISHED",
          "PROCESSING",
          "FAILED",
          "RESUBMITTED",
          "COMPLETED",
          "DEAD_LETTER",
        ),
      }),
    },
    response: {
      schema: inboxPageResponseSchema,
      failAction: "log",
    },
  },
  handler(request) {
    const { cursor, direction, pageSize, status } = request.query;

    return findInboxPageUseCase({ cursor, direction, pageSize, status });
  },
};
```

`find-outbox.route.js` is identical with `path: "/actuators/outbox"`, `findOutboxRoute`, `outboxPageResponseSchema`, `findOutboxPageUseCase` and `description: "List outbox events, newest first"`.

Named constants exist because `neostandard` + SonarCloud flag magic numbers (see `src/server/index.js:52-55` for the house pattern).

**Tests — `src/actuators/routes/find-inbox.route.test.js`, `…/find-outbox.route.test.js`** (`vi.mock` the use case, validate the Joi query schema directly via `route.options.validate.query.validate(...)`):
- `"is on the public-api strategy"` → `expect(route.options.auth).toBe("public-api")`.
- `"is tagged for the public API surface"` → `["api", "public-api"]`.
- `"declares the service token security scheme"` → `route.options.plugins["hapi-swagger"].security` equals `[{ serviceToken: [] }]`.
- `"defaults direction to forward and pageSize to 20"`.
- `"rejects pageSize above 50"` / `"rejects pageSize below 1"` / `"rejects a fractional pageSize"`.
- `"rejects an unknown direction"` / `"rejects an unknown status"`.
- `"accepts each of the six statuses"`.
- `"accepts a request with no query at all"`.
- `"passes the validated query to the use case"`.

### Step 7 — Register the routes, drop the placeholder

**`src/actuators/index.js`** (replace whole file):

```javascript
import { findInboxRoute } from "./routes/find-inbox.route.js";
import { findOutboxRoute } from "./routes/find-outbox.route.js";

export const actuators = {
  name: "actuators",
  register(server) {
    server.route([findInboxRoute, findOutboxRoute]);
  },
};
```

**Delete** `src/actuators/routes/find-boxes.route.js`.

**`src/actuators/index.test.js`** — replace the first test only:

```javascript
  it("registers the inbox and outbox routes", async () => {
    const server = await registeredServer();

    expect(server.table().map((r) => r.path)).toEqual(
      expect.arrayContaining(["/actuators/inbox", "/actuators/outbox"]),
    );
  });
```

Keep `vi.mock("../common/mongo-client.js")` at the top (`:5`) — the routes now pull in repositories that touch `db` and `config` at module load. Keep the second test (`"keeps every /actuators/* route on the public API strategy"`) **verbatim**; it enumerates by `path.startsWith("/actuators")` so it covers both new routes with no edit.

### Step 8 — Remove `/actuators/boxes` everywhere else

Full reference list (`grep -rn "actuators/boxes\|findBoxes"`, excluding `node_modules`):

| File:line | Action |
|---|---|
| `src/actuators/index.js:1,6` | done in Step 7 |
| `src/actuators/routes/find-boxes.route.js:2,4` | delete the file |
| `src/actuators/index.test.js:21` | done in Step 7 |
| `test/helpers/actuators.js:4-5` | rewrite (below) |
| `test/actuators/find-boxes.test.js` | **do not just delete** — see below |
| `README.md:517` | change the verify curl to `http://localhost:3101/actuators/inbox` |

`src/server/plugins/auth/public-api.test.js:19,34` uses a made-up `/actuators/thing` on its own throwaway server — unaffected.

**`test/helpers/actuators.js`** (replace whole file):

```javascript
import { SERVICE_TOKEN } from "./service-token.js";
import { wreck } from "./wreck.js";

const get = (path, query, token) =>
  wreck.get(query ? `${path}?${new URLSearchParams(query)}` : path, {
    headers: { authorization: token },
  });

export const findInbox = (query, token = `Bearer ${SERVICE_TOKEN}`) =>
  get("/actuators/inbox", query, token);

export const findOutbox = (query, token = `Bearer ${SERVICE_TOKEN}`) =>
  get("/actuators/outbox", query, token);
```

(`authorization: null` still reaches `wreck.js:35` and suppresses the header — keep that contract so the "no token" case works.)

**`test/actuators/find-boxes.test.js` must be relocated, not deleted — the ticket now says so explicitly** (FGP-1392 line 220: *"its integration test is the only coverage of service-token seeding, so relocate that test rather than delete it"*). Its `describe("access token seeding")` block (`:22-27`) is the only integration assertion that `SERVICE_ACCESS_TOKEN_HASH` is seeded on boot and stored hashed (`expect(record.id).not.toBe(SERVICE_TOKEN)`). Move that block **verbatim** into a new `test/actuators/access-token-seeding.test.js`, keeping the `MongoClient` `beforeAll`/`afterAll` and the `SERVICE_CLIENT` / `SERVICE_TOKEN` imports, then delete `find-boxes.test.js`. The four auth cases in its `describe("GET /actuators/boxes")` block are re-expressed against the new endpoints in Step 10.

### Step 9 — Migration

**File:** `migrations/<yyyymmddHHMMSS>-add-actuator-event-indexes.js` — generate the timestamp with `npm run migration:create -- add-actuator-event-indexes` (that script is `node --env-file .env node_modules/.bin/migrate-mongo create`, config in `migrate-mongo-config.js`, dir `migrations/`). Migrations here export **`up` only** — no `down` anywhere in the directory.

```javascript
export const up = async (db) => {
  const inbox = db.collection("inbox");
  const outbox = db.collection("outbox");

  await inbox.createIndex({ eventTime: -1, _id: -1 });
  await inbox.createIndex({ status: 1, eventTime: -1, _id: -1 });

  await outbox.createIndex({ publicationDate: -1, _id: -1 });
  await outbox.createIndex({ status: 1, publicationDate: -1, _id: -1 });
};
```

The two `status`-prefixed compounds go **beyond** the ticket's stated pair (FGP-1392 line 220); they cover the `?status=DEAD_LETTER` ops query, which is the one operators will actually run. Cheap, additive, no contract impact. Note the existing indexes on these collections are all `…: 1` ascending queue-claim indexes (`migrations/20251114120000-initial.js:19-38`, `20260120093100-inbox-add-event-time.js:4-11`, `20260318173812-add-queue-indexes.js`) and none of them serve a `-1` sort — so this migration is genuinely required, not a nicety.

Migrations run on deploy; run locally against the compose Mongo before the integration suite.

### Step 10 — Integration tests

**Files:** `test/actuators/find-inbox.test.js`, `test/actuators/find-outbox.test.js`, `test/actuators/access-token-seeding.test.js` (from Step 8).

Shape (mirrors `test/cases/inbox-service.test.js:19-31`): `MongoClient.connect(env.MONGO_URI)` in `beforeAll`, close in `afterAll`, insert plain documents with **explicit `new ObjectId()` `_id`s** and controlled `eventTime` / `publicationDate` values in `beforeEach` (`test/cleanup.js` already truncates both collections before every test).

`find-inbox.test.js`:
- `"rejects a request with no token"` → `findInbox(undefined, null)` rejects with `"Response Error: 401 Unauthorized"`.
- `"rejects an unknown token"` → `"Bearer not-a-real-token"` → 401.
- `"rejects a valid Entra user token"` → `getTokenFor(TestUser.Admin.email)` from `test/helpers/users.js` → 401.
- `"answers a caller holding the seeded service token"` → 200.
- `"returns events newest first by eventTime"`.
- `"breaks ties on _id descending"` — two docs with identical `eventTime`.
- `"returns at most pageSize rows"` — seed 25, `pageSize=10` → 10 rows, `hasNextPage: true`, `hasPreviousPage: false`.
- `"walks forward and back without duplicating or skipping a row"` — page 1 forward, then `cursor=endCursor&direction=forward`, then `cursor=startCursor&direction=backward` returns page 1 in the same order.
- `"rejects pageSize=51 with 400"`, `"rejects direction=sideways with 400"`, `"rejects status=BOGUS with 400"`.
- `"rejects a tampered cursor with 400"` → body message contains `Cannot decode cursor`.
- `"returns every status when no status is given"` — seed all six.
- `"returns only matching rows when status is given"`.
- `"returns an empty page with null cursors when the collection is empty"`.
- `"omits totalCount from pagination"`.
- `"never returns event, event.data or claimedBy"` — seed a row with a fat `event.data` and a non-null `claimedBy`, then assert on the serialised JSON: `expect(JSON.stringify(response.payload)).not.toMatch(/claimedBy|"event"/)`.
- `"exposes source, messageId as eventId and the top-level type"`.
- `"stamps maxAttempts from CW's INBOX_MAX_RETRIES on every row"` — `test/vitest.config.js:55` sets it to `5`, so expect `5`.
- `"returns no kind field"`.

`find-outbox.test.js`: the same auth, paging, filter and leakage cases against `publicationDate`, plus:
- `"returns the raw SNS target ARN"` — unreduced, per the contract; GAS shortens it.
- `"maps a CloudEvent row to eventId and type"`.
- `"maps an audit row to null eventId, null type and its audit entities"` — seed a realistic audit payload:
  `{ event: { audit: { entities: [{ entity: "CASE", action: "CREATE_CASE", entityid: "APPLICATION-REF-1" }], details: { security: { … }, query: { … } } } } }`.
- `"strips entityid from audit entities"` — the row's `auditEntities` must `toEqual([{ entity: "CASE", action: "CREATE_CASE" }])`.
- `"never leaks entityid or audit details"` — `expect(JSON.stringify(response.payload)).not.toMatch(/entityid|details|APPLICATION-REF-1/)`. This is the single most important assertion in the suite: it is the only automated guard that a business identifier cannot reach the admin UI.
- `"keeps an empty audit entities array as an empty array"`.
- `"returns null auditEntities for a CloudEvent row"`.
- `"stamps maxAttempts from CW's OUTBOX_MAX_RETRIES on every row"` — `test/vitest.config.js:51` sets it to `5`.
- `"returns no kind field"`.
- `"serialises publicationDate as an ISO string"`.

### Step 11 — Docs

- `README.md:517` — retarget the verify curl (Step 8).
- README "Two API surfaces" (`:382`) already describes `/actuators/*` generically and needs no edit. Optionally add the two paths to the table's Public API row; not required.
- Sanity-check swagger: boot locally, `GET /swagger.json`, confirm both paths appear tagged `public-api` with `security: [{ serviceToken: [] }]` and `InboxPageResponse` / `OutboxPageResponse` definitions. `src/server/index.test.js:37-42` already covers `/swagger.json` existing; no new test needed.

### Step 12 — Verify

```bash
npm run lint
npm run test:unit -- --run
npm run test:integration -- --run
```

---

## Risks / gotchas

1. **Unindexed sort until the migration runs.** Nothing in `migrations/` indexes `{ eventTime: -1 }` or `{ publicationDate: -1 }` today — every existing index on these collections is ascending and prefixed by `status`/`claimedBy`. Before Step 9 lands, `/actuators/*` does a collection scan with an in-memory sort and will hit Mongo's 32 MB sort limit once these never-purged collections grow. Deploy the migration with (or before) the endpoints; do not merge Steps 1-8 to an environment without Step 9.
2. **Audit rows dominate the outbox.** Every `withAudit`-wrapped use case writes an outbox row (`src/common/with-audit.js`), including read-only ones like `viewCaseListUseCase` — a case-list page view produces an audit row. So the outbox is mostly audit traffic and the merged GAS list will look audit-heavy by default. This is correct per FGP-1392 line 59 ("audit rows included"), but expect it to surprise reviewers; it is also why the `status`-prefixed index in Step 9 matters.
3. **Sort-key type mixing.** `inbox.eventTime` is compared as a **string** and `outbox.publicationDate` as a **`Date`**. Never let a `Date` reach the inbox codec or a string reach the outbox codec, or the `$lt`/`$gt` keyset filter silently compares across BSON types (BSON orders `Null < Number < String < ... < Date`) and paging jumps or stalls. The `toIsoOrNull` helper normalises the *output*; the *codecs* must keep the stored type. Cover this with the codec round-trip unit tests in Steps 2-3.
4. **Rows with a missing or null `eventTime`.** `Inbox` sets `eventTime = props.event.time` (`src/cases/models/inbox.js:38`) with no default, and the schema (`:6-10`) does not require `event.time`. A CloudEvent without `time` stores `eventTime: null`. Under `{ eventTime: -1 }` those rows sort **last**, and a cursor encoded from one produces `$lt: null`, which matches nothing — paging dead-ends at the tail rather than erroring. Acceptable for now; note it in the PR and consider a follow-up backfill (`$ifNull` to the `_id` timestamp).
5. **Test fixtures with string `_id`s.** `Inbox.createMock` defaults `_id: "1234"` (`src/cases/models/inbox.js:102`) and `test/cases/inbox-service.test.js` seeds string ids. The `_id` codec calls `.toHexString()`, which throws on a string. Actuator fixtures must use `new ObjectId()`.
6. **Token seeding in the test env is already wired** — `test/vitest.config.js:12,60` → `test/setup.js:22` → container env → `seedAccessToken()` in `src/main.js:23`. Do not add env or fixtures for it; do keep `test/actuators/access-token-seeding.test.js` alive (Step 8), because if seeding silently breaks, *every* actuator auth test fails with an indistinguishable 401 and the cause is only visible from that one test.
7. **Unit tests import repositories at module load.** `inbox.repository.js:6-8` and `outbox.repository.js:8-10` call `config.get(...)` and `db.collection(...)` at import time, and `src/common/config.js` ends with `config.validate({ allowed: "strict" })`. Keep `vi.mock("../common/mongo-client.js")` in `src/actuators/index.test.js`; `vitest.config.js:6-24` already supplies the `INBOX_*` / `OUTBOX_*` env for unit runs.
8. **`response.schema` with `failAction: "log"`, not the default.** hapi's default `failAction` for response validation is `"error"` → a 500 to GAS on any schema drift. `"log"` keeps the payload flowing and puts the mismatch in the logs. No other route in this repo sets `response.schema` at all, so this is new ground here.
9. **`entityid` survives the Mongo projection.** `"event.audit.entities": 1` returns the *whole* entity sub-documents, `entityid` included. Only `toAuditEntities` in `mapDocument` removes it. Anyone "simplifying" that mapper back to `doc.event?.audit?.entities ?? null` silently leaks an application/agreement reference into the admin UI — the exact thing FGP-1392 line 78 and AC line 131 forbid. Keep the `Object.keys(...)` assertion and the `not.toMatch(/entityid/)` integration assertion; they are the only things that would catch it.
10. **`maxAttempts` config is a String.** `config.get("inbox.inboxMaxRetries")` is declared `format: String` (`src/common/config.js:262-267`), so the raw value is `"5"`. Without `parseInt` the response ships a string and the FE's `attempts >= maxAttempts` comparison (ticket line 87) silently misbehaves. The `"returns maxAttempts as a number, not a string"` unit test exists for this.
11. **`auditEntities: []` must not collapse to `null`.** With `kind` gone, presence of the array is the *only* audit signal GAS has. `doc.event?.audit?.entities ?? null` is correct (an empty array is not nullish and survives) but `doc.event?.audit?.entities?.length ? … : null` would not be — do not "tidy" it that way.
12. **`hasPreviousPage` on a backward page is `hasMore`, not "a previous page exists" in the intuitive sense** (`paginate.js:105`). Read the semantics off the code before writing pager assertions; forward `hasPreviousPage` is simply `!!cursor`, so the first page after a filter change reports `false` correctly.

---

## Contract decisions

All six concerns raised against the first draft have been decided by the ticket author, and FGP-1392 has been amended. Nothing here is open. Recorded so the reasoning survives the ticket edit.

1. **Project `event.audit.entities` — RESOLVED, ACCEPTED.**
   *Concern:* the FGP-1227 projection list omitted audit entities, but the derivation table needs them to render an audit row's type, and audit outbox payloads have no `event.id`/`event.type` (`src/common/write-audit-event.js:32-56`).
   *Decision:* CW returns `auditEntities`, **restricted to `[{ entity, action }]` and nothing else**. `entityid` is an application/agreement/user reference and is never returned; `event.audit.details` is never projected. Ticket line 78 and line 183 now say so.
   *Consequence in this plan:* Mongo projects `"event.audit.entities": 1` (which does include `entityid`), and `toAuditEntities` in `src/cases/repositories/outbox.repository.js` **rebuilds** each entity from the two allowed keys (Step 3). The Joi `auditEntity` object is not `.unknown(true)`, so it rejects `entityid` as a backstop (Step 5). Three tests pin it: a repository unit test asserting `Object.keys(...)` is exactly `["entity", "action"]`, a schema test rejecting `entityid`, and an integration test asserting the serialised payload matches neither `/entityid/` nor `/details/`.

2. **Raw ARN in `target` — RESOLVED, ACCEPTED.**
   *Decision:* CW returns the full SNS ARN; GAS reduces it to a topic name (ticket line 72). No change to this plan — `mapDocument` passes `doc.target` through unmodified.
   *Consequence:* AC line 131's "no full ARN values" is a statement about the **GAS** response only. CW's own body does carry ARNs; that is intended and documented.

3. **`kind` — RESOLVED by removal from the contract.**
   *Concern:* `kind = audit if target == auditTopicArn` was not computable by GAS, which has no visibility of CW's `CW__SNS__AUDIT_TOPIC_ARN` (`src/common/config.js:145-150`).
   *Decision:* **`kind` is dropped from the contract entirely.** CW returns no `kind`; GAS identifies audit rows structurally from `auditEntities` being non-`null` (ticket line 69 and line 178: *"There is no `kind` field — audit rows are identified structurally in the mapper"*). A `kind` filter is parked for the later filter story.
   *Consequence in this plan:* no `kind` anywhere — not in the projection, the mapper, the schema, or swagger. Two tests assert its absence (`"returns no kind field"` in each integration file, `"rejects a row carrying a kind key"` in the schema test). Because presence of `auditEntities` is now load-bearing, it must be `[]` — not `null` — for an audit row whose `entities` array is empty (ticket edge case, line 145).

4. **`inbox.source` is effectively constant — NOTED, no change.**
   Every CW inbox row is written with `messageSource.Gas` (`src/cases/use-cases/save-inbox-message.use-case.js:10`; the only call sites are `create-new-case.subscriber.js:11` and `update-case-status-agreement.subscriber.js:11`), so `CW · Inbox ← GAS` is the only Source string CW inbox rows will produce. The field stays in the contract; don't build FE logic expecting variety.

5. **`maxAttempts` — RESOLVED, ACCEPTED.**
   *Concern:* GAS would otherwise apply its own `INBOX_MAX_RETRIES`/`OUTBOX_MAX_RETRIES` to CW rows, mis-rendering the `3 / 5` Attempts column when the two services' caps differ.
   *Decision:* CW returns `maxAttempts` per row, from **CW's own** `INBOX_MAX_RETRIES` (inbox) / `OUTBOX_MAX_RETRIES` (outbox) — ticket line 75 and line 183.
   *Consequence in this plan:* it is an **integer stamped by the use case**, not a stored or projected document field (Step 4). Read once at module load with `parseInt(config.get("inbox.inboxMaxRetries"))` / `…("outbox.outboxMaxRetries")` — the config format is `String` (`src/common/config.js:236-241, 262-267`), matching what `inbox.repository.js:6` and `outbox.repository.js:9` already do. `maxAttempts` is `required()` in both response schemas.

6. **`pageSize` — NOTED, unchanged.**
   `1..50`, default `20` on both actuator routes; the six-value `status` enum stays on the query (absent = all). `/cases` continues to hardcode 20 in its use case (`find-cases.use-case.js:105`); no conflict.

7. **Envelope and `withTotal` — CONFIRMED.**
   `{ data, pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage } }`, with `withTotal: false` implemented as an opt-out in `src/common/paginate.js` (Step 1) so `countDocuments` genuinely does not run (FGP-1392 line 190). No `totalCount` key on these endpoints; existing callers keep it by default.

8. **Relocating `find-boxes.test.js` — CONFIRMED, now in the ticket.**
   FGP-1392 line 220 mandates relocation rather than deletion, because its `describe("access token seeding")` block is the only integration coverage of `SERVICE_ACCESS_TOKEN_HASH` seeding. Step 8 moves it to `test/actuators/access-token-seeding.test.js`.

### Resulting CW row shapes

`GET /actuators/inbox` — one element of `data`:

```json
{
  "_id": "665f1c2e9a1b2c3d4e5f6a7b",
  "eventId": "3f2c1a0e-…",
  "type": "cloud.defra.prd.fg-gas-backend.case.create.new",
  "source": "GAS",
  "segregationRef": "GLD-9B2-BWS-grasslands",
  "status": "DEAD_LETTER",
  "completionAttempts": 5,
  "maxAttempts": 5,
  "createdAt": "2026-06-16T10:00:00.000Z",
  "lastFailureAt": "2026-06-16T10:16:05.000Z",
  "completedAt": null
}
```

`GET /actuators/outbox` — a CloudEvent row and an audit row:

```json
{
  "_id": "665f1c2e9a1b2c3d4e5f6a7c",
  "eventId": "9b4d2f10-…",
  "type": "cloud.defra.prd.fg-cw-backend.case.status.updated",
  "auditEntities": null,
  "target": "arn:aws:sns:eu-west-2:000000000000:cw__sns__case_status_updated_fifo.fifo",
  "segregationRef": "GLD-9B2-BWS-grasslands",
  "status": "COMPLETED",
  "completionAttempts": 1,
  "maxAttempts": 5,
  "createdAt": "2026-06-16T10:00:01.000Z",
  "lastFailureAt": null,
  "completedAt": "2026-06-16T10:00:02.000Z"
}
```

```json
{
  "_id": "665f1c2e9a1b2c3d4e5f6a7d",
  "eventId": null,
  "type": null,
  "auditEntities": [{ "entity": "CASE", "action": "VIEW_CASE_LIST" }],
  "target": "arn:aws:sns:eu-west-2:000000000000:cw__sns__audit_topic_arn",
  "segregationRef": "view-case-list-665f…",
  "status": "PUBLISHED",
  "completionAttempts": 1,
  "maxAttempts": 5,
  "createdAt": "2026-06-16T10:00:03.000Z",
  "lastFailureAt": null,
  "completedAt": null
}
```

No `kind`. No `event`. No `entityid`. No `details`. No `claimedBy`. No `totalCount`.

---

## Implementation notes

Implemented on **2026-09-01** in a dedicated worktree:

- Worktree: `/home/donatas/code/fg-cw-backend-fgp-1227`
- Branch: `FGP-1227-actuators` (from `origin/main` @ `69fa24f`)
- Nothing committed or pushed; all changes left in the working tree.
- Node 24.15.0 (repo `engines: node >= 24`, `.nvmrc` 24.14.1; `nvm` is not installed on this machine — `mise`-managed Node 24 was used instead).

### Files added

| File | Purpose |
|---|---|
| `src/actuators/routes/find-inbox.route.js` | Step 6 route |
| `src/actuators/routes/find-inbox.route.test.js` | Step 6 tests (15) |
| `src/actuators/routes/find-outbox.route.js` | Step 6 route |
| `src/actuators/routes/find-outbox.route.test.js` | Step 6 tests (15) |
| `src/actuators/use-cases/find-inbox-page.use-case.js` | Step 4 |
| `src/actuators/use-cases/find-inbox-page.use-case.test.js` | Step 4 tests (7) |
| `src/actuators/use-cases/find-outbox-page.use-case.js` | Step 4 |
| `src/actuators/use-cases/find-outbox-page.use-case.test.js` | Step 4 tests (7) |
| `src/actuators/schemas/box-page-response.schema.js` | Step 5 |
| `src/actuators/schemas/box-page-response.schema.test.js` | Step 5 tests (21) |
| `migrations/20260901120000-add-actuator-event-indexes.js` | Step 9 |
| `test/actuators/access-token-seeding.test.js` | Step 8 — the relocated seeding block, verbatim |
| `test/actuators/find-inbox.test.js` | Step 10 integration (21 tests) |
| `test/actuators/find-outbox.test.js` | Step 10 integration (26 tests) |

### Files changed

| File | Change |
|---|---|
| `src/common/paginate.js` | `countTotal` / `withTotalCount` helpers; `withTotal: false` opt-out (Step 1) |
| `src/common/paginate.test.js` | new `describe("withTotal")` — 5 tests |
| `src/cases/repositories/inbox.repository.js` | `findPage` + `orNull`/`toIsoOrNull`/`inboxCursorCodecs` (Step 2) |
| `src/cases/repositories/inbox.repository.test.js` | `describe("inbox.repository findPage")` — 16 tests |
| `src/cases/repositories/outbox.repository.js` | `findPage` + `toAuditEntities`/`auditEntitiesOf`/`eventIdOf`/`eventTypeOf`/`outboxCursorCodecs` (Step 3) |
| `src/cases/repositories/outbox.repository.test.js` | `describe("outbox.repository findPage")` — 21 tests |
| `src/actuators/index.js` | registers `findInboxRoute`, `findOutboxRoute` (Step 7) |
| `src/actuators/index.test.js` | first test rewritten; the public-API-strategy guard left verbatim |
| `test/helpers/actuators.js` | rewritten as `findInbox` / `findOutbox` (Step 8) |
| `README.md` | verify curl retargeted to `/actuators/inbox` (Step 11) |

### Files deleted

- `src/actuators/routes/find-boxes.route.js`
- `test/actuators/find-boxes.test.js` — its `describe("access token seeding")` block was moved verbatim to `test/actuators/access-token-seeding.test.js` first; the four auth cases are re-expressed in `find-inbox.test.js` / `find-outbox.test.js`.

### Test results

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 1 warning (pre-existing `object-shorthand` in `migrations/20260526160000-rename-woodland-workflow.js`, untouched) |
| `npx prettier --check` on all touched paths | clean (files formatted with `--write`) |
| `npm run test:unit -- --run` | **166 files, 1783 tests, all passing** |
| `npm run test:integration -- --run` | **29 files: 27 passed, 2 failed; 183 tests: 181 passed, 2 failed** |

The two integration failures are `test/cases/create-case.test.js > writes a CREATE_CASE audit event to the outbox with a system actor` and `test/cases/replace-case.test.js > replaces a case`. Both are `Error: Test timed out in 5000ms/7000ms` waiting on an SQS round-trip through the local floci container — unrelated to this change (neither file, nor any code path they exercise, was touched; both new actuator integration files and the relocated seeding test passed).

### Deviations from the plan

1. **Environment: integration suite ports.** `test/vitest.config.js` pins `CW_PORT = 3101` and `ENTRA_PORT = 3011`, both already bound on this machine by the developer's long-running `oyster-*` and `entra-platform-admin` containers, so the compose stack could not start. To get a real run, `CW_PORT`/`MONGO_PORT`/`ENTRA_PORT` were temporarily shifted to `3901`/`27918`/`3911` and `test/setup.js`'s `Wait.forHttp("/health", env.CW_PORT)` temporarily pinned to the container-internal port `3101`. **`FLOCI_PORT` must stay `4567`** — `test/helpers/sqs.js:14` and `sns-utils.js:8` fall back to a hardcoded `http://localhost:4567` during `globalSetup`, where vitest's `test.env` is not yet applied to `process.env`. All three temporary edits were reverted; `git diff` on `test/vitest.config.js` and `test/setup.js` is empty. A local `.env` (copied from `.env.example`, gitignored) was created because `compose/compose.cw-backend.yml` declares `env_file: .env`.

2. **`mapDocument` complexity.** The plan's mappers trip the repo's `complexity: max 4` rule (`??`/`?.` each count). Extracted module-level `orNull`, and for the outbox `eventIdOf` / `eventTypeOf` / `auditEntitiesOf`. Behaviour is identical, including `auditEntities: []` surviving as an empty array (Risk 11).

3. **Repository tests appended, not new files.** `src/cases/repositories/{inbox,outbox}.repository.test.js` already existed, so `findPage` coverage was appended as a new top-level `describe` in each (as the plan's parenthetical allows), with `vi.mock("../../common/paginate.js")` added alongside the existing mongo-client mock.

4. **Use-case config assertion.** The plan suggested `vi.mock("../../common/config.js")` to prove each use case reads its own retry cap. A whole-module config mock breaks `src/common/logger.js` (pino's `redact` reads a real config value) at import time. Instead each test file sets distinct caps in a `vi.hoisted()` block — `INBOX_MAX_RETRIES=7`, `OUTBOX_MAX_RETRIES=9` — before `config.js` reads the environment, and asserts the stamped integer. This exercises the real config and still fails if the two files are copy-pasted onto the same key.

5. **Integration fixtures hold a claim.** The inbox/outbox pollers run in the integration stack and would claim any seeded `PUBLISHED` row mid-test. Every fixture is therefore seeded with `claimedBy: "test-holder"` and `claimExpiresAt: 2099-01-01`, which keeps both the claim query (`claimedBy: null`) and the claim-expiry sweep (`claimExpiresAt: { $lt: now }`) away from it. This also gives the leakage tests a genuinely non-null `claimedBy` to prove is never returned.

6. **Migration timestamp generated by hand.** `npm run migration:create` requires a `.env` that did not exist at that point; the file was created directly as `migrations/20260901120000-add-actuator-event-indexes.js` in migrate-mongo's `yyyymmddHHMMSS` naming, `up`-only, exactly as the plan specifies.

7. **README:** only the verify curl was retargeted (Step 11's required change). The optional "Two API surfaces" table addition was skipped, and the swagger sanity-check (`GET /swagger.json` by hand) was not performed — `src/server/index.test.js` already covers `/swagger.json` and the route-level unit tests assert the `hapi-swagger` security block and tags.

### Not done

- Nothing committed or pushed, per instructions.
- No manual swagger inspection (see 7 above).

---

## Addendum (2026-09-02): `traceparent` on every actuator row

Added so the admin events page can link a row to its logs (see 04's own addendum).

- **Projections.** `inbox.repository.js` `findPage` projects the document's top-level `traceparent`;
  `outbox.repository.js` projects `"event.traceparent"` and lifts it to a top-level `traceparent` in
  `mapDocument`. `event.traceparent` is the *only* other `event` key ever projected — never `event.data`,
  never the payload. Audit payloads carry no traceparent (their `correlationid` is a different identifier
  and is deliberately not used), so audit rows return `null`.
- **Schema.** `commonRow` in `box-page-response.schema.js` gains
  `traceparent: Joi.string().allow(null).required()`, so both `InboxEvent` and `OutboxEvent` carry it. The
  value is either a W3C `00-<32 hex>-<16 hex>-<flags>` string or a bare CDP request id; CW does no
  extraction, it passes the stored value through.
- **Tests.** Repository unit tests cover W3C form, bare form, absent, null, and — for the outbox — an audit
  row returning `null` with its `correlationid` proven absent from the serialised row, plus a guard that
  the projected `event.*` key list is exactly `id`, `type`, `audit.entities`, `traceparent`. Schema tests
  cover required/null/bare-id and reject a row carrying `correlationid`. Both use-case tests carry the
  field through untouched. `test/actuators/find-{inbox,outbox}.test.js` gain a `traceparent` describe block
  and an extra leakage case proving a payload-carrying event yields the traceparent and nothing else.
- **Verification.** `npm run lint` clean (one pre-existing warning in `migrations/`), `npm run test:unit`
  **166 files / 1805 tests green**. `npm run test:integration` was **not** run: the testcontainers compose
  binds host port 3011, already taken by the shared `entra-platform-admin` container in this environment.
  The new integration cases are written but unexercised here.
