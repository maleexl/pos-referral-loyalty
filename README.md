<!--
FILE: README.md
PURPOSE: Front door of the POS Referral & Loyalty monorepo — overview, quick start,
         repo layout, and pointers to docs/ which are the source of truth.
CALLED BY: Anyone opening the repo (humans + future AI sessions reading project context).
CALLS: Links to docs/SPEC.md, docs/API-CONTRACT.md, docs/DECISIONS.md, docs/CODE-WALKTHROUGH.md.
-->

# POS Referral & Loyalty System

Referral and loyalty features for the POS platform. Private project, Sprint 3 in progress.

**Source of truth lives in docs/.** If this README and a doc disagree, the doc wins.

---

## What this is

A backend + frontend for running referrals and loyalty points off a POS.
Backend (F1–F4) and all three frontend pages are implemented — Customer,
Staff, and Admin (referrals + redemptions + settings). The contract and
its rationale live in `docs/API-CONTRACT.md` and `docs/DECISIONS.md`.

- Backend — Node.js 20 · TypeScript · Fastify · Prisma · PostgreSQL
- Frontend — React · Vite · Tailwind
- Tests — Vitest (unit + integration) · Playwright (E2E)
- Repo — monorepo (backend, frontend, docs)

---

## Architecture at a glance

Three layers, dependency direction strictly one-way:

    routes/*  →  usecases/*  →  prisma + settings loader
                              \── errors.ts (typed ApiError hierarchy)

- **Routes** are thin: parse input, call a usecase, serialize the response.
  No business logic.
- **Usecases** orchestrate domain + DB + settings. Never import Fastify.
- **Prisma** is reached only through the singleton in `backend/src/db/prisma.ts`.

Auth is by API key, plugin-scoped, no JWT:

    public     /api/*                 no auth
    staff      /staff/*               X-Staff-Key
    admin      /admin/*               X-Admin-Key
    internal   /internal/mock-pos/*   no auth (mock only)

Business config (points, expiry, code length) lives in the `settings`
table and is read through typed getters — nothing hardcodes a tunable
value. See `docs/DECISIONS.md #4`.

## Lifecycles

Two flows drive the product. Diagrams are rendered by GitHub; in a plain
editor they are just text blocks.

### Referral flow — register → invite → POS visit → completion

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer
    participant B as Backend
    participant DB as Postgres
    participant POS as Mock POS

    C->>B: POST /api/customers
    B->>DB: INSERT customer (referralCode = PREFIX + 4)
    B-->>C: 201 { referralCode }

    C->>B: POST /api/referrals
    B->>DB: BEGIN TX
    B->>DB: self-referral guard, INSERT referee, INSERT referral
    B->>DB: COMMIT
    B-->>C: 201 Created

    POS->>B: POST /internal/mock-pos/visits
    B->>DB: INSERT posVisit (standalone)
    B->>DB: BEGIN TX
    B->>DB: UPDATE referral SET COMPLETED WHERE status=PENDING
    B->>DB: INSERT reward (+points, REFERRAL_BONUS)
    B->>DB: COMMIT
    B-->>POS: 200 { referralCompleted: true }
```

### Redemption flow — staff issues → customer uses → staff confirms

```mermaid
sequenceDiagram
    autonumber
    participant Staff as Staff
    participant B as Backend
    participant DB as Postgres

    Staff->>B: POST /staff/redeem (X-Staff-Key)
    B->>DB: SELECT SUM(points) — BR-7 balance check
    B->>DB: INSERT reward (-points, REDEMPTION, ISSUED, code)
    B-->>Staff: 200 { redemptionCode, pointsRemaining }

    Staff->>B: POST /staff/redeem/confirm (X-Staff-Key)
    B->>DB: UPDATE reward SET REDEEMED WHERE status=ISSUED
    B-->>Staff: 200 { status: REDEEMED }
```

Full walkthrough: `docs/CODE-WALKTHROUGH.md`.

---

## Repository layout

    .
    backend/            # Fastify API + Prisma schema (Node 20 + TS)
      src/
      tests/
      prisma/
    frontend/           # React + Vite + Tailwind UI
      src/
      public/
    docs/               # SPEC, API contract, decisions, walkthrough
    .github/workflows/  # CI
    .env.example        # Root env template
    README.md           # this file

---
## Quick start

> End-to-end local run is wired up today (Postgres + backend + frontend); these are the same steps CI and the demo use.

### 1. Prerequisites

- Node.js 20.x
- PostgreSQL 15+ (local or Docker)
- npm 10+
- WSL or Linux/macOS shell

### 2. Environment files

Copy the templates and fill in local values. Never commit real .env files.

    cp .env.example .env
    cp backend/.env.example backend/.env
    cp frontend/.env.example frontend/.env

### 3. Install + run

    # Backend
    cd backend
    npm install
    npx prisma migrate dev
    npm run dev

    # Frontend (separate terminal)
    cd frontend
    npm install
    npm run dev

### 4. Tests

    cd backend && npm test         # Vitest — 67 passed (8 files)
    cd frontend && npm run lint    # no frontend unit tests; CI runs lint + typecheck + build
    cd tests && npm test           # E2E — customer-flow + staff-flow (webServer auto-starts the servers)

---

## Demo flow

A runnable step-by-step walkthrough (with talk track and an API curl sheet)
lives in `docs/DEMO-SCRIPT.md`. The happy path:

1. Customer registers at `/customer` and shares their referral code.
2. A friend is invited; the referral is created as PENDING.
3. The referee's first POS visit completes the referral — points awarded.
4. Customer page shows the real balance + referral status; staff redeems.
5. Admin page lists referrals / redemptions and edits tunable settings.

---

## Docs

- docs/SPEC.md — full functional spec
- docs/API-CONTRACT.md — HTTP API contract (request / response)
- docs/DECISIONS.md — architecture decisions with WHY
- docs/CODE-WALKTHROUGH.md — guided tour (filled in Sprint 3)

---

## Branching & commits

- Branches: main + feature/* (PRs even when solo)
- Commits: Conventional Commits — feat:, fix:, test:, docs:, chore:
- CI: .github/workflows/ci.yml runs three jobs — Backend (lint +
  typecheck + Vitest), Frontend (lint + typecheck + build), and E2E
  (Playwright customer-flow + staff-flow).

---

## Status

Sprint 3 — in progress. Delivered so far:

- Backend (F1-F4) complete: customer register, referral create + complete,
  rewards + redemption, admin (referrals / redemptions / settings).
- Frontend Customer + Staff pages implemented; all three pages now live,
  Admin included (referrals + redemptions + settings; shipped in ae8a91a).
- Backend tests: 67 passed (vitest, 8 files).
- E2E: two Playwright specs (customer-flow + staff-flow) green in CI.
- CI: 3 jobs (Backend / Frontend / E2E), all green on main.
- Docs: SPEC, API-CONTRACT, DECISIONS, HANDOVER, CODE-WALKTHROUGH,
  QA-CHEATSHEET, DEMO-SCRIPT, plus per-team briefs under the project docs/.

Remaining for Sprint 3: deploy to Render (stretch goal), final polish.
