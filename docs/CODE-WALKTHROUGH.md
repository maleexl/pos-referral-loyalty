<!--
FILE: docs/CODE-WALKTHROUGH.md
PURPOSE: Guided tour of the codebase — where to look, in what order, and why.
         Skeleton only in Sprint 1; each section is filled in as modules land
         (Sprint 2 for backend, Sprint 3 for full end-to-end trace).
CALLED BY: New contributors, future AI sessions, code reviewers.
CALLS: References docs/SPEC.md, docs/API-CONTRACT.md, docs/DECISIONS.md.
-->

# CODE-WALKTHROUGH — POS Referral & Loyalty System

**Status:** SKELETON — to be completed in Sprint 3.
**Audience:** a new contributor who has read SPEC.md and API-CONTRACT.md and now
wants to understand how the code is organized and how a request flows end-to-end.

---

## 0. How to use this document

Read top to bottom the first time. After that, use it as an index — jump to the
module you are touching, follow its "Reading order" and "Key files" list.

Each module section follows the same shape:

- **Purpose** — what this module is responsible for (one paragraph).
- **Key files** — the files you must read, in order.
- **Reading order** — which functions/types to start with and why.
- **Gotchas** — non-obvious behavior, invariants, or traps.

---

## 1. Backend

**Language/stack:** Node.js 20 + TypeScript + Fastify + Prisma + PostgreSQL.

### 1.1 Entry point and bootstrap

- Purpose: TODO (Sprint 2) — describe server bootstrap, plugin registration,
  config loading, graceful shutdown.
- Key files: TODO — backend/src/server.ts, backend/src/app.ts.
- Reading order: TODO.
- Gotchas: TODO — e.g. order of plugin registration, error handler setup.

### 1.2 Routes and HTTP layer

- Purpose: TODO (Sprint 2) — Fastify route definitions; mapping to API-CONTRACT
  endpoints; request/response validation with zod or JSON Schema.
