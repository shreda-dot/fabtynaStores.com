/**
 * Stable error envelope for every API response:
 *   { error: { code, message, details } }
 * `code` is a machine-readable constant the UI can switch on; `message` is safe
 * to show to a person; `details` carries structured context (never internals).
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "IDEMPOTENCY_MISMATCH"
  | "UNAVAILABLE"
  | "INTERNAL";

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: unknown };
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details: unknown = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const validationError = (message: string, details: unknown = null): AppError =>
  new AppError(400, "VALIDATION", message, details);

export const businessRuleError = (message: string, details: unknown = null): AppError =>
  new AppError(409, "BUSINESS_RULE", message, details);

export interface PgErrorInfo {
  /** SQLSTATE, e.g. 23505, 23514, 40P01, P0001 (a trigger's RAISE EXCEPTION). */
  sqlState: string | null;
  /** The database's own message (for a trigger, the text the trigger raised). */
  message: string | null;
  constraint: string | null;
  /** The Prisma error code, e.g. P2002, P2028, P2034. */
  prismaCode: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Prisma wraps the driver's error. Through `@prisma/adapter-pg` the SQLSTATE and
 * the database's message live at `meta.driverAdapterError.cause`; a bare `pg`
 * error carries `code` directly. Both shapes are read here, in one place.
 */
export function pgErrorInfo(error: unknown): PgErrorInfo {
  const top = asRecord(error);
  const prismaCode = asString(top?.code);
  const meta = asRecord(top?.meta);
  const cause = asRecord(asRecord(meta?.driverAdapterError)?.cause);
  const constraint = asRecord(cause?.constraint);

  const bareSqlState = prismaCode !== null && /^[0-9A-Z]{5}$/.test(prismaCode) && !/^P\d{4}$/.test(prismaCode)
    ? prismaCode
    : null;

  return {
    sqlState: asString(cause?.originalCode) ?? asString(cause?.code) ?? bareSqlState,
    message: asString(cause?.originalMessage) ?? asString(cause?.message),
    constraint: asString(constraint?.index) ?? asString(constraint?.name) ?? asString(top?.constraint),
    prismaCode,
  };
}

/** Deadlock (40P01) and serialization failure (40001) are safe to retry. */
export function isRetryableError(error: unknown): boolean {
  const info = pgErrorInfo(error);
  return (
    info.sqlState === "40P01" ||
    info.sqlState === "40001" ||
    info.prismaCode === "P2034"
  );
}

/**
 * Maps anything thrown below the route handler to an `AppError`, or returns
 * `null` for an unexpected failure (the caller turns that into a 500 with a
 * request id and no internals).
 */
export function mapKnownError(error: unknown): AppError | null {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof RangeError) {
    return validationError(error.message);
  }

  const info = pgErrorInfo(error);

  if (isRetryableError(error)) {
    return new AppError(503, "UNAVAILABLE", "The system is busy. Please try again.", null);
  }
  // lock_timeout: another transaction held a row lock for too long.
  if (info.sqlState === "55P03") {
    return new AppError(503, "UNAVAILABLE", "The system is busy. Please try again.", null);
  }
  if (info.prismaCode === "P2028" || info.prismaCode === "P1001" || info.prismaCode === "P1017") {
    return new AppError(503, "UNAVAILABLE", "The database is temporarily unavailable. Please try again.", null);
  }
  if (info.sqlState === "23505") {
    return new AppError(409, "CONFLICT", "That record already exists.", {
      constraint: info.constraint,
    });
  }
  if (
    info.sqlState === "23514" &&
    (info.message?.includes("ck_stock_balances_nonnegative") ?? false)
  ) {
    return new AppError(
      409,
      "INSUFFICIENT_STOCK",
      "Not enough stock to complete this sale.",
      { constraint: "ck_stock_balances_nonnegative" },
    );
  }
  if (info.sqlState === "P0001" && info.message !== null) {
    return businessRuleError(info.message);
  }
  if (info.sqlState === "23514" || info.sqlState === "23503") {
    return businessRuleError(info.message ?? "That change breaks a business rule.", {
      constraint: info.constraint,
    });
  }

  return null;
}
