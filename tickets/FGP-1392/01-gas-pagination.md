# Plan 01 — GAS pagination foundation

Repo to build in: `fg-gas-backend` (`/home/donatas/code/fg-gas-backend`).
Ticket (source of truth, do not edit): `tickets/FGP-1392.md` in `fg-grants-platform-admin`.
Relevant ticket sections: Scope/In → *fg-gas-backend*; Behaviour → Request flow step 3; Field derivation;
Data/interfaces → Files; Non-functional. The ticket has been amended since this plan was first drafted —
all six contract concerns below are now RESOLVED in it, and this plan matches the amended text.
Reference to port: `/home/donatas/code/fg-cw-backend/src/common/paginate.js` + `paginate.test.js`.

## Goal

Give GAS a cursor-pagination primitive and paged, projection-limited reads over the `inbox` and
`outbox` collections, plus the indexes that make those reads cheap. **No HTTP surface, no use case,
no CW fan-out in this plan** — Plan 02 builds `GET /grant-admin/events` on top of what lands here.

## Deliverables

1. `src/common/paginate.js` — port of the CW helper, **without** `countDocuments`/`totalCount`.
2. `src/common/paginate.test.js` — ported tests, minus totals, plus a "never counts" test.
3. `findPage` in `src/grants/repositories/inbox.repository.js` (+ tests in the existing test file).
4. `findPage` in `src/grants/repositories/outbox.repository.js` (+ tests in the existing test file).
5. `migrations/20260901120000-add-event-list-indexes.js`.
6. Optional but recommended: `test/grants/event-pagination.test.js` — real-Mongo keyset stability.

---

## Verified code facts (checked against the repo — trust these over memory)

### The collections and their documents

- **`_id` is always a driver-generated `ObjectId`.** Neither `Inbox` nor `Outbox` sets `_id` on
  insert (`src/grants/models/inbox.js:25`-ish region sets `this._id = props._id`, which is
  `undefined` for new events), and `node_modules/mongodb/lib/utils.js:1054` `maybeAddIdToDocuments`
  assigns `pkFactory.createPk()` when `document._id == null`. There is **no `ObjectId` import
  anywhere in `src/` today** — `findPage` will be the first.
- **`inbox.eventTime` is an ISO 8601 *string*.** `src/grants/models/inbox.js:38`:
  `this.eventTime = props.event.time;` and `CloudEvent.time` is
  `new Date().toISOString()` (`src/common/cloud-event.js:10`). Backfilled by
  `migrations/20260114140800-add-event-time-inbox.js` with `$set: { eventTime: "$event.time" }`,
  so pre-backfill docs whose `event.time` was absent have `eventTime: null`.
- **`inbox.publicationDate` is an ISO string and is rewritten on every save.**
  `src/grants/models/inbox.js:25`: `this.publicationDate = new Date().toISOString();` — the
  constructor ignores `props.publicationDate`, and `update()` round-trips through the model.
  **Never sort or display inbox rows on it.** (Ticket already raises this as a separate bug.)
- **`outbox.publicationDate` is a native `Date`.** `src/grants/models/outbox.js:37`:
  `this.publicationDate = props.publicationDate || new Date();`
- `lastResubmissionDate` and `completionDate` are ISO **strings** on both models
  (`markAsFailed`/`markAsComplete` use `new Date().toISOString()`), and `null`/`undefined` when unset.
  They are display-only here — never sort keys.
- `inbox.type` is the full CloudEvent type; `inbox.source` is `"CW"` or `"AS"`
  (`src/grants/use-cases/save-inbox-message.use-case.js:9-12`); `inbox.messageId` is the
  CloudEvent `id`.
- `outbox.event` for a **domain** row is a `CloudEvent` — it has `id`, `type`
  (`cloud.defra.<env>.<service>.<short>`), `time`, `source`, `data`.
- `outbox.event` for an **audit** row is the audit payload built by
  `src/common/write-audit-event.js:buildPayload` — it has **no `id` and no `type`**; it has
  `audit: { entities: [{ entity, action, entityid }], status, accounts, details }`,
  `datetime`, `correlationid`, `component`, `environment`. Target is
  `config.sns.auditTopicArn` (`GAS__SNS__AUDIT_TOPIC_ARN`). This confirms the ticket's
  "audit rows fall back to `_id` for `eventId`".
- Status enum, identical in both models: `PUBLISHED, PROCESSING, FAILED, RESUBMITTED, COMPLETED,
  DEAD_LETTER` (`InboxStatus` in `models/inbox.js`, `OutboxStatus` in `models/outbox.js`).

### Existing indexes (none support a time-ordered scan)

From `migrations/20251114120000-init.js`, `20260114140800-add-event-time-inbox.js`,
`20260318172737-add-queue-indexes.js`:

- `inbox`: `{status,claimedBy,completionAttempts,publicationDate}`, `{claimExpiresAt}`,
  `{messageId}`, `{status,completionAttempts}`, `{status,claimedBy,completionAttempts,eventTime}`,
  `{status,claimExpiresAt}`.
- `outbox`: `{status,claimedBy,completionAttempts,publicationDate}`, `{claimExpiresAt}`,
  `{status,completionAttempts}`, `{status,claimExpiresAt}`.

Every one leads with `status`, so an unfiltered `{eventTime:-1,_id:-1}` scan has no index today.
Mongo auto-names the new indexes `eventTime_-1__id_-1` and `publicationDate_-1__id_-1`.

### Migrations

- Runner: `migrate-mongo`, ESM (`migrate-mongo-config.js` → `moduleSystem: "esm"`,
  `migrationsDir: "migrations"`).
- **There is no `npm run migrate` script.** Migrations run automatically at boot from
  `src/grants/index.js:35-37` (`const migrated = await up(db, mongoClient)`) inside the `grants`
  hapi plugin's `register`. `npm run migration:create <name>` scaffolds a file.
- File pattern: `<YYYYMMDDHHMMSS>-kebab-case-name.js`, named exports `up` (and optionally `down` —
  only 2 of 44 migrations define `down`). Latest existing is `20260825090000-…`, so a new file must
  sort after it.
- Migrations are excluded from coverage (`vitest.config.js` → `coverage.exclude: ["**/migrations/**"]`)
  and are **not** linted by the `src/**` block in `eslint.config.js`.

### Test harness

