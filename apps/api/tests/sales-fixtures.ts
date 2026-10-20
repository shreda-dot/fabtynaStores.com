import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { createDevActorResolver, type Actor } from "../src/auth/actor.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { resolveTestConnectionString } from "./test-db.js";

export const connectionString = resolveTestConnectionString();
const clientOptions = { connectionString, ssl: { rejectUnauthorized: false } };

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export interface Harness {
  prisma: PrismaClient;
  pg: Client;
  actor: Actor;
  app: FastifyInstance;
  /** One entry per committed transaction attempt: route, txMs, queries (statement count). */
  txLog: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Lets one test hand the app a client whose transaction is wrapped (see atomicity test). */
  wrapPrisma?: (prisma: PrismaClient) => PrismaClient;
  now?: () => Date;
}

/** One app, one Prisma client (pool of 10, like the API) and one raw pg client for seeding and counting. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const prisma = createPrismaClient(connectionString, { maxConnections: 10 });
  const pg = new Client(clientOptions);
  await pg.connect();

  const actorId = newId("sales_actor");
  const actor: Actor = { id: actorId, email: `${actorId}@example.test` };
  await pg.query(
    `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'not-a-real-hash', now())`,
    [actor.id, actor.email],
  );

  const txLog: Array<Record<string, unknown>> = [];
  const app = buildApp({
    prisma: options.wrapPrisma ? options.wrapPrisma(prisma) : prisma,
    resolveActor: createDevActorResolver(actor),
    now: options.now,
    onTransaction: (entry) => txLog.push(entry),
  });
  await app.ready();

  return {
    prisma,
    pg,
    actor,
    app,
    txLog,
    async close() {
      await app.close();
      await prisma.$disconnect();
      await pg.end();
    },
  };
}

export async function seedProduct(
  pg: Client,
  input: {
    name?: string;
    unitsPerPack?: number;
    stock?: number;
    location?: "WAREHOUSE" | "RETAIL_SHELF" | "MARKET";
    saleChannel?: "RETAIL" | "WHOLESALE" | "BOTH";
    averageCostKobo?: bigint;
    deactivated?: boolean;
  } = {},
): Promise<{ id: string; name: string }> {
  const id = newId("sales_product");
  const name = input.name ?? `Product ${id}`;
  await pg.query(
    `INSERT INTO products
       (id, name, category, "unitsPerPack", "saleChannel", "retailPriceKobo", "wholesalePriceKobo",
        "averageCostKobo", "deletedAt", "updatedAt")
     VALUES ($1, $2, 'OTHER', $3, $4::"SaleChannel", 10000, 9000, $5::bigint, $6, now())`,
    [
      id,
      name,
      input.unitsPerPack ?? 24,
      input.saleChannel ?? "BOTH",
      (input.averageCostKobo ?? 7000n).toString(),
      input.deactivated === true ? new Date() : null,
    ],
  );
  if ((input.stock ?? 0) > 0) {
    // A committed PURCHASE movement with a synthetic source: audit-clean seed stock.
    await pg.query(
      `INSERT INTO stock_movements (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
       VALUES ($1, $2, $3::"StockLocation", 'PURCHASE', $4, 0::bigint, $5)`,
      [newId("sales_seed_move"), id, input.location ?? "RETAIL_SHELF", input.stock, newId("sales_seed_src")],
    );
  }
  return { id, name };
}

export async function seedCustomer(
  pg: Client,
  input: { type?: "RETAIL" | "WHOLESALE"; deactivated?: boolean } = {},
): Promise<{ id: string; name: string }> {
  const id = newId("sales_customer");
  const name = `Customer ${id}`;
  await pg.query(
    `INSERT INTO customers (id, name, type, "deletedAt", "updatedAt") VALUES ($1, $2, $3::"CustomerType", $4, now())`,
    [id, name, input.type ?? "RETAIL", input.deactivated === true ? new Date() : null],
  );
  return { id, name };
}

export async function seedAccount(
  pg: Client,
  input: { type?: "CASH" | "BANK" | "POS" } = {},
): Promise<{ id: string; name: string }> {
  const id = newId("sales_account");
  const name = `Account ${id}`;
  await pg.query(
    `INSERT INTO accounts (id, name, type, "updatedAt") VALUES ($1, $2, $3::"AccountType", now())`,
    [id, name, input.type ?? "CASH"],
  );
  return { id, name };
}

export async function deactivateAccount(pg: Client, accountId: string): Promise<void> {
  await pg.query(`UPDATE accounts SET "isActive" = false, "deactivatedAt" = now() WHERE id = $1`, [accountId]);
}

export async function stockOf(pg: Client, productId: string, location = "RETAIL_SHELF"): Promise<number> {
  const { rows } = await pg.query(
    `SELECT COALESCE(sum("quantityUnits"), 0)::int AS n FROM stock_balances
      WHERE "productId" = $1 AND location = $2::"StockLocation"`,
    [productId, location],
  );
  return rows[0].n as number;
}

export async function accountBalanceOf(pg: Client, accountId: string): Promise<bigint> {
  const { rows } = await pg.query(
    `SELECT COALESCE(sum("amountKobo"), 0)::text AS n FROM account_ledger_entries WHERE "accountId" = $1`,
    [accountId],
  );
  return BigInt(rows[0].n as string);
}

export interface Scope {
  productIds: string[];
  customerId?: string;
  accountId?: string;
  /** Prefix of the client references / idempotency keys the test uses. */
  prefix: string;
}

