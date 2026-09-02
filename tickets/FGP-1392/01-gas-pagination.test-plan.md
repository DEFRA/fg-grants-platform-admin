# Plan 01 — GAS pagination foundation: test plan

Companion to `01-gas-pagination.md`. Ticket (contract): `../FGP-1392.md`.
Repo under test: `fg-gas-backend`, worktree `/home/donatas/code/fg-gas-backend-fgp-1392`,
branch `FGP-1392-gas`.

Every row in the table below points at a test that exists and runs today. Rows marked
**existing** were already in the repo before this work and are cited rather than duplicated;
rows marked **added** were written for Plan 01. Rows marked **GAP** are explained in
"Gaps / not testable here".

## Scope under test

The six deliverables of Plan 01, and nothing beyond them:

1. `src/common/paginate.js` — the cursor-pagination primitive, ported from `fg-cw-backend`
   without `countDocuments`/`totalCount`.
2. `src/common/paginate.test.js` — the ported unit suite.
3. `findPage` in `src/grants/repositories/inbox.repository.js` — paged, projection-limited
   reads over `inbox`, sorted `{ eventTime: -1, _id: -1 }`.
4. `findPage` in `src/grants/repositories/outbox.repository.js` — the same over `outbox`,
   sorted `{ publicationDate: -1, _id: -1 }`.
5. `migrations/20260901120000-add-event-list-indexes.js` — the two indexes that make those
   reads cheap.
6. `test/grants/event-pagination.test.js` — keyset stability against real Mongo.
7. `migrations/20260901130000-normalise-event-sort-keys.js` — normalises both sort keys to a
   single BSON type so mixed types cannot strand rows (added after the coordinator chose to fix
   the hazard rather than manage it as a release gate).
8. The write-time guard in `src/grants/models/outbox.js` that keeps `publicationDate` a `Date`.

**Explicitly out of scope** (Plan 02): `GET /grant-admin/events`, the composite cursor, the
four-source merge, the shared field mapper, ARN reduction, `sourceErrors`, CW fan-out, and
every FE behaviour in the ticket. Where a ticket AC is only half-satisfiable here, the row
says so and names the half Plan 01 owns.

## Test cases

### A. `paginate` primitive (unit)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| PG-01 | First page with no cursor returns the rows plus start/end cursors and both page flags | unit | `src/common/paginate.test.js :: paginate > first page (no cursor) > returns data with pagination metadata` | added |
| PG-02 | Filter, projection, sort and `limit(pageSize + 1)` reach the collection unchanged | unit | `… :: first page (no cursor) > passes filter, project, sort and limit to collection` | added |
| PG-03 | **NFR: never issues `countDocuments`** — no total, no full-collection load | unit | `… :: first page (no cursor) > never counts documents` | added |
| PG-04 | `_id` tie-breaker appended using the last sort key's direction | unit | `… :: first page (no cursor) > appends _id to sort using last sort direction` | added |
| PG-05 | An explicit `_id` in the sort is left alone | unit | `… :: first page (no cursor) > does not append _id when sort already includes _id` | added |
| PG-06 | `hasNextPage` true when the look-ahead row comes back | unit | `… :: forward pagination with cursor > sets hasNextPage when there are more results` | added |
| PG-07 | `hasPreviousPage` is `!!cursor` on a forward page | unit | `… :: forward pagination with cursor > sets hasPreviousPage to true when cursor is present` | added |
| PG-08 | Keyset `$or` filter for an ascending sort uses `$gt` | unit | `… :: forward pagination with cursor > builds paging filter for ascending sort` | added |
| PG-09 | Keyset `$or` filter for a descending sort uses `$lt` | unit | `… :: forward pagination with cursor > builds paging filter for descending sort` | added |
| PG-10 | A backward page inverts the sort sent to Mongo | unit | `… :: backward pagination > reverses sort direction for query` | added |
| PG-11 | A backward page reverses the rows back to display order | unit | `… :: backward pagination > reverses docs back to original order` | added |
| PG-12 | Backward `hasNextPage` is hard-coded true; `hasPreviousPage` comes from `hasMore` | unit | `… :: backward pagination > sets hasNextPage to true and hasPreviousPage based on hasMore` | added |
| PG-13 | Backward `hasPreviousPage` false at the start of the stream | unit | `… :: backward pagination > sets hasPreviousPage to false when no more backward results` | added |
| PG-14 | Backward keyset filter flips the comparison operators | unit | `… :: backward pagination > builds paging filter with reversed operators` | added |
| PG-15 | Empty result set → null cursors, both flags false | unit | `… :: empty results > returns null cursors and false for page flags` | added |
| PG-16 | **AC: tampered cursor → `400 Cannot decode cursor`** | unit | `… :: cursor decoding > throws Boom.badRequest for invalid cursor` | added |
| PG-17 | A codec that throws during `decode` produces the same 400 (the ObjectId tamper path) | unit | `… :: cursor decoding > throws Boom.badRequest when a codec rejects the value` | added |
| PG-18 | `mapDocument` transforms the returned rows | unit | `… :: mapDocument > applies mapDocument to results` | added |
| PG-19 | Cursors are built from raw documents, never from mapped rows | unit | `… :: mapDocument > cursors are based on original docs not mapped data` | added |
| PG-20 | Codecs encode sort values into the cursor (Date → ISO) | unit | `… :: codecs > encodes and decodes cursor values using codecs` | added |
| PG-21 | Codecs decode before the keyset filter is built (filter carries a real `Date`) | unit | `… :: codecs > decodes cursor before building filter` | added |