- **Unit tests (`npm run test:unit`, `vitest --dir src`)**: repository tests do **not** use a real
  Mongo or `mongodb-memory-server`. They call `vi.mock("../../common/mongo-client.js")` (vitest
  automock — there is no `src/common/__mocks__/mongo-client.js`; the only manual mock is
  `src/common/__mocks__/logger.js`) and then stub per-test:
  ```js
  db.collection.mockReturnValue({ findOne, updateOne, /* … */ });
  ```
  See `src/grants/repositories/inbox.repository.test.js:1-30`. `vitest.config.js` sets
  `restoreMocks/clearMocks/mockReset: true` and injects all env vars (`INBOX_MAX_RETRIES: 5`, etc.).
  `mongodb-memory-server` is used only by `test/contract/load-grants.js`.
- **Integration tests (`npm run test:integration`, `vitest --dir test`)**: `test/setup.js` brings up
  the whole `compose.yml` stack via testcontainers (Mongo on 27018, floci on 4567, GAS on 3001);
  `test/cleanup.js` `deleteMany({})`s `inbox`, `outbox`, `applications`, … before **every** test.
  Test files connect directly with `MongoClient.connect(env.MONGO_URI)` in `beforeAll` — see
  `test/grant-admin/get-claims.test.js:19-28`. Because the containerised GAS runs the migrations at
  boot, the new indexes exist in that database.
- `npm test` = unit then integration. `npm run lint` = `eslint`.

### Lint rules that will bite (`eslint.config.js`, `files: ["src/**/*"]`)

- `complexity: ["error", { max: 4 }]` — the ported `paginate` exceeds this. **Keep the
  `// eslint-disable-next-line complexity` comment** that CW has above `export const paginate`.
- `func-style: ["error", "expression"]` — arrow consts only, no `function` declarations.
- `import-x/extensions: ["error", { js: "always" }]` — always `./paginate.js`, `mongodb` is fine.
- `import-x/no-default-export` — named exports only.
- `import-x/no-restricted-paths`: repositories may not import `routes`, `subscribers`, `use-cases`
  or `services`. **Importing `models/` and `common/` from a repository is allowed** (the rule's
  *message* mentions models but the `from` list does not include them — `inbox.repository.js`
  already imports `../models/inbox.js`).
- Prettier: 2-space, double quotes, trailing commas, `prettier-plugin-organize-imports` sorts imports.

### Read preference

`src/common/mongo-client.js:5-13` already sets `readPreference: getReadPreference(config.env)`,
i.e. `"secondary"` when `NODE_ENV === "production"`, `"primary"` otherwise. The Non-functional
requirement is already satisfied client-wide — **do not pass `readPreference` per query** (that is
reserved in this codebase for reads that must be strongly consistent, e.g.
`src/agreements/repositories/agreement.repository.js:10`).

### Config (nothing new needed in this plan)

`config.inbox.inboxMaxRetries` / `config.outbox.outboxMaxRetries` (`src/common/config.js:147-158`),
`config.sns.auditTopicArn` (`:174`), `config.cwBackend.{url,token}` (`:201-204`, already optional).
Plan 02 consumes these; Plan 01 adds no config.

---

## Steps

### Step 1 — `src/common/paginate.js`

Copy `fg-cw-backend/src/common/paginate.js` verbatim, then make exactly these changes:

- Delete the `Promise.all` and the `collection.countDocuments(opts.filter)` call; `await` the find
  chain directly into `docs`.
- Delete `totalCount` from the returned `pagination` object.
- Keep everything else identical: `encodeCursor`, `decodeCursor`, `getPagingFilter`, `invert`,
  `ensureTieBreaker`, the `// eslint-disable-next-line complexity` comment, and
  `Boom.badRequest("Cannot decode cursor")`.

Resulting shape (signature contract for the rest of the work):

```js
export const paginate = async (collection, opts) => { /* … */ };
// opts: {
//   filter,      // plain Mongo filter object (default to {} at the call site)
//   sort,        // e.g. { eventTime: -1 } — _id tie-breaker appended automatically
//   codecs,      // { [sortKey]: { encode(value) -> jsonable, decode(jsonable) -> value } }
//   cursor,      // base64url JSON string or undefined
//   direction,   // "forward" | "backward"
//   pageSize,    // number; the query fetches pageSize + 1
//   project,     // Mongo projection object
//   mapDocument, // optional (doc) => row; cursors are always built from the raw doc
// }
// returns: { data, pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage } }
```

Behaviour worth knowing before you write callers:

- `ensureTieBreaker` appends `_id` with the **last** sort key's direction if `_id` is absent, so
  `{ eventTime: -1 }` becomes `{ eventTime: -1, _id: -1 }`. Passing `_id` explicitly is also fine.
- `codecs` must contain an entry for **every** key in the final sort, `_id` included.
- Any throw inside a codec's `decode` becomes `400 Cannot decode cursor` (the whole decode is inside
  the `try`). This is how a tampered cursor is detected — exploit it, don't defend against it.
- `hasNextPage` on a backward page is hard-coded `true`; `hasPreviousPage` on a forward page is
  `!!cursor`. Do not "fix" this — the FE and the composite cursor in Plan 02 depend on the CW
  semantics being identical.

### Step 2 — `src/common/paginate.test.js`

Port the CW test file. Changes:

- `makeCollection(docs)` loses its `totalCount` argument and its `countDocuments` mock.
- Drop every `totalCount` assertion and the `expect(col.countDocuments).toHaveBeenCalledWith(...)`
  line from "passes filter, project, sort and limit to collection".

Test cases to have (name → scenario):

| Test | Scenario |
|---|---|
| `first page (no cursor) > returns data with pagination metadata` | 2 docs, pageSize 2 → data unchanged, `hasNextPage` false, `hasPreviousPage` false, start/end cursors are base64url of the first/last doc's sort keys |
| `first page > passes filter, project, sort and limit to collection` | asserts `find({active:true})`, `project({name:1})`, `sort({name:1,_id:1})`, `limit(3)` |
| `first page > never counts documents` | **new** — pass a collection whose `countDocuments` is a `vi.fn()`; assert it was not called |
| `first page > appends _id to sort using last sort direction` | `sort {createdAt:-1}` → `sort({createdAt:-1,_id:-1})` |
| `first page > does not append _id when sort already includes _id` | `{name:1,_id:-1}` passed through untouched |
| `forward > sets hasNextPage when there are more results` | 3 docs returned for pageSize 2 → data length 2, `hasNextPage` true, `hasPreviousPage` true |
| `forward > sets hasPreviousPage to true when cursor is present` | 1 doc + cursor → previous true, next false |
| `forward > builds paging filter for ascending sort` | `$or: [{name:{$gt:"Bob"}},{name:"Bob",_id:{$gt:"2"}}]` |
| `forward > builds paging filter for descending sort` | same with `$lt` |
| `backward > reverses sort direction for query` | `direction:"backward"`, sort `{name:1}` → `sort({name:-1,_id:-1})` |
| `backward > reverses docs back to original order` | docs come back descending, result ascending |
| `backward > sets hasNextPage true and hasPreviousPage from hasMore` | 3 docs for pageSize 2 + cursor → both true |
| `backward > sets hasPreviousPage false when no more backward results` | 2 docs for pageSize 2 → previous false |
| `backward > builds paging filter with reversed operators` | ascending sort + backward → `$lt` operators |
| `empty results > returns null cursors and false for page flags` | `[]` → both cursors null, both flags false |
| `cursor decoding > throws Boom.badRequest for invalid cursor` | `cursor: "not-valid-base64!"` rejects with `Cannot decode cursor` |
| `cursor decoding > throws Boom.badRequest when a codec rejects the value` | **new** — codec whose `decode` throws → same 400 (this is the ObjectId tamper path) |
| `mapDocument > applies mapDocument to results` | rows mapped |
| `mapDocument > cursors are based on original docs not mapped data` | cursor still encodes the raw sort keys |
| `codecs > encodes and decodes cursor values using codecs` | Date codec → ISO in cursor |
| `codecs > decodes cursor before building filter` | filter carries a real `Date` |

