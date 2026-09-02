# Test plan — CW `GET /actuators/inbox` / `GET /actuators/outbox` (FGP-1227, repointed)

Companion to `03-cw-actuators.md`. Repo under test: **`fg-cw-backend`**, worktree
`/home/donatas/code/fg-cw-backend-fgp-1227`, branch `FGP-1227-actuators`.

Derived from FGP-1392 *Data / interfaces → CW* (line 186), *Related tickets → FGP-1227*
(line 223), and the plan's Steps 1-11 and Risks 1-12.

## Scope under test

**In scope**

- `src/common/paginate.js` — the new `withTotal: false` opt-out only. The rest of
  `paginate` is pre-existing and already covered; this plan cites that coverage rather
  than restating it.
- `src/cases/repositories/inbox.repository.js` / `outbox.repository.js` — the new
  `findPage` export: filter, sort, projection, cursor codecs and the flattening
  `mapDocument`. No other export in those files changed.
- `src/actuators/use-cases/find-{inbox,outbox}-page.use-case.js` — pass-through plus the
  `maxAttempts` stamp read from CW's own retry config.
- `src/actuators/schemas/box-page-response.schema.js` — the declared (not enforced)
  response contract, including its refusal of `entityid`, `kind` and `event`.
- `src/actuators/routes/find-{inbox,outbox}.route.js` — surface (`public-api`, tags,
  swagger security), query validation, handler wiring.
- `src/actuators/index.js` — both routes registered, `/actuators/boxes` gone.
- `migrations/20260901120000-add-actuator-event-indexes.js` — the four indexes exist
  after boot.
- The end-to-end HTTP contract of both endpoints against a real Mongo + real auth.

**Out of scope**

- The GAS half (`GET /grant-admin/events`) and the FE page — separate plans.
- `paginate`'s pre-existing keyset algebra, the `public-api` scheme internals and
  service-token seeding mechanics: covered by existing tests, cited below, not
  re-implemented here.
- Any write path. These endpoints are read-only.

## Test cases

Status legend: **existing-before** = coverage that already existed on `origin/main` and
is cited, not duplicated; **added-by-this-work** = written for FGP-1227;
**GAP** = deliberately not covered (see *Gaps*).

### A. Pagination helper (`withTotal`)

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| P-1 | Keyset algebra: cursors, `$gt`/`$lt` filters, forward/backward, tie-breaker `_id`, `mapDocument`, codecs, bad cursor → `Boom.badRequest` | unit | `src/common/paginate.test.js` :: 19 tests across `first page`, `forward pagination with cursor`, `backward pagination`, `empty results`, `cursor decoding`, `mapDocument`, `codecs` | existing-before |
| P-2 | `withTotal: false` omits `totalCount` **and** does not call `countDocuments` | unit | `paginate.test.js` :: `withTotal > omits totalCount and does not count when withTotal is false` | added-by-this-work |
| P-3 | Default (option absent) still counts and still returns `totalCount` | unit | `paginate.test.js` :: `withTotal > still counts when withTotal is omitted` | added-by-this-work |
| P-4 | `withTotal: true` still counts | unit | `paginate.test.js` :: `withTotal > still counts when withTotal is true` | added-by-this-work |
| P-5 | `totalCount: 0` is not mistaken for "absent" | unit | `paginate.test.js` :: `withTotal > returns totalCount 0 without treating it as absent` | added-by-this-work |
| P-6 | The rest of the envelope is unchanged when `withTotal: false` | unit | `paginate.test.js` :: `withTotal > keeps the rest of the pagination envelope when withTotal is false` | added-by-this-work |

