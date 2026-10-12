<!--
FILE: docs/QA-CHEATSHEET.md
PURPOSE: Short, quotable answers to the questions an interviewer or a new
         contributor is most likely to ask — with a link to the file that
         proves each answer.
READER: Anyone preparing to discuss this project in an interview, a design
        review, or an onboarding session.
LAST UPDATED: 2026-10-12 @ commit 818ecb5 (Sprint 3 mid-flight).
SOURCE OF TRUTH: docs/SPEC.md, docs/API-CONTRACT.md, docs/DECISIONS.md,
                 docs/CODE-WALKTHROUGH.md.
-->

# Q&A Cheat Sheet

Each answer is 2–4 sentences plus a proof link. If a question goes deeper
than the answer, the linked file — or CODE-WALKTHROUGH §1/§2/§3 — is the
next stop.

---

## Q1. Why a monorepo instead of separate repos?

The backend and frontend share an API contract that changes often in
Sprint 1–3, and a single PR that lands both sides of a contract change is
easier to review than two coordinated PRs. It also means one CI
configuration, one branch strategy, and one place for docs. The trade-off
is CI must be path-aware enough not to rebuild everything on a docs-only
change — we handle that with scaffold guards and cache keys per package.

→ Proof: docs/DECISIONS.md #1, `.github/workflows/ci.yml` (three jobs, three working-directories)

## Q2. Why Fastify over Express?

Fastify has first-class JSON Schema validation and serialization at the
route boundary, typed route generics, and a plugin/encapsulation model
that keeps route groups isolated — which matters directly for §1.4 (the
staff/admin API-key hooks are plugin-scoped precisely because Fastify
gives plugins a scope). It is also measurably faster than Express with a
smaller memory footprint, which matters on modest POS hardware.

→ Proof: docs/DECISIONS.md #2, `backend/src/app.ts` (plugin registration order), `backend/src/routes/staff.ts` (scoped hook)

## Q3. Why Prisma over TypeORM?

`schema.prisma` is a single source of truth that generates both the SQL
migration and the TypeScript client, so schema and code cannot drift. The
migration workflow (`prisma migrate dev` / `migrate deploy`) is explicit
and reviewable in a PR, and the generated client gives end-to-end type
safety without hand-written entity decorators. TypeORM's history with
TypeScript strictness and migration edge cases made it the riskier choice.

→ Proof: docs/DECISIONS.md #3, `backend/prisma/schema.prisma`

## Q4. Why a settings table instead of env vars for business config?

Points per referral, expiry windows, and the redemption TTL are business
values that ops or product may want to tune without a redeploy — env vars
would force a restart, and multiple backend instances could drift. A
single DB row is a shared source of truth across every instance, carries
an `updatedAt` for free, and can be seeded per-test. Secrets (DB creds,
API keys) still live in env — the settings table is for tunables, not
secrets.

→ Proof: docs/DECISIONS.md #4, `backend/src/settings/schema.ts` (single source of truth), `backend/src/settings/loader.ts` (cache + invalidate)

## Q5. Why simple API keys over JWT?

The callers are services — the frontend and the POS — not end users with
logins in this system. JWT would add signing-key management, expiry, and
revocation machinery for a problem we do not have. A static key per
audience (staff, admin) is trivial to rotate and audit, and the POS
platform already handles user identity upstream; duplicating it here
would create two sources of truth. This is explicitly a "revisit when
first-party login arrives" decision.

→ Proof: docs/DECISIONS.md #5, `backend/src/routes/staff.ts` + `backend/src/routes/admin.ts` (plugin-scoped hooks)

## Q6. How is the referral completion atomic?

`recordPosVisit` is deliberately two-phase. Phase 1 records the POS visit
as a standalone write — SPEC F2 says "visit still recorded" even when the
referral is rejected. Phase 2 wraps two writes in a single
`prisma.$transaction`: flip the referral from PENDING to COMPLETED, and
insert the REFERRAL_BONUS reward. A crash between the two leaves the
visit, never a partial reward.

→ Proof: docs/CODE-WALKTHROUGH.md §1.2, `backend/src/usecases/recordPosVisit.ts`

## Q7. How does the idempotency guarantee work?

Two layers, defending different failure modes. First, the transaction
does an optimistic lock: `updateMany({ where: { id, status: PENDING } })`
returns `{ count }`; a race loses with count=0 and bails with 409 — no
lost update. Second, `UNIQUE(referralId, type)` on the Reward table
catches any code path that somehow bypasses the lock, and the usecase
translates Prisma's P2002 into the same 409. The check-then-write
pattern is deliberately avoided — it loses to races.

→ Proof: docs/CODE-WALKTHROUGH.md §1.2, `backend/src/usecases/recordPosVisit.ts` (both guards), `backend/prisma/schema.prisma` (UNIQUE constraints)

## Q8. Where does business config come from?

Every tunable — points per referral, referral expiry days, redemption
expiry days, reward code length, points-to-baht rate — lives in the
`settings` table and is read through typed getters on the settings
loader: `settings.getPointsPerReferral()`, etc. Reads are cached in a
process-local map with a TTL from `SETTINGS_CACHE_TTL_SECONDS` (default
30s), and `PATCH /admin/settings` calls `invalidateCache()` after the
transaction commits so the next request sees the new value immediately.
Nothing in `backend/src/` hardcodes a business value.

→ Proof: docs/DECISIONS.md #4, `backend/src/settings/loader.ts`, `backend/src/usecases/updateSettings.ts`

## Q9. How do we test without mocking the DB?

Backend integration tests run against a real Postgres, driven by
Fastify's `app.inject()` — no mocks, no in-memory substitute. The reason
is that the bugs we care about live at the DB boundary: `$transaction`
semantics, UNIQUE constraints, and rollback behaviour cannot be faked
faithfully. Suites share one database, so `fileParallelism: false` keeps
them serial, and each suite claims a unique email/phone prefix so cleanup
is a single sweep in FK order (reward → referral → posVisit → customer).

→ Proof: docs/CODE-WALKTHROUGH.md §3.1–§3.2, `backend/vitest.config.ts` (fileParallelism: false), `backend/tests/*.test.ts` (prefix constants + afterAll)

## Q10. What does the CI actually run?

Three jobs, run in parallel where possible. **Backend** spins up a
`postgres:16-alpine` service, runs `prisma generate` + `migrate deploy` +
`db seed`, then lint, typecheck, and vitest. **Frontend** runs lint,
typecheck, and a production `vite build` — the build catches Tailwind
config errors and bad import paths that typecheck alone would miss.
**E2E** `needs: [backend, frontend]`, creates `frontend/.env` (the
`VITE_API_URL` module-init trap), starts both dev servers in the
background, waits for `:3000/health` and `:5173`, installs Chromium, and
runs the Playwright customer-flow spec. On failure, the HTML report
uploads as an artifact.

→ Proof: `.github/workflows/ci.yml`, docs/CODE-WALKTHROUGH.md §3.4, the project docs §STEP 2.1

---

## Footer

Maintained by the project maintainer. Add a Q when a question comes
up more than once in review — the goal is a five-minute read, not an
FAQ. If an answer and the code disagree, the code wins; fix the answer
in the same PR.
