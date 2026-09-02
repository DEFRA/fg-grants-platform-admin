# Plan 05 — Design: `/dev-ops/events`

Repo `fg-grants-platform-admin` · ticket `tickets/FGP-1392.md` · build plan `04-admin-fe-events-page.md`.
Stack as installed: **Tailwind 4.3.3 + daisyUI 5.7.20**, nunjucks, server-rendered, no client framework.
Companion mockup: `05-events-page-design.html`. **HTML is the visual truth, this file the written truth; they agree.**

This is designed from the operator inward. §1 establishes who asks what; §2–§5 derive the composition from
that; §6 onward is the buildable detail. Where the design departs from the ticket's *rendering* table
(never its data), it is marked **[R-n] RECOMMENDATION FOR MARK** with a fallback the developer can build
instead. The ticket's six data points, badge roles and scope boundaries are unchanged.

### Recommendations for Mark, at a glance

| | Change | Because | Fallback |
|---|---|---|---|
| **R1** | Column order → `Status · Created · Event · Route · Attempts · Last failure` | Status was last: the first question answered at the far right, and the first thing clipped on a narrow screen | Ticket order; cell composition is unaffected |
| **R2** | Header labels → `Status · Created · Event · Route · Attempts · Last failure` | The identity cell is no longer "Event ID / Type"; "Source" is not a source | Ticket labels |
| **R3** | Identity cell leads with `segregationRef`, then type, then event id | Operators arrive holding a reference, never a UUID | Ticket order inside the cell |
| **R4** | Source → **Route**, read as `Caseworking → GAS` with `GAS inbox · <topic>` beneath | `GAS · Inbox ← CW` needs decoding to answer "which hop failed" | Ticket string |
| **R5** | Drop the duplicate `DLQ` chip; `DEAD_LETTER` + a row tint is the marker | The same fact twice, and in a cell about routing | Keep the chip |
| **R6** | Times read `18 min ago` with the absolute time beneath, anchored by an "as at" stamp | Triage is by recency; the anchor keeps relative time honest on a stale tab | Absolute only |
| **R7** | The lag note moves from under the table into the provenance line at the top | Nobody reads a footnote below 1400px of table; it qualifies the whole page | Keep it under the table |
| **R8** | Pager reads **Newer / Older** | Newest-first: "Next" travels backwards in time | Previous / Next |
| **R9** | "not configured" reported as an **info** note, not an amber warning | It is today's normal state in every environment; amber-always trains people to ignore amber | One amber banner |
| **R10** | Active `status`/`service` params disclosed at the top and in the empty state | The params work without controls; a filtered page currently looks like the whole picture | Nothing |
| **R11** | `/dev-ops` redirects to `/dev-ops/events` | An index page that links to exactly one page is a click tax | One-card index (§5) |
| **R12** | Event id is not `text-primary` | 2.9:1 on the dark theme, measured | Accept the contrast |

---

## 1. Who uses this, when, and what they ask

The user is a Grant Operations Administrator. The defining fact is in the ticket's own context: **they have
been refused Mongo access.** They are not a developer with a shell; they are the person who has to answer for
the platform's plumbing without being able to query it. Four moments:

**M1 — An alert fires / someone says things are stuck.** They open the page cold, knowing nothing. *Is
anything actually broken? What, since when, is it still trying or has it given up?* They are scanning for
trouble among mostly-healthy rows.

**M2 — "Did application X reach Caseworking?"** A caseworker or service-desk ticket names an application.
They arrive holding a **segregation reference**, not a UUID. There are no filter controls in this story, so
**Ctrl+F is the search interface.** Everything the operator might search for must be rendered as real,
unclipped text on the page — this single fact drives more of the design than any styling choice.

**M3 — Daily health glance.** Thirty seconds. *Is the shape of this page normal?* A healthy page must look
boring; anything else must break the pattern.

**M4 — Post-incident reconstruction.** Reading down the time column, correlating with logs and Slack.
Needs precise, copyable timestamps, a stated timezone, and columns that do not move between pages.

### Questions asked of a **row**, in the order they are asked

| # | Question | Answered by |
|---|---|---|
| 1 | Is this healthy, retrying, or dead? | `status` |
| 2 | How old is it / since when? | `createdAt` |
| 3 | Which application is blocked? | `segregationRef` |
| 4 | Is this a real domain event or audit bookkeeping? | `type` |
| 5 | Which hop — GAS→CW or CW→GAS — and which side holds it? | `service` + `box` + `source`/`target` |
| 6 | How close is it to dying? | `attempts` / `maxAttempts` |
| 7 | When did it last fail? | `lastFailureAt` |
| 8 | What do I quote to a developer? | `eventId` |

### Questions asked of the **page**

*Is anything red? · Am I seeing everything, or is a source missing? · Am I seeing everything, or is a filter
on? · How fresh is this? · Is there more?*

Two of those five are, in the ticket-as-written, unanswerable: a partially-answered page shows an amber
banner but never says the rows are **absent** rather than degraded (§4.3), and a page reached with
`?status=…` looks identical to an unfiltered one (§4.4). Both are fixed here.

### Information hierarchy per row

- **Primary — must be read in under a second:** state (healthy / retrying / dead) and recency.
- **Secondary — read in about three seconds, once the row matters:** which application, what kind of event, which hop.
- **Tertiary — read only on demand, must be present and copyable:** event id, raw topic name, attempt count, exact failure time, exact creation time to the second.

Every decision below cites this. The two design consequences that follow immediately:

- **Healthy recedes, dead advances.** A `PUBLISHED` row is a ghost badge, a `0 / 5` at 50% opacity, a `-`
  for last failure and a 55%-opacity event id. A `DEAD_LETTER` row is the only solid saturated red on the
  page, on a faintly tinted row, with a bold `5 / 5`. Nothing needs to be counted; the page has a texture.
- **Nothing searchable is ever truncated.** No ellipsis, no `text-overflow`, no tooltip-only content, no
  `title`-attribute-only values, no client-side virtualisation. Long values wrap.

---

## 2. Row composition

The ticket fixes **which** six data points a row carries. How they are grouped, ordered and worded is design.

### 2.1 Column order — **[R1]**

`Status · Created · Event · Route · Attempts · Last failure`

Three arguments, all from §1:

1. **Question 1 is answered first.** Status last means the eye crosses the widest column in the table before
   learning whether the row matters. Leading with it makes the health of twenty rows a single vertical strip.
2. **Leftmost columns survive.** Below `lg` this table hides its lowest-priority columns (§4.5) and the
   scroller clips from the right. Whatever is primary must be on the left or it is the first thing lost.
3. **The strip is quiet when the news is good.** The usual objection to a state column on the left — that it
   wastes the best real estate on nothing — does not apply here, because a healthy status is a ghost badge
   on a zebra stripe. In M3 the left edge reads as grey, and *that is the answer*.

`Created` second because the list is a time-ordered feed and orientation should be free. `Event` third: it is
the widest and most variable column, and an auto-layout table gives its slack to the flexible column, so it
sits where slack is useful. `Attempts` and `Last failure` are the *detail* behind a status the operator has
already read — tertiary, therefore right.

**Fallback:** ticket order. Every cell composition below is independent of column order; the developer moves
six `<th>`/`<td>` pairs and nothing else changes.

### 2.2 The identity cell — **[R3]**

Three lines, three distinct roles, three distinct typographic treatments:

```
GLD-9B2-BWS-grasslands              font-mono text-sm  font-semibold      ← question 3
case.status.updated                 text-xs   text-base-content/80        ← question 4
3f2c1a0e-8b7d-4c6a-9e21-5f0a7b3c8d94  font-mono text-[11px] /55 break-all ← question 8
```

The ticket leads with the event id in `text-primary` and puts the segregation reference last at 11px/70%.
That is exactly inverted against M2: the reference is the only value on the row that a human *brings* to the
page, and the UUID is the one value no human will ever have in their head. The reference leads.

**Rule when the reference is null** (audit and legacy rows): the type is promoted to line 1 and the cell has
two lines. Line 1 is therefore always "the most human-meaningful identifier this row has" — a rule, not an
inconsistency, and the left edge of the column stays a column of meaningful names.

**Audit rows recede.** Question 4 exists because during an incident audit traffic is noise. The derived type
already reads `audit · APPLICATION.CREATE`; render the `audit` half as a `badge badge-ghost badge-xs` and the
rest as normal text, and set the whole line to `/60`. The template can test `{% if 'audit · ' in row.type %}`
— no view-model change needed.

The event id keeps `break-all` so a 56-character legacy urn cannot widen the table, and stays at full text
(never `…`) because a developer will ask for it verbatim.

### 2.3 The Route cell — **[R4]**

The ticket renders `GAS · Outbox → cw__sns__update_status_fifo` and `GAS · Inbox ← CW`. Two problems: the
arrow reverses meaning between the two, so question 5 needs decoding rather than reading; and the primary
position is occupied by an SNS topic name, which is machinery, not an answer.

Every row is one message on one leg between two systems. Normalise all four cases to a **left-to-right hop**,
with the record's own home beneath it:

| service / box / peer | Line 1 (hop) | Line 2 (where the record lives) |
|---|---|---|
| gas · inbox · `CW` | `Caseworking → GAS` | `GAS inbox` |
| gas · outbox · `cw__sns__update_status_fifo` | `GAS → Caseworking` | `GAS outbox · cw__sns__update_status_fifo` |
| cw · inbox · `GAS` | `GAS → Caseworking` | `Caseworking inbox` |
| cw · outbox · `gas__sns__case_updated` | `Caseworking → GAS` | `Caseworking outbox · gas__sns__case_updated` |
| gas · outbox · `internal` | `GAS → Internal bus` | `GAS outbox · internal` |
| gas · inbox · `AS` | `Agreements → GAS` | `GAS inbox` |
| peer unknown / null | `GAS outbox` (no arrow) | `GAS outbox` suppressed as duplicate |

Line 1 answers "which hop"; line 2 answers "which side is holding it", which is what an operator needs
before asking anyone to retry. The raw topic is never lost — it is on line 2, in full, Ctrl+F-able.

Peer names come from a five-entry prefix map (`CW`/`cw__` → Caseworking, `GAS`/`gas__` → GAS, `AS`/`as__` →
Agreements, `internal` → Internal bus, **anything else → the raw string verbatim**). Unknown prefixes degrade
to showing the machine name rather than guessing.

**This is also the vocabulary of the partial-source banner** (§4.3): it lists `Caseworking inbox`,
`GAS outbox` — the exact strings on line 2 — so the operator can match a banner to the rows it is about.

### 2.4 Status, the DLQ marker, and attempts — **[R5]**

Badge roles are the ticket's and are not reopened: `PUBLISHED` ghost, `PROCESSING` info, `FAILED` /
`RESUBMITTED` warning + `arrow-path`, `COMPLETED` success, `DEAD_LETTER` error, anything else ghost. Raw
`SCREAMING_SNAKE` text, because the operator greps logs for the same token.

