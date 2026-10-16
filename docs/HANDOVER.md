<!--
FILE: docs/HANDOVER.md
PURPOSE: Onboarding document for new contributors and team. Gives an
         honest snapshot of project state, architecture, patterns, and rules
         so a new team can start work without asking the outgoing team.
READER: Any new team member joining the project. Read top to bottom
        the first time; then use as an index.
LAST UPDATED: 2026-10-16 (Wave-1 audit fixes + new staff E2E; not yet committed).
SOURCE OF TRUTH: docs/SPEC.md, docs/API-CONTRACT.md, docs/DECISIONS.md.
-->

# HANDOVER — POS Referral & Loyalty

## 1. Project state snapshot

- **Sprint:** Sprint 3 in progress. Backend (F1-F4) and all three
  frontend pages are implemented; deploy is the remaining stretch goal.
- **Features complete (backend):** F1 register, F2a referral create,
  F2b POS visit completion, F3 rewards + redemption, F4 admin.
- **Features complete (frontend):** all three pages — Customer
  (register + referral + invite), Staff (key + lookup + redeem +
  confirm), Admin (key + referrals table + redemptions table +
  settings editor).
- **Tests:** 66 passing + 1 skipped (backend, vitest, 8 files). 2 E2E specs
  (Playwright customer-flow + staff-flow), green in CI.
- **CI:** 3 jobs (Backend, Frontend, E2E), all green on main.
- **Sprint 3 commits:** `efb3ec5` (referrals endpoint) → `ae8a91a`
  (frontend Admin page). See `git log --oneline` for the full trail.

## 2. Architecture at a glance

### Tech stack

- **Backend:** Node 20 + TypeScript + Fastify 5 + Prisma 5 + PostgreSQL 16
- **Frontend:** React 19 + Vite 6 + TypeScript + Tailwind v3 + React Router v6
- **Tests:** Vitest (backend integration against real Postgres), Playwright
  (E2E — two specs: customer-flow + staff-flow)
- **CI:** GitHub Actions — backend job spins up Postgres service + migrate
  deploy + seed before running tests.

### Repo layout
    .
    |-- backend/ Fastify API, Prisma schema, vitest tests
    |-- frontend/ Vite + React app, Tailwind, React Router
    |-- docs/ SPEC, API-CONTRACT, DECISIONS, HANDOVER, team docs/
    |-- .github/workflows/ ci.yml (backend + frontend + e2e jobs)
    |-- docker-compose.yml local Postgres for development

### Layer boundaries (backend)

    routes/* → usecases/* → prisma (via src/db/prisma.ts) + settings loader
    \── errors.ts (typed ApiError hierarchy)

- **Routes** are thin: parse input, call usecase, serialize response.
  Never contain business logic.
- **Usecases** orchestrate domain + DB + settings. Never import fastify.
- **Prisma** accessed only through the singleton in `src/db/prisma.ts`.

### Auth model

| Caller | Header | Scope |
|--------|--------|-------|
| Public (customer) | none | `/api/*`, `/internal/mock-pos/*` |
| Staff | `X-Staff-Key` | `/staff/*` |
| Admin | `X-Admin-Key` | `/admin/*` |

Keys come from env (`STAFF_API_KEY`, `ADMIN_API_KEY`). No JWT (DECISIONS #5).

---

## 3. Source of truth

These files define what the system does. Do not edit without telling the
Maintainer — every team reads from the same originals.

- **docs/SPEC.md** — business rules, features (F1–F4), data model, NFRs.
- **docs/API-CONTRACT.md** — every endpoint, request/response shape,
  auth header, error code. This is what the frontend and QA trust.
- **docs/DECISIONS.md** — why we chose monorepo, Fastify, Prisma,
  settings table, API-key auth. Read this before proposing changes that
  contradict an accepted decision.

If SPEC or API-CONTRACT needs an update, the request goes through the
the maintainer. Do not fork the contract silently.

## 4. Patterns every team must follow

### Error handling (backend)

Throw a subclass of `ApiError` (see `backend/src/errors.ts`). The global
error handler in `backend/src/app.ts` translates it into the standard
JSON shape:

    { "error": "message", "code": "MACHINE_CODE", "details": {...} }

Available subclasses and their defaults:
- `ValidationError`  → 400 INVALID_INPUT
- `UnauthorizedError` → 401 UNAUTHORIZED
- `ForbiddenError`    → 403 FORBIDDEN
- `NotFoundError`     → 404 NOT_FOUND
- `ConflictError`     → 409 CONFLICT
- `GoneError`         → 410 GONE
- `InternalError`     → 500 INTERNAL

Each subclass accepts an optional `code` override for endpoint-specific
codes (e.g. `REFERRER_NOT_FOUND`, `SELF_REFERRAL`) and an optional
`details` payload (e.g. F2b 409 includes `visitId`).

Never construct an HTTP response directly in a route for error cases —
throw and let the handler format it.

### Settings (business config)

All tunable values live in the DB `settings` table (DECISIONS #4). Read
via the typed loader:

    import { settings } from '../settings/loader.js';
    const points = await settings.getPointsPerReferral();

Never hardcode points, expiry days, code length, or exchange rates in
code. If a value is tunable in production, it belongs in settings and
therefore in `backend/src/settings/schema.ts`.

### Validation

Routes accept `unknown` payloads; usecases validate with zod. ZodError
bubbles to the global handler and becomes 400 INVALID_INPUT with a
`details` object keyed by field name.

### Transactions (multi-step writes)

When two or more rows must move together (e.g. F2b completion: referral
update + reward create), wrap them in `prisma.$transaction(async (tx) => …)`.
Individual writes are not enough — a crash mid-way would leave a partial
state that violates the domain invariants in SPEC §5.

### Idempotency

Any endpoint that must not double-apply uses a UNIQUE constraint at the
DB level (see `UNIQUE(refereeId)` on Referral, `UNIQUE(referralId, type)`
on Reward). The usecase catches Prisma's `P2002` (via
`isPrismaUniqueViolation`) and translates the collision into the
appropriate `ConflictError`. Do not replace DB constraints with
check-then-write logic — that loses to races.

### File header (Rule #6)

Every source file starts with a block comment:

    /**
     * FILE: <path>
     * PURPOSE: <1-2 lines on what this file does>
     * CALLED BY: <who imports this>
     * CALLS: <what this imports>
     */

