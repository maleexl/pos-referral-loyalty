<!--
FILE: docs/DECISIONS.md
PURPOSE: Architecture decision log (ADR-lite). Each entry records the decision,
         the WHY behind it, and the consequences so future contributors
         (and future AI sessions) can reason about the tradeoffs.
CALLED BY: Anyone onboarding to the repo; referenced from README and SPEC.
CALLS: Nothing — this is a leaf doc.
-->

# Architecture Decisions

Each entry follows the same shape: Context, Decision, Why, Consequences.
Numbering is stable — do not renumber; add new decisions at the bottom.

---

## Decision 1 — Monorepo (not separate repos)

**Status:** Accepted

**Context**

We ship a backend (Fastify + Prisma) and a frontend (React + Vite) that share types,
API contracts, and version history. Team is small. Sprints are short.

**Decision**

Keep backend, frontend, and docs in one repository under /backend, /frontend, /docs.

**Why**

- Atomic commits across the API contract and both sides — a contract change and its
  consumers land in one PR, so reviewers see the whole picture.
- One CI pipeline definition, one branch strategy, one issue tracker.
- Shared docs (SPEC, API-CONTRACT, DECISIONS) sit next to the code they describe.
- Cheaper for a solo/small team than maintaining cross-repo version alignment.

**Consequences**

- CI must be path-aware (do not rebuild everything on a docs-only change).
- Tooling must not accidentally couple the two packages — keep separate
  node_modules and lockfiles per package.

---

## Decision 2 — Fastify (over Express)

**Status:** Accepted

**Context**

Need an HTTP framework for Node 20 + TypeScript with first-class schema validation
and good performance for a POS workload (many small, frequent requests).

**Decision**

Use Fastify as the backend HTTP framework.

**Why**

- Built-in JSON Schema validation and serialization at the route boundary — less
  hand-rolled input checking, fewer surprise payloads.
- First-class TypeScript support and typed route generics out of the box.
- Faster than Express in benchmarks, and lighter memory footprint — matters on
  modest POS hardware or shared server hosts.
- Plugin/encapsulation model keeps route groups isolated (good for Sprint 2+ features).
- Express 5 is still settling; Fastify has been stable and TypeScript-first for years.

**Consequences**

- Middleware ecosystem is smaller than Express — some Node middleware needs a
  Fastify wrapper or rewrite.
- Team must learn Fastify plugin conventions (encapsulation, decorators).

---

## Decision 3 — Prisma (over TypeORM)

**Status:** Accepted

**Context**

Need an ORM/query layer for PostgreSQL that plays well with TypeScript and supports
schema migrations in a predictable way.

**Decision**

Use Prisma for schema, migrations, and query client.

**Why**

- Single source of truth: schema.prisma generates both the DB migration and the
  TypeScript client — no drift between them.
- Typed client is generated, so queries are type-checked end-to-end without
  hand-written entity decorators.
- Migration workflow is explicit and reviewable (prisma migrate dev / deploy)
  — good fit for a small team that reviews PRs.
- Studio gives a quick DB browser for debugging without a separate tool.
- TypeORM has had a rough history with TypeScript strictness and migration
  edge cases; Prisma's model is simpler to reason about.

**Consequences**

- Prisma is not a full DataMapper — complex raw SQL sometimes needs
  prisma.$queryRaw, which bypasses type-checking.
- Adds a codegen step to the dev loop (npm run prisma generate).

---

## Decision 4 — Settings table (not env vars) for business config

**Status:** Accepted

**Context**

Points rates, expiry windows, and referral bonuses are business values that will
change over time. Ops or product may need to tune them without a redeploy.

**Decision**

Store business configuration (points-per-currency-unit, points expiry days,
referral bonus points, etc.) in a `settings` table in the database, not in
environment variables.

**Why**

- Env vars require a redeploy to change — too slow for business tuning.
- Env vars are per-process, so multiple backend instances can drift if not
  careful. DB row is a single source of truth for all instances.
- Auditability: a settings row can carry updated_at / updated_by, giving us a
  change history for free. Env vars have no such trail.
- Test isolation: integration tests can seed their own settings row, whereas
  env vars force whole-process config.
- The spec (docs/SPEC.md) already treats these as tunable business values,
  not deploy-time secrets.

**Consequences**

- Backend must load settings from DB (with a short-lived cache — avoid a
  query per request; details in Sprint 2).
- Secrets (DB creds, API key) still live in env vars — only business config
  moves to the DB. Do not mix the two concerns.

---

## Decision 5 — Simple API key auth (not JWT)

**Status:** Accepted

**Context**

The API is called by two kinds of clients in Sprint 1:
1. The frontend (same operator, same origin family).
2. Server-to-server calls from the POS platform.

End users do not log in directly to this service — there is no user identity
to carry in a token. Session and identity live upstream.

**Decision**

Use a static API key sent in a request header (for example X-API-Key),
validated server-side against a value stored in env vars. Do not use JWT.

**Why**

- JWT solves a problem we do not have yet: distributing and verifying
  per-user identity tokens. Our callers are services, not end users.
- A static key is trivial to rotate, audit, and reason about. JWTs add
  signing-key management, expiry logic, and revocation machinery we
  would only be reinventing poorly.
- No token refresh flow to build, test, and secure — saves Sprint 1 and
  Sprint 2 budget for actual product features.
- The POS platform already handles user auth upstream; duplicating it
  here would create two sources of truth for identity.

**Consequences**

- Revisit when we add a first-party web UI with real end-user login —
  at that point JWT (or session cookies) becomes justified.
- Key rotation must be handled operationally (env var change + restart).
  For Sprint 1 that is acceptable; document the rotation runbook later.
- The API key is a shared secret — never log it, never commit it.

---

## How to add a new decision

1. Append a new section: `## Decision N — <short title>` where N is the next number.
2. Keep the same four sub-sections: Context, Decision, Why, Consequences.
3. Set `**Status:**` to one of: Proposed, Accepted, Superseded, Deprecated.
4. If this supersedes an earlier decision, edit the old one's Status to
   Superseded and add a one-line pointer to the new decision number.
