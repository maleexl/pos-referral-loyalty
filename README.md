<!--
FILE: README.md
PURPOSE: Front door of the POS Referral & Loyalty monorepo — overview, quick start,
         repo layout, and pointers to docs/ which are the source of truth.
CALLED BY: Anyone opening the repo (humans + future AI sessions reading project context).
CALLS: Links to docs/SPEC.md, docs/API-CONTRACT.md, docs/DECISIONS.md, docs/CODE-WALKTHROUGH.md.
-->

# POS Referral & Loyalty System

Referral and loyalty features for the POS platform. Private project, Sprint 1 in progress.

**Source of truth lives in docs/.** If this README and a doc disagree, the doc wins.

---

## What this is

A backend + frontend for running referrals and loyalty points off a POS. Sprint 1 delivers the
repo skeleton, contract, and decisions. Business logic lands in later sprints.

- Backend — Node.js 20 · TypeScript · Fastify · Prisma · PostgreSQL
- Frontend — React · Vite · Tailwind
- Tests — Vitest (unit + integration) · Playwright (E2E)
- Repo — monorepo (backend, frontend, docs)

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
## Quick start (skeleton)

> End-to-end local run is wired up in a later sprint. These steps describe the intended flow.

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

    cd backend && npm test         # Vitest
    cd frontend && npm test        # Vitest (placeholder)
    npx playwright test            # E2E (scaffolded later)

---

## Demo flow

Placeholder — will be filled in Sprint 3 once features are wired up.
Suggested outline:

1. Staff creates a referral for a customer at POS.
2. Customer receives a link / code.
3. Referred customer completes first purchase — points awarded.
4. Dashboard shows balance + referral status.
5. Expiry / rate values read from the settings table (see docs/DECISIONS.md #4).

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
- CI: .github/workflows/ci.yml runs backend lint + typecheck + Vitest
  (auto-activates once backend/package.json exists)

---

## Status

Sprint 1 — repo skeleton, CI, docs, decisions. Feature code not yet implemented.