**The DLQ chip goes.** `DEAD_LETTER` in the Status column and `DLQ` in the Route column are the same fact
rendered twice, and the second one sits in a cell that is otherwise about routing — it reads as though the
*route* is dead. Duplication of a rare, loud signal is how a loud signal becomes wallpaper. The single
marker is the red status badge, reinforced structurally rather than repeated: the dead row gets
`bg-error/5`, so it is a visibly different row, not a row with two red things on it.

**Attempts is not next to status**, deliberately. `FAILED` already implies "retrying", `DEAD_LETTER` already
implies "hit the cap". `3 / 5` is the second-glance detail that says *how much rope is left*, so it belongs
with the tertiary group on the right. It earns prominence conditionally:

- `attempts == 0` → `text-base-content/50` — the healthy majority disappears, so a page of zeros is silent.
- `0 < attempts < max` → normal.
- `attempts >= max` → `font-bold text-error` (ticket, kept).

Right-aligned with `tabular-nums` so the `/` line stacks vertically and the eye reads the column, not the cells.

### 2.5 Time — **[R6]**

Triage is by recency, and `16 Jun 2026, 11:15:00 BST` requires the operator to subtract. But a server-rendered
"18 min ago" is a lie the moment the tab goes stale — a serious one during an incident.

Both, with the honesty problem solved by anchoring rather than by avoidance:

```
18 min ago                     text-sm font-medium
16 Jun 2026, 11:47:12 BST      font-mono text-[11px] /60 tabular-nums
```

and one page-level stamp in the provenance line (§3): `as at 16 Jun 2026, 12:05:14 BST`. Every relative label
on the page is then explicitly relative to a time the page itself states. `Last failure` uses the same
two-line shape; a row that has never failed shows a plain `-` with no second line and no colour.

Bands: `< 60 s` → `just now`; `< 60 min` → `N min ago`; `< 24 h` → `N h ago`; `< 7 d` → `N days ago`
(`Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })` gives `yesterday`); older → the relative line is
dropped and the absolute time is promoted to line 1 at full size. Absolute format and timezone are the
ticket's, unchanged.

---

## 3. Page composition

**Reading order, and why it is that order:**

1. `h1` **Events** + one-sentence caption — *what this list is.*
2. Error alert, if any — *the page may be lying to you.* Exceptions go above everything.
3. Partial-source note, if any — *the page is incomplete.*
4. **Provenance line** — *what you asked for, and how fresh the answer is.* Sits immediately above the table because it describes the table.
5. The table.
6. Pager + position.

The header has to communicate four things the operator cannot otherwise know, and it does it in two lines
rather than four:

```
Events
Every inbox and outbox message across GAS and Caseworking, newest first.
ⓘ  All statuses, both services · as at 16 Jun 2026, 12:05:14 BST · data may be a few seconds behind (read from a secondary).
```

- *Merged across two services* — said in the caption, and visible in every Route cell.
- *"All" is the default* — `All statuses, both services`. Without it, an operator cannot tell a complete page
  from a filtered one, and this page's whole value is being trusted.
- *How fresh* — the `as at` stamp, which also anchors every relative time.
- *That it may lag* — **[R7]** the ticket puts this under the table. Under a 1400px table it is read by
  nobody, and it qualifies the entire page, not the last row. It belongs in the provenance line, where the
  operator is already reading "what am I looking at". The exact ticket sentence is preserved verbatim.

**When a filter is active — [R10].** The `status` and `service` params work today even though the controls
are a later story, so an operator can arrive from a bookmark or a shared link at `?status=DEAD_LETTER` and
see a page that looks exactly like the whole platform. The provenance line's first segment is replaced:

```
ⓘ  Filtered: status = DEAD_LETTER · Show all · as at 16 Jun 2026, 12:05:14 BST · data may be …
```

`Show all` is a plain link to `/dev-ops/events`. **This is a state disclosure with an escape hatch, not a
filter control** — it renders only when a param is present, offers no way to *choose* a filter, and is
deleted by the filter-controls story when real controls arrive.

### 3.1 The partial-source note — [R9]

Two facts the ticket's single amber banner does not carry.

**First: the rows are absent, not degraded.** A partial page has invisible gaps. Nothing can be marked,
because there is nothing there to mark — which is precisely why the banner must say so in words, and why
"mark the affected rows" is not an option:

> **Some event sources are unavailable: Caseworking inbox, Caseworking outbox. Showing the rest.**
> Anything held in those sources is missing from this page, and Newer / Older only move through the sources
> that answered. Reload to try again.

**Second: "not configured" is not an incident.** `CW_BACKEND_URL` is unset in every environment today, so
until FGP-1227 lands *every* page carries an amber warning. Amber that is always on is amber that is never
read, and it will still be ignored on the day it means something. Split it:

> ⓘ **Caseworking is not connected in this environment.** This page lists GAS events only.  `alert alert-info`

Sources that failed keep the amber banner. Both can appear at once. This needs the view model to separate
`sourceErrors` whose `message` is `not configured` from the rest — the message string is still never
rendered, only tested. **Fallback:** one amber banner as the ticket specifies.

### 3.2 Empty state

Which of two things is true matters enormously and the ticket's `No events found.` covers both:

- **No filter:** *"No events found."* / "No inbox or outbox messages have been recorded yet." — the platform is idle.
- **Filter active:** *"No events match this filter."* / "Nothing matched `status = DEAD_LETTER`." + **Show all events** link — the platform is fine and you are looking through a keyhole.