### B. `inbox.findPage` (unit, mocked collection)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| IB-01 | Queries newest-first with the `_id` tie-breaker and a 21-row look-ahead | unit | `src/grants/repositories/inbox.repository.test.js :: inbox.repository > findPage > queries the inbox newest-first with the _id tie-breaker` | added |
| IB-02 | **NFR: reads at most `pageSize + 1`** — caller passes 20, repo never pre-adds | unit | `… :: findPage > requests pageSize + 1 documents` | added |
| IB-03 | Projects exactly the ten generic list fields | unit | `… :: findPage > projects only the generic list fields` | added |
| IB-04 | **AC: never projects `event`, `event.data`, claim fields, `traceparent`, `publicationDate`** | unit | `… :: findPage > never projects the payload or claim fields` | added |
| IB-05 | **AC: `status` filter applied** | unit | `… :: findPage > applies the status filter when given` | added |
| IB-06 | **AC: default is All — no filter narrows the query** | unit | `… :: findPage > returns every status when no filter is given` | added |
| IB-07 | Returns raw projected documents, no `Inbox.fromDocument` round-trip | unit | `… :: findPage > returns the raw documents without rebuilding the Inbox model` | added |
| IB-08 | Cursor encodes `{ eventTime, _id-as-hex }` | unit | `… :: findPage > encodes cursors from eventTime and _id` | added |
| IB-09 | Cursor `_id` decodes back to a real `ObjectId` in the keyset filter | unit | `… :: findPage > resumes from a cursor with a decoded ObjectId` | added |
| IB-10 | Tampered cursor (bad base64 and non-hex `_id`) → `Cannot decode cursor` | unit | `… :: findPage > rejects a tampered cursor` | added |
| IB-11 | Backward page inverts the sort and reverses the rows | unit | `… :: findPage > reverses order for a backward page` | added |

### C. `outbox.findPage` (unit, mocked collection)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| OB-01 | Queries newest-first by `publicationDate` with the `_id` tie-breaker, `limit(21)` | unit | `src/grants/repositories/outbox.repository.test.js :: outbox.repository > findPage > queries the outbox newest-first with the _id tie-breaker` | added |
| OB-02 | **NFR: reads at most `pageSize + 1`** | unit | `… :: findPage > requests pageSize + 1 documents` | added |
| OB-03 | Projects the generic fields plus `event.id`, `event.type` and the two audit subfields | unit | `… :: findPage > projects only the generic list fields and the derivable event subfields` | added |
| OB-04 | **AC: never projects full `event`, `event.data`, claim fields, `entityid`, `audit.details`** | unit | `… :: findPage > never projects the full event, event.data, audit details or claim fields` | added |
| OB-05 | **AC: `status` filter applied** | unit | `… :: findPage > applies the status filter when given` | added |
| OB-06 | **AC: default is All** | unit | `… :: findPage > returns every status when no filter is given` | added |
| OB-07 | A native `Date` `publicationDate` is encoded as ISO in the cursor | unit | `… :: findPage > encodes a Date publicationDate as ISO in the cursor` | added |
| OB-08 | The cursor decodes back to a real `Date` for the keyset filter | unit | `… :: findPage > decodes the cursor back to a Date for the paging filter` | added |
| OB-09 | Tampered cursor → `Cannot decode cursor` | unit | `… :: findPage > rejects a tampered cursor` | added |
| OB-10 | Backward page inverts the sort and reverses the rows | unit | `… :: findPage > reverses order for a backward page` | added |
| OB-11 | Audit rows (no `event.id`/`event.type`) pass through untouched, no throw | unit | `… :: findPage > returns audit rows with only entity and action` | added |

