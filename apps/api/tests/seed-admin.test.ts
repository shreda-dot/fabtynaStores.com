import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { assertNotATestDatabase, seedAdmin } from "../src/lib/seed-admin.js";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * Seed-script behaviour, proven against the TEST database only.
 *
 * "Creates an OWNER on an empty database" needs an empty `admin_users`, but the
 * real table can never be emptied: committed sales and audit rows (immutable)
 * reference admins. So these tests run against an ISOLATED copy of the table in
 * their own Postgres schema (`seed_admin_test`), emptied before each test and
 * dropped at the end. The real `public.admin_users` is never touched. The
 * vitest global setup (tests/global-setup.ts) runs `db:verify` first.
 */

const connectionString = resolveTestConnectionString();
const ISOLATED_SCHEMA = "seed_admin_test";
const PASSWORD = "correct horse battery staple";

let prisma: PrismaClient;
let pg: Client;
let passwordHash: string;
let seq = 0;
const nextEmail = (): string => `seed_admin_${Date.now()}_${seq++}@example.test`;

const seed = (options: Parameters<typeof seedAdmin>[1]) => seedAdmin(connectionString, options, prisma);

beforeAll(async () => {
  pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  await pg.query(`DROP SCHEMA IF EXISTS ${ISOLATED_SCHEMA} CASCADE`);
  await pg.query(`CREATE SCHEMA ${ISOLATED_SCHEMA}`);
  await pg.query(`CREATE TYPE ${ISOLATED_SCHEMA}."AdminRole" AS ENUM ('OWNER', 'STAFF')`);
  await pg.query(`CREATE TABLE ${ISOLATED_SCHEMA}.admin_users (LIKE public.admin_users INCLUDING ALL)`);
  // Prisma casts enums to the schema-qualified type, so the copy needs its own.
  await pg.query(`ALTER TABLE ${ISOLATED_SCHEMA}.admin_users ALTER COLUMN role DROP DEFAULT`);
  await pg.query(
    `ALTER TABLE ${ISOLATED_SCHEMA}.admin_users ALTER COLUMN role TYPE ${ISOLATED_SCHEMA}."AdminRole" USING role::text::${ISOLATED_SCHEMA}."AdminRole"`,
  );
  await pg.query(`ALTER TABLE ${ISOLATED_SCHEMA}.admin_users ALTER COLUMN role SET DEFAULT 'STAFF'`);

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: ISOLATED_SCHEMA }) });
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await prisma.adminUser.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  await pg.query(`DROP SCHEMA IF EXISTS ${ISOLATED_SCHEMA} CASCADE`);
  await pg.end();
});

describe("seedAdmin", () => {
  it("creates an OWNER on an empty database, normalising the email", async () => {
    const raw = `  ${nextEmail().toUpperCase()}  `;

    const created = await seed({ email: raw, passwordHash, additional: false });

    expect(created.role).toBe("OWNER");
    expect(created.email).toBe(raw.trim().toLowerCase());

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email: created.email } });
    expect(row.role).toBe("OWNER");
    expect(row.isActive).toBe(true);
  });

  it("refuses to create a second owner once an admin exists", async () => {
    await seed({ email: nextEmail(), passwordHash, additional: false });

    await expect(
      seed({ email: nextEmail(), passwordHash, additional: false }),
    ).rejects.toThrow(/already exists/);
  });

  it("creates a STAFF account with --additional", async () => {
    await seed({ email: nextEmail(), passwordHash, additional: false });

    const created = await seed({
      email: nextEmail(),
      passwordHash,
      additional: true,
    });

    expect(created.role).toBe("STAFF");
    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email: created.email } });
    expect(row.role).toBe("STAFF");
  });

  it("refuses --additional when the email is already taken", async () => {
    const email = nextEmail();
    await seed({ email, passwordHash, additional: false });

    await expect(
      seed({ email, passwordHash, additional: true }),
    ).rejects.toThrow(/already exists/);
  });

  it("stores a hash that verifies against the original password", async () => {
    const email = nextEmail();
    await seed({ email, passwordHash, additional: false });

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    await expect(verifyPassword(row.passwordHash, PASSWORD)).resolves.toBe(true);
  });

  it("rejects an invalid email address", async () => {
    await expect(
      seed({ email: "not-an-email", passwordHash, additional: false }),
    ).rejects.toThrow(/valid email address/);
  });

  it("rejects a hash that is not argon2id", async () => {
    await expect(
      seed({ email: nextEmail(), passwordHash: "plain-text", additional: false }),
    ).rejects.toThrow(/Argon2id/);
  });
});

describe("assertNotATestDatabase", () => {
  it("refuses a database whose name contains test", () => {
    expect(() =>
      assertNotATestDatabase("postgres://user:secret@example.com/fabtyna_test", null),
    ).toThrow(/contains "test"/);
  });

  it("refuses when the target is the configured TEST database", () => {
    // A name that does not itself contain "test", so this proves the second
    // guard (target === TEST_DATABASE_URL) fires on its own.
    const url = "postgres://user:secret@example.com/fabtyna_primary";

    expect(() => assertNotATestDatabase(url, url)).toThrow(/equals TEST_DATABASE_URL/);
  });

  it("allows a non-test database", () => {
    expect(() =>
      assertNotATestDatabase("postgres://user:secret@example.com/fabtyna_dev", null),
    ).not.toThrow();
  });
});
