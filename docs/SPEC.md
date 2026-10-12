<!--
FILE: docs/SPEC.md
PURPOSE: Functional and non-functional specification for the POS Referral &
         Loyalty system. Source of truth for what the system must do.
CALLED BY: Backend and frontend implementers; referenced from README and DECISIONS.
CALLS: References docs/API-CONTRACT.md, docs/DECISIONS.md, backend/prisma/schema.prisma.
-->

# SPEC — POS Referral & Loyalty System

## 1. Overview

A referral and loyalty platform for service shops (spa, massage,
beauty) that integrates with existing POS systems. Customers invite
friends via unique referral codes; when an invited friend completes
a first visit, the referrer earns points that can be redeemed at
the shop through a staff-facing interface.

**Version:** 1.0 (Sprint 1-3)
**Status:** MVP

---

## 2. Users & Roles

| Role | Auth method | Primary actions |
|------|-------------|-----------------|
| Customer | referral code + email | Register, share referral code, view points, redeem |
| Staff | API key (`X-Staff-Key`) | Look up customer, issue redemption code, confirm redemption |
| Admin | API key (`X-Admin-Key`) | View all referrals, redemptions, edit settings |
| Mock POS | internal (same backend) | Simulate first visit of a new customer |

Authentication is intentionally minimal for the MVP. Full JWT auth
is out of scope (see DECISIONS.md).

---

## 3. Functional Requirements

### F1 — Customer Registration

- A customer registers with email, phone, and name.
- System generates a unique, human-readable referral code
  (alphanumeric, 6-10 chars).
- Email and phone must be unique across customers.
- The new customer starts with 0 points.

### F2 — Referral Flow

1. Referrer shares their referral code.
2. Referee registers with the referrer's code.
3. System creates a referral with status `PENDING`.
4. Referral has an expiry date = now + `referral_expiry_days` (from settings).
5. When the POS records the referee's first visit (via `POST /mock-pos/visits`):
   - If referral is `PENDING` and not expired → status becomes `COMPLETED`.
   - If expired → status becomes `EXPIRED`, no points awarded.
   - If already `COMPLETED` → no-op (idempotent).

### F3 — Points & Redemption

- On referral completion, referrer receives `points_per_referral` (from settings).
- Points are tracked per customer in `pointsBalance`.
- Staff can issue a redemption: input customer code + points to use.
- System generates a short redemption code for the customer.
- Staff later confirms the redemption code → points are deducted, reward is marked `REDEEMED`.
- Redemption codes expire (configurable, default 7 days).

### F4 — Admin Dashboard

- List all referrals with referrer / referee info and status.
- List all redemptions with customer, points, and timestamp.
- View and edit settings (`points_per_referral`, `referral_expiry_days`, `points_to_thb_rate`).

---

## 4. Data Model

See `backend/prisma/schema.prisma` for the authoritative Prisma schema.

| Entity | Purpose |
|--------|---------|
| Customer | End user of the shop |
| Referral | Link between referrer and referee |
| Reward | Points earn / redeem record |
| PosVisit | Raw visit record from POS |
| Setting | Business config (points, expiry, rates) |
| Staff | Staff member with API key hash |

**Key relationships:**
- Customer 1—N Referral (as referrer)
- Customer 1—1 Referral (as referee, enforced by `UNIQUE(refereeId)`)
- Customer 1—N Reward
- Referral 1—N Reward (idempotency enforced by `UNIQUE(referralId, type)`)

---

## 5. Business Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-1 | Self-referral is blocked | Usecase check + reject early |
| BR-2 | One customer can be a referee at most once | DB `UNIQUE(refereeId)` |
| BR-3 | One referral yields at most one reward | DB `UNIQUE(referralId, type)` |
| BR-4 | Referral expiry = `createdAt + referral_expiry_days` | Set at creation; checked at completion |
| BR-5 | Referral completion + reward issuance happen in one DB transaction | Prisma `$transaction` |
| BR-6 | Points per referral, expiry days, and exchange rate come from settings table | Never hardcoded in code |
| BR-7 | Redemption requires sufficient points | Checked before issuing code |
| BR-8 | Redemption code cannot be reused | `Reward.status = REDEEMED` check |
| BR-9 | Expired redemption code → error | `expiresAt` checked |

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Health endpoint responds < 100ms; typical request < 500ms |
| Reliability | Referral completion is atomic (transaction) and idempotent |
| Security | API keys via env; no secrets in code; input validated with zod |
| Testability | Unit + integration tests with vitest; E2E with Playwright |
| Portability | Docker Compose for local dev; same stack deployable to cloud |
| Observability | Structured logs via pino |
| Documentation | Every file has header comment; CODE-WALKTHROUGH.md per module |

---

## 7. Out of Scope

- Real POS integration (Mock POS only in MVP)
- Payment processing
- SMS / email notifications
- Multi-branch / multi-tenant
- Mobile native apps
- BI / analytics dashboards
- QR code scanning (manual code entry only)
- Full JWT authentication

---

## 8. Sprint Plan

| Sprint | Focus | Deliverables |
|--------|-------|--------------|
| 1 | Backend core + DB | Schema, settings, customer register, referral state machine, mock POS |
| 2 | Rewards + Frontend | Points issuance, redemption, 3 UI pages |
| 3 | Polish + Handover | Playwright E2E, CODE-WALKTHROUGH, Q&A cheat sheet |

---
