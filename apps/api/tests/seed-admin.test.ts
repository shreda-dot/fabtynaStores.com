import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { assertNotATestDatabase, seedAdmin } from "../src/lib/seed-admin.js";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * Seed-script behaviour, proven against the TEST database only.
 *
 * Every row these tests create is removed again: `admin_users` is emptied
 * before each test (so "creates an OWNER on an empty database" really starts
 * empty) and once more in `afterAll`. The vitest global setup
 * (tests/global-setup.ts) runs `db:verify` first and aborts the run if the
 * schema does not match `src/db/expected-schema.ts`.
 */

const connectionString = resolveTestConnectionString();
const PASSWORD = "correct horse battery staple";

let prisma: PrismaClient;
let passwordHash: string;
let seq = 0;
const nextEmail = (): string => `seed_admin_${Date.now()}_${seq++}@example.test`;

beforeAll(async () => {
  prisma = createPrismaClient(connectionString);
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  await prisma.adminUser.deleteMany();
});

afterAll(async () => {
  await prisma.adminUser.deleteMany();
  await prisma.$disconnect();
});

describe("seedAdmin", () => {
  it("creates an OWNER on an empty database, normalising the email", async () => {
    const raw = `  ${nextEmail().toUpperCase()}  `;

    const created = await seedAdmin(connectionString, { email: raw, passwordHash, additional: false });

    expect(created.role).toBe("OWNER");
    expect(created.email).toBe(raw.trim().toLowerCase());

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email: created.email } });
    expect(row.role).toBe("OWNER");
    expect(row.isActive).toBe(true);
  });

  it("refuses to create a second owner once an admin exists", async () => {
    await seedAdmin(connectionString, { email: nextEmail(), passwordHash, additional: false });

    await expect(
      seedAdmin(connectionString, { email: nextEmail(), passwordHash, additional: false }),
    ).rejects.toThrow(/already exists/);
  });

  it("creates a STAFF account with --additional", async () => {
    await seedAdmin(connectionString, { email: nextEmail(), passwordHash, additional: false });

    const created = await seedAdmin(connectionString, {
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
    await seedAdmin(connectionString, { email, passwordHash, additional: false });

    await expect(
      seedAdmin(connectionString, { email, passwordHash, additional: true }),
    ).rejects.toThrow(/already exists/);
  });

  it("stores a hash that verifies against the original password", async () => {
    const email = nextEmail();
    await seedAdmin(connectionString, { email, passwordHash, additional: false });

    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    await expect(verifyPassword(row.passwordHash, PASSWORD)).resolves.toBe(true);
  });

  it("rejects an invalid email address", async () => {
    await expect(
      seedAdmin(connectionString, { email: "not-an-email", passwordHash, additional: false }),
    ).rejects.toThrow(/valid email address/);
  });

  it("rejects a hash that is not argon2id", async () => {
    await expect(
      seedAdmin(connectionString, { email: nextEmail(), passwordHash: "plain-text", additional: false }),
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
