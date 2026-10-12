<!--
FILE: docs/API-CONTRACT.md
PURPOSE: HTTP contract between clients (frontend, staff UI, mock POS) and the
         backend. Defines endpoints, request/response shapes, auth headers, and
         error codes for F1-F4.
CALLED BY: Frontend, backend implementers, test authors; referenced from README and SPEC.
CALLS: Aligns with docs/SPEC.md (functional reqs) and docs/DECISIONS.md (auth choice).
-->

# API-CONTRACT — POS Referral & Loyalty System

**Version:** v1
**Base URL:** `http://localhost:3000`
**Content-Type:** `application/json`

---

## Authentication

| Header | Used by | Applies to |
|--------|---------|------------|
| `X-Staff-Key` | Staff routes | `/staff/*` (from `.env` `STAFF_API_KEY`) |
| `X-Admin-Key` | Admin routes | `/admin/*` (from `.env` `ADMIN_API_KEY`) |
| (none) | Public routes | `/api/*`, `/internal/mock-pos/*` |

Public (`/api/*`) and internal (`/internal/mock-pos/*`) routes are unauthenticated for the MVP.

---

## Standard Errors

All errors return JSON:

{ "error": "Human-readable message", "code": "MACHINE_CODE" }

| Code | HTTP | Meaning |
|------|------|---------|
| INVALID_INPUT | 400 | Validation failed |
| UNAUTHORIZED | 401 | Missing or invalid API key |
| FORBIDDEN | 403 | Self-referral attempt |
| NOT_FOUND | 404 | Resource missing |
| CONFLICT | 409 | Duplicate or already-done |
| GONE | 410 | Expired |
| INTERNAL | 500 | Unexpected server error |

---

## F1 — Customer Registration

### POST /api/customers

Register a new customer.

**Request:**
{
  "email": "alice@example.com",
  "phone": "0812345678",
  "name": "Alice"
}

**Response 201:**
{
  "id": "uuid",
  "email": "alice@example.com",
  "phone": "0812345678",
  "name": "Alice",
  "referralCode": "ALICE123",
  "pointsBalance": 0,
  "createdAt": "2026-10-12T10:00:00Z"
}

**Errors:** 409 EMAIL_EXISTS, 409 PHONE_EXISTS, 400 INVALID_INPUT

### GET /api/customers/:referralCode

**Response 200:** same shape as create response.

**Errors:** 404 NOT_FOUND

---

## F2 — Referral Flow

### POST /api/referrals

Referee registers using referrer's code.

**Request:**
{
  "referrerCode": "ALICE123",
  "refereeEmail": "bob@example.com",
  "refereePhone": "0899999999",
  "refereeName": "Bob"
}

**Response 201:**
{
  "referralId": "uuid",
  "status": "PENDING",
  "createdAt": "2026-10-12T10:00:00Z",
  "expiresAt": "2026-11-11T10:00:00Z",
  "referee": {
    "id": "uuid",
    "referralCode": "BOB456"
  }
}

**Errors:**
- 404 REFERRER_NOT_FOUND
- 409 REFEREE_EMAIL_EXISTS
- 409 REFEREE_PHONE_EXISTS
- 403 SELF_REFERRAL (same email or phone)
- 409 REFEREE_HAS_REFERRER

### GET /api/customers/:referralCode/referrals

List referrals where the given referral code is the referrer.

