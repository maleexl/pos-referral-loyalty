/**
 * FILE: backend/src/errors.ts
 * PURPOSE: Typed error hierarchy for the API. All thrown API errors extend
 *          ApiError so the global error handler can map them to HTTP status
 *          and the standard { error, code } JSON shape from API-CONTRACT.
 *          Each subclass accepts an optional `code` override so endpoints
 *          can emit specific codes (e.g. REFERRER_NOT_FOUND, SELF_REFERRAL)
 *          while defaulting to the generic code from the Standard Errors table.
 * CALLED BY: routes, usecases, middleware, app.ts global error handler.
 * CALLS: (none — pure module, no imports).
 */

// WHY: named constants instead of inline 400/401/... — centralizes the codes
// for grep-ability when auditing against docs/API-CONTRACT.md "Standard Errors",
// and eliminates magic numbers from every subclass.
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_INTERNAL = 500;

/**
 * Base for every error that should be translated to an HTTP response by the
 * global error handler in app.ts. Anything that is NOT an ApiError becomes a
 * generic 500 INTERNAL (stack logged, details never leaked to the client).
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    // WHY: optional structured payload (e.g. F2b 409 includes visitId so the
    // client knows the visit was recorded even though the referral was not
    // completed). Merged into the response body by the global error handler.
    public readonly details?: unknown
  ) {
    super(message);
    // WHY: `name` helps with logs (pino) and stack traces read as
    // "ConflictError: Email exists" instead of "Error: Email exists".
    this.name = new.target.name;
    // WHY: `instanceof` across realm/bundler boundaries can break for
    // subclassed built-ins. Re-pointing the prototype here is a well-known
    // defensive pattern; harmless on ES2022 targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- 400 INVALID_INPUT ------------------------------------------------------
export class ValidationError extends ApiError {
  constructor(message = 'Validation failed', code = 'INVALID_INPUT', details?: unknown) {
    super(HTTP_BAD_REQUEST, code, message, details);
  }
}

// --- 401 UNAUTHORIZED -------------------------------------------------------
export class UnauthorizedError extends ApiError {
  constructor(message = 'Missing or invalid API key', code = 'UNAUTHORIZED', details?: unknown) {
    super(HTTP_UNAUTHORIZED, code, message, details);
  }
}

// --- 403 FORBIDDEN ----------------------------------------------------------
export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN', details?: unknown) {
    super(HTTP_FORBIDDEN, code, message, details);
  }
}

// --- 404 NOT_FOUND ----------------------------------------------------------
export class NotFoundError extends ApiError {
  constructor(message = 'Not found', code = 'NOT_FOUND', details?: unknown) {
    super(HTTP_NOT_FOUND, code, message, details);
  }
}

// --- 409 CONFLICT -----------------------------------------------------------
export class ConflictError extends ApiError {
  constructor(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    super(HTTP_CONFLICT, code, message, details);
  }
}

// --- 410 GONE ---------------------------------------------------------------
export class GoneError extends ApiError {
  constructor(message = 'Gone', code = 'GONE', details?: unknown) {
    super(HTTP_GONE, code, message, details);
  }
}

// --- 500 INTERNAL -----------------------------------------------------------
// WHY: included for completeness so usecases can throw a typed 500 with a
// specific message in dev. In prod the handler will still strip details
// unless NODE_ENV=development (see app.ts — STEP 3.3).
export class InternalError extends ApiError {
  constructor(message = 'Internal server error', code = 'INTERNAL', details?: unknown) {
    super(HTTP_INTERNAL, code, message, details);
  }
}