### Step 3 — `findPage` in `src/grants/repositories/inbox.repository.js`

Add at the top of the file (alongside the existing imports; organize-imports will sort them):

```js
import { ObjectId } from "mongodb";
import { paginate } from "../../common/paginate.js";
```

Module-level constants — **projection verbatim**:

```js
// Generic inbox/outbox fields only. Never `event`, `event.data`, `claimedBy`,
// `traceparent`, or `publicationDate` (rewritten on every save - see models/inbox.js:25).
const listProjection = {
  _id: 1,
  messageId: 1,
  type: 1,
  source: 1,
  status: 1,
  completionAttempts: 1,
  eventTime: 1,
  lastResubmissionDate: 1,
  completionDate: 1,
  segregationRef: 1,
};

// eventTime is an ISO string on every inbox document (models/inbox.js:38),
// so it round-trips through the cursor unchanged.
const listCodecs = {
  eventTime: {
    encode: (value) => value ?? null,
    decode: (value) => value ?? null,
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

const listSort = { eventTime: -1, _id: -1 };
```

Exported function:

```js
export const findPage = async ({
  cursor,
  direction = "forward",
  pageSize = 20,
  status,
} = {}) =>
  paginate(db.collection(collection), {
    filter: status ? { status } : {},
    sort: listSort,
    codecs: listCodecs,
    cursor,
    direction,
    pageSize,
    project: listProjection,
  });
```

Implementation notes:

- **Callers pass `pageSize: 20`; `paginate` adds the `+1` look-ahead itself** (ticket, Request flow
  step 3). `findPage` must never pre-add the extra row, and the default here is the plain `20`.
- **No enum validation on `status` in the repository.** It is passed straight into the filter;
  the route validates it against the six values in Plan 02, and the GAS response schema types
  `status` as a plain string so one unexpected document cannot fail a whole page.
  An unknown value simply matches nothing.
- **Return the raw projected documents.** Do not `Inbox.fromDocument(doc)` — the constructor
  overwrites `publicationDate` with `new Date().toISOString()` and nulls `claimedBy/claimedAt/
  claimExpiresAt`, and it `Joi`-validates `source`/`event`/`segregationRef`, which the projection
  deliberately omits (`event` is absent, so the constructor would throw on `props.event.time`).
  No `mapDocument` — Plan 02's shared mapper owns the shape.
- `collection` is the existing module-level `const collection = "inbox";`.
- Keep `findPage` at the bottom of the file with the other query functions.

Tests to add to `src/grants/repositories/inbox.repository.test.js` (inside a
`describe("findPage", …)`; the file already has `vi.mock("../../common/mongo-client.js")`):

Harness helper for this describe block:

```js
const mockFindChain = (docs) => {
  const chain = {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  const find = vi.fn().mockReturnValue(chain);
  db.collection.mockReturnValue({ find });
  return { find, chain };
};
```

| Test | Scenario |
|---|---|
| `queries the inbox newest-first with the _id tie-breaker` | no args → `find({})`, `sort({eventTime:-1,_id:-1})`, `limit(21)` |
| `requests pageSize + 1 documents` | `pageSize: 5` → `limit(6)` |
| `projects only the generic list fields` | asserts `project()` called with the exact `listProjection` object above |
| `never projects the payload or claim fields` | asserts the projection object has no `event`, `event.data`, `claimedBy`, `claimedAt`, `claimExpiresAt`, `traceparent`, `publicationDate` keys |
| `applies the status filter when given` | `status: "DEAD_LETTER"` → `find({status:"DEAD_LETTER"})` |
| `returns every status when no filter is given` | `find({})` — nothing narrows the query |
| `returns the raw documents without rebuilding the Inbox model` | seed a doc with `publicationDate` absent and `status:"COMPLETED"`; result `data[0]` is the identical object reference/shape (proves no model round-trip) |
| `encodes cursors from eventTime and _id` | doc `{ _id: new ObjectId("665f1c2e9a1b2c3d4e5f6a7b"), eventTime: "2026-06-16T10:00:00.000Z" }` → `startCursor` decodes (base64url → JSON) to `{ eventTime: "2026-06-16T10:00:00.000Z", _id: "665f1c2e9a1b2c3d4e5f6a7b" }` |
| `resumes from a cursor with a decoded ObjectId` | pass that cursor forward → `find` called with `$or: [{eventTime:{$lt:"2026-06-16T10:00:00.000Z"}}, {eventTime:"2026-06-16T10:00:00.000Z", _id:{$lt: ObjectId(...)}}]` and the filter's `_id` is an `ObjectId` instance |
| `rejects a tampered cursor` | `cursor: "!!!not-base64!!!"` and a valid-base64-but-non-hex `_id` cursor both reject with `Cannot decode cursor` |
| `reverses order for a backward page` | `direction:"backward"` → `sort({eventTime:1,_id:1})` and returned `data` reversed back to newest-first |

### Step 4 — `findPage` in `src/grants/repositories/outbox.repository.js`

Same shape, different sort key, codec and projection.

```js
import { ObjectId } from "mongodb";
import { paginate } from "../../common/paginate.js";
```

**Projection verbatim** — note `event.audit.entities` is narrowed to the two subfields the
derivation table needs, so `entityid` (a business identifier: agreement number, clientRef, …)
never leaves the database:

```js
// Generic outbox fields plus the three event subfields the list derives
// its id/type from. Never the full `event`, `event.data`, or `claimedBy`.
const listProjection = {
  _id: 1,
  target: 1,
  "event.id": 1,
  "event.type": 1,
  "event.audit.entities.entity": 1,
  "event.audit.entities.action": 1,
  status: 1,
  completionAttempts: 1,
  publicationDate: 1,
  lastResubmissionDate: 1,
  completionDate: 1,
  segregationRef: 1,
};

// publicationDate is a native Date on every outbox document
// (models/outbox.js:37), so the cursor carries it as an ISO string.
const listCodecs = {
  publicationDate: {
    encode: (value) => (value instanceof Date ? value.toISOString() : value),
    decode: (value) => new Date(value),
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

const listSort = { publicationDate: -1, _id: -1 };
```

```js
export const findPage = async ({
  cursor,
  direction = "forward",
  pageSize = 20,
  status,
} = {}) =>
  paginate(db.collection(collection), {
    filter: status ? { status } : {},
    sort: listSort,
    codecs: listCodecs,
    cursor,
    direction,
    pageSize,
    project: listProjection,
  });
```

Notes:

- **Callers pass `pageSize: 20`; `paginate` adds the `+1` look-ahead itself** (ticket, Request flow
  step 3). `findPage` must never pre-add the extra row, and the default here is the plain `20`.
- **No enum validation on `status` in the repository.** It is passed straight into the filter;
  the route validates it against the six values in Plan 02, and the GAS response schema types
  `status` as a plain string so one unexpected document cannot fail a whole page.
  An unknown value simply matches nothing.
- Again, no `Outbox.fromDocument` — its constructor `Joi`-requires `target`, `event` and
  `segregationRef`, nulls the claim fields, and defaults `publicationDate` to *now* when absent.
- Audit rows legitimately come back as `{ _id, target, event: { audit: { entities: [{entity,action}] } }, … }`
  with no `event.id`/`event.type`. That is the expected shape for Plan 02's mapper; do not
  paper over it here.
- **There is no `kind` field anywhere.** It was dropped from the contract: an audit row is
  recognised *structurally* by `event.audit.entities` being present. The repository does not
  classify, label or filter on it — it just projects the two subfields and lets Plan 02's mapper
  decide. Do not add a `kind`, `isAudit` or `box` field to the returned documents.

Tests to add to `src/grants/repositories/outbox.repository.test.js` (`describe("findPage", …)`,
same `mockFindChain` helper):

| Test | Scenario |
|---|---|
| `queries the outbox newest-first with the _id tie-breaker` | `sort({publicationDate:-1,_id:-1})`, `limit(21)`, `find({})` |
| `requests pageSize + 1 documents` | `pageSize: 5` → `limit(6)` |
| `projects only the generic list fields and the derivable event subfields` | asserts the exact `listProjection` object above |
| `never projects the full event, event.data, audit details or claim fields` | projection has no `event: 1`, no `"event.data"`, no `claimedBy`/`claimedAt`/`claimExpiresAt`, no `"event.audit.entities.entityid"` and no `"event.audit.details"` |
| `applies the status filter when given` | `status:"FAILED"` → `find({status:"FAILED"})` |
| `returns every status when no filter is given` | `find({})` |
| `encodes a Date publicationDate as ISO in the cursor` | doc `{ _id: ObjectId(...), publicationDate: new Date("2026-06-16T10:00:00Z") }` → cursor JSON `{ publicationDate: "2026-06-16T10:00:00.000Z", _id: "…" }` |
| `decodes the cursor back to a Date for the paging filter` | forward with that cursor → `find` filter's `$or[0].publicationDate.$lt` `toEqual(new Date("2026-06-16T10:00:00.000Z"))` |
| `rejects a tampered cursor` | garbage base64 and non-hex `_id` → `Cannot decode cursor` |
| `reverses order for a backward page` | `direction:"backward"` → `sort({publicationDate:1,_id:1})`, data reversed |
| `returns audit rows with only entity and action` | doc with `event.audit.entities = [{entity:"APPLICATION",action:"CREATE"}]` and no `event.id` → passed through untouched, no throw |

### Step 5 — the migration

File: `migrations/20260901120000-add-event-list-indexes.js` (bump the timestamp to *now* if you are
building later; it only has to sort after `20260825090000`). Exact content:

```js
export const up = async (db) => {
  await db.collection("inbox").createIndex({ eventTime: -1, _id: -1 });
  await db.collection("outbox").createIndex({ publicationDate: -1, _id: -1 });
};

export const down = async (db) => {
  await db.collection("inbox").dropIndex("eventTime_-1__id_-1");
  await db.collection("outbox").dropIndex("publicationDate_-1__id_-1");
};
```

Notes:

- `createIndex` is idempotent for an identical spec, so a re-run is safe.
- No `{ background: true }` — that option is a no-op on modern MongoDB and no existing migration
  uses it.
- `down` is optional in this repo (only 2 of 44 migrations have one) but cheap and safe here.
- **Before writing this, run the pre-check in Risks below** to confirm no `outbox` document has a
  string `publicationDate` in the environments you care about.

Verification: there is **no `npm run migrate`**. Migrations run at service boot from
`src/grants/index.js` (`await up(db, mongoClient)`). To verify locally, either
(a) start the `fg-grants-core` compose stack / `npm run dev` and check the "Migrated: …" log line,
or (b) run `npm run test:integration` — `test/setup.js` boots the container, which runs the
migrations, and then confirm with
`db.inbox.getIndexes()` / `db.outbox.getIndexes()` against `mongodb://localhost:27018`.

### Step 6 — real-Mongo keyset test (recommended)

`test/grants/event-pagination.test.js`. This is the only place the ticket's "no duplicate or skipped
row under interleaved insert" AC can actually be proven — the unit tests above assert query shape,
not Mongo's ordering semantics.

Pattern (follow `test/grant-admin/get-claims.test.js`):

```js
import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findPage } from "../../src/grants/repositories/inbox.repository.js";
```

`beforeAll` connects to `env.MONGO_URI` and grabs `client.db().collection("inbox")`;
`test/cleanup.js` already empties `inbox`/`outbox` before every test, so just insert fixtures.
Importing the repository pulls in `src/common/mongo-client.js`, which connects lazily to the same
`MONGO_URI` — no extra wiring needed.

Fixture helper — **note `eventTime` is a string, `publicationDate` a `Date`**:

