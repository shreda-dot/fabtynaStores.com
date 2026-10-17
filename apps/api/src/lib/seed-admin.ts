import { z } from "zod";
import { databaseNameOf } from "../db/verify.js";
import { createPrismaClient } from "./prisma.js";
import { isArgon2idHash } from "./password.js";

/**
 * Admin seeding, kept free of CLI concerns (env reading, argv, exit codes) so it
 * can be driven by the `db:seed:admin` script and by the tests — the same split
 * as `src/db/verify.ts` (logic) and `src/scripts/db-verify.ts` (CLI).
 *
 * It exists so the business can have several admin users: run it once to create
 * the OWNER, then once per additional person with `--additional`.
 */

/** Accepts an email, and normalises it: trimmed and lower-cased. */
const emailSchema = z.string().trim().toLowerCase().email();

/** Roles an admin account can hold. Not enforced anywhere yet (see schema.prisma). */
export type AdminRoleValue = "OWNER" | "STAFF";

export interface SeedAdminOptions {
  email: string;
  passwordHash: string;
  /** `true` when the caller passed `--additional`: create a STAFF account. */
  additional: boolean;
}

export interface SeededAdmin {
  email: string;
  role: AdminRoleValue;
}

/**
 * Validates the inputs and writes exactly one `admin_users` row.
 *
 * Throws when the email is invalid, the hash is not an Argon2id hash, an admin
 * already exists without `--additional`, or the email is already taken.
 *
 * The connection string is passed in explicitly so the CLI can be pinned to
 * `DATABASE_URL` while the tests drive this function against the TEST database.
 */
export async function seedAdmin(
  connectionString: string,
  options: SeedAdminOptions,
): Promise<SeededAdmin> {
  const parsedEmail = emailSchema.safeParse(options.email);
  if (!parsedEmail.success) {
    throw new Error(`ADMIN_EMAIL is not a valid email address: ${JSON.stringify(options.email)}.`);
  }
  const email = parsedEmail.data;

  if (!isArgon2idHash(options.passwordHash)) {
    throw new Error(
      "ADMIN_PASSWORD_HASH is not a valid Argon2id hash. " +
        "Generate one with `pnpm --filter @fabtyna/api hash-password`.",
    );
  }

  const prisma = createPrismaClient(connectionString);
  try {
    if (options.additional) {
      const clash = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
      if (clash !== null) {
        throw new Error(`an admin with the email ${email} already exists.`);
      }
    } else if ((await prisma.adminUser.count()) > 0) {
      throw new Error(
        "an admin user already exists. Re-run with --additional to add another (STAFF) account.",
      );
    }

    const role: AdminRoleValue = options.additional ? "STAFF" : "OWNER";

    const created = await prisma.adminUser.create({
      data: { email, passwordHash: options.passwordHash, role },
      select: { email: true, role: true },
    });

    return { email: created.email, role: created.role };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Refuses to seed anything that looks like a test database — either because the
 * target's own name contains "test", or because it is the configured
 * `TEST_DATABASE_URL`. `testConnectionString` is passed in rather than read from
 * the environment so this guard stays a pure function.
 */
export function assertNotATestDatabase(
  connectionString: string,
  testConnectionString: string | null,
): void {
  const databaseName = databaseNameOf(connectionString);
  if (databaseName.toLowerCase().includes("test")) {
    throw new Error(
      `refusing to seed: DATABASE_URL points at "${databaseName}", whose name contains "test". ` +
        "The seed only ever writes to the dev database.",
    );
  }

  if (testConnectionString !== null && testConnectionString.trim() !== "") {
    if (connectionString === testConnectionString.trim()) {
      throw new Error("refusing to seed: DATABASE_URL equals TEST_DATABASE_URL.");
    }
  }
}
