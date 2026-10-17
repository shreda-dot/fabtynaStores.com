import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Prisma 7 no longer loads `.env` on our behalf and `tsx` does not either, so
// the API loads its own file (resolved from this file, not from the current
// working directory) before any value is read.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export interface RuntimeEnv {
  /** Pooled Neon connection string used by the running API. */
  databaseUrl: string;
  /** Direct Neon connection string; only needed for schema/migration commands. */
  directUrl: string | null;
  port: number;
  nodeEnv: string;
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

  const databaseUrl = source.DATABASE_URL?.trim() ?? "";
  if (databaseUrl === "") {
    problems.push("DATABASE_URL is missing (the pooled Neon connection string).");
  } else if (!isPostgresUrl(databaseUrl)) {
    problems.push("DATABASE_URL must start with postgres:// or postgresql://.");
  }

  const rawDirectUrl = source.DIRECT_URL?.trim() ?? "";
  if (rawDirectUrl !== "" && !isPostgresUrl(rawDirectUrl)) {
    problems.push("DIRECT_URL must start with postgres:// or postgresql://.");
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

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join("\n  - ")}\n` +
        "Copy apps/api/.env.example to apps/api/.env and fill it in.",
    );
  }

  return {
    databaseUrl,
    directUrl: rawDirectUrl === "" ? null : rawDirectUrl,
    port,
    nodeEnv: source.NODE_ENV?.trim() || "development",
  };
}