### B. Inbox repository `findPage`

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| RI-1 | Sort is `{ eventTime: -1, _id: -1 }` (explicit tie-break) | unit | `src/cases/repositories/inbox.repository.test.js` :: `inbox.repository findPage > sorts newest first with an _id tie-break` | added-by-this-work |
| RI-2 | `withTotal: false` is passed through | unit | `… > skips the total count` | added-by-this-work |
| RI-3 | `status` present → `{ status }` filter | unit | `… > filters by status when given` | added-by-this-work |
| RI-4 | `status` absent → `{}` (all six statuses) | unit | `… > uses an empty filter when status is absent` | added-by-this-work |
| RI-5 | `cursor` / `direction` / `pageSize` forwarded verbatim | unit | `… > passes cursor, direction and pageSize through` | added-by-this-work |
| RI-6 | Projection is exactly the generic fields; no `event`, no `claimedBy` | unit | `… > projects only the generic fields` | added-by-this-work |
| RI-7 | `messageId` → `eventId` | unit | `… > maps messageId to eventId` | added-by-this-work |
| RI-8 | `eventTime` → `createdAt` | unit | `… > maps eventTime to createdAt` | added-by-this-work |
| RI-9 | `lastResubmissionDate` → `lastFailureAt` | unit | `… > maps lastResubmissionDate to lastFailureAt` | added-by-this-work |
| RI-10 | `completionDate` → `completedAt` | unit | `… > maps completionDate to completedAt` | added-by-this-work |
| RI-11 | `_id` rendered as a hex string | unit | `… > renders _id as a hex string` | added-by-this-work |
| RI-12 | A `Date` `eventTime` is normalised to ISO (FGP-1392 line 181, one timestamp type) | unit | `… > normalises a Date eventTime to ISO` | added-by-this-work |
| RI-13 | An ISO-string `eventTime` passes through unchanged | unit | `… > passes an ISO string eventTime through` | added-by-this-work |
| RI-14 | Absent optionals are `null`, never `undefined` (JSON would drop them) | unit | `… > returns null rather than undefined for absent optional fields` | added-by-this-work |
| RI-15 | The mapped row carries no `event` and no `claimedBy` key | unit | `… > never returns event or claimedBy` | added-by-this-work |
| RI-16 | `_id` codec round-trips hex ↔ `ObjectId` (Risk 3, 5) | unit | `… > encodes and decodes _id cursor values as ObjectIds` | added-by-this-work |
| RI-17 | `eventTime` codec keeps the **string** type (Risk 3: no `Date` may reach it) | unit | `… > keeps eventTime cursor values as strings` | added-by-this-work |
| RI-18 | `findPage` returns `paginate`'s result untouched | unit | `… > returns the paginate result unchanged` | added-by-this-work |

### C. Outbox repository `findPage`

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| RO-1 | Sort is `{ publicationDate: -1, _id: -1 }` | unit | `src/cases/repositories/outbox.repository.test.js` :: `outbox.repository findPage > sorts newest first with an _id tie-break` | added-by-this-work |
| RO-2 | `withTotal: false` | unit | `… > skips the total count` | added-by-this-work |
| RO-3 | `status` filter present / RO-4 absent | unit | `… > filters by status when given`, `… > uses an empty filter when status is absent` | added-by-this-work |
| RO-5 | `cursor` / `direction` / `pageSize` forwarded | unit | `… > passes cursor, direction and pageSize through` | added-by-this-work |
| RO-6 | Projection is exactly `event.id`, `event.type`, `event.audit.entities` + generics; never `event` whole, `event.data`, `event.audit.details`, `claimedBy` | unit | `… > projects only event.id, event.type and event.audit.entities` | added-by-this-work |
| RO-7 | CloudEvent row → `eventId` / `type` | unit | `… > maps a CloudEvent row to eventId and type` | added-by-this-work |
| RO-8 | Audit row → `eventId: null`, `type: null`, entities present (FGP-1392 line 69, structural recognition) | unit | `… > maps an audit row to null eventId, null type and its audit entities` | added-by-this-work |
| RO-9 | `entityid` stripped from every audit entity; keys are exactly `["entity","action"]` (Risk 9) | unit | `… > strips entityid from every audit entity` | added-by-this-work |
| RO-10 | Empty `entities` array stays `[]`, never `null` (Risk 11 / ticket line 145) | unit | `… > keeps an empty audit entities array as an array, not null` | added-by-this-work |
| RO-11 | CloudEvent row → `auditEntities: null` | unit | `… > returns null auditEntities for a CloudEvent row` | added-by-this-work |
| RO-12 | `event.audit.details` never reaches the row | unit | `… > never returns audit details` | added-by-this-work |
| RO-13 | `target` returned as the raw ARN (contract decision 2) | unit | `… > returns the raw target ARN unmodified` | added-by-this-work |
| RO-14 | `_id` hex | unit | `… > renders _id as a hex string` | added-by-this-work |
| RO-15 | `Date` `publicationDate` → ISO string | unit | `… > converts a Date publicationDate to an ISO string` | added-by-this-work |
| RO-16 | Absent optionals → `null` | unit | `… > returns null rather than undefined for absent optional fields` | added-by-this-work |
| RO-17 | No `event` / `claimedBy` on the row | unit | `… > never returns event or claimedBy` | added-by-this-work |
| RO-18 | `_id` codec round-trip | unit | `… > encodes and decodes _id cursor values as ObjectIds` | added-by-this-work |
| RO-19 | `publicationDate` codec round-trips **`Date`** ↔ ISO (Risk 3) | unit | `… > encodes and decodes publicationDate cursor values as Dates` | added-by-this-work |
| RO-20 | `findPage` returns `paginate`'s result untouched | unit | `… > returns the paginate result unchanged` | added-by-this-work |

