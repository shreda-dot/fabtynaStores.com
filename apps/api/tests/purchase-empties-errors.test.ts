import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapKnownError } from "../src/lib/errors.js";
import { purchaseEmptiesErrorMessage } from "../src/lib/purchase-empties-errors.js";

describe("purchase empties database errors", () => {
  it("maps every exception in the applied migration to an actionable message", () => {
    const sql = readFileSync(resolve("prisma", "migrations", "20261113000000_purchase_empties", "migration.sql"), "utf8");
    const messages = [...sql.matchAll(/RAISE EXCEPTION '([^']+)'/g)].map((match) => match[1]!);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(purchaseEmptiesErrorMessage(message, null), message).toBeTruthy();
    }
    const constraints = [...sql.matchAll(/\bCONSTRAINT\s+([a-z][a-z0-9_]+)\s+(?:PRIMARY KEY|FOREIGN KEY|CHECK)/g)]
      .map((match) => match[1]!);
    const indexes = [...sql.matchAll(/CREATE UNIQUE INDEX\s+([a-z][a-z0-9_]+)/g)].map((match) => match[1]!);
    for (const name of [...constraints, ...indexes]) {
      expect(purchaseEmptiesErrorMessage(null, name), name).toBeTruthy();
    }
  });

  it("maps bare PostgreSQL and Prisma-wrapped errors without exposing database wording", () => {
    const bare = mapKnownError({ code: "P0001", message: "The purchase has an unresolved or incorrect empties shortage." });
    expect(bare?.status).toBe(409);
    expect(bare?.message).toContain("Refresh the check");
    const wrapped = mapKnownError({
      code: "P2010",
      meta: { driverAdapterError: { cause: { originalCode: "23514", constraint: { name: "ck_supplier_empties_balance_nonnegative" } } } },
    });
    expect(wrapped?.status).toBe(409);
    expect(wrapped?.message).toContain("greater than the outstanding empties debt");
    const duplicate = mapKnownError({ code: "23505", constraint: "ux_supplier_empties_event_reversal" });
    expect(duplicate?.message).toContain("already corrected");
  });
});
