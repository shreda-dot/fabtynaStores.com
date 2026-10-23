import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { DEFAULT_TX_TIMEOUTS, type TxTimeouts } from "./tx-options.js";

// Prisma 7 no longer loads `.env` on our behalf and `tsx` does not either, so
// the API loads its own file (resolved from this file, not from the current
// working directory) before any value is read.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export interface RuntimeEnv {
  /**
   * Connection string the API process uses: the DIRECT (non-pooled) Neon
   * endpoint. Transactions with row locks fail on the pooled endpoint.
   */
  apiDatabaseUrl: string;
  /** Pooled endpoint, kept for later deployment work; unused by the API now. */
  databaseUrl: string | null;
  /** Maximum connections in the API's pool. */
  dbPoolMax: number;
  port: number;
  nodeEnv: string;
  host: string;
  trustProxy: boolean;
  webOrigin: string;
  cookieDomain: string | null;
  sessionIdleTimeoutHours: number;
  sessionAbsoluteTimeoutDays: number;
  /**
   * Resend credentials for the self-service password reset email. Both are
   * `null` when unset, which disables "forgot password" (the endpoint answers
   * 503) — the API still starts, so a missing mail key is never an outage.
   */
  resendApiKey: string | null;
  mailFrom: string | null;
  /** Transaction timing for write endpoints (see lib/tx-options.ts). */
  txTimeouts: TxTimeouts;
  /** Maximum inclusive date range accepted by list and statement endpoints. */
  maxDateRangeDays: number;
}

function readPositiveInt(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  problems: string[],
): number {
  const raw = source[name]?.trim() ?? "";
  if (raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 600_000) {
    problems.push(`${name} must be an integer number of milliseconds between 100 and 600000.`);
    return fallback;
  }
  return parsed;
}

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value);
}

/**
 * Reads and validates the environment once, at startup. Throws a single error
 * listing *every* problem so the process fails fast with an actionable message
 * instead of blowing up on the first query. Never includes a value in the
 * message — only variable names.
 */