### D. Use cases (`maxAttempts`)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| U-1 | Query args forwarded to the repository | unit | `src/actuators/use-cases/find-inbox-page.use-case.test.js` :: `passes cursor, direction, pageSize and status through` (+ outbox twin) | added-by-this-work |
| U-2 | Pagination envelope returned unchanged, still without `totalCount` | unit | `… :: returns the repository pagination envelope unchanged` (+ twin) | added-by-this-work |
| U-3 | `maxAttempts` stamped on **every** row | unit | `… :: stamps maxAttempts on every row` (+ twin) | added-by-this-work |
| U-4 | Inbox reads `INBOX_MAX_RETRIES` (7) and outbox reads `OUTBOX_MAX_RETRIES` (9) — distinct values, so a copy-paste onto the wrong key fails (contract decision 5) | unit | `find-inbox-page.use-case.test.js :: reads maxAttempts from the inbox retry config`; `find-outbox-page.use-case.test.js :: reads maxAttempts from the outbox retry config` | added-by-this-work |
| U-5 | `maxAttempts` is a number, not the config's `String` (Risk 10) | unit | `… :: returns maxAttempts as a number, not a string` (+ twin) | added-by-this-work |
| U-6 | The rest of each row is untouched | unit | `… :: leaves the rest of each row untouched` (+ twin) | added-by-this-work |
| U-7 | Empty page returns `data: []` | unit | `… :: returns an empty data array untouched when the page is empty` (+ twin) | added-by-this-work |

### E. Response schema

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| S-1 | A full inbox row validates | unit | `src/actuators/schemas/box-page-response.schema.test.js` :: `inboxPageResponseSchema > accepts a full inbox row` | added-by-this-work |
| S-2 | Empty page with `null` cursors validates | unit | `… > accepts an empty page with null cursors` | added-by-this-work |
| S-3 | `null` for every optional timestamp | unit | `… > accepts nulls for every optional timestamp` | added-by-this-work |
| S-4 | `maxAttempts` required / S-5 must be an integer | unit | `… > requires maxAttempts on every row`, `… > rejects a non-integer maxAttempts` | added-by-this-work |
| S-6 | A status outside the six is **accepted** as a plain string (ticket edge case "never a 500") | unit | `… > accepts a status outside the six values` (+ outbox twin) | added-by-this-work |
| S-7 | A row carrying `event` is rejected (AC line 133) | unit | `… > rejects a row carrying an event object` (+ twin) | added-by-this-work |
| S-8 | A row carrying `kind` is rejected (contract decision 3) | unit | `… > rejects a row carrying a kind key` (+ twin) | added-by-this-work |
| S-9 | A row carrying `claimedBy` is rejected | unit | `… > rejects a row carrying claimedBy` | added-by-this-work |
| S-10 | `pagination` carrying `totalCount` is rejected | unit | `… > rejects a totalCount in pagination` | added-by-this-work |
| S-11 | Outbox CloudEvent row / audit row with `null` eventId+type validate | unit | `outboxPageResponseSchema > accepts a full outbox CloudEvent row`, `… > accepts an audit outbox row with null eventId and type` | added-by-this-work |
| S-12 | An audit entity carrying `entityid` is **rejected** — schema backstop for RO-9 | unit | `… > rejects an audit entity carrying entityid` | added-by-this-work |
| S-13 | `auditEntities: []` and `auditEntities: null` both validate; the key is required | unit | `… > accepts an empty auditEntities array`, `… > accepts a null auditEntities`, `… > requires auditEntities to be present` | added-by-this-work |
| S-14 | The raw ARN survives validation in `target` | unit | `… > accepts the raw SNS ARN in target` | added-by-this-work |

