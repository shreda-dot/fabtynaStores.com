import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { runDbAudit } from "../src/db/audit.js";
import { resolveTestConnectionString } from "./test-db.js";

const connectionString = resolveTestConnectionString();
const clientOptions = { connectionString, ssl: { rejectUnauthorized: false } };
const spendKobo = 60n;
const openingKobo = 100n;
const raceCount = 20;

let setupClient!: Client;
let spenderA!: Client;
let spenderB!: Client;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function insertAccountEntry(
  client: Client,
  entry: {
    id: string;
    accountId: string;
    type: "OWNER_CAPITAL" | "OWNER_DRAWING";
    amountKobo: bigint;
    note?: string;
    reversesEntryId?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO account_ledger_entries
       (id, "accountId", type, "amountKobo", note, "reversesEntryId")
     VALUES ($1, $2, $3::"AccountEntryType", $4::bigint, $5, $6)`,
    [
      entry.id,
      entry.accountId,
      entry.type,
      entry.amountKobo.toString(),
      entry.note ?? null,
      entry.reversesEntryId ?? null,
    ],
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

beforeAll(async () => {
  setupClient = new Client(clientOptions);
  spenderA = new Client(clientOptions);
  spenderB = new Client(clientOptions);
  await Promise.all([setupClient.connect(), spenderA.connect(), spenderB.connect()]);
});

afterAll(async () => {
  await Promise.all([setupClient.end(), spenderA.end(), spenderB.end()]);
});

describe("account_balances", () => {
  it("serializes competing spends and preserves zero balance over 20 races", async () => {
    const accountId = newId("account_balance_race");
    await setupClient.query(
      `INSERT INTO accounts (id, name, type, "updatedAt")
       VALUES ($1, $2, 'CASH', now())`,
      [accountId, `Account balance concurrency ${accountId}`],
    );

    for (let round = 0; round < raceCount; round += 1) {
      const capitalId = newId("owner_capital");
      await insertAccountEntry(setupClient, {
        id: capitalId,
        accountId,
        type: "OWNER_CAPITAL",
        amountKobo: openingKobo,
      });

      const spendIds = [newId("owner_drawing"), newId("owner_drawing")];
      const results = await Promise.allSettled([
        insertAccountEntry(spenderA, {
          id: spendIds[0],
          accountId,
          type: "OWNER_DRAWING",
          amountKobo: -spendKobo,
          note: "Concurrency regression test spend",
        }),
        insertAccountEntry(spenderB, {
          id: spendIds[1],
          accountId,
          type: "OWNER_DRAWING",
          amountKobo: -spendKobo,
          note: "Concurrency regression test spend",
        }),
      ]);

      const fulfilled = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [spendIds[index]] : [],
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      try {
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(errorCode(rejected[0].reason)).toBe("23514");

        const balanceResult = await setupClient.query(
          `SELECT "balanceKobo"::text AS balance
             FROM account_balances
            WHERE "accountId" = $1`,
          [accountId],
        );
        expect(balanceResult.rows[0]?.balance).toBe((openingKobo - spendKobo).toString());
      } finally {
        for (const spendId of fulfilled) {
          await insertAccountEntry(setupClient, {
            id: newId("owner_drawing_reversal"),
            accountId,
            type: "OWNER_DRAWING",
            amountKobo: spendKobo,
            note: "Concurrency regression test spend",
            reversesEntryId: spendId,
          });
        }
        await insertAccountEntry(setupClient, {
          id: newId("owner_capital_reversal"),
          accountId,
          type: "OWNER_CAPITAL",
          amountKobo: -openingKobo,
          reversesEntryId: capitalId,
        });
      }

      const finalBalance = await setupClient.query(
        `SELECT "balanceKobo"::text AS balance
           FROM account_balances
          WHERE "accountId" = $1`,
        [accountId],
      );
      expect(finalBalance.rows[0]?.balance).toBe("0");
    }

    const audit = await runDbAudit(connectionString);
    expect(
      audit.ok,
      audit.checks
        .filter((check) => check.severity === "fatal" && check.rowCount > 0)
        .map((check) => `${check.name}: ${check.rowCount}`)
        .join("\n"),
    ).toBe(true);
  }, 120_000);
});
