import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resolveTestConnectionString } from "./test-db.js";

/**
 * The strict credit rules, proven against the database:
 *   purchases CHECK ("paidKobo" >= "totalKobo" OR "supplierId" IS NOT NULL)
 *   sales     CHECK ("paidKobo" >= "totalKobo" OR "customerId" IS NOT NULL)
 *
 * These tests talk to the TEST database only and roll every write back, so the
 * test database is never left dirty and the dev database is never touched.
 * The vitest global setup (tests/global-setup.ts) runs `db:verify` first and
 * aborts the run if the schema does not match `src/db/expected-schema.ts`.
 */

const connectionString = resolveTestConnectionString();

let client: Client;
let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now()}_${seq++}`;

/** Runs `body` inside a transaction that is always rolled back. */
async function inRollback(body: (c: Client) => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await body(client);
  } finally {
    await client.query("ROLLBACK");
  }
}

/** `sales.createdById` / `purchases.createdById` are NOT NULL, so seed an admin. */
async function seedAdminUser(c: Client): Promise<string> {
  const id = nextId("ct_admin");
  await c.query(
    `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, now())`,
    [id, `${id}@example.test`, "not-a-real-hash"],
  );
  return id;
}

async function seedCustomer(c: Client): Promise<string> {
  const id = nextId("ct_customer");
  await c.query(`INSERT INTO customers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
    id,
    "Constraint Test Customer",
  ]);
  return id;
}

async function seedSupplier(c: Client): Promise<string> {
  const id = nextId("ct_supplier");
  await c.query(`INSERT INTO suppliers (id, name, "updatedAt") VALUES ($1, $2, now())`, [
    id,
    "Constraint Test Supplier",
  ]);
  return id;
}

async function insertSale(
  c: Client,
  sale: {
    adminId: string;
    customerId: string | null;
    customerName: string | null;
    totalKobo: bigint;
    paidKobo: bigint;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO sales
       (id, "createdById", "customerId", "customerName", channel, status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, $4, 'RETAIL', 'COMPLETED', $5::bigint, $6::bigint, now())`,
    [
      nextId("ct_sale"),
      sale.adminId,
      sale.customerId,
      sale.customerName,
      sale.totalKobo.toString(),
      sale.paidKobo.toString(),
    ],
  );
}

async function insertPurchase(
  c: Client,
  purchase: {
    adminId: string;
    supplierId: string | null;
    totalKobo: bigint;
    paidKobo: bigint;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO purchases
       (id, "createdById", "supplierId", status, "totalKobo", "paidKobo", "updatedAt")
     VALUES ($1, $2, $3, 'RECEIVED', $4::bigint, $5::bigint, now())`,
    [
      nextId("ct_purchase"),
      purchase.adminId,
      purchase.supplierId,
      purchase.totalKobo.toString(),
      purchase.paidKobo.toString(),
    ],
  );
}

async function seedLoan(c: Client): Promise<string> {
  const id = nextId("ct_loan");
  await c.query(
    `INSERT INTO loans (id, "lenderName", "principalKobo", "agreedInterestKobo", "disbursedAt")
     VALUES ($1, $2, $3::bigint, $4::bigint, now())`,
    [id, "Constraint Test Lender", "100000", "10000"],
  );
  return id;
}

async function seedLoanRepayment(c: Client, loanId: string): Promise<string> {
  const id = nextId("ct_repayment");
  await c.query(
    `INSERT INTO loan_repayments (id, "loanId", "amountKobo", "interestPortionKobo", "paidAt")
     VALUES ($1, $2, $3::bigint, $4::bigint, now())`,
    [id, loanId, "20000", "10000"],
  );
  return id;
}

async function insertExpense(
  c: Client,
  expense: { category: string; loanRepaymentId: string | null },
): Promise<void> {
  await c.query(
    `INSERT INTO expenses
       (id, channel, category, description, "amountKobo", "expenseDate", "loanRepaymentId", "updatedAt")
     VALUES ($1, 'BOTH', $2::"ExpenseCategory", 'Constraint Test Expense', $3::bigint, now(), $4, now())`,
    [nextId("ct_expense"), expense.category, "1000", expense.loanRepaymentId],
  );
}

