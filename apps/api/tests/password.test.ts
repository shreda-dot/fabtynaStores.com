import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, hashPassword, isArgon2idHash, verifyPassword } from "../src/lib/password.js";

/**
 * Pure unit tests for the password helper — they touch no database. They run
 * inside the same vitest project as the constraint tests, so the global setup
 * (`tests/global-setup.ts`) still proves the TEST database schema first.
 */

const PASSWORD = "correct horse battery staple";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword(stored, PASSWORD)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword(stored, `${PASSWORD} extra`)).resolves.toBe(false);
  });

  it("produces a different hash every time (random salt)", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    // Both still verify — only the salt differs.
    await expect(verifyPassword(first, PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(second, PASSWORD)).resolves.toBe(true);
  });

  it("rejects an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow(/at least 12 characters/);
  });

  it("enforces a minimum length of 12 characters", async () => {
    const tooShort = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const justLongEnough = "a".repeat(MIN_PASSWORD_LENGTH);

    await expect(hashPassword(tooShort)).rejects.toThrow(/at least 12 characters/);
    await expect(hashPassword(justLongEnough)).resolves.toMatch(/^\$argon2id\$/);
  });

  it("treats a malformed stored hash as a failed verification", async () => {
    await expect(verifyPassword("not-a-real-hash", PASSWORD)).resolves.toBe(false);
  });
});

describe("isArgon2idHash", () => {
  it("accepts a hash this module produced", async () => {
    expect(isArgon2idHash(await hashPassword(PASSWORD))).toBe(true);
  });

  it("rejects anything that is not an argon2id hash", () => {
    expect(isArgon2idHash("")).toBe(false);
    expect(isArgon2idHash("plain-text")).toBe(false);
    // argon2i / argon2d must not pass: the seeds require argon2id specifically.
    expect(
      isArgon2idHash("$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0$3wP9Wq0M0Q0F0n8lJcpE1F0C6mC0kq0m6d5aXm1E9fA"),
    ).toBe(false);
  });
});
