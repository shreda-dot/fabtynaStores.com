import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";

const connectionString = resolveTestConnectionString();
let client: Client;
let sequence = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now()}_${sequence++}`;

async function inRollback(body: (db: Client) => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await body(client);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function insertAccount(db: Client): Promise<string> {
  const accountId = nextId("source_account");
  await db.query(
    `INSERT INTO accounts (id, name, type, "updatedAt")
     VALUES ($1, $2, 'CASH', now())`,
    [accountId, `Source trigger ${accountId}`],
  );
  await db.query(
    `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
     VALUES ($1, $2, 'OWNER_CAPITAL', 100000, 'source trigger funding')`,
    [nextId("source_funding"), accountId],
  );
  return accountId;
}

async function insertManual(
  db: Client,
  accountId: string,
  type: string,
  amountKobo: string,
  sourceId: string | null = null,
): Promise<void> {
  await db.query(
    `INSERT INTO account_ledger_entries
       (id, "accountId", type, "amountKobo", note, "otherIncomeId")
     VALUES ($1, $2, $3::"AccountEntryType", $4::bigint, $5, $6)`,
    [
      nextId("source_manual"),
      accountId,
      type,
      amountKobo,
      type === "OWNER_DRAWING" || type === "BANK_OR_POS_CHARGE" ? "source trigger test" : null,
      sourceId,
    ],
  );
}

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

beforeAll(async () => {
  client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
});

describe("account-ledger source-type trigger", () => {
  it.each([
    ["OWNER_CAPITAL", "100"],
    ["OTHER_INCOME", "100"],
    ["BANK_OR_POS_CHARGE", "-100"],
  ])("%s accepts a source-less entry and rejects a stray source", async (type, amount) => {
    await inRollback(async (db) => {
      const accountId = await insertAccount(db);
      await insertManual(db, accountId, type, amount);

      const savepoint = `stray_${type.toLowerCase()}`;
      await db.query(`SAVEPOINT ${savepoint}`);
      await expect(insertManual(db, accountId, type, amount, `stray_${type}`)).rejects.toMatchObject({
        code: "P0001",
      });
      await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    });
  });

  it("requires a drawing document at commit while keeping the ledger entry source-less", async () => {
    await inRollback(async (db) => {
      const accountId = await insertAccount(db);
      const entryId = nextId("drawing_entry");
      await db.query(`SAVEPOINT missing_document`);
      await db.query(
        `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
         VALUES ($1, $2, 'OWNER_DRAWING', -100, 'Drawing test')`,
        [entryId, accountId],
      );
      await expect(db.query(`SET CONSTRAINTS trg_account_drawing_requires_document IMMEDIATE`))
        .rejects.toMatchObject({ code: "P0001" });
      await db.query(`ROLLBACK TO SAVEPOINT missing_document`);

      const actorId = nextId("drawing_actor");
      const memberId = nextId("drawing_member");
      await db.query(
        `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
         VALUES ($1, $2, 'test-only', now())`,
        [actorId, `${actorId}@example.test`],
      );
      await db.query(
        `INSERT INTO family_members (id, name, "normalizedKey", relationship, "updatedAt")
         VALUES ($1, $2, $3, 'Family', now())`,
        [memberId, memberId, memberId.toLowerCase()],
      );
      await db.query(
        `INSERT INTO account_ledger_entries (id, "accountId", type, "amountKobo", note)
         VALUES ($1, $2, 'OWNER_DRAWING', -100, 'Drawing test')`,
        [entryId, accountId],
      );
      await db.query(
        `INSERT INTO drawings (id, "entryId", "beneficiaryId", purpose, "createdById")
         VALUES ($1, $2, $3, 'OTHER', $4)`,
        [nextId("drawing"), entryId, memberId, actorId],
      );
      await expect(db.query(`SET CONSTRAINTS trg_account_drawing_requires_document IMMEDIATE`))
        .resolves.toBeDefined();
    });
  });

  it("still rejects a missing source for every source-backed account-ledger type", async () => {
    await inRollback(async (db) => {
      const accountId = await insertAccount(db);
      const sourceTypes: Array<[string, string]> = [
        ["SALE_PAYMENT", "100"],
        ["CUSTOMER_PAYMENT", "100"],
        ["SUPPLIER_PAYMENT", "-100"],
        ["PURCHASE_PAYMENT", "-100"],
        ["EXPENSE", "-100"],
        ["CUSTOMER_REFUND", "-100"],
        ["TRANSFER_IN", "100"],
        ["TRANSFER_OUT", "-100"],
        ["LOAN_DISBURSEMENT", "100"],
        ["LOAN_REPAYMENT", "-100"],
      ];

      for (const [type, amount] of sourceTypes) {
        const savepoint = `missing_${type.toLowerCase()}`;
        await db.query(`SAVEPOINT ${savepoint}`);
        await expect(
          db.query(
            `INSERT INTO account_ledger_entries
               (id, "accountId", type, "amountKobo")
             VALUES ($1, $2, $3::"AccountEntryType", $4::bigint)`,
            [nextId("missing_source"), accountId, type, amount],
          ),
        ).rejects.toMatchObject({ code: "P0001" });
        await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
    });
  });
});
