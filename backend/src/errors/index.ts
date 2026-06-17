/**
 * Lightweight typed error taxonomy. The central Express error handler
 * (middleware/errorHandler.ts) maps any `AppError` to its `statusCode` and
 * logs it with its `code`; anything else is treated as an unexpected 500.
 *
 * Operational errors (expected, e.g. NotFound/Validation) surface their message
 * to the client; non-operational ones return a generic message.
 */

interface AppErrorOptions {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;

  constructor(message: string, opts: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? new.target.name;
    this.isOperational = opts.isOperational ?? true;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
    // Keep the stack pointing at the throw site, not this constructor.
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 — request failed validation. */
export class ValidationError extends AppError {
  readonly details?: unknown;
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR' });
    this.details = details;
  }
}

/** 404 — requested resource does not exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

/**
 * A scraper could not complete a check (network error, bad upstream response,
 * parse failure). Note: a scraper that simply can't *determine* stock returns
 * UNKNOWN — it does not throw. This is for genuine failures.
 */
export class ScraperError extends AppError {
  readonly storeSlug?: string;
  constructor(message: string, opts: { storeSlug?: string; cause?: unknown } = {}) {
    super(message, { statusCode: 502, code: 'SCRAPER_ERROR', cause: opts.cause });
    this.storeSlug = opts.storeSlug;
  }
}

/** A notification channel (email/sms/push/discord) failed to deliver. */
export class NotificationError extends AppError {
  readonly channel?: string;
  constructor(message: string, opts: { channel?: string; cause?: unknown } = {}) {
    super(message, { statusCode: 502, code: 'NOTIFICATION_ERROR', cause: opts.cause });
    this.channel = opts.channel;
  }
}
