# FGP-1392 build plans

Ticket: `../FGP-1392.md` (source of truth for scope, contract and acceptance criteria).

| Plan | Repo | Depends on |
|---|---|---|
| [01-gas-pagination.md](01-gas-pagination.md) | fg-gas-backend | — |
| [02-gas-events-endpoint.md](02-gas-events-endpoint.md) | fg-gas-backend | 01; contract of 03 |
| [03-cw-actuators.md](03-cw-actuators.md) | fg-cw-backend | — (FGP-1227 repointed) |
| [04-admin-fe-events-page.md](04-admin-fe-events-page.md) | fg-grants-platform-admin | contract of 02 |

Each plan is self-contained: a fresh engineer (or agent) with only the plan, the ticket and the repo should be able to build it. Plans must not change the contract in the ticket; contract problems go in the plan's "Contract concerns" section for a human to arbitrate.

## Status (2026-09-01)

All four plans have been refined against the code by independent agents and re-aligned with the ticket after a contract review. Every "Contract concerns" section is marked RESOLVED; the decisions taken:

- Sort/cursor keys are per source (`eventTime` string for inboxes, `publicationDate` Date for outboxes); `createdAt` is a derived name. Sources pass `pageSize: 20`.
- No `kind` field. Audit rows are recognised structurally (`auditEntities` / `event.audit.entities`); only `entity` and `action` are ever read — never `entityid` or `details`.
- CW actuators return `maxAttempts` per row and `auditEntities`; raw ARN `target`, reduced by GAS; envelope without `totalCount`.
- Any single source failing → `200` + `sourceErrors`; unconfigured CW → `"not configured"`; both GAS sources failing → `502`.
- Response `status` is a string (six documented values); `fullType` nullable; `attempts`/`maxAttempts` required integers ≥ 1.
- FE forwards `status`/`service` unvalidated; GAS's `400` shows as the in-page alert. Badge roles: PUBLISHED ghost, PROCESSING info, FAILED/RESUBMITTED warning, COMPLETED success, DEAD_LETTER error; role in view model, class literal in the template.

Build order: 01 → (03 in parallel) → 02 → 04. 02 and 04 can start against stubs once 01/03 contracts are fixed.