Without the second, an operator reads "No events found" on a `?status=DEAD_LETTER` bookmark and concludes the
platform is dead quiet. The first line of the unfiltered variant is kept verbatim so existing tests pass.

### 3.3 Pager — [R8]

Newest-first means "Next" travels **backwards** in time, which is a small, permanent, avoidable confusion.
**Newer** (left) / **Older** (right). `rel="prev"` / `rel="next"` and the hrefs are unchanged.

The unavailable direction renders as a disabled `<span>`, not an omitted element, so the control keeps its
position between pages and the first page is legible as *the first page* rather than as a page whose buttons
moved. Right of it, `Newest first · up to 20 per page` — page context without a count (counts are out of scope).

### 3.4 Density, with reasons

- `table-sm` (12px body, 8px/12px padding) not `table-md`: rows are 2–3 lines; at `table-md` a 20-row page
  is ~1700px and M3's thirty-second glance covers a quarter of it.
- `leading-tight` on stacked lines: takes a 3-line cell from ~66px to ~54px, ~240px off the page.
- `table-zebra` kept: with multi-line cells, row boundaries carry real work.
- Hover `hover:bg-base-300`, not daisyUI's `row-hover` (which paints `base-200` — identical to the zebra
  stripe, so it is invisible on every even row).
- No sticky header: `overflow-x-auto` computes `overflow-y: auto` on an unbounded box, so `table-pin-rows`
  has nothing to stick to, and capping the height would push the pager below a nested scrollport.

---

## 4. Layout by breakpoint

**Wide ≥ 1440 · six columns, content capped at 90rem**

```
│ Status    Created        Event                    Route              Attempts  Last failure │
│ ┌──────┐  18 min ago     GLD-9B2-BWS-grasslands   GAS → Caseworking       0/5   -           │
│ │PUBLI.│  16 Jun, 11:47  case.status.updated      GAS outbox ·                               │
│ └──────┘                 3f2c1a0e-8b7d-…          cw__sns__update_status_fifo                │
│ ┌──────┐  50 min ago     GLD-9B2-BWS-grasslands   GAS → Caseworking       5/5   49 min ago   │
│ │DEAD_L│  16 Jun, 11:15  case.status.updated      GAS outbox · cw__sns…         16 Jun,11:16 │  ← bg-error/5
```

**Laptop 1024–1439 · same six columns, table scrolls from ~1280 down.** `max-w-[90rem]` still centres;
surplus goes to Event. This is the design's primary target.

**Tablet 640–1023 · four columns.** `Attempts` and `Last failure` are `hidden lg:table-cell`. They are the
tertiary pair and the status badge already answers what they qualify.

```
│ Status   Created        Event                     Route                     │
```

**Mobile < 640 · three columns.** `Route` becomes `hidden sm:table-cell`; inside Event, the event-id line
becomes `hidden sm:block`. What remains — state, recency, which application — is exactly the §1 primary tier
plus question 3, and it fits 375px with no horizontal scroll at all.

```
│ Status    Created        Event                    │
│ ┌──────┐  18 min ago     GLD-9B2-BWS-grasslands   │
│ │PUBLI.│  16 Jun, 11:47  case.status.updated      │
```

**Table or stacked cards on mobile?** Cards were rejected. The one-template constraint means cards would be
a *second copy* of every row in the DOM (`md:hidden` / `hidden md:table-row`), which doubles every Ctrl+F hit
— and Ctrl+F is this page's search interface (M2). Rebuilding the table as `block`/`table-cell` with
`::before` labels loses `<colgroup>`, daisyUI's table styling and the scannable column alignment that is the
entire point of the layout. **Progressive column disclosure** keeps one row of markup, one Ctrl+F hit, real
table semantics at every width, and drops only the tertiary tier. The horizontal scroller stays as a safety
net for the columns that *are* shown.

Column visibility is applied to `<th>` and `<td>` together; `<colgroup>` is therefore dropped and widths go
on the `<th>` (`w-[9rem]` etc.), since a hidden `<th>` removes its column but a `<col>` cannot be hidden per
breakpoint.

---

## 5. The shell

**One navbar band, no second nav row.** The section list has exactly one entry today. A dedicated nav row
containing one link is chrome that says nothing, so the section links live in the navbar itself as a
`menu menu-horizontal menu-sm` beside the brand. A second section is one more `<li>` — no new band, no reflow.
A `drawer` sidebar was rejected outright: a 16rem rail competes directly with the widest content this app
will ever have, and this app's content *is* a wide table.

```
│ Grants Platform Admin │ Events            [Env: LOCAL] [☀/☾] [Sign out] │   h-16, border-b
```

**`/dev-ops` redirects to `/dev-ops/events` — [R11].** The current index is a demo card. An index whose only
job is to link to the single page in the app is a click tax on every visit, and its "Signed in as X" is
already answered by the Sign out control. Events *is* the home; the brand link goes there. When there are
three tools and an overview has something to summarise, it earns its place then.
*Fallback if Mark wants the index kept:* `h1 Dev Ops`, one sentence, and a single
`card bg-base-100 border border-base-300` whose title is `Events`, body one line, action
`<a class="btn btn-sm" href="/dev-ops/events">Open</a>`. Nothing else; no duplicate Sign out.

**Nav item naming:** `Events` — the noun for the thing listed, matching the URL and the `h1`. Not "Event
list" (says nothing extra) and not "Message queues" (wrong: these are Mongo collections, not SQS).

