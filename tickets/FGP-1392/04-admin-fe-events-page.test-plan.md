# FGP-1392 — Admin FE `/dev-ops/events`: test plan vs. actual coverage

Companion to `04-admin-fe-events-page.md`. Every row below names a **real test that exists and passes**;
nothing here is aspirational. Written against the worktree
`/home/donatas/code/fg-grants-platform-admin-fgp-1392`, branch `FGP-1392-events-page`, based on
`origin/main` @ `44e78ac`.

Status column:
- **existing-before** — a test that was already on `main` and that this work relies on rather than repeating.
- **added-by-this-work** — written for FGP-1392.
- **GAP** — no automated cover. **There are none left at unit / component / route level**; everything that
  cannot be covered without the backend is in *Not covered here* instead.

---

## Scope under test

**In scope (this repo, this story).** The server-rendered `/dev-ops/events` page and the four layers behind it:

| Layer | Unit | How it is tested |
|---|---|---|
| Repository | `src/dev-ops/repositories/events.repository.ts` | unit, `getFromGas` mocked — URL construction and escaping |
| Use case | `src/dev-ops/use-cases/get-events.use-case.ts` | unit, repository + logger mocked — the failure→`unavailable` fold and the log line |
| View model | `src/dev-ops/view-models/events-page.view-model.ts` | unit, pure function — formatting, badge roles, labels, pager hrefs, banner text |
| Route + template | `src/dev-ops/routes/view-events.route.ts`, `views/events.njk` | route-level: real hapi server (`createServer()` + `server.register([devOps])`), real auth strategy, real nunjucks, use case mocked, assertions through cheerio |
| Components | `views/components/status-badge`, `views/components/pager`, `icon/all/arrow-path.njk` | component, `test-utils.render` + cheerio |
| Helper | `src/common/describe-error.ts` | unit |

**Out of scope, by decision.**
- The GAS endpoint itself (Plan 02) — merge ordering, composite cursors, the four-source fan-out,
  `sourceErrors` derivation, the response Joi schema. Tested in `fg-gas-backend`.
- The CW actuators (Plan 03 / FGP-1227).
- **No integration or end-to-end tests are written here**: `GET /grant-admin/events` does not exist yet, so
  there is nothing to integrate against. Everything is fixtures plus a mocked repository against the JSON
  shape documented in `02-gas-events-endpoint.md` and `FGP-1392.md:153-181`.
- The dev-ops app shell (`layouts/page.njk`, `view-options.ts`, `test-utils.ts`, `client/dev-ops.css`) — owned
  by FGP-1227 and unmodified by this work.

**Test kit.** `vitest` (node environment; no `happy-dom` pragma — neither new component has a custom element),
`cheerio` for markup, `vi.mock(import('…'))` by module reference. Route-level tests inject through a real
server so hapi's auth, Joi query validation, `scopedTo` and the nunjucks environment are all exercised for
real rather than stubbed.

---

## Test cases

### A. Access — ticket AC "Access"; plan Step 5 / Concern 6 (the `scopedTo` footgun)

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| ACC-1 | An anonymous request is redirected to login, not served the page | route | `src/dev-ops/routes/view-events.route.test.ts` :: `redirects an anonymous user to login` | added-by-this-work |
| ACC-2 | A signed-in user holding only `FCP.GrantApplicationsAdmin` is refused (403) | route | `view-events.route.test.ts` :: `forbids a signed in user holding only the applications admin role` | added-by-this-work |
| ACC-3 | A signed-in user holding no roles is refused (403) | route | `view-events.route.test.ts` :: `forbids a signed in user holding no roles` | added-by-this-work |
| ACC-4 | A user holding `FCP.GrantOperationsAdmin` gets the page (200, table present) | route | `view-events.route.test.ts` :: `renders the page for the operations admin role` | added-by-this-work |
| ACC-5 | The route is refused as the other `/dev-ops` routes are — same shell, same scope | route | `src/dev-ops/routes/view-dev-ops.route.test.ts` :: `forbids a signed in user holding only the applications admin role` / `forbids a signed in user holding no roles` | existing-before |
| ACC-6 | `scopedTo` applies the scope to a route that declares no `auth` of its own — the mechanism ACC-1..4 depend on | unit | `src/server/plugins/auth/scoped-to.test.ts` :: `scopes a route that names no auth of its own` | existing-before |
| ACC-7 | `scopedTo` preserves a route's other options (this route's `validate`) while adding `auth` | unit | `scoped-to.test.ts` :: `keeps the other options of a scoped route` | existing-before |
| ACC-8 | A route that names its own `auth` is left unscoped — the footgun the route's docblock warns about | unit | `scoped-to.test.ts` :: `leaves a route naming its own auth alone` | existing-before |

