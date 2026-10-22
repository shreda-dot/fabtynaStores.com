import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  accountBalanceOf,
  createHarness,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedProduct,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;
let failNextWrite: Error | null = null;

/**
 * A real Prisma client whose transaction fails ONCE with a connection error
 * just before the account entry is written, i.e. after the idempotency key,
 * sale, lines, stock movements and payment rows were written inside the open
 * transaction. The database rolls all of it back for real.
 */
function wrapPrisma(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === "$transaction") {
        return (fn: (tx: any) => Promise<unknown>, options: unknown) =>
          (target as any).$transaction(
            (tx: any) =>
              fn(
                new Proxy(tx, {
                  get(txTarget, txProp) {
                    if (txProp === "accountLedgerEntry") {
                      return {
                        createMany: async (args: unknown) => {
                          if (failNextWrite !== null) {
                            const error = failNextWrite;
                            failNextWrite = null;
                            throw error;
                          }
                          return txTarget.accountLedgerEntry.createMany(args);
                        },
                      };
                    }
                    return Reflect.get(txTarget, txProp);
                  },
                }),
              ),
            options,
          );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

beforeAll(async () => {
  h = await createHarness({ wrapPrisma });
});

afterAll(async () => {
  await h.close();
});

describe("connection errors on a write", () => {
  it("returns 503 UNAVAILABLE with Retry-After, rolls back everything, and the retry with the same key succeeds once", async () => {
    const product = await seedProduct(h.pg, { stock: 10, averageCostKobo: 7000n });
    const account = await seedAccount(h.pg);
    const key = newId("conn-retry");
    const body = saleBody({ productId: product.id, quantity: 2, paidKobo: "20000", accountId: account.id });

    // 1. the connection dies mid-transaction
    failNextWrite = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const first = await postSale(h.app, body, { "idempotency-key": key });
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe("UNAVAILABLE");
    expect(first.headers["retry-after"]).toBe("2");

    // 2. nothing survived: no key, no stock change, no money
    const keyRows = await h.pg.query(`SELECT 1 FROM idempotency_keys WHERE key = $1`, [key]);
    expect(keyRows.rows).toHaveLength(0);
    expect(await stockOf(h.pg, product.id)).toBe(10);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(0n);

    // 3. the retry with the SAME key and body is a normal first request: 201
    const retry = await postSale(h.app, body, { "idempotency-key": key });
    expect(retry.status).toBe(201);
    expect(await stockOf(h.pg, product.id)).toBe(8);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(20000n);

    // 4. a third attempt replays the stored response and changes nothing
    const replay = await postSale(h.app, body, { "idempotency-key": key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(retry.body.id);
    expect(replay.headers["idempotent-replayed"]).toBeDefined();
    expect(await stockOf(h.pg, product.id)).toBe(8);

    const sales = await h.pg.query(`SELECT 1 FROM idempotency_keys WHERE key = $1`, [key]);
    expect(sales.rows).toHaveLength(1);
  });
});