### D. Keyset behaviour against real Mongo (integration, testcontainers)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| IT-01 | **AC: a full forward walk returns every row exactly once, newest first** | integration | `test/grants/event-pagination.test.js :: inbox keyset pagination > pages forward through every document exactly once, newest first` | added |
| IT-02 | **AC: a page never exceeds `pageSize`** (25 rows at 10 → 10/10/5) | integration | `… :: inbox keyset pagination > never returns more than pageSize rows in a page` | added |
| IT-03 | **AC: no Previous on the first page, no Next on the last** | integration | `… :: inbox keyset pagination > reports no previous page on the first page and no next page on the last` | added |
| IT-04 | **AC: Previous from page 3 returns page 2 exactly, in the same order** | integration | `… :: inbox keyset pagination > pages backward to the identical previous page` | added |
| IT-05 | Forward-then-backward round trip returns to page 1 | integration | `… :: inbox keyset pagination > returns to the first page when paging backward twice` | added |
| IT-06 | **AC: a newer row inserted mid-walk duplicates and skips nothing** | integration | `… :: inbox keyset pagination > does not duplicate or skip a row when a newer document is inserted mid-walk` | added |
| IT-07 | An older row inserted mid-walk is picked up on the final page, still no dup/skip | integration | `… :: inbox keyset pagination > does not duplicate or skip a row when an older document is inserted mid-walk` | added |
| IT-08 | **Edge: identical sort keys tie-break deterministically on `_id` desc** (25 rows sharing one `eventTime`) | integration | `… :: inbox keyset pagination > tie-breaks on _id when every eventTime is identical` | added |
| IT-09 | **AC: `status` filter returns only that status** | integration | `… :: inbox keyset pagination > honours the status filter` | added |
| IT-10 | **AC: no filter returns all six statuses** | integration | `… :: inbox keyset pagination > returns every status when no filter is given` | added |
| IT-11 | **Edge: a cursor issued under one filter stays usable under another** | integration | `… :: inbox keyset pagination > accepts a cursor issued under a different filter` | added |
| IT-12 | **AC: tampered cursor rejects as Boom `statusCode: 400`** | integration | `… :: inbox keyset pagination > rejects a tampered cursor with a Boom 400` | added |
| IT-13 | A structurally valid cursor with a non-hex `_id` also rejects 400 | integration | `… :: inbox keyset pagination > rejects a well-formed cursor carrying a non-hex _id with a Boom 400` | added |
| IT-14 | **AC: leakage — the returned key set is exactly the ten list fields, and no payload identifier appears anywhere in the response** | integration | `… :: inbox keyset pagination > returns only the generic list fields, never the payload or claim fields` | added |
| IT-15 | Outbox forward walk, newest first by `publicationDate` | integration | `… :: outbox keyset pagination > pages forward through every document exactly once, newest first` | added |
| IT-16 | Outbox backward page returns the previous page exactly | integration | `… :: outbox keyset pagination > pages backward to the identical previous page` | added |
| IT-17 | Outbox tie-break on `_id` when `publicationDate` is identical | integration | `… :: outbox keyset pagination > tie-breaks on _id when every publicationDate is identical` | added |
| IT-18 | Outbox `status` filter and default-All | integration | `… :: outbox keyset pagination > honours the status filter and returns every status when unfiltered` | added |
| IT-19 | Outbox tampered cursor → Boom 400 | integration | `… :: outbox keyset pagination > rejects a tampered cursor with a Boom 400` | added |
| IT-20 | **AC: leakage — outbox returns only the nine list fields plus `event.id`/`event.type`; no `clientRef`/`sbi`** | integration | `… :: outbox keyset pagination > returns only the generic list fields plus event.id and event.type` | added |
| IT-21 | **AC: audit rows expose only `entity` and `action` — never `entityid`, never `details`** | integration | `… :: outbox keyset pagination > returns audit rows with only entity and action, never entityid or details` | added |
| IT-22 | Audit and domain rows list together; audit rows carry no `event.id`/`event.type` | integration | `… :: outbox keyset pagination > lists audit rows alongside domain rows with no id or type of their own` | added |
| IT-23 | Inbox cursor encodes `eventTime` + hex `_id` against a real document | integration | `… :: cursor encoding against real documents > encodes the inbox cursor as eventTime plus a hex _id` | added |
| IT-24 | Outbox cursor encodes `publicationDate` as ISO against a real document | integration | `… :: cursor encoding against real documents > encodes the outbox cursor with publicationDate as an ISO string` | added |

### E. Sort-key type hazards on un-normalised data (integration)

