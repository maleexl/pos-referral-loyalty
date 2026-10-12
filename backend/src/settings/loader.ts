/**
 * FILE: backend/src/settings/loader.ts
 * PURPOSE: Typed access to the DB-backed settings table (see DECISIONS #4).
 *          Caches the whole settings table in-process with a configurable TTL
 *          so business config changes (points, expiry, rate) do not require a
 *          code deploy OR a per-request DB hit.
 * CALLED BY: usecases, admin route (PATCH invalidates cache).
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, node:process.
 */
import { prisma } from '../db/prisma.js';
import { InternalError } from '../errors.js';

// WHY: cache lives only as long as the process — no Redis in MVP.
// Simplicity > freshness at MVP scale; admin PATCH calls invalidateCache().
const DEFAULT_TTL_SECONDS = 30;

// WHY: named constants for setting keys used elsewhere via typed getters.
// The generic get() accepts any string; these are the ones we know exist
// because prisma/seed.ts inserts them.
const KEY_POINTS_PER_REFERRAL = 'points_per_referral';
const KEY_REFERRAL_EXPIRY_DAYS = 'referral_expiry_days';
const KEY_POINTS_TO_THB_RATE = 'points_to_thb_rate';
const KEY_REWARD_CODE_LENGTH = 'reward_code_length';
const KEY_REDEMPTION_EXPIRY_DAYS = 'redemption_expiry_days';

type Cache = {
  values: Map<string, string>;
  loadedAt: number; // epoch ms
};

let cache: Cache | null = null;

function ttlMs(): number {
  // WHY: read env on every reload (not just at boot) so tests can override
  // SETTINGS_CACHE_TTL_SECONDS within a running process without restart.
  const raw = process.env.SETTINGS_CACHE_TTL_SECONDS;
  const parsed = raw === undefined ? DEFAULT_TTL_SECONDS : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    // WHY: fail loudly on misconfig — silently falling back would hide an
    // operator typo (e.g. "30s" instead of "30") behind a default.
    throw new InternalError(
      `Invalid SETTINGS_CACHE_TTL_SECONDS: ${String(raw)}`
    );
  }
  return parsed * 1000;
}

function isFresh(): boolean {
  if (cache === null) return false;
  return Date.now() - cache.loadedAt < ttlMs();
}

async function loadAll(): Promise<Map<string, string>> {
  // WHY: read the entire table — settings is tiny (currently 4 rows) and this
  // avoids a second roundtrip when a usecase reads several keys at once.
  const rows = await prisma.setting.findMany({
    select: { key: true, value: true }
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);
  cache = { values: map, loadedAt: Date.now() };
  return map;
}

async function getRaw(key: string): Promise<string> {
  // WHY: validate TTL config on every read, not only after warm-up. Without
  // this call, a misconfigured SETTINGS_CACHE_TTL_SECONDS would be silently
  // ignored on the first request (cold cache) and only surface once the cache
  // warms — a confusing intermittent failure. Fail fast instead.
  ttlMs();
  const values = isFresh() && cache ? cache.values : await loadAll();
  const value = values.get(key);
  if (value === undefined) {
    // WHY: a missing setting is a *configuration* error, not a user error.
    // 500 (InternalError) signals ops to run `prisma db seed` or add the row.
    throw new InternalError(`Setting "${key}" is not configured`);
  }
  return value;
}

export const settings = {
  /**
   * Generic read. Returns string only — never `any` — so parsing is always
   * explicit at the call site. This is the type-safety contract: if you want
   * a number, call asInt() or the typed getter, and a parse failure surfaces.
   */
  async get(key: string): Promise<string> {
    return getRaw(key);
  },

  // --- typed parse helpers -------------------------------------------------
  async asInt(key: string): Promise<number> {
    const raw = await getRaw(key);
    // WHY: parseInt stops at first non-digit ("100abc" → 100). We reject any
    // trailing garbage explicitly to avoid silently accepting corrupted config.
    if (!/^-?\d+$/.test(raw)) {
      throw new InternalError(`Setting "${key}" is not a valid integer: "${raw}"`);
    }
    return Number.parseInt(raw, 10);
  },

  async asFloat(key: string): Promise<number> {
    const raw = await getRaw(key);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || String(n) !== raw.trim()) {
      // WHY: parseFloat("1.5xyz") === 1.5 — a classic silent-corruption trap.
      // We reject any value that does not round-trip through String().
      throw new InternalError(`Setting "${key}" is not a valid number: "${raw}"`);
    }
    return n;
  },

  async asBool(key: string): Promise<boolean> {
    const raw = await getRaw(key);
    // WHY: strict allow-list — prevents "TRUE"/"1"/"yes" ambiguity from
    // leaking into business logic. Operators must use the canonical form.
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new InternalError(`Setting "${key}" is not a valid boolean: "${raw}"`);
  },

  // --- typed sugar ---------------------------------------------------------
  // These names map 1:1 to seeded keys (prisma/seed.ts). Adding a new getter
  // means adding a seed row — keep them in sync.
  getPointsPerReferral(): Promise<number> {
    return settings.asInt(KEY_POINTS_PER_REFERRAL);
  },
  getReferralExpiryDays(): Promise<number> {
    return settings.asInt(KEY_REFERRAL_EXPIRY_DAYS);
  },
  getPointsToThbRate(): Promise<number> {
    return settings.asFloat(KEY_POINTS_TO_THB_RATE);
  },
  getRewardCodeLength(): Promise<number> {
    return settings.asInt(KEY_REWARD_CODE_LENGTH);
  },
  getRedemptionExpiryDays(): Promise<number> {
    return settings.asInt(KEY_REDEMPTION_EXPIRY_DAYS);
  },

  // --- cache control -------------------------------------------------------
  // WHY: admin PATCH /admin/settings must take effect immediately, not after
  // TTL expiry — otherwise the operator sees stale values in the UI and
  // suspects the change was lost.
  invalidateCache(): void {
    cache = null;
  }
};