```js
const inboxDoc = (n, overrides = {}) => ({
  messageId: `msg-${n}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  status: "PUBLISHED",
  completionAttempts: 1,
  eventTime: new Date(Date.UTC(2026, 5, 16, 10, n)).toISOString(),
  lastResubmissionDate: null,
  completionDate: null,
  segregationRef: `ref-${n}`,
  event: { id: `evt-${n}`, time: "…", data: { clientRef: "secret" } },
  claimedBy: null,
});
```

| Test | Scenario |
|---|---|
| `pages forward through every document exactly once` | insert 25 docs; walk `findPage` with pageSize 10 following `endCursor` until `hasNextPage` is false; assert 25 distinct `_id`s in strictly descending `eventTime` order |
| `pages backward to the identical previous page` | go forward two pages, then `direction:"backward"` from page 3's `startCursor`; assert the rows equal page 2 in the same order |
| `does not duplicate or skip a row when a newer document is inserted mid-walk` | take page 1, insert a doc with `eventTime` newer than every existing one, take page 2 via `endCursor`; assert no `_id` appears twice and none of the original 25 is missing |
| `honours the status filter` | seed all six statuses; `status:"DEAD_LETTER"` returns only those |
| `returns all statuses with no filter` | seed all six; unfiltered first page contains every status |
| `rejects a tampered cursor with 400` | `expect(findPage({cursor:"tampered"})).rejects.toMatchObject({ output: { statusCode: 400 } })` |
| `never returns event, event.data or claimedBy` | assert `Object.keys(data[0])` contains none of them |
| `outbox pages newest-first by publicationDate` | same walk against `outbox.repository.findPage` with `Date` publication dates |

### Step 7 — green

```
npm run lint
npm run test:unit -- --run
npm run test:integration -- --run   # needs Docker; skip if unavailable and say so in the PR
```

---

## Risks / gotchas

1. **Mixed BSON types in a sort key destroy keyset ordering — RESOLVED, see the follow-up notes.**
   Mongo's canonical type order is `Null < Number < String < Object < … < Date`, and comparison
   operators are type-bracketed, so a collection holding *both* string and `Date` values in the
   sort field sorts all Dates after all strings and a cursor decoded to one type **silently skips
   the other block entirely** — those rows become unreachable, not merely mis-ordered. This was
   proved against real Mongo (integration test `sort-key type hazards before the normalising
   migration`), and it was reachable through the existing model, since `Outbox.fromDocument`
   preserved a string `publicationDate`.

   **This is now fixed in the code rather than managed at release time.**
   `migrations/20260901130000-normalise-event-sort-keys.js` normalises both collections at boot,
   and the `Outbox` constructor converts a string `publicationDate` to a `Date` so the write path
   cannot re-introduce the mixture. The old pre-check —
   ```
   db.outbox.countDocuments({ publicationDate: { $type: "string" } })
   db.inbox.countDocuments({ eventTime: { $type: "date" } })
   ```
   — is therefore **optional post-deploy verification, no longer a release gate**; the migration
   makes both zero. Still do **not** try to solve this in the codec: normalising in the mapper
   (as the ticket's edge-case list suggests) fixes *display*, not *sort*.
2. **`inbox.eventTime` can be `null` — RESOLVED for existing data; one residual on the write path.**
   `migrations/20260114140800` backfilled it from `$event.time`, which is missing for any
   non-CloudEvent message. **This plan originally claimed such rows "paginate correctly"; that was
   wrong.** It holds only inside a *pure* null block: as soon as any string-valued row precedes
   them, `{eventTime: {$lt: "<string>"}}` is type-bracketed and never matches null, so the null
   rows are stranded exactly as in Risk 1. Both behaviours are now pinned by integration tests.

   `migrations/20260901130000-normalise-event-sort-keys.js` rebuilds every missing, null or
   non-string `eventTime` from `event.time`, or from the `_id` timestamp when there is nothing to
   rebuild from, so existing data is safe. **Residual:** `Inbox`'s constructor still does
   `this.eventTime = props.event.time`, so a message with no `time` can write a fresh null. The
   inbox model was deliberately not touched here (it belongs to the separately-raised
   `publicationDate` bug), so an inbox write-time guard is a recommended follow-up.

   The codecs above deliberately map `undefined → null` so a missing key can never make
   `JSON.stringify` drop a cursor field.
3. **`ObjectId.createFromHexString` throws on anything but 24 hex chars** — which is exactly the
   400 the ticket wants for a tampered cursor. But it also means any legacy `inbox`/`outbox`
   document with a *string* `_id` becomes an un-pageable wall. Verified that none exist by
   construction (the driver assigns `ObjectId` at
   `node_modules/mongodb/lib/utils.js:1054`), but if `db.inbox.countDocuments({_id:{$type:"string"}})`
   is non-zero in an environment, this plan breaks there.
   Do **not** use bare `new ObjectId(v)`: `new ObjectId(undefined)` silently *generates a new id*
   instead of throwing, which would turn a truncated cursor into a random position.
4. **Index build on a large collection blocks boot.** Migrations run inside the hapi plugin's
   `register`, before `server.start()` (`src/main.js:15-18`), so a slow `createIndex` on
   never-purged `inbox`/`outbox` collections delays the container passing its `/health` check on
   CDP. Check `db.inbox.stats().count` in prod before deploying; if it is large, consider building
   the index out-of-band first (the migration is then a no-op).
5. **Secondary reads.** In production `readPreference` is `secondary`
   (`src/common/mongo-client.js:5-7`), so a page can lag replication by seconds and a row inserted
   between two requests may appear late. Keyset pagination stays correct (no skip/dup) because the
   cursor is a position, not an offset — but the integration test must not assume read-your-writes;
   the test Mongo is a single node with `directConnection=true`, so it is fine there.
6. **`publicationDate` on `inbox` is a trap.** It is rewritten to *now* on every `update()`
   (`src/grants/models/inbox.js:25`), so sorting or displaying it would reorder rows on every retry.
   It is deliberately absent from the inbox projection. Reviewers will ask; the answer is that line.
7. **Do not round-trip through the models.** Both `Inbox` and `Outbox` constructors `Joi`-validate
   fields the projection omits and mutate dates/claim fields. `Inbox`'s constructor also reads
   `props.event.time`, which throws outright on a projected document.
8. **`complexity: max 4`** will fail the build on the ported `paginate` unless the
   `// eslint-disable-next-line complexity` comment comes across with it.
9. **Vitest automock brittleness.** `db.collection.mockReturnValue({ find })` returns the same stub
   for every collection name; if a test needs both boxes at once, use `mockImplementation((name) => …)`.
   `mockReset: true` means every stub must be set up inside its own `it`.

---

## Acceptance for this plan (subset of the ticket's)

- `paginate` produces stable keyset pages: forward/backward symmetry, no duplicate or skipped row
  under interleaved insert, `400 Cannot decode cursor` on a tampered cursor.
- `findPage` on both repositories reads at most `pageSize + 1` documents, issues **no**
  `countDocuments`, honours an optional `status`, and returns every status when none is given.