export function loadRuntimeEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const problems: string[] = [];
  const nodeEnv = source.NODE_ENV?.trim() || "development";

  const directUrl = source.DIRECT_URL?.trim() ?? "";
  if (directUrl === "") {
    problems.push("DIRECT_URL is missing (the direct, non-pooled Neon connection string the API uses).");
  } else if (!isPostgresUrl(directUrl)) {
    problems.push("DIRECT_URL must start with postgres:// or postgresql://.");
  }

  const rawDatabaseUrl = source.DATABASE_URL?.trim() ?? "";
  if (rawDatabaseUrl !== "" && !isPostgresUrl(rawDatabaseUrl)) {
    problems.push("DATABASE_URL must start with postgres:// or postgresql://.");
  }

  const rawPort = source.PORT?.trim() ?? "";
  let port = 3001;
  if (rawPort !== "") {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      problems.push("PORT must be an integer between 1 and 65535.");
    } else {
      port = parsed;
    }
  }

  const rawHost = source.HOST?.trim() ?? "";
  const host = rawHost || "127.0.0.1";
  if (nodeEnv === "production" && rawHost === "") {
    problems.push("HOST must be set explicitly in production.");
  }

  const rawWebOrigin = source.WEB_ORIGIN?.trim() ?? "";
  const webOrigin = rawWebOrigin || "http://localhost:3000";
  try {
    const parsedOrigin = new URL(webOrigin);
    if (
      parsedOrigin.origin !== webOrigin ||
      (nodeEnv === "production" && parsedOrigin.protocol !== "https:")
    ) {
      problems.push("WEB_ORIGIN must be an exact origin (and use HTTPS in production).");
    }
  } catch {
    problems.push("WEB_ORIGIN must be a valid origin.");
  }
  if (nodeEnv === "production" && rawWebOrigin === "") {
    problems.push("WEB_ORIGIN is required in production.");
  }

  const rawCookieDomain = source.COOKIE_DOMAIN?.trim() ?? "";
  if (rawCookieDomain.includes("/") || rawCookieDomain.includes(":")) {
    problems.push("COOKIE_DOMAIN must be a hostname without a scheme or path.");
  }

  const rawTrustProxy = source.TRUST_PROXY?.trim().toLowerCase() ?? "";
  if (rawTrustProxy !== "" && rawTrustProxy !== "true" && rawTrustProxy !== "false") {
    problems.push("TRUST_PROXY must be true or false.");
  }

  const readBoundedInteger = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = source[name]?.trim() ?? "";
    if (raw === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}.`);
      return fallback;
    }
    return parsed;
  };
  const sessionIdleTimeoutHours = readBoundedInteger("SESSION_IDLE_TIMEOUT_HOURS", 12, 1, 168);
  const sessionAbsoluteTimeoutDays = readBoundedInteger(
    "SESSION_ABSOLUTE_TIMEOUT_DAYS",
    7,
    1,
    90,
  );

  // Self-service password reset email (Resend). Optional as a pair: without
  // both, "forgot password" is disabled rather than half-configured.
  const rawResendApiKey = source.RESEND_API_KEY?.trim() ?? "";
  const rawMailFrom = source.MAIL_FROM?.trim() ?? "";
  if ((rawResendApiKey === "") !== (rawMailFrom === "")) {
    problems.push(
      "RESEND_API_KEY and MAIL_FROM must be set together (password reset email) or both left empty.",
    );
  } else if (rawMailFrom !== "" && !rawMailFrom.includes("@")) {
    problems.push("MAIL_FROM must be a sender address, e.g. Fabtyna Stores <no-reply@example.com>.");
  }

  const rawPoolMax = source.DB_POOL_MAX?.trim() ?? "";
  let dbPoolMax = 10;
  if (rawPoolMax !== "") {
    const parsed = Number(rawPoolMax);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
      problems.push("DB_POOL_MAX must be an integer between 1 and 10.");
    } else {
      dbPoolMax = parsed;
    }
  }

  const txTimeouts: TxTimeouts = {
    timeoutMs: readPositiveInt(source, "API_TX_TIMEOUT_MS", DEFAULT_TX_TIMEOUTS.timeoutMs, problems),
    maxWaitMs: readPositiveInt(source, "API_TX_MAX_WAIT_MS", DEFAULT_TX_TIMEOUTS.maxWaitMs, problems),
    lockTimeoutMs: readPositiveInt(source, "API_LOCK_TIMEOUT_MS", DEFAULT_TX_TIMEOUTS.lockTimeoutMs, problems),
  };
  if (txTimeouts.lockTimeoutMs >= txTimeouts.timeoutMs) {
    problems.push("API_LOCK_TIMEOUT_MS must be smaller than API_TX_TIMEOUT_MS.");
  }

  const rawMaxDateRange = source.API_MAX_DATE_RANGE_DAYS?.trim() ?? "";
  let maxDateRangeDays = 366;
  if (rawMaxDateRange !== "") {
    const parsed = Number(rawMaxDateRange);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
      problems.push("API_MAX_DATE_RANGE_DAYS must be an integer between 1 and 3650.");
    } else {
      maxDateRangeDays = parsed;
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join("\n  - ")}\n` +
        "Copy apps/api/.env.example to apps/api/.env and fill it in.",
    );
  }

  return {
    apiDatabaseUrl: directUrl,
    databaseUrl: rawDatabaseUrl === "" ? null : rawDatabaseUrl,
    dbPoolMax,
    port,
    nodeEnv,
    host,
    trustProxy: rawTrustProxy === "true",
    webOrigin,
    cookieDomain: rawCookieDomain === "" ? null : rawCookieDomain,
    sessionIdleTimeoutHours,
    sessionAbsoluteTimeoutDays,
    resendApiKey: rawResendApiKey === "" ? null : rawResendApiKey,
    mailFrom: rawMailFrom === "" ? null : rawMailFrom,
    txTimeouts,
    maxDateRangeDays,
  };
}