beforeAll(async () => {
  client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
});

afterAll(async () => {
  if (client) {
    await client.end();
  }
});

describe("ck_sales_unpaid_requires_customer (strict)", () => {
  it("is defined as paidKobo >= totalKobo OR customerId IS NOT NULL, with no customerName clause", async () => {
    const { rows } = await client.query(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'sales'::regclass
          and conname = 'ck_sales_unpaid_requires_customer'`,
    );

    expect(rows).toHaveLength(1);
    const def = rows[0].def as string;
    expect(def).toContain('"paidKobo" >= "totalKobo"');
    expect(def).toContain('"customerId" IS NOT NULL');
    expect(def).not.toContain("customerName");
  });

  it("REJECTS an unpaid sale that has only a customer name (no customer id)", async () => {
    await expect(
      inRollback(async (c) => {
        const adminId = await seedAdminUser(c);
        await insertSale(c, {
          adminId,
          customerId: null,
          customerName: "Walk-in buyer",
          totalKobo: 1000n,
          paidKobo: 0n,
        });
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_sales_unpaid_requires_customer",
    });
  });

  it("REJECTS an unpaid sale with no customer id and no customer name", async () => {
    await expect(
      inRollback(async (c) => {
        const adminId = await seedAdminUser(c);
        await insertSale(c, {
          adminId,
          customerId: null,
          customerName: null,
          totalKobo: 1000n,
          paidKobo: 0n,
        });
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_sales_unpaid_requires_customer",
    });
  });

  it("ACCEPTS an unpaid sale that has a customer id", async () => {
    await inRollback(async (c) => {
      const adminId = await seedAdminUser(c);
      const customerId = await seedCustomer(c);

      await insertSale(c, {
        adminId,
        customerId,
        customerName: null,
        totalKobo: 1000n,
        paidKobo: 0n,
      });

      const { rows } = await c.query(
        `select count(*)::int as n from sales where "customerId" = $1`,
        [customerId],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("ACCEPTS a fully paid sale with neither a customer id nor a customer name", async () => {
    await inRollback(async (c) => {
      const adminId = await seedAdminUser(c);

      await insertSale(c, {
        adminId,
        customerId: null,
        customerName: null,
        totalKobo: 1000n,
        paidKobo: 1000n,
      });

      const { rows } = await c.query(`select count(*)::int as n from sales`);
      expect(rows[0].n).toBe(1);
    });
  });
});

describe("ck_purchases_unpaid_requires_supplier", () => {
  it("is defined as paidKobo >= totalKobo OR supplierId IS NOT NULL", async () => {
    const { rows } = await client.query(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'purchases'::regclass
          and conname = 'ck_purchases_unpaid_requires_supplier'`,
    );

    expect(rows).toHaveLength(1);
    const def = rows[0].def as string;
    expect(def).toContain('"paidKobo" >= "totalKobo"');
    expect(def).toContain('"supplierId" IS NOT NULL');
  });

  it("REJECTS an unpaid purchase with no supplier", async () => {
    await expect(
      inRollback(async (c) => {
        const adminId = await seedAdminUser(c);
        await insertPurchase(c, {
          adminId,
          supplierId: null,
          totalKobo: 1000n,
          paidKobo: 0n,
        });
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_purchases_unpaid_requires_supplier",
    });
  });

  it("ACCEPTS an unpaid purchase that has a supplier", async () => {
    await inRollback(async (c) => {
      const adminId = await seedAdminUser(c);
      const supplierId = await seedSupplier(c);

      await insertPurchase(c, {
        adminId,
        supplierId,
        totalKobo: 1000n,
        paidKobo: 0n,
      });

      const { rows } = await c.query(
        `select count(*)::int as n from purchases where "supplierId" = $1`,
        [supplierId],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("ACCEPTS a fully paid purchase with no supplier", async () => {
    await inRollback(async (c) => {
      const adminId = await seedAdminUser(c);

      await insertPurchase(c, {
        adminId,
        supplierId: null,
        totalKobo: 1000n,
        paidKobo: 1000n,
      });

      const { rows } = await c.query(`select count(*)::int as n from purchases`);
      expect(rows[0].n).toBe(1);
    });
  });
});

/* ------------------------------------------------------------------ *
 * STEP 1 — the loan-repayment to expense link is one-directional
 *
 * `loan_repayments.expenseId` and `fk_loan_repayments_expense` no longer
 * exist (migration `20261017060000`). A repayment's expense is now reached
 * through the reverse relation `expenses.loanRepaymentId`, which is unique
 * (index `expenses_loanRepaymentId_key`) and referenced by
 * `fk_expenses_loan_repayment`. These tests prove the column/FK are gone, that
 * a second expense for one repayment is rejected by the unique index, and that
 * `trg_expenses_loan_link` still enforces the LOAN_INTEREST category.
 * ------------------------------------------------------------------ */
describe("loan-repayment to expense link (one-directional)", () => {
  it("removed loan_repayments.expenseId and fk_loan_repayments_expense", async () => {
    const { rows: cols } = await client.query(
      `select 1
         from information_schema.columns
        where table_name = 'loan_repayments'
          and column_name = 'expenseId'`,
    );
    expect(cols).toHaveLength(0);

    const { rows: fks } = await client.query(
      `select 1 from pg_constraint where conname = 'fk_loan_repayments_expense'`,
    );
    expect(fks).toHaveLength(0);
  });

  it("keeps fk_expenses_loan_repayment and the unique index on expenses.loanRepaymentId", async () => {
    const { rows: fks } = await client.query(
      `select 1
         from pg_constraint
        where conrelid = 'expenses'::regclass
          and conname = 'fk_expenses_loan_repayment'`,
    );
    expect(fks).toHaveLength(1);

    const { rows: idx } = await client.query(
      `select 1
         from pg_indexes
        where tablename = 'expenses'
          and indexname = 'expenses_loanRepaymentId_key'`,
    );
    expect(idx).toHaveLength(1);
  });

  it("ACCEPTS a LOAN_INTEREST expense that references a repayment", async () => {
    await inRollback(async (c) => {
      const loanId = await seedLoan(c);
      const repaymentId = await seedLoanRepayment(c, loanId);
      await insertExpense(c, {
        category: "LOAN_INTEREST",
        loanRepaymentId: repaymentId,
      });

      const { rows } = await c.query(
        `select count(*)::int as n from expenses where "loanRepaymentId" = $1`,
        [repaymentId],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("REJECTS a second expense pointing at the same repayment (unique index)", async () => {
    await expect(
      inRollback(async (c) => {
        const loanId = await seedLoan(c);
        const repaymentId = await seedLoanRepayment(c, loanId);
        await insertExpense(c, {
          category: "LOAN_INTEREST",
          loanRepaymentId: repaymentId,
        });
        // Same repayment again — the unique index must reject it.
        await insertExpense(c, {
          category: "LOAN_INTEREST",
          loanRepaymentId: repaymentId,
        });
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "expenses_loanRepaymentId_key",
    });
  });

  it("REJECTS a linked expense whose category is not LOAN_INTEREST (trg_expenses_loan_link)", async () => {
    await expect(
      inRollback(async (c) => {
        const loanId = await seedLoan(c);
        const repaymentId = await seedLoanRepayment(c, loanId);
        await insertExpense(c, { category: "RENT", loanRepaymentId: repaymentId });
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("ACCEPTS a manual LOAN_INTEREST expense with no repayment", async () => {
    await inRollback(async (c) => {
      await insertExpense(c, { category: "LOAN_INTEREST", loanRepaymentId: null });

      const { rows } = await c.query(
        `select count(*)::int as n from expenses where "loanRepaymentId" is null`,
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });
});