- No response path can leak `event`, `event.data`, `claimedBy`, claim timestamps, `traceparent`,
  `event.audit.entities[].entityid` or `event.audit.details`.
- Both indexes exist after boot.

## Contract concerns — all RESOLVED

*(Kept as a record. Every item below was raised against the original ticket, accepted by the
coordinator, and is now reflected in the amended `tickets/FGP-1392.md`. This plan matches the
amended contract; nothing here is an open question. Do not re-litigate — build to the ticket.)*

1. **RESOLVED — the sort key `createdAt` does not exist on either collection.**
   *Evidence:* `createdAt` is absent from `Inbox.toDocument` (`src/grants/models/inbox.js:57-75`)
   and `Outbox.toDocument` (`src/grants/models/outbox.js:64-78`).
   *Decision (accepted):* sort keys are **per source** — inbox `{ eventTime: -1, _id: -1 }`,
   outbox `{ publicationDate: -1, _id: -1 }`; `createdAt` is the **derived output name only**.
   The ticket's Request flow step 3 now states this verbatim. Steps 3 and 4 above implement it.

2. **RESOLVED — the two sort keys have different BSON types, so there is no single codec.**
   *Evidence:* `inbox.eventTime` is an ISO **string** (`src/grants/models/inbox.js:38`, sourced from
   `CloudEvent.time` at `src/common/cloud-event.js:10`); `outbox.publicationDate` is a native
   **Date** (`src/grants/models/outbox.js:37`).
   *Decision (accepted):* keep **per-source codecs** — inbox `eventTime` compared as a string,
   outbox `publicationDate` as Date ↔ ISO, `_id` as ObjectId ↔ hex on both. The ticket's
   Data/interfaces → Files line now says exactly this.
   *Knock-on for Plan 02:* each slice of the composite cursor uses its own source's encoding
   (`{ eventTime, _id }` for an inbox, `{ publicationDate, _id }` for an outbox), so the composite
   cursor cannot be validated with one schema. The ticket's Request flow step 5 now says so.

3. **RESOLVED — projecting `event.audit.entities` wholesale would leak a business identifier.**
   *Evidence:* the entity objects written by `src/common/with-audit.js:24` are
   `{ entity, action, entityid }`, and `entityid` is an agreement number / application reference —
   which the AC *"contains no … business identifier from a payload"* forbids.
   *Decision (accepted):* project **only** `"event.audit.entities.entity"` and
   `"event.audit.entities.action"`; **never** `entityid` and never `event.audit.details`. The
   ticket's Field-derivation footnote now states this. Step 4's projection and its
   "never projects…" test enforce it.

4. **RESOLVED — audit outbox rows have no `event.id` and no `event.type` at all.**
   *Evidence:* the audit payload built by `src/common/write-audit-event.js:64-82` carries
   `datetime`/`correlationid`/`component`/`audit`, not a CloudEvent envelope.
   *Decision (accepted as-is):* the fallbacks (`eventId = _id`, type = `audit · <entity>.<action>`)
   are the **normal path** for audit rows, not a legacy edge case, so Plan 02's mapper must not warn
   or log on them. The repository returns the row as-is and classifies nothing.

5. **RESOLVED — `inbox.publicationDate` is unusable and is not exposed.**
   *Evidence:* `src/grants/models/inbox.js:25` overwrites it with `new Date().toISOString()` on every
   construction, so it reflects the last *save*, not publication.
   *Decision (accepted as-is):* it stays out of the inbox projection entirely, and remains a
   separately-raised bug (ticket, Related tickets). Inbox rows derive `createdAt` from `eventTime`.

6. **RESOLVED — duplicate of (1).** The prose and the Migrations/FGP-1227 lines disagreed about the
   sort field; both now say `eventTime`/`publicationDate`. No further action.

7. **RESOLVED (coordinator decision, not raised here) — `kind` is dropped from the contract.**
   There is no `domain|audit` field in the response. Audit rows are identified **structurally** by
   the presence of `event.audit.entities`. Plan 01 must not introduce a `kind`, `isAudit` or `box`
   field, nor filter on one. (The ticket's Open questions note a `kind` filter can be added back in
   one line by the later filter story.)

8. **RESOLVED (coordinator decision) — `pageSize` and `status` conventions.**
   Callers pass `pageSize: 20`; `paginate` adds the `+1` look-ahead itself, so `findPage` never
   pre-adds it. `status` is passed through to the filter without enum validation in the repository —
   the route validates the six values in Plan 02, and the GAS response schema types `status` as a
   plain string so a single unexpected document cannot fail a whole page.

---

## Implementation notes

Built in a dedicated worktree: `/home/donatas/code/fg-gas-backend-fgp-1392`, branch `FGP-1392-gas`
(from `origin/main` @ `1d10f4b`). Nothing committed — all changes left in the working tree.
Node v24.15.0 (repo `.nvmrc` pins v24.14.1; `engines` says `>=24`, mise-managed 24.x used).

### Files added

- `src/common/paginate.js` — CW helper ported verbatim minus `countDocuments`/`totalCount`.
  `Promise.all` removed, the find chain awaited directly. `encodeCursor`, `decodeCursor`,
  `getPagingFilter`, `invert`, `ensureTieBreaker`, the `// eslint-disable-next-line complexity`
  comment and `Boom.badRequest("Cannot decode cursor")` all unchanged.
- `src/common/paginate.test.js` — 21 tests. `makeCollection(docs)` lost its `totalCount` argument;
  `countDocuments` is now a bare `vi.fn()` so the new **"never counts documents"** test can assert it
  was never called. All `totalCount` assertions dropped. New **"throws Boom.badRequest when a codec
  rejects the value"** test added. Every other case from the plan's table is present.
- `migrations/20260901120000-add-event-list-indexes.js` — exact content from Step 5
  (`up` creates both indexes, `down` drops them by their auto-generated names). Sorts after the
  latest existing migration, `20260827120000-add-claims-collection.js`.
- `test/grants/event-pagination.test.js` — 9 real-Mongo tests (Step 6).

### Files changed

- `src/grants/repositories/inbox.repository.js` — added `import { ObjectId } from "mongodb"` and
  `import { paginate } from "../../common/paginate.js"`, the module-level `listProjection`,
  `listCodecs`, `listSort` (verbatim from the plan) plus a small `listFilter` helper (see
  Deviations), and `findPage` at the bottom of the file.
- `src/grants/repositories/inbox.repository.test.js` — added `describe("findPage", …)` with the
  `mockFindChain` helper and all 12 cases from the plan's table.
