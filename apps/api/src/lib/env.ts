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
  /** `ALLOW_UNAUTHENTICATED_DEV=true`: explicit opt-in to run with no login. */
  allowUnauthenticatedDev: boolean;
  /** Email of the active admin that created rows while there is no login. */
  devActorEmail: string | null;
  /** Transaction timing for write endpoints (see lib/tx-options.ts). */
  txTimeouts: TxTimeouts;
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

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join("\n  - ")}\n` +
        "Copy apps/api/.env.example to apps/api/.env and fill it in.",
    );
  }

  const devActorEmail = source.DEV_ACTOR_EMAIL?.trim().toLowerCase() ?? "";

  return {
    apiDatabaseUrl: directUrl,
    databaseUrl: rawDatabaseUrl === "" ? null : rawDatabaseUrl,
    dbPoolMax,
    port,
    nodeEnv: source.NODE_ENV?.trim() || "development",
    allowUnauthenticatedDev: source.ALLOW_UNAUTHENTICATED_DEV?.trim() === "true",
    devActorEmail: devActorEmail === "" ? null : devActorEmail,
    txTimeouts,
  };
}