### F. Routes (surface + query validation)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| R-1 | Method + path are `GET /actuators/inbox` / `…/outbox` | unit | `src/actuators/routes/find-inbox.route.test.js` :: `is a GET on /actuators/inbox` (+ twin) | added-by-this-work |
| R-2 | `auth: "public-api"` | unit | `… :: is on the public-api strategy` (+ twin) | added-by-this-work |
| R-3 | `tags: ["api","public-api"]` | unit | `… :: is tagged for the public API surface` (+ twin) | added-by-this-work |
| R-4 | Swagger `security: [{ serviceToken: [] }]` overrides the global `jwt` block | unit | `… :: declares the service token security scheme` (+ twin) | added-by-this-work |
| R-5 | Each route declares **its own** box's response schema (guards a copy-paste) | unit | `… :: declares its own box's response schema` (asserts the Joi label `InboxPageResponse` / `OutboxPageResponse`) | added-by-this-work |
| R-6 | `response.failAction: "log"` — schema drift must not 500 GAS (Risk 8) | unit | `… :: declares the response schema without failing the request on drift` (+ twin) | added-by-this-work |
| R-7 | Defaults: `direction=forward`, `pageSize=20` | unit | `… :: defaults direction to forward and pageSize to 20` (+ twin) | added-by-this-work |
| R-8 | `pageSize` bounds: > 50, < 1, fractional all rejected | unit | `… :: rejects pageSize above 50`, `… :: rejects pageSize below 1`, `… :: rejects a fractional pageSize` (+ twins) | added-by-this-work |
| R-9 | Unknown `direction` / unknown `status` rejected | unit | `… :: rejects an unknown direction`, `… :: rejects an unknown status` (+ twins) | added-by-this-work |
| R-10 | All six statuses accepted | unit | `… :: accepts each of the six statuses` (+ twin) | added-by-this-work |
| R-11 | No query at all is valid (absent = all) | unit | `… :: accepts a request with no query at all` (+ twin) | added-by-this-work |
| R-12 | An unknown query param is rejected | unit | `… :: rejects an unknown query parameter` (+ twin) | added-by-this-work |
| R-13 | The validated query reaches the use case and its result is returned | unit | `… :: passes the validated query to the use case` (+ twin) | added-by-this-work |

### G. Module registration and auth surface

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| M-1 | Both routes are registered by the `actuators` plugin | unit | `src/actuators/index.test.js` :: `registers the inbox and outbox routes` | added-by-this-work (rewritten from the `/actuators/boxes` assertion) |
| M-2 | **Every** `/actuators/*` route sits on `PUBLIC_API_STRATEGY` — the README:426 guard; picks up new routes automatically | unit | `src/actuators/index.test.js` :: `keeps every /actuators/* route on the public API strategy` | existing-before (left verbatim) |
| M-3 | Service-token scheme: valid token authenticates and exposes `service`; lookup is by sha256, never the raw value; whitespace tolerated; `WWW-Authenticate` challenge; unknown token, expired token rejected; future expiry accepted; strategy composition (falls through with no bearer, does not fall through on a bad bearer) | unit | `src/server/plugins/auth/public-api.test.js` :: 9 tests | existing-before (cited, not duplicated) |

### H. HTTP contract, end to end

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| I-1 | No `Authorization` header → 401 | integration | `test/actuators/find-inbox.test.js :: auth > rejects a request with no token` (+ outbox twin) | added-by-this-work |
| I-2 | Unknown bearer token → 401 | integration | `… auth > rejects an unknown token` (+ twin) | added-by-this-work |
| I-3 | A valid **Entra user** token → 401 (the BFF credential must not open the public API) | integration | `… auth > rejects a valid Entra user token` (+ twin) | added-by-this-work |
| I-4 | The seeded service token → 200 | integration | `… auth > answers a caller holding the seeded service token` (+ twin) | added-by-this-work |
| I-5 | `SERVICE_ACCESS_TOKEN_HASH` is seeded on boot and stored **hashed** | integration | `test/actuators/access-token-seeding.test.js :: seeds the configured client's access token on boot` | existing-before (relocated verbatim from the deleted `find-boxes.test.js`) |
| I-6 | `pageSize=51` → 400 | integration | `… validation > rejects pageSize=51 with 400` (+ twin) | added-by-this-work |
| I-7 | `pageSize=0` → 400 | integration | `… validation > rejects pageSize=0 with 400` (+ twin) | added-by-this-work |
| I-8 | `direction=sideways` → 400 | integration | `… validation > rejects direction=sideways with 400` (+ twin) | added-by-this-work |
| I-9 | `status=BOGUS` → 400 | integration | `… validation > rejects status=BOGUS with 400` (+ twin) | added-by-this-work |
| I-10 | Tampered cursor → 400 with body message `Cannot decode cursor` | integration | `… validation > rejects a tampered cursor with 400` (+ twin) | added-by-this-work |
| I-11 | Empty collection → `data: []`, `null` cursors, both flags false | integration | `… empty collection > returns an empty page with null cursors` (+ twin) | added-by-this-work |
| I-12 | Newest first by `eventTime` / `publicationDate` | integration | `… listing > returns events newest first by eventTime`; outbox `… by publicationDate` | added-by-this-work |
| I-13 | Equal sort keys tie-break on `_id` descending | integration | `… tie-breaking > breaks ties on _id descending` (+ twin) | added-by-this-work |
| I-14 | `pageSize` honoured; `hasNextPage`/`hasPreviousPage` correct on page 1 | integration | `… paging > returns at most pageSize rows` (+ twin) | added-by-this-work |
| I-15 | Default page size is 20 when `pageSize` is omitted | integration | `… paging > defaults to 20 rows when pageSize is omitted` (+ twin) | added-by-this-work |
| I-16 | **Interleaved insert**: a newer row written between page 1 and page 2 neither duplicates nor skips a row (AC line 118) | integration | `… paging > does not duplicate or skip a row when a newer row is inserted between pages` (+ twin) | added-by-this-work |
| I-17 | Forward then backward returns page 1 in the same order, no overlap | integration | `… paging > walks forward and back without duplicating or skipping a row` (+ twin) | added-by-this-work |
| I-18 | No `status` → all six statuses returned (default = All) | integration | `… filtering > returns every status when no status is given` (+ twin) | added-by-this-work |
| I-19 | `status=DEAD_LETTER` → only matching rows | integration | `… filtering > returns only matching rows when status is given` (+ twin) | added-by-this-work |
| I-20 | `maxAttempts` reflects CW's own retry cap (`INBOX_MAX_RETRIES` / `OUTBOX_MAX_RETRIES` = 5 in the test env) on every row | integration | `… listing > stamps maxAttempts from CW's INBOX_MAX_RETRIES on every row`; outbox `… OUTBOX_MAX_RETRIES …` | added-by-this-work |
| I-21 | No `kind` field on the wire | integration | `… listing > returns no kind field` (+ twin) | added-by-this-work |
| I-22 | No `totalCount` in `pagination` | integration | `… listing > omits totalCount from pagination` (+ twin) | added-by-this-work |
| I-23 | Inbox: `source`, `messageId`→`eventId`, top-level `type`, `segregationRef`, ISO `createdAt` | integration | `… listing > exposes source, messageId as eventId and the top-level type` | added-by-this-work |
| I-24 | Outbox: `publicationDate` serialised as an ISO string | integration | `find-outbox.test.js :: listing > serialises publicationDate as an ISO string` | added-by-this-work |
| I-25 | Outbox: `target` is the **raw** SNS ARN | integration | `… listing > returns the raw SNS target ARN` | added-by-this-work |
| I-26 | Outbox: CloudEvent row → `eventId`/`type`, `auditEntities: null` | integration | `… audit rows > maps a CloudEvent row to eventId and type`, `… > returns null auditEntities for a CloudEvent row` | added-by-this-work |
| I-27 | Outbox: audit row → `null` eventId/type and `auditEntities` from a seeded payload that **does** carry `entityid` | integration | `… audit rows > maps an audit row to null eventId, null type and its audit entities` | added-by-this-work |
| I-28 | Outbox: `entityid` stripped — the row is exactly `[{entity, action}]` | integration | `… audit rows > strips entityid from audit entities` | added-by-this-work |
| I-29 | Outbox: the serialised body matches neither `/entityid/`, `/details/` nor the seeded business reference. **The single most important assertion in the suite** (Risk 9) | integration | `… audit rows > never leaks entityid or audit details` | added-by-this-work |
| I-30 | Outbox: empty audit `entities` stays `[]` on the wire | integration | `… audit rows > keeps an empty audit entities array as an empty array` | added-by-this-work |
| I-31 | Body contains no `claimedBy`, no `"event"`, no `details`, no payload business identifiers — with a fat `event.data` and a non-null `claimedBy` seeded (AC line 133) | integration | `… leakage > never returns event, event.data or claimedBy` (+ twin) | added-by-this-work |
| I-32 | The four actuator indexes exist after boot — migrations run in `src/main.js` (Risk 1) | integration | `test/actuators/actuator-indexes.test.js :: 4 tests` | added-by-this-work |

## Integration tests

All three files run against the real stack brought up by `test/setup.js`
(`DockerComposeEnvironment` over `compose.yml`: CW backend, Mongo replica set, floci,
Entra stub), with `test/cleanup.js` truncating `inbox` and `outbox` before every test.

### `test/actuators/find-inbox.test.js` — 23 tests

**Seeds** (`MongoClient` on `env.MONGO_URI`, plain documents, explicit `new ObjectId()`
`_id`s — never `Inbox.createMock`, whose default `_id` is the string `"1234"` and would
break the `toHexString()` codec, Risk 5):

- A generic inbox document factory with `messageId`, top-level `type`, `source: "GAS"`,
  `segregationRef`, `status`, `completionAttempts`, ISO `eventTime`, and a nested
  `event` object.
- Every fixture holds a claim — `claimedBy: "test-holder"`, `claimExpiresAt: 2099-01-01`
  — so the live inbox poller (`claimedBy: null`) and the claim-expiry sweep
  (`claimExpiresAt < now`) leave it alone for the life of the test. This also gives the
  leakage test a genuinely non-null `claimedBy` to prove is hidden.
- Per describe block: 3 rows at distinct `eventTime`s (ordering); 2 rows sharing an
  `eventTime` (tie-break); 25 rows at `10:00`-`10:24` (paging); one row per status
  (filtering); one row with a fat `event.data` and `claimedBy: "worker-1"` (leakage).

**Asserts** — I-1 … I-4, I-6 … I-23, I-31: auth on all four credential shapes, the four
400s, empty page, ordering, `_id` tie-break, `pageSize` honoured / defaulted / bounded,
interleaved-insert paging, forward+backward symmetry, default-All and `status` filter,
`maxAttempts: 5`, no `kind`, no `totalCount`, field derivation, and a
`JSON.stringify(payload)` regex proving the body contains no `claimedBy`, no `"event"`,
no `details` and neither seeded identifier.

### `test/actuators/find-outbox.test.js` — 30 tests

**Seeds**: the outbox equivalent — `event: { id, type }`, a full SNS ARN in `target`, a
`Date` `publicationDate`, the same held claim. Plus an audit fixture built to match
`src/common/write-audit-event.js`: `event.audit.entities = [{ entity: "CASE", action:
"VIEW_CASE_LIST", entityid: "APPLICATION-REF-1" }]` **with** `event.audit.details`
carrying a query and a security context, and a variant with `entities: []`.

**Asserts** — the whole of the inbox list plus I-24 … I-30: ISO `publicationDate`, raw
ARN, CloudEvent vs audit derivation, `entityid` stripped down to exactly
`{entity, action}`, `[]` preserved as `[]`, and the payload matching neither
`/entityid/`, `/details/` nor `/APPLICATION-REF-1/`.

### `test/actuators/actuator-indexes.test.js` — 4 tests

**Seeds** nothing. Reads `db.collection(...).indexes()` after the stack is healthy —
migrations run on boot in `src/main.js`.

**Asserts** — I-32: `inbox` carries `{eventTime: -1, _id: -1}` and
`{status: 1, eventTime: -1, _id: -1}`; `outbox` carries `{publicationDate: -1, _id: -1}`
and `{status: 1, publicationDate: -1, _id: -1}`. Without these the endpoints do a
collection scan with an in-memory sort and will hit Mongo's 32 MB sort limit on these
never-purged collections (Risk 1).

### `test/actuators/access-token-seeding.test.js` — 1 test

**Seeds** nothing; reads the `access_tokens` collection.

**Asserts** — I-5: the configured client's record exists with `expiresAt: null` and
`record.id !== SERVICE_TOKEN`, i.e. the token is stored hashed. Relocated verbatim from
the deleted `test/actuators/find-boxes.test.js` per FGP-1392 line 223 — if seeding
silently breaks, *every* actuator auth test fails with an indistinguishable 401 and this
is the only test that names the cause.

## Gaps / not testable here

| Gap | Why |
|---|---|
| `maxAttempts` differing between the two boxes is not distinguishable at the **integration** level | `test/vitest.config.js` sets `INBOX_MAX_RETRIES` and `OUTBOX_MAX_RETRIES` both to `5`, so both endpoints legitimately return `5`. Changing the shared config to prove the difference would alter the retry behaviour every other integration test depends on. Covered instead at unit level by U-4, which forces the two caps apart (7 vs 9) and fails if either use case reads the other's key. |
| `response.schema` is not **enforced** at runtime | Deliberate (plan decision 5, Risk 8): `failAction: "log"` keeps a drifting payload flowing to GAS rather than turning it into a 500. So no integration test can assert a schema rejection; the schema is covered as a declared contract by E-1…E-14 and its presence/`failAction` by R-5/R-6. |
| Swagger output (`/swagger.json` listing both paths with `serviceToken` security and the `InboxPageResponse`/`OutboxPageResponse` definitions) | Not asserted end-to-end. `src/server/index.test.js :: serves swagger` already covers `/swagger.json` existing, and R-3/R-4/R-5 assert the exact route metadata hapi-swagger renders from. A doc-shape assertion would pin hapi-swagger's rendering rather than our contract. |
| Rows with a **missing/null `eventTime`** paging behaviour (Risk 4) | Known and accepted: such rows sort last and a cursor encoded from one produces `$lt: null`, which matches nothing, so paging dead-ends at the tail rather than erroring. Deliberately not pinned by a test because the intended behaviour is a follow-up backfill (`$ifNull` to the `_id` timestamp), not this shape. Flagged in the plan's Risks for the PR. |
| Sort-key **type mixing** across BSON types under real Mongo (Risk 3) | Covered structurally by RI-17 / RO-19 (the codecs keep the stored type) rather than by a fixture that stores the wrong type on purpose — writing such a row would require bypassing the models, which is not a state the service can reach. |
| Mongo actually **using** the new indexes (an `explain()` assertion) | Not asserted. I-32 proves the indexes exist; asserting a specific query plan would pin the Mongo 6.0 planner rather than our contract. |
| Load / latency (FGP-1392 non-functional: ≤ 1 s merged page) | Out of scope for CW's half; belongs with the GAS merge story. |
| GAS-side consumption of this contract | Plan 02 (`GET /grant-admin/events`), separate repo. |

## Run record

Worktree `/home/donatas/code/fg-cw-backend-fgp-1227`, branch `FGP-1227-actuators`,
Node 24.15.0.

```bash
npm run lint
npm run test:unit -- --run
npm run test:integration -- --run
```

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 1 warning — pre-existing `object-shorthand` in `migrations/20260526160000-rename-woodland-workflow.js`, an untouched file |
| `npm run test:unit -- --run` | 166 files / **1785 passed** (2026-09-01 15:50, after all additions; harness files at origin/main state) |
| `npm run test:integration -- --run` | 30 files / **193 passed**, 0 failed (2026-09-01 15:54, exit 0, 40.0s). Per file: `test/actuators/find-inbox.test.js` 23/23 passed, `test/actuators/find-outbox.test.js` 30/30 passed, `test/actuators/actuator-indexes.test.js` 4/4 passed, `test/actuators/access-token-seeding.test.js` 1/1 passed. The two previously pre-existing SQS round-trip timeouts in `create-case`/`replace-case` did **not** recur — the whole suite was green. Run in one attempt with temporary, since-reverted harness edits (see Environment note). |

New/changed test counts contributed by this work:

| Suite | File | Tests |
|---|---|---|
| unit | `src/common/paginate.test.js` (`withTotal` block) | 5 added (19 pre-existing retained) |
| unit | `src/cases/repositories/inbox.repository.test.js` (`findPage` block) | 18 added |
| unit | `src/cases/repositories/outbox.repository.test.js` (`findPage` block) | 20 added |
| unit | `src/actuators/use-cases/find-inbox-page.use-case.test.js` | 7 added |
| unit | `src/actuators/use-cases/find-outbox-page.use-case.test.js` | 7 added |
| unit | `src/actuators/schemas/box-page-response.schema.test.js` | 21 added |
| unit | `src/actuators/routes/find-inbox.route.test.js` | 16 added |
| unit | `src/actuators/routes/find-outbox.route.test.js` | 16 added |
| unit | `src/actuators/index.test.js` | 1 rewritten, 1 retained |
| integration | `test/actuators/find-inbox.test.js` | 23 added |
| integration | `test/actuators/find-outbox.test.js` | 30 added |
| integration | `test/actuators/actuator-indexes.test.js` | 4 added |
| integration | `test/actuators/access-token-seeding.test.js` | 1 relocated (was `find-boxes.test.js`) |

**Cited existing coverage** (not duplicated): `src/common/paginate.test.js` 19 keyset
tests, `src/server/plugins/auth/public-api.test.js` 9 service-token tests,
`src/actuators/index.test.js :: keeps every /actuators/* route on the public API
strategy`, `src/server/index.test.js :: serves swagger`.

### Environment note

Two things had to be shifted temporarily to get a run on this machine; both were
reverted afterwards (`git diff` on `test/setup.js`, `test/vitest.config.js` and
`compose.yml` is empty).

1. **Host ports.** Only `CW_PORT` (3101) and `ENTRA_PORT` (3011) are actually taken
   locally, by the long-running `oyster-fg-cw-backend-1` and `entra-platform-admin`
   containers; they were shifted to `3199` / `3099`. `MONGO_PORT` 27018 and
   `FLOCI_PORT` 4567 are **free** and were left alone — and `FLOCI_PORT` must stay
   `4567` anyway, because `test/helpers/sqs.js:14` and `sns-utils.js:8` fall back to a
   hardcoded `http://localhost:4567` during `globalSetup`, where vitest's `test.env` is
   not applied to `process.env`. `test/setup.js`'s
   `Wait.forHttp("/health", env.CW_PORT)` also had to be pinned to the
   container-internal port `3101`: testcontainers resolves that argument as a
   *container* port via `boundPorts.getBinding()`, so it must not be shifted with the
   host port.

2. **Compose network (the real cause of the earlier `rs.initiate` failure).**
   `compose.yml` attaches every service to a network declared as `name: cdp-tenant`,
   which the developer's `oyster-*` stack is already on. `oyster-mongodb-1` therefore
   holds the DNS alias `mongodb` on that network (verified via `docker inspect`), so the
   throwaway `mongo-ready` container's `PRIMARY: mongodb:27017` resolved
   non-deterministically to either mongod. That is why the previous attempt reported
   `no replset config has been received` — not the port shift. Renaming the network to
   `cwit-tenant` for the run isolated the stack; `rs.status()` then reported
   `myState: 1` with the single member `mongodb:27017` on the first poll, and the
   backend health wait passed immediately.

The compose project was pinned with `.withProjectName("cwit")` (after
`.withNoRecreate()`, which otherwise forces the project name to `testcontainers-node`)
so teardown was deterministic. Vitest's `globalTeardown` removed the stack and its
volumes; `docker compose -p cwit down -v --remove-orphans` confirmed nothing was left,
and the `oyster-*` / `entra-platform-admin` containers were untouched throughout.