*Note.* ACC-6..8 are why `view-events.route.ts` deliberately declares `validate` and **not** `auth`.
ACC-2/ACC-3 are the only tests that would catch a regression there, which is why both are kept.

### B. Query handling and the backend call — ticket AC "Content" (`?status=BOGUS`), plan Decision 1, Risk 3

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| QRY-1 | No parameters ⇒ the unfiltered page (use case called with `{}`) | route | `view-events.route.test.ts` :: `asks for the unfiltered page when no parameters are given` | added-by-this-work |
| QRY-2 | `cursor`, `direction`, `status`, `service` are forwarded verbatim | route | `view-events.route.test.ts` :: `forwards the cursor, direction, status and service` | added-by-this-work |
| QRY-3 | `?status=BOGUS` is forwarded, not rejected locally (200) | route | `view-events.route.test.ts` :: `forwards a status the endpoint does not know` | added-by-this-work |
| QRY-4 | `?service=other` is forwarded, not rejected locally (200) | route | `view-events.route.test.ts` :: `forwards a service the endpoint does not know` | added-by-this-work |
| QRY-5 | `?direction=sideways` is forwarded, not rejected locally (200) | route | `view-events.route.test.ts` :: `forwards a direction the endpoint does not know` | added-by-this-work |
| QRY-6 | A value GAS refuses renders **this page's** alert, not the shared govuk error page | route | `view-events.route.test.ts` :: `shows the error alert when the endpoint refuses the query` (asserts `[data-testid="events-error"]` present **and** `.govuk-heading-xl` absent) | added-by-this-work |
| QRY-7 | An unknown query *key* is still a 400 (Joi default) — catches a typo'd link | route | `view-events.route.test.ts` :: `rejects a query parameter it does not know` | added-by-this-work |
| QRY-8 | A Joi rejection is rendered as the shared error page — the behaviour QRY-6 is defined against | unit | `src/server/plugins/errors.test.ts` :: `renders the "Bad Request" page` | existing-before |
| REP-1 | The page is read from `/grant-admin/events` | unit | `src/dev-ops/repositories/events.repository.test.ts` :: `reads the events page from fg-gas-backend` | added-by-this-work |
| REP-2 | No parameters ⇒ no `?` at all | unit | `events.repository.test.ts` :: `asks for the unfiltered page when given no parameters` | added-by-this-work |
| REP-3 | All four parameters reach the query string in order | unit | `events.repository.test.ts` :: `forwards the cursor, direction, status and service` | added-by-this-work |
| REP-4 | An absent parameter is left out rather than sent empty | unit | `events.repository.test.ts` :: `leaves out a parameter that was not given` | added-by-this-work |
| REP-5 | A status the endpoint may reject still reaches the URL unchanged | unit | `events.repository.test.ts` :: `forwards a status the endpoint may reject` | added-by-this-work |
| REP-6 | A cursor carrying `+ / =` is percent-encoded | unit | `events.repository.test.ts` :: `escapes a cursor containing url characters` | added-by-this-work |
| REP-7 | A status carrying `& =` cannot break out of the query string | unit | `events.repository.test.ts` :: `escapes a status containing url characters` | added-by-this-work |
| REP-8 | The backend's page is returned unchanged | unit | `events.repository.test.ts` :: `returns the page the backend answers with` | added-by-this-work |
| REP-9 | `getFromGas` presents the service bearer token and hits `gas.apiUrl` + path | unit | `src/common/gas.test.ts` :: `presents the service token` / `asks fg-gas-backend for the given path` / `returns the payload` | existing-before |
| REP-10 | The shared client carries the CDP trace id onward | unit | `src/common/wreck.test.ts` :: `adds the trace header when a trace id is present` / `does not add the trace header when a trace id is absent` | existing-before |