The failure modes from the plan's Risks 1 and 2, proved against real Mongo on data that has
**not** been through the normalising migration. These seed bad rows directly and never invoke
the migration, so they establish that the fault is real; section I then shows the migration is
what removes it. Keep the two sections in step — together they are the regression guard.

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| IT-25 | **Risk 1: a string `publicationDate` mixed with Dates makes rows unreachable** — the descending scan puts every Date before every String, and a `$lt` against a Date is type-bracketed, so the walk stops at the end of the Date block | integration | `… :: sort-key type hazards before the normalising migration > skips outbox rows whose publicationDate is a string, not a Date` | added |
| IT-26 | **Risk 2: `eventTime` null/missing rows are unreachable once a string-valued row precedes them** — `$lt: "<string>"` never matches null | integration | `… :: sort-key type hazards before the normalising migration > skips inbox rows whose eventTime is null or missing` | added |
| IT-27 | Within a pure null block the `_id` tie-breaker still carries the walk correctly | integration | `… :: sort-key type hazards before the normalising migration > pages through null eventTime rows when no string-valued row precedes them` | added |

### F. Indexes and migration (integration)

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| IX-01 | **Acceptance: both indexes exist after the service boots** (migrations run in the hapi plugin's `register`) | integration | `test/grants/event-list-indexes.test.js :: event list indexes > exist on inbox and outbox after the service boots` | added |
| IX-02 | Index keys are exactly `{ eventTime: -1, _id: -1 }` and `{ publicationDate: -1, _id: -1 }` | integration | `… :: event list indexes > are keyed newest-first with the _id tie-breaker` | added |
| IX-03 | **NFR: the list query is served by an `IXSCAN`, not a collection scan** | integration | `… :: event list indexes > serve the list query with an index scan rather than a collection scan` | added |
| IX-04 | `up` is idempotent — a re-run over an identical spec is safe | integration | `… :: event list indexes > can be re-applied idempotently` | added |
| IX-05 | `down` drops both indexes by their auto-generated names and `up` restores them | integration | `… :: event list indexes > are dropped by down and restored by up` | added |

### G. Pre-existing coverage this work depends on

Cited, not duplicated. These protect the model-level facts the projections, sort keys and
codecs are built on; if any of them changes, Plan 01 breaks.

| ID | Behaviour depended on | Level | Covering test | Status |
|---|---|---|---|---|
| PRE-01 | `completionAttempts` defaults to `1` and `status` to `PUBLISHED` — the `attempts`/`status` columns are always populated | unit | `src/grants/models/outbox.test.js :: Outbox model > should create an outbox object` | existing |
| PRE-02 | **`outbox.publicationDate` is a native `Date`** — the premise of the outbox codec and sort key | unit | `src/grants/models/outbox.test.js :: Outbox model > should create an outbox object` | existing |
| PRE-03 | `Outbox.fromDocument` **used to preserve** a string `publicationDate` — the proof that Risk 1 / IT-25 was reachable through the existing model, not hypothetical. This work closed that path, so the test's assertion was **deliberately inverted**: it now requires a `Date`. | unit | `src/grants/models/outbox.test.js :: Outbox model > should create an outbox object from existing document` | existing (assertion updated by this work — see MD-01) |
| PRE-04 | `Inbox` requires `source`, `event` and `segregationRef` and reads `props.event.time` — why `findPage` must never round-trip a projected document through the model | unit | `src/grants/models/inbox.test.js :: inbox model > should throw Boom error when source is missing`, `… > should throw Boom error with all validation failures` | existing |
| PRE-05 | `inbox.eventTime` is `event.time`, an ISO string — the premise of the inbox codec | unit | `src/grants/models/inbox.test.js :: inbox model > should convert to a document` | existing |
| PRE-06 | `inbox.publicationDate` reaches the document from the model, not from the caller — why it is excluded from the inbox projection | unit | `src/grants/models/inbox.test.js :: inbox model > should convert to a document` (asserts `doc.publicationDate === obj.publicationDate`). **Partial:** no existing test asserts that a caller-supplied `publicationDate` is discarded; the evidence for that is `src/grants/models/inbox.js:25` itself, and `… :: should create model from doc` notably does *not* assert the seeded value survives. | existing (partial) |
| PRE-07 | `markAsComplete`/`markAsFailed` write `completionDate`/`lastResubmissionDate` as ISO strings — display-only fields, never sort keys | unit | `src/grants/models/inbox.test.js :: inbox model > should mark a document as complete`, `… > should mark a document as failed` | existing |
| PRE-08 | The six-value status enum | unit | `src/grants/models/outbox.test.js`, `src/grants/models/inbox.test.js` (both import and assert against `OutboxStatus`/`InboxStatus`) | existing |
| PRE-09 | Existing inbox/outbox repository queries (claim, dead-letter, expiry, resubmit) still behave — regression cover for adding `findPage` and the shared `listFilter` helper to those modules | unit | all non-`findPage` describes in `src/grants/repositories/inbox.repository.test.js` and `…/outbox.repository.test.js` | existing |
| PRE-10 | A migration's `up` can be imported and applied directly in an integration test — the pattern IX-04/IX-05 follow | integration | `test/integration/seed-access-token.test.js` | existing |
| PRE-11 | `readPreference` is `secondary` only in production, `primary` elsewhere — the NFR is satisfied client-wide, so `findPage` passes no per-query read preference | unit | `src/common/mongo-client.test.js :: Mongo client > should get read preference based on environment` | existing |

### H. Ticket acceptance criteria not covered by Plan 01 (GAP rows)

Listed here so the table indexes the whole ticket, not just what Plan 01 builds. Each is a
deliberate scope boundary rather than missing work; the reasons are in "Gaps / not testable
here" below.

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| GAP-01 | `GET /grant-admin/events` returns `401` without a valid service token | integration | none — Plan 02 route | GAP (Plan 02) |
| GAP-02 | `?status=BOGUS` / `?service=other` → `400` from Joi | unit | none — Plan 02 query schema | GAP (Plan 02) |
| GAP-03 | Rows from all four sources merge newest-first; exactly 20 shown | unit | none — Plan 02 merge | GAP (Plan 02) |
| GAP-04 | Composite cursor encode/decode; unknown `v` → `400`; per-source slices | unit | none — Plan 02 cursor | GAP (Plan 02) |
| GAP-05 | Three sources exhausted, one with more rows → Next still available | unit | none — Plan 02 merge | GAP (Plan 02) |
| GAP-06 | `service=gas` skips Caseworking entirely | unit | none — Plan 02 use case | GAP (Plan 02) |
| GAP-07 | Field derivation: `createdAt`, `eventId`, short `type`, `audit · ENTITY.ACTION`, `fullType` null for audit | unit | none — Plan 02 mapper | GAP (Plan 02) |
| GAP-08 | `target` ARN reduced to a topic name (ticket AC "no full ARN values") | unit | none — Plan 02 mapper; `findPage` returns the raw `target` by design | GAP (Plan 02) |
| GAP-09 | `maxAttempts` from `config.{inbox,outbox}.*MaxRetries` per row | unit | none — Plan 02 mapper | GAP (Plan 02) |
| GAP-10 | CW unreachable / 401 / not configured → `sourceErrors`, still `200`; both GAS reads fail → `502` | integration | none — Plan 02 fan-out | GAP (Plan 02) |
| GAP-11 | Joi response schema round-trip | unit | none — Plan 02 schema | GAP (Plan 02) |
| GAP-12 | Every FE behaviour (badges, Europe/London formatting, pager hrefs, role scoping) | component | none — different repo | GAP (FE story) |
| GAP-13 | Production `publicationDate`/`eventTime` BSON-type counts are zero | manual | superseded — `migrations/20260901130000-normalise-event-sort-keys.js` now makes them zero at boot, and NM-01/NM-05 assert it against real Mongo | **closed** (optional post-deploy verification, no longer a gate) |
| GAP-14 | Index build time on a production-sized collection does not block boot | manual | none — needs production data volume | GAP (release gate) |
| GAP-15 | Secondary-read replication lag disclosed in the footer | manual | none — single-node test Mongo has no secondary | GAP (deployment property) |

### I. Sort-key normalisation — migration and write-time guard

Added after the coordinator chose to fix the mixed-type fault rather than manage it as a
release gate. Section E proves the fault; this section proves the fix.

| ID | Behaviour / scenario | Level | Covering test | Status |
|---|---|---|---|---|
| NM-01 | **Risk 1 fixed: no string `publicationDate` survives** — after `up`, zero outbox rows are a non-`date` type | integration | `test/grants/event-type-normalisation.test.js :: normalising the event sort keys > outbox.publicationDate > leaves no string publicationDate behind` | added |
| NM-02 | A parsable ISO string becomes the equivalent `Date`; a real `Date` is left alone | integration | `… :: outbox.publicationDate > converts a parsable string to the equivalent Date and leaves a real Date alone` | added |
| NM-03 | An **unparsable** string falls back to the row's ObjectId timestamp — never left as a string | integration | `… :: outbox.publicationDate > falls back to the ObjectId timestamp for an unparsable string` | added |
| NM-04 | **IT-25 inverted:** once normalised, a full forward walk returns all 3 mixed rows instead of 1 | integration | `… :: outbox.publicationDate > returns every row from a full forward walk once normalised` | added |
| NM-05 | **Risk 2 fixed: every `eventTime` is a string** — after `up`, zero inbox rows are a non-string type | integration | `… :: inbox.eventTime > leaves every eventTime as a string` | added |
| NM-06 | Null and missing `eventTime` are backfilled from `event.time` when it is a usable string; an already-good row is untouched | integration | `… :: inbox.eventTime > backfills from event.time when it is a usable string` | added |
| NM-07 | With no usable `event.time` (missing or empty), `eventTime` falls back to the ObjectId timestamp as an ISO string that round-trips to that instant | integration | `… :: inbox.eventTime > falls back to the ObjectId timestamp when event.time is missing or empty` | added |
| NM-08 | **IT-26 inverted:** once normalised, a full forward walk returns all 5 mixed rows | integration | `… :: inbox.eventTime > returns every row from a full forward walk once normalised` | added |
| NM-09 | **Idempotent:** a second `up` leaves every document in both collections byte-identical | integration | `… :: idempotency > changes nothing on a second run` | added |
| NM-10 | Safe against collections that are already clean | integration | `… :: idempotency > is safe to run against collections that are already clean` | added |
| MD-01 | **Write-time guard: a string `publicationDate` is converted to a `Date` by the `Outbox` constructor**, so a legacy row read and re-saved cannot re-introduce a string | unit | `src/grants/models/outbox.test.js :: Outbox model > converts a string publicationDate to a Date` | added |
| MD-02 | A `Date` `publicationDate` still round-trips as an equivalent `Date` (the guard changes nothing else) | unit | `src/grants/models/outbox.test.js :: Outbox model > leaves a Date publicationDate as an equivalent Date` | added |
| MD-03 | `fromDocument` on a legacy string-dated document now yields a `Date` | unit | `src/grants/models/outbox.test.js :: Outbox model > should create an outbox object from existing document` (assertion inverted — see PRE-03) | existing (updated) |

## Integration tests

Both files run under `npm run test:integration`, which boots the whole `compose.yml` stack via
testcontainers (Mongo on 27018, floci on 4567, GAS on 3001). `test/cleanup.js` empties `inbox`
and `outbox` before every test, so each test seeds its own fixtures. The containerised GAS runs
the migrations during plugin registration, so the new indexes are present before the first test.
Importing a repository pulls in `src/common/mongo-client.js`, which connects lazily to the same
`MONGO_URI` — no extra wiring.

### `test/grants/event-pagination.test.js` (27 tests)

**Seeds.** `inboxDoc(n)` — an inbox document with `eventTime` as an **ISO string**
(`2026-06-16T10:0n`), plus the fields the projection must exclude: a `publicationDate`, a
`traceparent`, claim fields, and an `event.data` carrying the sentinel `SECRET-CLIENT-REF`
and an `sbi`. `outboxDoc(n)` — the same shape with `publicationDate` as a native **`Date`**,
a full SNS ARN `target`, and a CloudEvent `event` with `id`, `type` and a secret-bearing
`data`. `auditOutboxDoc(n)` — an audit payload with **no** `event.id`/`event.type`, whose
`audit.entities[0]` carries `entityid: "SECRET-AGREEMENT-NUMBER"` and whose `audit.details`
carries `SECRET-AUDIT-DETAILS`.

**Asserts against real Mongo.** That a full forward walk over 25 documents returns each row
exactly once in strictly descending sort-key order and never overruns `pageSize` (IT-01, IT-02);
that page flags mark the ends of the stream (IT-03); that backward paging reproduces the
preceding page byte-for-byte by `_id` and round-trips to page 1 (IT-04, IT-05); that inserting
a newer or an older document mid-walk yields neither a duplicate nor a skipped row (IT-06,
IT-07); that 25 documents sharing one sort-key value still page deterministically by `_id`
descending (IT-08, IT-17); that the `status` filter narrows and its absence returns all six
statuses (IT-09, IT-10, IT-18); that a cursor is a position, not a filter, so it survives a
filter change (IT-11); that garbage and non-hex-`_id` cursors reject as Boom 400 (IT-12, IT-13,
IT-19); that the returned key sets are **exactly** the projected fields and that neither
sentinel string appears anywhere in the serialised response (IT-14, IT-20, IT-21); that audit
rows survive with only `entity` and `action` (IT-21, IT-22); and that cursors encode the real
BSON types correctly — ISO string for inbox `eventTime`, ISO string for a `Date`
`publicationDate`, hex for `_id` (IT-23, IT-24). It also pins the two type hazards (IT-25 to
IT-27) by seeding mixed `Date`/string `publicationDate` values and null/missing `eventTime`
values and asserting exactly which rows a keyset walk can and cannot reach.

### `test/grants/event-type-normalisation.test.js` (10 tests)

**Seeds.** A deliberately mixed `outbox` — one native `Date`, one parsable ISO string, and one
string no parser can read (`"not-a-date-at-all"`) — and a mixed `inbox` covering all five
shapes the migration must handle: a good ISO string, an explicit `null` with a usable
`event.time`, a missing field with a usable `event.time`, a missing field with no `event.time`
at all, and a `null` with an empty-string `event.time`.

**Asserts against real Mongo.** It imports the migration's `up` and applies it directly, then
checks that no outbox `publicationDate` is anything but a `date` and no inbox `eventTime` is
anything but a string (NM-01, NM-05); that parsable strings convert to the equivalent instant
while good rows are untouched (NM-02, NM-06); that both fallback paths land on the row's own
ObjectId timestamp, with the inbox one round-tripping through an ISO string (NM-03, NM-07);
that a full forward `findPage` walk over the previously-stranded data now returns **every** row
— 3 of 3 for outbox, 5 of 5 for inbox, the direct inversion of IT-25 and IT-26 (NM-04, NM-08);
and that a second `up` leaves both collections byte-identical, including against already-clean
data (NM-09, NM-10).

### `test/grants/event-list-indexes.test.js` (5 tests)

**Seeds.** Five minimal inbox documents for the explain plan; otherwise it inspects the
database the booted service left behind and drives the migration module directly (importing its
`up` and `down`, the pattern set by `test/integration/seed-access-token.test.js`).

**Asserts against real Mongo.** That `eventTime_-1__id_-1` and `publicationDate_-1__id_-1`
exist after boot and carry exactly the expected keys (IX-01, IX-02); that the unfiltered
newest-first list query with `limit(21)` wins an `IXSCAN` rather than a `COLLSCAN` (IX-03);
that `up` is safe to re-run (IX-04); and that `down` removes both indexes and `up` puts them
back (IX-05). An `afterAll` re-applies `up` so the database is left exactly as the service
booted it, whatever the tests did.

## Gaps / not testable here

| Area | Why there is no test in Plan 01 |
|---|---|
| `GET /grant-admin/events` — auth `401`, Joi query validation, `400` on `status=BOGUS`/`service=other`, response schema round-trip | No HTTP surface exists in Plan 01; the route, its schemas and its use case are Plan 02 deliverables. Plan 01 deliberately does no enum validation in the repository (contract concern 8). |
| Four-source merge ordering, composite cursor, `hasNextPage` across sources, "three sources exhausted and one with more rows" | Plan 02. Plan 01 provides one source's page and nothing that merges. |
| Field derivation — `createdAt`, `eventId`, short `type`, `audit · ENTITY.ACTION`, ARN → topic name, `maxAttempts` | Plan 02's shared mapper. Plan 01 returns raw projected documents on purpose, so there is nothing to assert here beyond the projection tests (IB-03/04, OB-03/04). Note the ticket AC "no full ARN values" is only half-covered here: `findPage` returns the raw `target` by design and Plan 02's mapper reduces it. |
| CW fan-out, `sourceErrors`, "not configured", 3 s timeout, `502` when both GAS reads fail | Plan 02. |
| Every FE behaviour (badges, Europe/London formatting, pager hrefs, `FCP.GrantOperationsAdmin` scoping) | Different repo (`fg-grants-platform-admin`) and a later plan. |
| ~~**Risk 1 pre-check against real environments**~~ | **No longer a gap.** `migrations/20260901130000-normalise-event-sort-keys.js` converts every string `publicationDate` to a `Date` (falling back to the ObjectId timestamp for unparsable text) at boot, and the `Outbox` constructor now keeps it a `Date` on the way back out. NM-01 to NM-04 and MD-01 to MD-03 cover both halves. Running the `$type` counts post-deploy is still worthwhile as *verification*, but nothing is gated on it. |
| ~~**Risk 2 in production data**~~ | **No longer a gap.** The same migration rebuilds every missing, null or non-string `eventTime` from `event.time`, or from the ObjectId timestamp when there is nothing to rebuild from. NM-05 to NM-08 cover it. |
| **Residual: a *new* inbox row can still be written with a null `eventTime`** | `Inbox`'s constructor sets `this.eventTime = props.event.time`, so a non-CloudEvent message with no `time` still lands as `undefined`. The migration fixes existing data and the outbox guard closes the outbox write path, but the equivalent inbox write-time guard was explicitly out of scope for this change (the inbox model is owned by a separate bug ticket). Worth a follow-up; until then a null-`eventTime` row written after the migration would be stranded behind the string block again. |
| Index build time on a large collection blocking boot (Risk 4) | Needs a production-sized collection; the test database holds tens of rows. `db.inbox.stats().count` must be checked before deploy. |
| Secondary-read replication lag (Risk 5) | The test Mongo is a single node with `directConnection=true`; there is no secondary to lag. The behaviour is a property of the deployment, not of this code. |
| Legacy string `_id` documents (Risk 3) | None can exist by construction — the driver assigns an `ObjectId` when `_id` is null — and the integration database cannot be made to hold one through the repository. IB-10/IT-13 cover the tamper path that shares the code. |
| `paginate`'s behaviour under a `mapDocument` at the repository level | `findPage` deliberately passes no `mapDocument` (Plan 02's mapper owns the shape). The option itself is covered at the primitive level by PG-18/PG-19. |