Add inline "why" comments at decision points (why a transaction, why a
retry, why a cache TTL) — but not "what" comments (the code says what).

## 5. Anti-hardcode checklist

Every PR must satisfy all four before merge. These are enforced by review
and (where possible) by tests / lint. Do not add exemptions silently.

- [ ] No secrets in code — API keys and DB credentials come from env;
      business values come from the settings table (DECISIONS #4, #5).
- [ ] No URLs hardcoded — backend reads from `process.env`; frontend reads
      from `import.meta.env.VITE_*`.
- [ ] No status / type literals — use `backend/src/constants.ts`
      (`REFERRAL_STATUS`, `REWARD_TYPE`, `REWARD_STATUS`) which re-export
      Prisma's generated enums, so a schema change cannot silently break
      comparisons.
- [ ] No magic numbers — extract to a named `const` with a WHY comment
      (page sizes, retry counts, prefix lengths, MS_PER_DAY, etc.).

## 6. Handover workflow

This project uses an Maintainer-driven workflow. Read this before you
issue any command.

- **One step at a time.** Each step produces exactly one artifact (a file,
  a patch, a test run). Stop and wait for the maintainer to paste output
  before proceeding.
- **No terminal access for teams.** The maintainer runs every command
  and pastes output back. Never assume a command succeeded.
- **Never skip verification.** Every step ends with an explicit verify
  block. If a paste looks truncated or odd (a common artifact of long
  heredocs), stop and re-check with `grep`/`wc -l` rather than moving on.
- **Watch for paste artifacts.** A `text` line appearing where a
  ``` fence should be, or an echo command leaking into file content, both
  indicate the terminal swallowed part of the input. Use indented code
  blocks (4-space) in docs to avoid the issue.
- **Report failures immediately.** A red CI run or a failing test is not a
  blocker to hide — paste the log so the maintainer can diagnose.

## 7. Team split (Sprint 3)

Four teams own disjoint areas. Do not cross the boundary without the
maintainer's coordination.

| Team | Owns | Does not own |
|------|------|--------------|
| Git (maintainer) | docs/**, .github/**, README.md, deploy | backend/src/**, frontend/src/** |
| Backend | backend/src/**, backend/prisma/** | docs/**, frontend/** |
| Frontend | frontend/src/**, frontend/public/** | backend/**, docs/** |
| QA | backend/tests/**, tests/e2e/** | backend/src/**, frontend/src/** |

Per-team briefs with task queues live in the project docs/.

---

## Footer

Maintained by the project maintainer. Update the LAST UPDATED line at
the top of this file whenever a structural change lands (new top-level
folder, new CI job, new team split).
