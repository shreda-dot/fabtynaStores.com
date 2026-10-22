import { Client } from "pg";
import { resolveSslConfig } from "./ssl.js";

/**
 * Everything the database scripts share about WHICH database they are pointed at:
 * the `--url` / `--confirm-db` arguments, the database name, a class label and
 * the name check that guards writes.
 *
 * Nothing here ever prints or returns a connection string or host name. A script
 * only ever shows the database NAME and its class (dev, test or prod).
 */

export type DatabaseClass = "dev" | "test" | "prod";

/** Reads just the database name out of a connection string (no network). */
export function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

/**
 * Class by database NAME: a name containing "test" is test, containing "dev" is
 * dev, and anything else is treated as prod. Unknown names are deliberately
 * classed as prod so an unfamiliar database is handled with the most care.
 */
export function classifyDatabase(databaseName: string): DatabaseClass {
  const name = databaseName.toLowerCase();
  if (name.includes("test")) return "test";
  if (name.includes("dev")) return "dev";
  return "prod";
}

export function describeDatabase(databaseName: string): string {
  return `${databaseName} [${classifyDatabase(databaseName)}]`;
}

export interface TargetArgs {
  /** An environment variable name or a literal connection string; null when omitted. */
  url: string | null;
  confirmDb: string | null;
  flags: Set<string>;
}

export interface TargetArgSpec {
  /** Accept `--confirm-db <name>`. */
  confirmDb?: boolean;
  /** Extra boolean flags, e.g. `--additional`. */
  flags?: readonly string[];
}

function takeValue(arg: string, name: string, argv: string[], index: number): { value: string; next: number } {
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) {
    const value = arg.slice(prefix.length);
    if (value === "") throw new Error(`${name} requires a value.`);
    return { value, next: index };
  }
  const value = argv[index + 1];
  if (value === undefined || value === "") throw new Error(`${name} requires a value.`);
  return { value, next: index + 1 };
}

export function parseTargetArgs(argv: string[], spec: TargetArgSpec = {}): TargetArgs {
  const result: TargetArgs = { url: null, confirmDb: null, flags: new Set() };
  const flags = new Set(spec.flags ?? []);
  const supported = [
    "--url <NAME|VALUE>",
    ...(spec.confirmDb === true ? ["--confirm-db <name>"] : []),
    ...[...flags],
  ].join(", ");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url" || arg.startsWith("--url=")) {
      const taken = takeValue(arg, "--url", argv, index);
      result.url = taken.value;
      index = taken.next;
      continue;
    }
    if (spec.confirmDb === true && (arg === "--confirm-db" || arg.startsWith("--confirm-db="))) {
      const taken = takeValue(arg, "--confirm-db", argv, index);
      result.confirmDb = taken.value;
      index = taken.next;
      continue;
    }
    if (flags.has(arg)) {
      result.flags.add(arg);
      continue;
    }
    throw new Error(`Unknown argument "${arg}". Supported: ${supported}.`);
  }
  return result;
}

/** Resolves `--url` to a connection string: a literal URL, or the name of an env var. */
export function resolveConnectionString(
  requested: string | null,
  defaultEnvName: string,
  tool: string,
  env: NodeJS.ProcessEnv = process.env,
): { connectionString: string; source: string } {
  const target = requested ?? defaultEnvName;
  if (/^postgres(ql)?:\/\//.test(target)) {
    return { connectionString: target, source: "--url (literal)" };
  }
  const value = (env[target] ?? "").trim();
  if (value === "") {
    throw new Error(`${target} is empty or not set. Refusing to run ${tool} without a target database.`);
  }
  return { connectionString: value, source: target };
}

/**
 * Refuses unless `--confirm-db` names exactly the database that is connected.
 * The message never reveals the connected name, so the operator has to know it
 * (run `db:whoami` first), and never contains a URL.
 */
export function assertConfirmedDatabase(connectedName: string, confirmedName: string | null): void {
  if (confirmedName === null || confirmedName.trim() === "") {
    throw new Error(
      "Refusing to run: pass --confirm-db <database name> naming the database you intend to change. " +
        "Run `pnpm --filter @fabtyna/api db:whoami` to see the name and class of the target.",
    );
  }
  if (confirmedName !== connectedName) {
    throw new Error(
      "Refusing to run: --confirm-db does not match the name of the connected database. Nothing was changed.",
    );
  }
}

/** Asks the server which database this connection really reached. */
export async function fetchConnectedDatabaseName(connectionString: string): Promise<string> {
  const client = new Client({ connectionString, ssl: resolveSslConfig(connectionString) });
  await client.connect();
  try {
    const result = await client.query<{ name: string }>("SELECT current_database() AS name");
    return result.rows[0].name;
  } finally {
    await client.end();
  }
}

/** Removes the connection string, its password and its host from text a child process printed. */
export function redactConnectionDetails(text: string, connectionString: string): string {
  let output = text;
  try {
    const url = new URL(connectionString);
    const secrets = [connectionString, decodeURIComponent(url.password), url.password, url.host, url.hostname];
    for (const secret of secrets) {
      if (secret !== "" && secret.length >= 3) output = output.split(secret).join("<hidden>");
    }
  } catch {
    // An unparseable URL has nothing more to redact than the whole string.
    output = output.split(connectionString).join("<hidden>");
  }
  return output;
}