**The env badge is a misidentification guard, not decoration.** Every environment renders an identical page.
An operator with test and production tabs open must not read test data during a production incident, or
paste a production screenshot into a ticket believing it is test. So it is loud where the stakes are —
`badge-warning` when `environment == 'production'`, `badge-ghost` otherwise — and it is in the top-right
where the eye lands when a tab is restored.

**The footer carries two facts and nothing else,** both of which qualify every page and have nowhere else to
live: *Read-only* (so nobody hunts for a Retry button that this story does not have) and *Times shown in
Europe/London* (so nobody misreads a timestamp against UTC logs during M4). No copyright, no version, no
links.

---

## 6. Anatomy — exact classes

Shell (`views/layouts/page.njk`): `<body class="flex min-h-screen flex-col bg-base-200">`;
navbar `navbar min-h-16 border-b border-base-300 bg-base-100 px-0` with an inner
`mx-auto flex w-full max-w-[90rem] items-center gap-2 px-4 sm:px-6 lg:px-8`;
`<main id="main-content" class="mx-auto w-full max-w-[90rem] flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">`;
footer `mt-10 border-t border-base-300 bg-base-100` with the same inner gutters.

**Width — `max-w-[90rem]` (1440px), replacing `container mx-auto max-w-4xl`.** The six columns need ~80rem
before anything wraps; `max-w-4xl` (896px) means every desktop scrolls on every page. 90rem clears it, leaves
slack for the Event column, and leaves the future Actions and Error columns a scroll rather than a redesign.
`container` is dropped — it caps at breakpoints and fights the max-width.

**Header block**

```html
<hgroup class="mb-5 flex flex-wrap items-start justify-between gap-3">
  <div>
    <h1 class="text-xl font-bold sm:text-2xl">Events</h1>
    <p class="mt-1 text-sm text-base-content/70">Every inbox and outbox message across GAS and Caseworking, newest first.</p>
  </div>
  <div class="flex items-center gap-2" data-testid="do-heading-actions"><!-- FUTURE: Purge Completed --></div>
</hgroup>
```

**Provenance line** (`mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70`,
`data-testid="events-provenance"`), `information-circle` at `h-4 w-4 shrink-0`, then either
`<span>All statuses, both services</span>` or
`<span class="font-medium text-base-content">Filtered: status = DEAD_LETTER</span> <a class="link link-hover" href="/dev-ops/events">Show all</a>`,
then `<span aria-hidden="true">·</span> as at {{ asAt }} · data may be a few seconds behind (read from a secondary).`

**Alerts** — solid `alert alert-error` / `alert alert-warning` / `alert alert-info`, each `mb-4`, icon
`h-5 w-5 shrink-0`, two `<p>`: `font-semibold` headline then `text-sm` detail. Solid, never `alert-soft`:
soft paints the raw accent as *text* on near-`base-100`, and light-theme amber measures ~1.8:1 there.
`role="alert"` on the failure, `role="status"` on the partial and info notes.

**Table**

```html
<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
     tabindex="0" role="region" aria-label="Events, scrollable" data-testid="events-scroller">
  <table class="table table-zebra table-sm" data-testid="events-table">
    <caption class="sr-only">Inbox and outbox events across GAS and Caseworking, newest first, up to 20 per page.</caption>
    <thead class="text-xs uppercase tracking-wider">
      <tr>
        <th scope="col" class="w-[9rem]">Status</th>
        <th scope="col" class="w-[11rem]">Created</th>
        <th scope="col" class="min-w-[18rem]">Event</th>
        <th scope="col" class="hidden w-[16rem] sm:table-cell">Route</th>
        <th scope="col" class="hidden w-[7rem] text-right lg:table-cell">Attempts</th>
        <th scope="col" class="hidden w-[11rem] lg:table-cell">Last failure</th>
      </tr>
    </thead>
```

Row: `<tr class="hover:bg-base-300">`, or `<tr class="bg-error/5 hover:bg-base-300">` when
`status == 'DEAD_LETTER'` (both spelled out — see §9). Every `<td>` carries `align-top`.

| Cell | Classes and content |
|---|---|
| Status | `align-top` → `statusBadge({ status, role, retrying })`, unchanged component |
| Created | `align-top whitespace-nowrap` → `<div class="text-sm font-medium leading-tight">18 min ago</div>` + `<div class="mt-0.5 font-mono text-[11px] leading-tight tabular-nums text-base-content/60">16 Jun 2026, 11:47:12 BST</div>` |
| Event | `align-top` → line 1 `font-mono text-sm font-semibold leading-tight break-all`; line 2 `mt-0.5 text-xs leading-tight text-base-content/80` (audit variant: `badge badge-ghost badge-xs mr-1` + remainder at `/60`); line 3 `mt-0.5 hidden font-mono text-[11px] leading-tight break-all text-base-content/55 sm:block` |
| Route | `align-top hidden whitespace-nowrap sm:table-cell` → line 1 `text-xs`; line 2 `mt-0.5 font-mono text-[11px] leading-tight text-base-content/60` |
| Attempts | `align-top hidden whitespace-nowrap text-right font-mono text-xs tabular-nums lg:table-cell`, plus `text-base-content/50` when 0 or `font-bold text-error` at max |
| Last failure | `align-top hidden whitespace-nowrap lg:table-cell` → same two-line shape as Created in `text-error`, or a bare `-` |