### C. Content rendering — ticket AC "Content"; plan Steps 4, 7, 8

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| CNT-1 | Page title is `Events` | route | `view-events.route.test.ts` :: `titles the page Events` | added-by-this-work |
| CNT-2 | The six columns appear in the ticket's order | route | `view-events.route.test.ts` :: `heads the table with the six columns in order` | added-by-this-work |
| CNT-3 | One row per event, all sources/statuses included (nothing filtered client-side) | route | `view-events.route.test.ts` :: `renders a row for every event` | added-by-this-work |
| CNT-4 | Event ID, short type and `segregationRef` render together in column 1 | route | `view-events.route.test.ts` :: `shows the event id, type and segregation reference together` | added-by-this-work |
| CNT-5 | `segregationRef` is carried through the model unchanged | unit | `events-page.view-model.test.ts` :: `carries the segregation reference through` | added-by-this-work |
| CNT-6 | `2026-06-16T10:00:00Z` ⇒ `16 Jun 2026, 11:00:00 BST` | unit | `events-page.view-model.test.ts` :: `formats a summer timestamp in British Summer Time` | added-by-this-work |
| CNT-7 | `2026-01-16T10:00:00Z` ⇒ `16 Jan 2026, 10:00:00 GMT` | unit | `events-page.view-model.test.ts` :: `formats a winter timestamp in Greenwich Mean Time` | added-by-this-work |
| CNT-8 | A single-digit day is padded (column alignment) | unit | `events-page.view-model.test.ts` :: `pads a single digit day` | added-by-this-work |
| CNT-9 | The formatted London time reaches the rendered cell | route | `view-events.route.test.ts` :: `shows the created time in Europe/London` | added-by-this-work |
| CNT-10 | Last Failure uses the same format as Created At | unit | `events-page.view-model.test.ts` :: `formats the last failure the same way as the creation time` | added-by-this-work |
| CNT-11 | A row that never failed shows `-` and is not reddened | unit | `events-page.view-model.test.ts` :: `shows a dash when a row has never failed` | added-by-this-work |
| CNT-12 | …and the `-` reaches the cell | route | `view-events.route.test.ts` :: `shows a dash for a row that never failed` | added-by-this-work |
| CNT-13 | An unparseable timestamp is a dash, never a 500 (`Intl` throws `RangeError`) | unit | `events-page.view-model.test.ts` :: `shows a dash rather than throwing on an unparseable timestamp` | added-by-this-work |
| CNT-14 | Outbox Source reads `GAS · Outbox → <topic>` | unit + route | `events-page.view-model.test.ts` :: `names a GAS outbox row by the topic it goes to`; `view-events.route.test.ts` :: `names an outbox row by the topic it goes to` | added-by-this-work |
| CNT-15 | Inbox Source reads `GAS · Inbox ← CW` | unit | `events-page.view-model.test.ts` :: `names a GAS inbox row by where it came from` | added-by-this-work |
| CNT-16 | A Caseworking inbox row reads `CW · Inbox ← GAS` | unit | `events-page.view-model.test.ts` :: `names a Caseworking inbox row` | added-by-this-work |
| CNT-17 | An audit outbox row names the **real topic**, never the word "audit" (Decision 3) | unit + route | `events-page.view-model.test.ts` :: `names a Caseworking audit outbox row by its topic`; `view-events.route.test.ts` :: `shows an audit row as the endpoint derived it` | added-by-this-work |
| CNT-18 | `internal` is rendered as a target like any other | unit | `events-page.view-model.test.ts` :: `names an outbox row bound for the internal bus` | added-by-this-work |
| CNT-19 | A row naming no counterpart drops the arrow | unit | `events-page.view-model.test.ts` :: `drops the arrow when a row names no counterpart` | added-by-this-work |
| CNT-20 | An audit row shows `_id` as Event ID and `audit · APPLICATION.CREATE` as Type | unit + route | `events-page.view-model.test.ts` :: `carries an audit row as the endpoint derived it`; `view-events.route.test.ts` :: `shows an audit row as the endpoint derived it` | added-by-this-work |
| CNT-21 | A row whose type could not be derived shows `-`, never a blank cell | unit | `events-page.view-model.test.ts` :: `carries a row whose type could not be derived` | added-by-this-work |
| CNT-22 | `3 / 5` attempts, not at max | unit | `events-page.view-model.test.ts` :: `counts attempts against the maximum` | added-by-this-work |
| CNT-23 | `5 / 5` is at max | unit | `events-page.view-model.test.ts` :: `marks a row at its maximum attempts` | added-by-this-work |
| CNT-24 | `6 / 5` (past max) is still at max | unit | `events-page.view-model.test.ts` :: `marks a row past its maximum attempts` | added-by-this-work |
| CNT-25 | A CW row under its own retry cap colours against that cap (`2 / 2`) | unit | `events-page.view-model.test.ts` :: `counts against the maximum the row carries` | added-by-this-work |
| CNT-26 | A row at max renders `text-error font-bold` (ticket AC "5 / 5 in red") | route | `view-events.route.test.ts` :: `reddens the attempts of a row at its maximum` | added-by-this-work |
| CNT-27 | A missing attempt count renders `-`, never `null / 5` (Risk 10, defensive) | unit | `events-page.view-model.test.ts` :: `shows a dash if an attempt count is ever missing` | added-by-this-work |
| CNT-28 | A missing maximum renders `3 / ?` and is not at max (Risk 10, defensive) | unit | `events-page.view-model.test.ts` :: `shows a question mark when the endpoint reported no maximum` | added-by-this-work |
| CNT-29 | `PUBLISHED` ⇒ ghost, quiet | unit + route | `events-page.view-model.test.ts` :: `leaves a published row quiet`; `view-events.route.test.ts` :: `badges a published row quietly` | added-by-this-work |
| CNT-30 | `PROCESSING` ⇒ info | unit + route | `…view-model.test.ts` :: `marks a processing row as in flight`; `…route.test.ts` :: `badges a processing row as in flight` | added-by-this-work |
| CNT-31 | `FAILED` ⇒ warning + ↻ | unit + route | `…view-model.test.ts` :: `marks a failed row as retrying`; `…route.test.ts` :: `badges a retrying row amber with the retry icon` | added-by-this-work |
| CNT-32 | `RESUBMITTED` ⇒ warning + ↻ | unit | `events-page.view-model.test.ts` :: `marks a resubmitted row as retrying` | added-by-this-work |
| CNT-33 | `COMPLETED` ⇒ success | unit + route | `…view-model.test.ts` :: `marks a completed row as done`; `…route.test.ts` :: `badges a completed row green` | added-by-this-work |
| CNT-34 | `DEAD_LETTER` ⇒ error badge **and** a `DLQ` badge on Source | unit + route | `…view-model.test.ts` :: `marks a dead letter row as failed` / `marks a dead letter row for the DLQ badge`; `…route.test.ts` :: `badges a dead letter row red and flags the queue` | added-by-this-work |
| CNT-35 | Any other row carries no DLQ badge | unit | `events-page.view-model.test.ts` :: `leaves any other row unmarked` | added-by-this-work |
| CNT-36 | A status outside the six ⇒ ghost badge, still shown, page does not fail | unit + route | `…view-model.test.ts` :: `falls back to a quiet badge for a status it does not know` / `keeps the raw status as the badge text`; `…route.test.ts` :: `badges a status it does not know quietly and still shows it` | added-by-this-work |
| CMP-1 | status-badge shows the raw status as its text | component | `views/components/status-badge/template.test.ts` :: `shows the raw status as the badge text` | added-by-this-work |
| CMP-2..6 | Each role maps to its literal daisyUI class (`badge-ghost`/`-info`/`-warning`/`-success`/`-error`) | component | `status-badge/template.test.ts` :: `renders a quiet badge for the ghost role`, `renders an informational badge`, `renders a warning badge`, `renders a success badge`, `renders an error badge` | added-by-this-work |
| CMP-7 | An unknown role falls back to `badge-ghost` | component | `status-badge/template.test.ts` :: `falls back to a quiet badge for a role it does not know` | added-by-this-work |
| CMP-8 | No role at all falls back to `badge-ghost` | component | `status-badge/template.test.ts` :: `falls back to a quiet badge when no role is given` | added-by-this-work |
| CMP-9 | The retry icon appears only when retrying | component | `status-badge/template.test.ts` :: `shows the retry icon for a retrying status` / `omits the retry icon otherwise` | added-by-this-work |
| CMP-10 | A status with no known role still renders its text | component | `status-badge/template.test.ts` :: `shows a status it has no role for` | added-by-this-work |
| CMP-11 | The `arrow-path` glyph is a real inline heroicon carrying the caller's classes | component | `views/components/icon/template.test.ts` :: `renders the retry icon as an inline svg` | added-by-this-work |
| CMP-12 | The icon macro throws for an unknown name (so a typo'd icon fails loudly) | component | `icon/template.test.ts` :: `throws for a name the set does not hold` | existing-before |
| CMP-13 | The component kit itself renders a macro by directory name and hands back cheerio | component | `views/components/heading/template.test.ts` :: `renders the heading with its title and caption` (the kit's own smoke test, relied on by every row above) | existing-before |

### D. Pagination links — ticket AC "Pagination" (FE half); plan Steps 4, 9

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| PAG-1 | Next links to `?cursor=<endCursor>&direction=forward` | unit + route | `events-page.view-model.test.ts` :: `links Next to the end cursor`; `view-events.route.test.ts` :: `links Previous and Next to the cursors the endpoint issued` | added-by-this-work |
| PAG-2 | Previous links to `?cursor=<startCursor>&direction=backward` | unit + route | `…view-model.test.ts` :: `links Previous to the start cursor`; same route test as PAG-1 | added-by-this-work |
| PAG-3 | `status` is carried on **both** links | unit + route | `…view-model.test.ts` :: `keeps the status filter on both links`; `…route.test.ts` :: `keeps the status filter on both links` | added-by-this-work |
| PAG-4 | `service` is carried on **both** links | unit + route | `…view-model.test.ts` :: `keeps the service filter on both links`; `…route.test.ts` :: `keeps the service filter on both links` | added-by-this-work |
| PAG-5 | Both filters together are carried | unit | `events-page.view-model.test.ts` :: `keeps both filters on the links` | added-by-this-work |
| PAG-6 | First page ⇒ no Previous | unit + route | `…view-model.test.ts` :: `offers no Previous link on the first page`; `…route.test.ts` :: `omits Previous on the first page` | added-by-this-work |
| PAG-7 | Last page ⇒ no Next | unit + route | `…view-model.test.ts` :: `offers no Next link on the last page`; `…route.test.ts` :: `omits Next on the last page` | added-by-this-work |
| PAG-8 | A flag set with no cursor issued ⇒ no link (rather than a broken href) | unit | `events-page.view-model.test.ts` :: `offers no link when a flag is set but no cursor was issued` | added-by-this-work |
| PAG-9 | A cursor containing `+ / =` is percent-encoded into the href | unit | `events-page.view-model.test.ts` :: `percent-encodes a cursor` | added-by-this-work |
| PAG-10 | No events ⇒ no pager at all | route | `view-events.route.test.ts` :: `omits the pager when there are no events` | added-by-this-work |
| PAG-11 | The pager renders both links when there is a page either side | component | `views/components/pager/template.test.ts` :: `offers both links when there is a page either side` | added-by-this-work |
| PAG-12 | Only Next / only Previous / neither | component | `pager/template.test.ts` :: `offers only Next on the first page`, `offers only Previous on the last page`, `renders nothing when there is neither` | added-by-this-work |
| PAG-13 | The nav is labelled for assistive technology with `rel=prev`/`rel=next` | component | `pager/template.test.ts` :: `names the navigation for assistive technology` | added-by-this-work |
| PAG-14 | The whole query string survives into the href (autoescaped `&` decodes back) | component | `pager/template.test.ts` :: `keeps the whole query string of the href it is given` | added-by-this-work |

### E. Failure states — ticket AC "Failure states"; plan Steps 3, 7, Risks 7 and 11

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| FAIL-1 | A page that was read is reported available and returned unchanged | unit | `get-events.use-case.test.ts` :: `returns the page the repository read` / `reports a page it read as available` | added-by-this-work |
| FAIL-2 | The use case asks for exactly the query it was given | unit | `get-events.use-case.test.ts` :: `asks for the page the caller asked for` | added-by-this-work |
| FAIL-3 | A GAS `400` for a refused query ⇒ `unavailable`, not a thrown Boom | unit | `get-events.use-case.test.ts` :: `reports the page unavailable when the query is one the endpoint refuses` | added-by-this-work |
| FAIL-4 | A GAS `400 Cannot decode cursor` (tampered cursor) ⇒ `unavailable` | unit | `get-events.use-case.test.ts` :: `reports the page unavailable when the cursor cannot be decoded` | added-by-this-work |
| FAIL-5 | A GAS `502` (both GAS reads down) ⇒ `unavailable` | unit | `get-events.use-case.test.ts` :: `reports the page unavailable when both GAS reads fail` | added-by-this-work |
| FAIL-6 | A failure yields an honest empty page (no rows, no cursors, flags false) | unit | `get-events.use-case.test.ts` :: `returns an empty page when the backend fails` | added-by-this-work |
| FAIL-7 | Exactly one log line, naming the failure | unit | `get-events.use-case.test.ts` :: `logs one line naming the failure` | added-by-this-work |
| FAIL-8 | **The backend response body is never logged** (Risk 7, ticket Non-functional) | unit | `get-events.use-case.test.ts` :: `never logs the backend response body` | added-by-this-work |
| FAIL-9 | `describeError` reduces any Error to `name: message` | unit | `src/common/describe-error.test.ts` :: `describes an error by its name and message` | added-by-this-work |
| FAIL-10 | `describeError` drops a wreck Boom's `data.payload` | unit | `describe-error.test.ts` :: `describes a wreck response error without its payload` | added-by-this-work |
| FAIL-11 | A thrown non-Error is described, not stringified blindly | unit | `describe-error.test.ts` :: `describes a thrown non-error` | added-by-this-work |
| FAIL-12 | Unconfigured CW ⇒ warning banner naming both CW sources, **rows still render** (Risk 11: today's normal state) | unit + route | `events-page.view-model.test.ts` :: `names both Caseworking sources when Caseworking is unconfigured`; `view-events.route.test.ts` :: `names the unavailable sources when Caseworking is not configured` | added-by-this-work |
| FAIL-13 | One GAS source failing ⇒ banner names `GAS · Outbox`, the other rows render | unit + route | `…view-model.test.ts` :: `names a GAS source when one GAS read failed`; `…route.test.ts` :: `names a GAS source when one GAS read failed` | added-by-this-work |
| FAIL-14 | One source lost per service ⇒ both named, in order | unit | `events-page.view-model.test.ts` :: `names sources from both services when each lost one` | added-by-this-work |
| FAIL-15 | Every source answered ⇒ no banner | unit | `events-page.view-model.test.ts` :: `names nothing when every source answered` | added-by-this-work |
| FAIL-16 | Previous/Next keep working on a partial page | route | `view-events.route.test.ts` :: `keeps the pager working on a partial page` | added-by-this-work |
| FAIL-17 | Whole-request failure ⇒ `alert-error`, still HTTP 200, no table | route | `view-events.route.test.ts` :: `shows the error alert when the page could not be read` | added-by-this-work |
| FAIL-18 | Nothing anywhere ⇒ "No events found.", no pager, no alerts | route | `view-events.route.test.ts` :: `tells the user when there are no events` | added-by-this-work |
| FAIL-19 | An empty page yields no rows, no hrefs, no banner | unit | `events-page.view-model.test.ts` :: `has no rows when nothing was found` | added-by-this-work |
| FAIL-20 | `unavailable` is carried through the model to the template | unit | `events-page.view-model.test.ts` :: `reports the page unavailable when it could not be read` | added-by-this-work |
| FAIL-21 | A service or box the endpoint widens to is named as it arrived, not dropped (closes the two defensive branches at `events-page.view-model.ts:96`) | unit | `events-page.view-model.test.ts` :: `names a service it has no label for by the name the endpoint used`, `names a box it has no label for by the name the endpoint used`, `names an unavailable source it has no label for as the endpoint named it` | added-by-this-work |

### F. Escaping / injection — plan Risk 4 ("never introduce `| safe`"); ticket "Layout & scope"

Every string on this page originates in a Mongo document the FE does not validate, so each user-influenced
cell has its own escaping test.

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| SEC-1 | `segregationRef` renders as text | route | `view-events.route.test.ts` :: `escapes a segregation reference containing markup` | added-by-this-work |
| SEC-2 | `eventId` renders as text | route | `view-events.route.test.ts` :: `escapes an event id containing markup` | added-by-this-work |
| SEC-3 | `type` renders as text | route | `view-events.route.test.ts` :: `escapes a type containing markup` | added-by-this-work |
| SEC-4 | `target` (outbox Source cell) renders as text | route | `view-events.route.test.ts` :: `escapes a target containing markup` | added-by-this-work |
| SEC-5 | `source` (inbox Source cell) renders as text | route | `view-events.route.test.ts` :: `escapes a source containing markup` | added-by-this-work |
| SEC-6 | `status` — the unvalidated passthrough Risk 4 singles out — renders as text | route | `view-events.route.test.ts` :: `escapes a status containing markup` | added-by-this-work |
| SEC-7 | A `sourceErrors[].service` carrying markup renders as text in the warning banner | route | `view-events.route.test.ts` :: `escapes an unavailable source name containing markup` | added-by-this-work |
| SEC-8 | With every one of those fields hostile at once, the page carries exactly one `<script>` — the layout's own module tag | route | `view-events.route.test.ts` :: `never renders a script the endpoint sent, anywhere on the page` | added-by-this-work |
| SEC-9 | The view model hands hostile text over raw rather than pre-rendering markup (escaping stays nunjucks' job) | unit | `events-page.view-model.test.ts` :: `leaves markup in an unavailable source name for the template to escape` | added-by-this-work |
| SEC-10 | The status badge component escapes its own status | component | `status-badge/template.test.ts` :: `escapes a status containing markup` | added-by-this-work |
| SEC-11 | The icon macro escapes a hostile class rather than emitting it | component | `icon/template.test.ts` :: `escapes hostile classes rather than emitting them` | existing-before |

*`sourceErrors[].message` (`"timeout"`, `"HTTP 401"`, `"not configured"`) is deliberately **never rendered** —
the banner is built from `service`/`box` only. SEC-8 passes a hostile `message` too, proving it reaches no
markup at all.*

### G. Layout & scope — ticket AC "Layout & scope"; plan Risk 5

| ID | Behaviour / scenario | Level | Covering test (file :: test name) | Status |
|---|---|---|---|---|
| LAY-1 | The table scrolls inside its own container; the container holds the table | route | `view-events.route.test.ts` :: `scrolls the table inside its own container` | added-by-this-work |
| LAY-2 | No Actions column, filter controls, counts or purge control | route | `view-events.route.test.ts` :: `offers no actions, filter controls, counts or purge` | added-by-this-work |
| LAY-3 | The secondary-read footnote is present and worded as the ticket says | route | `view-events.route.test.ts` :: `footnotes that the data may lag` | added-by-this-work |
| LAY-4 | The page is reachable from the `/dev-ops` index | route | `src/dev-ops/routes/view-dev-ops.route.test.ts` :: `renders the dev-ops page for the operations admin role` (renders `views/index.njk`, which now carries the `/dev-ops/events` action) | existing-before |
| LAY-5 | **Every daisyUI literal survives Tailwind's content scan** (plan Risk 2 — the sharpest trap, and one no unit test can catch) | build | `npm run build:frontend` + the class grep in the Run record below | added-by-this-work |

---

## Not covered here — needs the backend

`GET /grant-admin/events` does not exist yet, so the items below are *unverifiable in this repo by
construction*, not gaps in the suite. Each names what only a run against a deployed Plan 02 can settle, and
how to check it once that lands.

| # | What only a real backend can verify | Why no test here can | Manual verification once Plan 02 is deployed |
|---|---|---|---|
| N-1 | **The 3 s `wreck` timeout vs. real fan-out latency** (plan Risk 6). GAS fans out to two CW actuator calls (each with its own 3 s budget) plus two Mongo keyset reads; a slow CW can push GAS past *this* app's fixed 3 s, turning a page GAS would have returned as **partial** into a whole-page `unavailable` — the opposite of the intended degradation. | The FE mocks the repository; the timeout lives in `src/common/wreck.ts:18` with no per-call override in `getFromGas`. Nothing local can produce the real latency. | Run GAS + CW + this app from the `fg-grants-core` compose stack. Load `/dev-ops/events` and time it. Then make CW hang (pause the CW container, or point `CW_BACKEND_URL` at a blackhole) and reload: **expect** the warning banner naming the two CW sources and GAS rows still listed; **a red "Events could not be loaded from GAS." alert instead is the bug.** If it bites, the fix is a per-call timeout parameter on `getFromGas` (shared with grant-ops — needs its own change). |
| N-2 | **Real cursor round-trips.** That an `endCursor` GAS issued, sent back through this page's Next link, returns the next 20 rows in the same order, with no row duplicated or skipped across the boundary between sources. | The composite cursor is opaque to the FE — it is a string in and a string out. Locally it is only ever the literal `'END'`. Ordering, keyset correctness and forward/backward symmetry are Plan 02's unit tests. | Seed >20 events across all four sources. Walk Next to the end and Previous back, recording the first `eventId` of each page; the sequences must mirror. Insert a new event between two requests and re-walk: no row seen twice, none skipped. Exhaust three sources and leave one with rows: Next must remain and the next page must hold only that source's rows. |
| N-3 | **Real `400` bodies.** That GAS actually answers `400` for `?status=BOGUS`, `?service=other`, `?direction=sideways` and a tampered cursor — and that each surfaces as this page's own error alert rather than the shared govuk error page. | The FE's contribution (forward unvalidated; fold any failure into `unavailable`) is covered by QRY-3..6 and FAIL-3..5 with a synthesised wreck Boom. Whether GAS returns 400 rather than 200-with-nothing is Plan 02's contract. | Hit `/dev-ops/events?status=BOGUS`, `…?service=other`, `…?direction=sideways` and `…?cursor=tampered`. Each must render the page with the red alert, HTTP 200, no govuk styling. Then check the app log: exactly one line per request, of the form `Could not read events from fg-gas-backend: Error: Response Error: 400 Bad Request` — **and no response body**, which is the Risk 7 check in the wild. |
| N-4 | **Real timestamps from real documents** — inbox `eventTime` as a string, outbox `publicationDate` as a `Date`, pre-backfill rows falling back to the `_id` timestamp. | Fixtures are hand-written ISO strings. Whether GAS normalises correctly is its concern; only the rendering is ours (CNT-6..13). | Submit a grasslands application against local GAS to generate real events. Check Created At reads as `dd Mon yyyy, HH:mm:ss GMT|BST` for every row, and that no cell shows `-` for a row that plainly has a time. |
| N-5 | **A real `DEAD_LETTER` row**, reached by exhausting retries rather than by fixture. | Requires the retry loop and a genuinely failing target. | Point an outbox topic ARN at a bad value, let the row exhaust `OUTBOX_MAX_RETRIES`, then confirm the page shows the red `DEAD_LETTER` badge, the `DLQ` badge on Source, and `5 / 5` in red. |
| N-6 | **A real partial-source page.** That GAS emits `sourceErrors` with `message: "not configured"` for both CW boxes in an environment where `CW_BACKEND_URL`/`CW_BACKEND_TOKEN` are unset (Risk 11: today, everywhere). | FE-side rendering is FAIL-12; the emission is Plan 02's. | Deploy with CW config unset. The banner must read exactly `Some event sources are unavailable: CW · Inbox, CW · Outbox. Showing the rest.` with GAS rows listed beneath. Then set CW config and confirm the banner disappears. |
| N-7 | **Layout at real widths** (plan Risk 5). Six columns carrying a 36-char UUID, a 24-char ObjectId, a long topic and two 27-char timestamps inside a `max-w-4xl` `<main>`. | LAY-1 proves the scroller exists and wraps the table; it cannot prove the result is readable. | Open the page at 1440px and at 375px with real data. The **container** must scroll sideways; the page body must not. This is also the screenshot Mark Stead reviews (ticket, Acceptance). |
| N-8 | **`FCP.GrantOperationsAdmin` end to end** through real Entra ID sign-in rather than an injected session. | Route tests inject credentials directly; the OIDC flow is covered separately (`src/server/plugins/auth/oidc.test.ts`, `session.test.ts` — both existing-before). | Sign in as a user holding the role and as one without; the second must be refused exactly as `/dev-ops` is. |

---

## Run record

All commands run from `/home/donatas/code/fg-grants-platform-admin-fgp-1392` on node 24.15.0
(mise; `.nvmrc` asks v24.14.1, `engines` is `>=24`), after `npm ci`.

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` (`tsc --noEmit`) | **pass**, 0 errors |
| 2 | `npm run lint` (`eslint .` then `stylelint`) | **pass**, 0 errors, 0 warnings |
| 3 | `npm run format:check` (prettier) | **pass** — "All matched files use Prettier code style!" (after one `npm run format`) |
| 4 | `npm test` (`AWS_EMF_ENVIRONMENT=Local TZ=UTC vitest run --coverage`) | **40 files, 289 tests, all passing.** Coverage: statements 99.43% (355/357), branches 96.18% (126/131), functions 100% (94/94), lines 99.41% (342/344) |
| 5 | Scoped coverage of the code this story adds | `vitest run --coverage --coverage.include='src/dev-ops/**' --coverage.include='src/common/describe-error.ts' src/dev-ops src/common/describe-error.test.ts` → **12 files, 158 tests; 100% statements, 100% branches (44/44), 100% functions, 100% lines**. The two defensive branches previously uncovered at `events-page.view-model.ts:96` are now closed by FAIL-21. |
| 6 | `npm run build:frontend` (`vite build`) | **pass**, `.public/assets/dev-ops-css-c0ycZK69.css` 58.01 kB (gzip 10.03 kB), built in ~0.3 s |
| 7 | daisyUI class grep over the built stylesheet | **all present**, none purged |

Baseline for comparison: on `origin/main` (`git stash -u`, run, `git stash pop`) the suite is
**33 files / 152 tests**. This work adds **7 suites and 137 tests** (289 − 152): describe-error 3,
repository 8, use case 9, view model 50, route 48, status-badge 12, pager 6, plus 1 added to the existing
icon suite.

The grep for step 7, verbatim:

```bash
CSS=$(ls .public/assets/dev-ops-css-*.css)
for c in badge badge-sm badge-ghost badge-info badge-warning badge-success badge-error \
         table table-zebra table-sm alert alert-warning alert-error join join-item \
         btn btn-sm text-error text-primary font-bold font-mono text-xs \
         whitespace-nowrap overflow-x-auto rounded-box bg-base-100 shadow-sm mb-4 mt-4; do
  n=$(grep -c "\.$c[^a-zA-Z0-9_-]" "$CSS"); [ "$n" -eq 0 ] && echo "MISSING $c"
done
# → no output: every class literal survived Tailwind's content scan
grep -c '\.badge-info' "$CSS"   # → 1
```

This is the only check that can catch plan Risk 2 — a daisyUI class assembled in TypeScript is tree-shaken
out of the stylesheet with **no build error and no failing test**, because the component tests assert on the
class attribute, which is present either way. Re-run step 7 after any change that touches a class name.

---

## Case counts

122 rows across sections A-G (one row, CMP-2..6, stands for five sibling cases, so 126 cases in all):

| | Rows | Notes |
|---|---|---|
| existing-before (relied on, not repeated) | **11** | ACC-5, ACC-6, ACC-7, ACC-8, QRY-8, REP-9, REP-10, CMP-12, CMP-13, SEC-11, LAY-4 |
| added-by-this-work | **111** | backed by **137** individual tests: describe-error 3, repository 8, use case 9, view model 50, route 48, status-badge 12, pager 6, icon +1 |
| GAP (no automated cover) | **0** | every gap reported earlier is now closed — see FAIL-21 (the two defensive branches at `events-page.view-model.ts:96`) and SEC-1..SEC-9 (escaping for every user-influenced cell) |
| Deferred to a real backend | 8 | N-1..N-8, each with manual verification steps above |

Several rows are covered at two levels at once (unit **and** route), which is why the test count exceeds the
row count: the view model is tested as a pure function, and the same behaviour is then asserted again through
the rendered page so a template that ignores the model cannot pass.