- `src/grants/repositories/outbox.repository.js` — same shape with the outbox projection, the
  `publicationDate` Date↔ISO codec and `{ publicationDate: -1, _id: -1 }` sort.
- `src/grants/repositories/outbox.repository.test.js` — added `describe("findPage", …)` with all 11
  cases from the plan's table.

Both `findPage` functions return the raw projected documents — no `mapDocument`, no
`Inbox.fromDocument`/`Outbox.fromDocument` round-trip, no `kind`/`isAudit`/`box` field, no enum
validation on `status`, no pre-added `+1` (the caller passes `pageSize: 20`).

### Test results

| Command | Result |
|---|---|
| `npm run lint` | **pass**, 0 errors, 0 warnings |
| `npx prettier --write <the 8 touched files>` | clean (only the new integration test was reformatted) |
| `npm run test:unit -- --run` | **pass** — 163 files, **1660/1660** tests |
| `npm run test:integration -- --run event-pagination` | **pass** — 1 file, **9/9** tests |
| `npm run test:integration -- --run` (whole suite) | **pass** — 32 files, **128 passed / 6 skipped (134)** |

Integration tests **did run**: Docker was available and testcontainers brought up the full
`compose.yml` stack (Mongo 27018, floci 4567, GAS 3001) without trouble.

**Index verification.** A throwaway integration test was run against the containerised Mongo,
asserting `inbox.indexes()` contains `eventTime_-1__id_-1` and `outbox.indexes()` contains
`publicationDate_-1__id_-1` after the service booted and ran the migrations. It passed; the
temporary file was then deleted. Both indexes exist after boot, as required.

### Deviations from the plan

1. **`listFilter` helper extracted (both repositories).** `findPage` written exactly as the plan
   specifies fails `complexity: ["error", { max: 4 }]` with *"Async arrow function has a complexity
   of 5"* — the three default parameters (`= {}`, `direction = "forward"`, `pageSize = 20`) plus the
   `status ? { status } : {}` ternary come to 5. Rather than add a second `eslint-disable`, the
   ternary moved to a module-level

   ```js
   // Extracted so `findPage` stays inside the configured complexity max of 4.
   const listFilter = (status) => (status ? { status } : {});
   ```

   and `findPage` passes `filter: listFilter(status)`. Behaviour is byte-identical; the signature,
   defaults and returned shape are unchanged. This is the smallest sensible change and does not
   touch the contract.
2. **`npm run setup:env` had to be run in the worktree** to create `.env` from `.env.example` —
   testcontainers' compose client fails at `DockerComposeEnvironment.up` without it. `.env` is
   gitignored, so it does not appear in the working-tree changes. Not a code change.
3. **Integration fixtures carry a few extra fields** beyond the plan's `inboxDoc` sketch
   (`publicationDate`, `claimedAt`, `claimExpiresAt`) so the "never returns … claim fields" test has
   something real to prove the projection excludes. `eventTime` is still an ISO string and outbox
   `publicationDate` still a native `Date`, as the plan requires.

### Skipped / not done

- **The Risks §1 pre-check was not run against any real environment.** `db.outbox.countDocuments({
  publicationDate: { $type: "string" } })` and `db.inbox.countDocuments({ eventTime: { $type: "date"
  } })` need access to a deployed Mongo, which this task had none of. The migration was written
  without a type-conversion step, per the plan's default. **Run both counts against each target
  environment before deploying**; if `outbox` holds string `publicationDate` values, add the
  `$toDate` `updateMany` ahead of `createIndex` and say so in the PR.
- Risks §4 (index build time on a large production collection) likewise unverified — no prod access.
  `db.inbox.stats().count` should be checked before deploy, since migrations run inside the hapi
  plugin's `register` and a slow build delays the CDP health check.
- No HTTP route, use case, schema or CW fan-out — those are Plan 02, deliberately out of scope here.
- Nothing committed or pushed, as instructed.

---

## Implementation notes — follow-up: test plan and gap closure

A second pass produced `01-gas-pagination.test-plan.md` alongside this plan and closed every
gap in it that is testable in `fg-gas-backend`. Same worktree
(`/home/donatas/code/fg-gas-backend-fgp-1392`, branch `FGP-1392-gas`), still nothing committed.

### Added

- **`tickets/FGP-1392/01-gas-pagination.test-plan.md`** (the only file written outside the
  worktree) — scope under test, 101 numbered cases in eight tables, an "Integration tests"
  section describing what each file seeds and asserts, a gaps table, and a run record.
  101 cases: **75 added by this work**, **11 pre-existing and cited rather than duplicated**,
  **15 GAP rows** (14 of them Plan 02 / FE scope, plus the release-gate checks).
- **`test/grants/event-list-indexes.test.js`** (new, 5 tests) — index presence after boot,
  exact index keys, an `explain()` assertion that the list query wins an `IXSCAN` rather than a
  `COLLSCAN`, migration `up` idempotency, and `down`-then-`up`. It imports the migration module
  directly, following `test/integration/seed-access-token.test.js`. An `afterAll` re-applies
  `up`, and IX-05 restores inline, so the database is left as the service booted it.

### Rewritten

- **`test/grants/event-pagination.test.js`** — expanded from 9 tests to **27**. Fixtures now
  carry sentinel secrets (`SECRET-CLIENT-REF`, `SECRET-AGREEMENT-NUMBER`,
  `SECRET-AUDIT-DETAILS`) and the fields the projection must strip (`traceparent`,
  `publicationDate`, claim fields), so leakage is asserted on the serialised response rather
  than by key name alone. New coverage: per-page size ceiling; first/last page flags;
  backward round-trip to page 1; an **older** document inserted mid-walk; `_id` tie-break with
  25 rows sharing one sort key (both boxes); a cursor reused under a different filter; a
  well-formed cursor with a non-hex `_id`; exact returned key sets; audit rows carrying only
  `entity`/`action`; audit and domain rows listed together; and real-document cursor encoding
  for both boxes.

### Findings worth escalating

Two new tests (IT-25, IT-26) pin down the plan's Risks 1 and 2 as **reproducible data-loss
paths**, not just ordering quirks:

- **A string `publicationDate` mixed with `Date` values makes rows unreachable.** Mongo's
  canonical type order puts every `Date` after every `String`, and `$lt` against a `Date` is
  type-bracketed, so a keyset walk stops at the end of the `Date` block and never reaches the
  string rows. Verified against real Mongo: 4 seeded rows, only 2 returned by a full walk.
- **The same applies to `null`/missing `eventTime`.** This plan's Risk 2 says such rows
  "paginate correctly"; that holds *only* when no string-valued row precedes them (IT-27
  confirms a pure null block walks fine). In a mixed collection they are stranded.