- Key files: TODO — backend/src/routes/*.ts.
- Reading order: TODO — start with /api/customers, then /api/referrals,
  then /api/rewards, then /admin/*.
- Gotchas: TODO — auth header handling (X-Staff-Key / X-Admin-Key), error shape
  must match API-CONTRACT "Standard Errors".

### 1.3 Usecases (business logic)

- Purpose: TODO (Sprint 2) — one usecase per business action
  (register customer, create referral, complete referral, redeem, confirm).
  Usecases orchestrate domain + repos + settings; they do not know about HTTP.
- Key files: TODO — backend/src/usecases/*.ts.
- Reading order: TODO — completeReferral.ts first (it is the most subtle:
  transaction + idempotency + expiry).
- Gotchas: TODO — BR-5 (single transaction), BR-6 (settings only),
  BR-8 (reward status check).

### 1.4 Persistence (Prisma)

- Purpose: TODO (Sprint 2) — schema, migrations, generated client, repo helpers.
- Key files: TODO — backend/prisma/schema.prisma, backend/src/db/*.ts.
- Reading order: TODO — schema.prisma, then migrations/, then repo wrappers.
- Gotchas: TODO — UNIQUE(refereeId), UNIQUE(referralId, type),
  settings row seeding.

### 1.5 Settings loader

- Purpose: TODO (Sprint 2) — read business config from the settings table,
  with a short-lived in-process cache to avoid a DB hit per request.
- Key files: TODO — backend/src/settings/*.ts.
- Reading order: TODO.
- Gotchas: TODO — cache TTL, invalidation on PATCH /admin/settings,
  the values are strings in the DB (per API-CONTRACT /admin/settings).

---

## 2. Frontend

**Language/stack:** React + Vite + Tailwind.

### 2.1 App shell and routing

- Purpose: TODO (Sprint 2) — describe app layout, route table, shared providers
  (query client, API client context).
- Key files: TODO — frontend/src/main.tsx, frontend/src/App.tsx, frontend/src/routes/*.
- Reading order: TODO.
- Gotchas: TODO — environment-based API base URL (VITE_API_BASE_URL), no hardcoded URLs.

### 2.2 API client

- Purpose: TODO (Sprint 2) — thin wrapper around fetch that sets headers
  (Content-Type, X-Staff-Key / X-Admin-Key), parses standard errors, and exposes
  typed functions per API-CONTRACT endpoint.
- Key files: TODO — frontend/src/api/client.ts, frontend/src/api/*.ts.
- Reading order: TODO.
- Gotchas: TODO — error shape from API-CONTRACT ("error" + "code"); never log
  API keys; keep staff/admin keys out of the customer-facing bundle where possible.

### 2.3 Feature pages (F1–F4)

- Purpose: TODO (Sprint 2) — one page per functional requirement:
  register / referral share / points & redeem / admin dashboard.
- Key files: TODO — frontend/src/pages/*.
- Reading order: TODO.
- Gotchas: TODO — business values (points, expiry, rate) come from settings
  endpoint, never hardcoded in UI.

### 2.4 Components and styling

- Purpose: TODO (Sprint 2) — shared UI primitives (buttons, inputs, tables)
  and Tailwind conventions.
- Key files: TODO — frontend/src/components/*.
- Reading order: TODO.
- Gotchas: TODO.

---

## 3. End-to-end request lifecycle

Traces to fill in Sprint 3 (one per major flow):

### 3.1 Customer registration (F1)

TODO — from frontend form submit → POST /api/customers → route handler →
usecase → Prisma insert → response → UI update.

### 3.2 Referral + first visit (F2)

TODO — from POST /api/referrals (PENDING created) → POST /mock-pos/visits →
usecase checks expiry → single transaction: status COMPLETED + reward ISSUED +
referrer balance += points_per_referral (from settings).

### 3.3 Redemption (F3)

TODO — staff issues code → customer presents code → staff confirms →
points deducted, reward REDEEMED, code cannot be reused.

### 3.4 Admin settings change (F4)

TODO — PATCH /admin/settings → validation → DB update → settings cache
invalidation → subsequent reads pick up new value.

---

## 4. Testing

### 4.1 Unit tests (Vitest)

- Purpose: TODO (Sprint 2) — cover pure logic (usecases, validators, settings
  loader cache). No DB, no HTTP.
- Key files: TODO — backend/tests/unit/*.test.ts.
- Reading order: TODO.
- Gotchas: TODO — do not rely on wall clock; inject "now" where time matters
  (referral expiry).

### 4.2 Integration tests (Vitest)

- Purpose: TODO (Sprint 2) — spin up Fastify app + test DB, exercise endpoints
  end-to-end within the process.
- Key files: TODO — backend/tests/integration/*.test.ts.
- Reading order: TODO — start with referral completion, because it exercises the
  transaction + idempotency path.
- Gotchas: TODO — reset DB between tests; seed a settings row per test.

### 4.3 E2E (Playwright)

- Purpose: TODO (Sprint 3) — browser-driven tests for the frontend flows
  (register, share code, redeem).
- Key files: TODO — frontend/e2e/*.spec.ts.
- Reading order: TODO.
- Gotchas: TODO — mock POS visit endpoint to control timing.

---

## 5. Conventions

### 5.1 File header comment (RULE #6)

Every source file MUST start with a header comment of this shape:

    /**
     * FILE: <filename>
     * PURPOSE: <what this file does, 1-2 lines>
     * CALLED BY: <who imports this>
     * CALLS: <what this imports>
     */

Plus inline "why" comments at critical points (not "what" — the code says what).

### 5.2 Anti-hardcode checklist

Before merging any change, confirm:

- No secrets in code — use .env or the settings table.
- No URLs hardcoded — read from process.env (backend) or VITE_* (frontend).
- No points / expiry / rate hardcoded — read from the settings table.
- No magic numbers — extract to a named constant with a comment.

### 5.3 Commit conventions

Conventional Commits: feat:, fix:, test:, docs:, chore:.
One concern per commit. Reference SPEC rule (e.g. BR-5) in the body when relevant.

### 5.4 Branch strategy

main + feature/* + PR (even solo). CI must pass before merge.

---

## 6. Glossary

| Term | Meaning |
|------|---------|
| Referrer | The existing customer who shares a referral code |
| Referee | The new customer who registers using that code |
| Referral | The link between referrer and referee; has status PENDING / COMPLETED / EXPIRED |
| Reward | A points event for a customer; type REFERRAL_BONUS or REDEMPTION; has status ISSUED / REDEEMED |
| Points balance | Running total of points a customer can redeem |
| Settings | DB-backed business config (points_per_referral, referral_expiry_days, points_to_thb_rate, reward_code_length) |
| Mock POS | Internal endpoint that simulates the POS recording a customer's visit |

---

## 7. Change log

- Sprint 1 — skeleton created (this document).
- Sprint 2 — to be filled: backend modules 1.x.
- Sprint 3 — to be filled: frontend 2.x, lifecycle 3.x, tests 4.x; final review pass.

---