### Standing risk — raised, then closed

**Raised.** IT-25 and IT-26 showed that a mixed-type sort key does not merely mis-order rows,
it makes them **unreachable**: a keyset walk over 4 seeded outbox rows returned 2, and null
`eventTime` rows sitting behind string-valued ones were never reached at all. PRE-03 showed the
string-`publicationDate` path was reachable through `Outbox.fromDocument`, so this was real
data, not a thought experiment. It also contradicted this plan's own Risk 2, which claimed such
rows "paginate correctly" — true only inside a *pure* null block (IT-27).

**Closed.** The coordinator chose to fix it rather than gate on it.
`migrations/20260901130000-normalise-event-sort-keys.js` normalises both collections to one BSON
type per sort key, and the `Outbox` constructor now converts a string `publicationDate` to a
`Date` so the write path cannot re-introduce the mixture. Section I covers both halves, and
NM-04/NM-08 are IT-25/IT-26 run again after the migration, returning every row. Section E is
kept deliberately: it is what proves the migration is the thing doing the fixing.

**What is left.** One residual, recorded in the gaps table: `Inbox`'s constructor still derives
`eventTime` from `props.event.time`, so a message arriving without a `time` can still write a
null. The inbox model was out of scope here (it belongs to the separately-raised
`publicationDate` bug), so this is a follow-up rather than a regression — but until it is done,
a null-`eventTime` row written *after* the migration would be stranded again.