**Auth:** none (public read-only, same class as GET /api/customers/:code
and GET /api/customers/:code/rewards — the referralCode itself is the
capability token; see DECISIONS #5).

**Response 200:**
{
  "items": [
    {
      "id": "uuid",
      "status": "PENDING" | "COMPLETED" | "EXPIRED",
      "createdAt": "2026-10-12T10:00:00Z",
      "completedAt": "2026-10-12T11:00:00Z" | null,
      "referee": {
        "id": "uuid",
        "name": "Bob",
        "referralCode": "BOB456"
      }
    }
  ]
}

**Errors:**
- 404 NOT_FOUND (referralCode unknown)

A known customer with no referrals returns 200 with an empty array:
{
  "items": []
}

**Notes:**
- No pagination — a single customer's referral set is bounded; adding
  page/limit would be a contract change requiring a coordinated update.
- No referrer fields in the response — the caller already owns the
  referral code, so repeating their own identity per row is noise.
- No `expiresAt` on items — the customer-facing UI does not surface the
  deadline; admin endpoints expose it.

### POST /internal/mock-pos/visits

Called by POS to record a customer's visit.

**Request:**
{
  "customerEmail": "bob@example.com",
  "amount": 500,
  "note": "first visit"
}

**Response 200:**
{
  "visitId": "uuid",
  "visitedAt": "2026-10-12T10:05:00Z",
  "referralCompleted": true,
  "pointsAwarded": 100,
  "referrerCode": "ALICE123"
}

If the customer has no pending referral:
{
  "visitId": "uuid",
  "visitedAt": "...",
  "referralCompleted": false,
  "pointsAwarded": 0,
  "referrerCode": null
}

**Errors:**
- 404 CUSTOMER_NOT_FOUND
- 409 REFERRAL_ALREADY_COMPLETED (visit still recorded; no double reward)
- 410 REFERRAL_EXPIRED (status set to EXPIRED; no points)

**Transaction:** referral status change + reward creation + referrer balance update must occur in a single Prisma $transaction.

---

## F3 — Points & Redemption

### GET /api/customers/:referralCode/rewards

List rewards for a customer.

**Response 200:**
{
  "pointsBalance": 100,
  "rewards": [
    {
      "id": "uuid",
      "type": "REFERRAL_BONUS",
      "points": 100,
      "status": "ISSUED",
      "createdAt": "..."
    }
  ]
}

### POST /staff/redeem

Staff issues a redemption on behalf of the customer.

**Headers:** X-Staff-Key

**Request:**
{
  "customerCode": "ALICE123",
  "points": 100
}

**Response 200:**
{
  "redemptionCode": "R8K2MX9Q",
  "pointsUsed": 100,
  "pointsRemaining": 0,
  "expiresAt": "2026-10-19T10:00:00Z"
}

**Errors:**
- 404 CUSTOMER_NOT_FOUND
- 400 INSUFFICIENT_POINTS
- 401 UNAUTHORIZED

### POST /staff/redeem/confirm

Staff confirms the customer used the redemption code.

**Headers:** X-Staff-Key

**Request:**
{
  "redemptionCode": "R8K2MX9Q"
}

**Response 200:**
{
  "status": "REDEEMED",
  "redeemedAt": "2026-10-12T11:00:00Z"
}

**Errors:**
- 404 CODE_NOT_FOUND
- 409 CODE_ALREADY_REDEEMED
- 410 CODE_EXPIRED

---

## F4 — Admin

All admin endpoints require header `X-Admin-Key`.

### GET /admin/referrals?status=&page=&limit=

**Response 200:**
{
  "total": 42,
  "page": 1,
  "limit": 20,
  "items": [
    {
      "id": "uuid",
      "status": "COMPLETED",
      "createdAt": "...",
      "completedAt": "...",
      "referrer": { "id": "...", "name": "Alice", "code": "ALICE123" },
      "referee": { "id": "...", "name": "Bob", "code": "BOB456" }
    }
  ]
}

### GET /admin/redemptions

**Response 200:**
{
  "total": 5,
  "items": [
    {
      "id": "uuid",
      "customerCode": "ALICE123",
      "points": 100,
      "code": "R8K2MX9Q",
      "status": "REDEEMED",
      "createdAt": "...",
      "redeemedAt": "..."
    }
  ]
}

### GET /admin/settings

**Response 200:**
{
  "points_per_referral": "100",
  "referral_expiry_days": "30",
  "points_to_thb_rate": "1",
  "reward_code_length": "8"
}

### PATCH /admin/settings

**Request:**
{
  "points_per_referral": "150"
}

**Response 200:** updated settings object.

---

## Versioning

Breaking changes → bump to `/v2`. MVP uses unversioned paths.

---