**Pager row** — `mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`; a
`nav.join` with `a.join-item.btn.btn-sm.motion-reduce:transition-none` (`rel="prev"` Newer / `rel="next"`
Older) or `span.join-item.btn.btn-sm.btn-disabled[aria-disabled=true]`; then
`<p class="text-xs text-base-content/70">Newest first · up to 20 per page</p>`. The whole `<nav>` is omitted
only when both hrefs are null.

**Empty state** — `rounded-box border border-base-300 bg-base-100 p-10 text-center`, `inbox` glyph
`mx-auto h-10 w-10 text-base-content/30`, headline `mt-3 text-base font-semibold`, body
`mt-1 text-sm text-base-content/70`, and in the filtered variant `<a class="link" href="/dev-ops/events">Show all events</a>`.

---

## 7. States matrix

| State | Provenance | Alerts | Table | Pager |
|---|---|---|---|---|
| Default, mid-list | `All statuses, both services · as at …` | none | 20 rows | Newer link · Older link |
| First page | as above | none | rows | Newer **disabled** · Older link |
| Last page | as above | none | rows | Newer link · Older **disabled** |
| Single page | as above | none | rows | `<nav>` omitted; position line kept |
| Empty, unfiltered | as above | none | "No events found." panel | omitted |
| Empty, filtered | `Filtered: … · Show all` | none | "No events match this filter." + Show all | omitted |
| Whole-request error | as above | `alert-error` | **nothing** — no table, no empty panel | omitted |
| CW not configured (today's normal) | as above | `alert-info` | GAS rows | normal |
| One source failed | as above | `alert-warning` naming `GAS outbox` | remaining rows | normal |
| Several failed | as above | one `alert-warning`, comma list | remaining rows | normal |
| Not configured **and** failed | as above | info **then** warning | remaining rows | normal |
| Filtered + partial | `Filtered: …` | warning | rows | normal |
| Long id / ref / type | – | – | wraps inside Event via `break-all` / `break-words`; table width unchanged | – |
| Unknown status | – | – | `badge-ghost`, raw text, no icon, no row tint | – |
| Row older than 7 days | – | – | Created line 1 becomes the absolute time; no relative line | – |
| 20 rows | – | – | ≈1450px tall; page scrolls, header does not stick | below the fold, expected |
| Dark theme | – | same variants | `base-100` card is *lighter* than the `base-200` page — inverted elevation, correct for dark | – |

---

## 8. Theme, colour and measured contrast

`dev-ops.css` configures `themes: light --default, dark --prefersdark`; the toggle forces `dark`. Kept, and
**light-first** despite the dark stakeholder mockup: this app shares a tab and a service identity with the
light-only GDS side of the same service, and operators run it beside whatever their OS decides. Dark is one
click away and preserves the mockup's look.

| Token | Used for | Never |
|---|---|---|
| `base-100` | card, table, navbar, footer surfaces | the page ground |
| `base-200` | page ground, zebra stripe | – |
| `base-300` | every border, row hover | text |
| `base-content` | all text; `/80` `/70` `/60` `/55` `/50` the recede scale; `/30` empty glyph | – |
| `primary` | the skip link only | body text (**R12**) |
| `info`/`success`/`warning`/`error` | badge and alert fills; `error/5` the dead-row tint | text, except `text-error` on the two failure cells |

**[R12]** daisyUI's dark `--color-primary` (`oklch(58% .233 277)`) on dark `base-100` measures **2.9:1** —
below AA, on the page's most-quoted identifier. Raising the token instead breaks `btn-primary` and
`badge-primary`, which paint near-white content on it. So the event id carries weight and typeface, not hue;
when Inspect makes it a link it becomes `<a class="link">`, underlined, inheriting `base-content`.

**One CSS change.** Light `--color-error` is `oklch(71% .194 13.428)` — **2.7:1** as text on white, and 3.9:1
against its own content colour, while the ticket mandates `text-error` for failure times and exhausted
attempts. Append **after** the existing `@plugin "daisyui"` block (the theme plugin merges with the built-in
theme of the same name — verified in `node_modules/daisyui/theme/index.js`):

```css
@plugin "daisyui/theme" {
  name: "light";
  default: true;
  --color-error: oklch(52% 0.19 25);
  --color-error-content: oklch(98% 0 0);
}
```

Resulting ratios — light / dark: body on card 15 / 14 · `/70` metadata 8 / 7 · `/55` event id 5.2 / 4.9 ·
`text-error` 6.2 / 4.7 · `badge-error` 6.2 / 6.3 · `badge-warning` 5.7 / 5.7 · `badge-info` 6.6 / 6.6 ·
`badge-success` 5.8 / 5.8 · `badge-ghost` 12 / 15.8 · alerts 5.7–6.2 both.

In dark, `base-200` (23.3%) is **darker** than `base-100` (25.3%), so elevation inverts and cards lift off
the page. Intended; no class changes, because every surface is named semantically.

---

## 9. Accessibility

- **Landmarks:** `banner` (navbar), `navigation` × 2 (`aria-label="Sections"` in the navbar,
  `aria-label="Pagination"`), `main#main-content`, `contentinfo`.
- **Headings:** exactly one `h1`. No `h2` — the table is introduced by its `<caption>`.
- **Table semantics:** `<caption class="sr-only">`, `<th scope="col">` on all six, no row headers.
- **Scroll region:** `tabindex="0" role="region" aria-label="Events, scrollable"` with a visible
  `focus-visible` outline. Without it the table is unreachable by keyboard when it clips (WCAG 2.1.1).
- **Progressive disclosure and AT:** hidden columns use `hidden … :table-cell`, i.e. `display:none` — they
  are removed from the accessibility tree *and* from Ctrl+F at that width. That is deliberate and safe
  because only the tertiary tier is ever hidden; nothing an operator searches for (reference, type, topic,
  event id) is hidden below `sm`, and only the event id is hidden below `sm`.
- **Badges:** no ARIA. The badge text *is* the status; `role="status"` would create twenty live regions. The
  retry glyph is `aria-hidden` and **never animates** — an animated glyph implies live polling.
- **Relative time:** the absolute value is present in the same cell as real text, so nothing depends on
  parsing "18 min ago". No `<time datetime>` is required, but it is free and correct: `<time datetime="{{ isoCreatedAt }}">`.
- **Attempts / Last failure:** no `sr-only` suffixes. `5 / 5` and a timestamp are self-describing and the
  row's own badge carries the state as text; adding hidden text would also change `.text()` and break tests
  for no gain.
- **Alerts:** `role="alert"` on the failure, `role="status"` on partial and info. Neither is announced at
  load — server-rendered live regions do not fire — so DOM order does the work.
- **Keyboard path:** skip link → brand → Events → theme toggle → Sign out → `Show all` (when filtered) →
  scroll region → Newer → Older → footer. Disabled directions are `<span aria-disabled="true">` and are
  correctly out of the tab order.
- **Focus:** daisyUI's own `focus-visible` ring on `.btn`/`.menu`; explicit
  `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` on the scroller and
  bare links. Never `outline-none` without a replacement.
- **Reduced motion:** `motion-reduce:transition-none` on pager and nav. Nothing animates by default.
- **Greyscale test:** printing the page in greyscale must lose nothing — every colour is duplicated by a word.
- **Zoom:** 200% at 1280px lands in the tablet band; column disclosure, not two-axis scrolling, absorbs it.

---

## 10. Copy — every string

`<title>` `Events | {{ serviceName }}` · skip `Skip to main content` · brand `{{ serviceName }}` · nav
`Events` · env `Env: LOCAL` (uppercased env name) · toggle `aria-label="Dark theme"` · `Sign out`.

`h1` **Events** · caption **Every inbox and outbox message across GAS and Caseworking, newest first.**

Provenance: **All statuses, both services** *or* **Filtered: status = DEAD_LETTER** + **Show all** ·
**as at 16 Jun 2026, 12:05:14 BST** · **data may be a few seconds behind (read from a secondary).**

Error alert: **Events could not be loaded from GAS.** / *Nothing is listed below. Reload; if it persists, check fg-gas-backend.*
Partial: **Some event sources are unavailable: Caseworking inbox, Caseworking outbox. Showing the rest.** /
*Anything held in those sources is missing from this page, and Newer / Older only move through the sources that answered. Reload to try again.*
Not connected: **Caseworking is not connected in this environment.** / *This page lists GAS events only.*

Headers: `Status` `Created` `Event` `Route` `Attempts` `Last failure`.
Table caption (sr-only): *Inbox and outbox events across GAS and Caseworking, newest first, up to 20 per page.*
Scroll region label: *Events, scrollable*.

Empty, unfiltered: **No events found.** / *No inbox or outbox messages have been recorded yet.*
Empty, filtered: **No events match this filter.** / *Nothing matched status = DEAD_LETTER.* + **Show all events**.

Pager **Newer** / **Older** (same words disabled) · position **Newest first · up to 20 per page**.
Footer **{{ serviceName }} · Dev Ops** · **Read-only. Times shown in Europe/London.**
Missing value placeholder: `-`. Relative bands: `just now`, `N min ago`, `N h ago`, `yesterday`, `N days ago`.

Tone: declarative, no exclamation marks, no "Oops", no "please". Status tokens keep their wire casing.

---

## 11. Implementation mapping

| File | Action |
|---|---|
| `views/layouts/page.njk` | **Change** — flex-column body, single navbar band with the section `menu`, env badge, `max-w-[90rem]` main, footer (§5–§6) |
| `views/components/heading/template.njk` | **Change** — actions slot, `text-xl sm:text-2xl`, caption `/70` |
| `views/components/status-badge/` | **Keep** — roles and literals unchanged |
| `views/components/pager/template.njk` | **Change** — Newer/Older, disabled `<span>` variants (`do-pager-*-disabled`), `motion-reduce:transition-none` |
| `views/components/icon/all/{x-circle,exclamation-triangle,information-circle,inbox}.njk` | **Add** — heroicons v2 24/solid in the `moon.njk` shape |
| `views/events.njk` | **Change** — provenance line, three alert variants, recomposed table, pager row, two empty variants |
| `views/index.njk` | **Delete** with [R11], or reduce to the one-card fallback in §5 |
| `routes/view-dev-ops.route.ts` | **Change** — `h.redirect('/dev-ops/events')` ([R11] fallback: keep the view) |
| `client/dev-ops.css` | **Change** — the light error tokens in §8, nothing else |
| `view-options.ts` | **Change** — add `environment` to the manager context |
| `view-models/events-page.view-model.ts` | **Change** — see below |
| `vite.config.ts`, `components/index.ts`, `use-cases/`, `repositories/` | **No change** |

### View-model changes, each with its justification and its fallback

1. **`route: { from, to, detail }`** replacing `source: string` — §2.3. Needed to answer question 5 without
   decoding. Two small lookup maps; `toSourceLabel` is deleted. *Fallback: keep `source`.*
2. **`createdRelative` / `lastFailureRelative` (`string | null`) and page-level `asAt: string`** — §2.5.
   One `Intl.RelativeTimeFormat` plus a five-band helper. *Fallback: absolute only, drop `asAt`.*
3. **`filter: { summary: string | null, clearHref: string }`** — §3, §3.2. Derived from the `query` the model
   already receives; `summary` is `null` when no param is set. Without it a filtered page is
   indistinguishable from a complete one. *Fallback: omit; accept the ambiguity.*
4. **`unavailableSources` splits into `unavailableSources` / `unconfiguredSources`** — §3.1. Tests
   `sourceErrors[].message === 'not configured'`; the message string is still never rendered.
   *Fallback: one string, one amber banner.*
5. **`attemptsIsZero: boolean`** — §2.4, so the template can pick the `/50` variant as a whole class literal
   rather than composing one. One expression.

No new fields on the wire, no change to the repository or use case, no counts, no totals. Audit detection
stays in the template (`{% if 'audit · ' in row.type %}`).

### Tailwind content-scan caveat

`dev-ops.css` is `@import "tailwindcss" source(none); @source "../views";` — **only `src/dev-ops/views` is
scanned**, and daisyUI 5's components are tree-shaken like any other utility. A literal that exists only in a
`.ts` file is dropped silently: no build error, no failing test, just unstyled markup. So every class must be
spelled out in a `.njk` file, **including every branch of every conditional** (the three Attempts variants and
the two `<tr>` variants each get their own literal), and no class name may ever be built by concatenation —
use a `{% set %}` table of complete literals, as `status-badge/template.njk` already does.

New literals this design introduces, all of which must appear under `views/`: `max-w-[90rem]`, `min-w-[18rem]`,
`w-[9rem]`, `w-[11rem]`, `w-[16rem]`, `w-[7rem]`, `text-[11px]`, `align-top`, `leading-tight`, `break-all`,
`break-words`, `tabular-nums`, `hover:bg-base-300`, `bg-error/5`, `border-base-300`, `text-base-content/80`,
`text-base-content/60`, `text-base-content/55`, `text-base-content/50`, `text-base-content/30`,
`hidden`, `sm:table-cell`, `sm:block`, `lg:table-cell`, `menu`, `menu-horizontal`, `menu-sm`, `menu-active`,
`badge-neutral`, `badge-warning`, `badge-xs`, `btn-disabled`, `alert-info`, `link`, `link-hover`,
`motion-reduce:transition-none`, `focus-visible:outline-2`, `focus-visible:outline-offset-2`,
`focus-visible:outline-primary`, `uppercase`, `tracking-wider`, `shrink-0`.
After implementing: `npm run build:frontend`, then grep the emitted CSS for each.

---

## 12. Reserved slots (out of scope, no reflow when filled)

| Feature | Slot | Cost when it lands |
|---|---|---|
| Purge Completed | `do-heading-actions` in the header row | zero — the row is already `justify-between` |
| Application dropdown + status tabs | a bordered bar between the header and the provenance line | ~64px; **replaces** the `Filtered:` disclosure, which is its temporary stand-in |
| Summary count cards | `grid grid-cols-2 gap-3 lg:grid-cols-4` above the provenance line | pushes the table down only |
| Actions (Inspect / Retry) | a 7th `<th class="w-[9rem]">` at the right | table minimum rises ~9rem; the scroller absorbs it |
| Error column | an 8th, `w-[16rem]`, wrapping, `align-top text-xs text-error` | same; consider `table-xs` at that point |
| Audit History / DLQ page | one more `<li>` in the navbar `menu` | one line |
| Row click-through to Inspect | the reference line becomes `<a class="link">` inside the same cell | `hover:bg-base-300` already signals it |

---

## 13. Handover checklist

- [ ] Squint at a healthy page: the left edge is grey, `0 / 5` and `-` are near-invisible, nothing pulls the eye.
- [ ] Put one `DEAD_LETTER` row among nineteen healthy ones — it is found in under a second, and it is the only red thing on the row.
- [ ] Ctrl+F a segregation reference: exactly one hit per matching row, never zero, never two; no value anywhere is truncated with an ellipsis.
- [ ] Every row answers "which hop" without decoding an arrow; the raw topic is still present and searchable.
- [ ] Every relative time has its absolute time beneath it, and the page states the time it was rendered.
- [ ] A page reached with `?status=DEAD_LETTER` says so at the top and offers `Show all`; its empty state says "match this filter", not "No events found".
- [ ] With CW unconfigured the page shows a blue informational note, not amber; a genuinely failed source shows amber and names it in the same words as the rows' second line.
- [ ] Error state: one red alert, no table, no empty panel.
- [ ] Pager holds its position on the first and last page; wording is Newer / Older.
- [ ] 1440px: six columns, no horizontal scroll. 900px: four columns. 375px: three columns and **no horizontal scroll at all**; the scroller is still keyboard-reachable with a visible focus ring.
- [ ] Column positions are identical between page 1 and page 2 of the same result set; every cell is top-aligned on one baseline.
- [ ] Both themes checked with the toggle; nothing below 4.5:1; the `dev-ops.css` error token override is in.
- [ ] Greyscale screenshot: nothing ambiguous. Event id is not blue.
- [ ] One `h1`, one banner/main/contentinfo, two labelled navs, `sr-only` caption, `scope="col"` × 6.
- [ ] `npm run build:frontend`; every literal in §11 present in the emitted stylesheet.