## Run record

Worktree `/home/donatas/code/fg-gas-backend-fgp-1392`, branch `FGP-1392-gas`, Node v24.15.0
(`.nvmrc` pins v24.14.1; `engines` requires `>=24`). Nothing committed. Latest run
2026-09-01, after the sort-key normalisation work.

| Command | Result |
|---|---|
| `npm run lint` | **pass** — 0 errors, 0 warnings (whole repo) |
| `npm run test:unit -- --run` | **pass** — 171 files, **1788 passed (1788)**, 0 failed |
| `npm run test:integration -- --run event-type-normalisation event-pagination event-list-indexes` | **pass** — 3 files, **42 passed (42)** |
| `npm run test:integration -- --run` (whole suite) | **pass** — 36 files, **196 passed \| 6 skipped (202)**, 0 failed |

Docker was available throughout and testcontainers brought up the full `compose.yml` stack for
every integration run; nothing was skipped for want of Docker. The 6 skipped tests are
pre-existing skips elsewhere in the suite, untouched by this work.

### What this work contributes to those totals

| Suite | Tests |
|---|---|
| `src/common/paginate.test.js` | 21 unit |
| `src/grants/repositories/inbox.repository.test.js` → `describe("findPage")` | 11 unit |
| `src/grants/repositories/outbox.repository.test.js` → `describe("findPage")` | 11 unit |
| `src/grants/models/outbox.test.js` → write-time guard | 2 unit added, 1 existing assertion inverted |
| `test/grants/event-pagination.test.js` | 27 integration |
| `test/grants/event-list-indexes.test.js` | 5 integration |
| `test/grants/event-type-normalisation.test.js` | 10 integration |
| **Total** | **45 unit + 42 integration = 87 added**, plus 1 pre-existing test deliberately updated |

### Run history

| When | Unit | Integration (whole suite) |
|---|---|---|
| Plan 01 first pass | 163 files / 1660 | 32 files / 128 passed, 6 skipped |
| After the test-plan gap closure | 171 files / 1786 | 35 files / 186 passed, 6 skipped |
| After sort-key normalisation (current) | 171 files / **1788** | 36 files / **196 passed, 6 skipped** |

The jump between the first two rows is mostly the Plan 02 agent's work, which shared this
worktree at the time; the third row is this change (+2 unit model-guard tests, +1 integration
file of 10). Plan 02's agent has since finished and the worktree is no longer shared, so the
`EADDRINUSE` port contention noted in earlier runs no longer applies.