/**
 * Row counts limited to what ONE test owns (its own products, customer, account
 * and reference prefix), so tests never depend on each other's committed rows.
 */
export async function snapshot(pg: Client, scope: Scope): Promise<Record<string, number>> {
  const count = async (sql: string, params: unknown[]): Promise<number> => {
    const { rows } = await pg.query(sql, params);
    return Number(rows[0].n);
  };
  const like = `${scope.prefix}%`;
  return {
    sales: await count(`SELECT count(*) AS n FROM sales WHERE reference LIKE $1`, [like]),
    saleLines: await count(`SELECT count(*) AS n FROM sale_lines WHERE "productId" = ANY($1::text[])`, [
      scope.productIds,
    ]),
    stockMovements: await count(
      `SELECT count(*) AS n FROM stock_movements WHERE "productId" = ANY($1::text[])`,
      [scope.productIds],
    ),
    stockUnits: await count(
      `SELECT COALESCE(sum("quantityUnits"), 0) AS n FROM stock_balances WHERE "productId" = ANY($1::text[])`,
      [scope.productIds],
    ),
    customerLedger: await count(
      `SELECT count(*) AS n FROM customer_ledger_entries WHERE "customerId" = $1`,
      [scope.customerId ?? ""],
    ),
    salePayments: await count(`SELECT count(*) AS n FROM sale_payments WHERE "accountId" = $1`, [
      scope.accountId ?? "",
    ]),
    accountEntries: await count(
      `SELECT count(*) AS n FROM account_ledger_entries WHERE "accountId" = $1`,
      [scope.accountId ?? ""],
    ),
    auditRows: await count(
      `SELECT count(*) AS n FROM audit_logs WHERE action = 'sale.create' AND "afterData"->'sale'->>'reference' LIKE $1`,
      [like],
    ),
    idempotencyKeys: await count(`SELECT count(*) AS n FROM idempotency_keys WHERE key LIKE $1`, [like]),
  };
}

export interface SaleBodyInput {
  productId: string;
  quantity?: number;
  unit?: "UNIT" | "PACK";
  unitPriceKobo?: string;
  paidKobo?: string;
  accountId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  channel?: "RETAIL" | "WHOLESALE";
  location?: "WAREHOUSE" | "RETAIL_SHELF" | "MARKET";
  reference?: string | null;
  soldAt?: string;
  lines?: Array<{ productId: string; unit?: "UNIT" | "PACK"; quantity: number; unitPriceKobo?: string }>;
}

export function saleBody(input: SaleBodyInput): Record<string, unknown> {
  const lines = input.lines ?? [
    { productId: input.productId, unit: input.unit, quantity: input.quantity ?? 1, unitPriceKobo: input.unitPriceKobo },
  ];
  return {
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    channel: input.channel ?? "RETAIL",
    location: input.location ?? "RETAIL_SHELF",
    soldAt: input.soldAt ?? new Date().toISOString(),
    notes: null,
    reference: input.reference ?? null,
    paidKobo: input.paidKobo ?? "0",
    accountId: input.accountId ?? null,
    lines: lines.map((line) => ({
      productId: line.productId,
      unit: line.unit ?? "UNIT",
      quantity: line.quantity,
      unitPriceKobo: line.unitPriceKobo ?? "10000",
    })),
  };
}

export async function postSale(
  app: FastifyInstance,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/sales",
    payload: body as object,
    headers: { "content-type": "application/json", ...headers },
  });
  return { status: response.statusCode, body: response.json() as Record<string, any>, headers: response.headers };
}