`src/grants/models/outbox.test.js :: "should create an outbox object from existing document"`
already proves `Outbox.fromDocument` preserves a string `publicationDate`, so the first path is
reachable through the existing model — it is not hypothetical. **The Risks §1 pre-deploy counts
remain a release gate**, and if either is non-zero the `$toDate` conversion must go into the
migration ahead of `createIndex`.

### Concurrency note

Partway through this follow-up another agent began building **Plan 02** in the *same worktree*
(`src/grant-admin/routes/find-events.route.js`, `use-cases/find-events.use-case.js`,
`services/{event-cursor,map-event-row,merge-event-pages}.js`, `test/helpers/cw-stub.js`,
`compose/compose.test-cw.yml`, and edits to `test/setup.js`, `test/vitest.config.js`,
`src/grant-admin/index.js`, `.env.example`). Their changes are additive and do not touch any
Plan 01 file; `findPage`, `paginate.js` and the migration were verified intact. The two of us
share the fixed integration ports (3001/4567/4568/27018), so integration runs had to be
serialised; the run record in the test plan notes which runs were affected.

### Follow-up run record

| Command | Result |
|---|---|
| `npm run lint` | **pass** — 0 errors, 0 warnings |
| `npm run test:unit -- --run` | **pass** — 171 files, **1786 passed (1786)** |
| `npm run test:integration -- --run event-pagination event-list-indexes` | **pass** — 2 files, **32 passed (32)** |
| `npm run test:integration -- --run` (whole suite) | **pass** — 35 files, **186 passed \| 6 skipped (192)** |

Plan 01 contributes 43 unit + 32 integration = **75 tests**. The unit and whole-suite totals
also include the Plan 02 agent's tests, since both plans share this worktree; see the
"Run record" section of `01-gas-pagination.test-plan.md` for the isolation detail and the
`EADDRINUSE` port-sharing caveat.

Nothing skipped for want of Docker — testcontainers ran the full `compose.yml` stack for every
integration run. The 6 skipped tests are pre-existing skips elsewhere in the suite.

---

## Implementation notes — follow-up 2: sort-key normalisation

Coordinator decision: **option 1** — fix the mixed-BSON-type hazard in code rather than manage
it as a release gate. Same worktree (`/home/donatas/code/fg-gas-backend-fgp-1392`, branch
`FGP-1392-gas`), nothing committed. Plan 02's agent had finished, so the worktree was no longer
shared and the earlier `EADDRINUSE` port contention no longer applied.

### Added

- **`migrations/20260901130000-normalise-event-sort-keys.js`** — timestamped after the index
  migration, same ESM `up`/`down` module format as the rest of the directory.
  - `outbox`: every `{ publicationDate: { $type: "string" } }` becomes a real `Date`. The
    unparsable-string fallback is expressed with **`$dateFromString`'s `onError`/`onNull`**
    resolving to `{ $toDate: "$_id" }`, so no string can survive.
  - `inbox`: every `{ eventTime: { $not: { $type: "string" } } }` — which covers missing, null
    and any wrong type — is rebuilt from `$event.time` when that is a non-empty string, else
    from `{ $toString: { $toDate: "$_id" } }`, keeping the field's canonical ISO-string type.
  - **Pipeline, not a cursor loop.** One server-side `updateMany` with an aggregation pipeline
    per collection; no documents are pulled into the application. `$dateFromString`'s `onError`
    expressed the fallback cleanly, so the batched-loop escape hatch was not needed.
  - **Idempotent** — each pass selects only still-wrong-typed documents, so a second run matches
    nothing (asserted by NM-09/NM-10).
  - **`down` is a deliberate no-op that logs.** Documented in the file: once a string has become
    a `Date` we no longer know which rows were strings or what their original text was, and
    re-introducing mixed types would restore the very fault the migration removes.
  - **Ordering rationale, in the file header:** it runs *after* the index migration. Index
    creation over mixed types is harmless — an index stores whatever types are present — so
    there is no need to normalise first. What matters is that both have run before anything
    *reads* through the index, and migrate-mongo applies them in timestamp order in the same
    boot, before `server.start()`.
- **`test/grants/event-type-normalisation.test.js`** (10 integration tests) — seeds a mixed
  outbox (Date + parsable string + unparsable string) and a mixed inbox (good string, null with
  `event.time`, missing with `event.time`, missing with none, null with an empty `event.time`),
  applies `up` directly, then asserts the resulting types and values, both ObjectId-timestamp
  fallbacks, idempotency, and — the point of the exercise — that a full forward `findPage` walk
  now returns **3 of 3** outbox and **5 of 5** inbox rows where it previously returned 2 and 2.

### Changed

- **`src/grants/models/outbox.js`** — the constructor's `props.publicationDate || new Date()`
  became `props.publicationDate ? new Date(props.publicationDate) : new Date()`, so a legacy
  string read back through `fromDocument` cannot be written out as a string again. Nothing else
  in the model was touched; the inbox `publicationDate` bug was left alone as instructed.
- **`src/grants/models/outbox.test.js`** — two new tests for the guard, and one **pre-existing
  assertion deliberately inverted**: `"should create an outbox object from existing document"`
  asserted `expect(newDoc.publicationDate).toBe("2025-10-16T10:41:52.964Z")`, i.e. that a string
  survives the round trip. That is precisely the behaviour being removed, so it now asserts a
  `Date` of the same instant. This is the only pre-existing assertion this work changed.
- **`test/grants/event-pagination.test.js`** — the hazard block was renamed to
  `"sort-key type hazards before the normalising migration"` and cross-referenced. These tests
  seed bad data and never invoke the migration, so they still pass and now serve as the proof
  that the migration is what fixes the fault. They are the "before" to the new file's "after".

### Results

| Command | Result |
|---|---|
| `npm run lint` | **pass** — 0 errors, 0 warnings |
| `npm run test:unit -- --run` | **pass** — 171 files, **1788 passed (1788)** |
| `npm run test:integration -- --run event-type-normalisation event-pagination event-list-indexes` | **pass** — 3 files, **42 passed (42)** |
| `npm run test:integration -- --run` (whole suite) | **pass** — 36 files, **196 passed \| 6 skipped (202)** |

### Consequences for the PR

- The Risks §1 `$type` counts are **no longer a release gate** — Risks 1 and 2 above have been
  rewritten to say so. Running them post-deploy is optional verification.
- **One residual to flag in review:** `Inbox`'s constructor still derives `eventTime` from
  `props.event.time`, so a message arriving with no `time` can still write a null after the
  migration has run. The outbox write path is now closed; the inbox one is not, because that
  model belongs to the separately-raised `publicationDate` bug. Recommended follow-up.
