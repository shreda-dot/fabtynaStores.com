import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createHarness,
  fundAccount,
  newId,
  postPurchase,
  purchaseBody,
  seedAccount,
  seedBlankProduct,
  seedSupplier,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe("GET /purchases and GET /purchases/:id", () => {
  it("filters, paginates without duplicates or gaps, and returns the detail shape", async () => {
    const prefix = newId("purch_list");
    const product = await seedBlankProduct(h.pg);
    const supplierA = await seedSupplier(h.pg);
    const supplierB = await seedSupplier(h.pg);
    const account = await seedAccount(h.pg);
    await fundAccount(h.pg, account.id, 100000n);
    const base = Date.now() - 6 * 3_600_000;

    const make = async (n: number, extra: Parameters<typeof purchaseBody>[0]) => {
      const res = await postPurchase(
        h.app,
        purchaseBody({
          productId: product.id,
          reference: `${prefix}-${n}`,
          purchasedAt: new Date(base + n * 3_600_000).toISOString(),
          ...extra,
        }),
      );
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const p0 = await make(0, { supplierId: supplierA.id, dueDate: "2020-01-01" }); // unpaid and overdue
    const p1 = await make(1, { supplierId: supplierA.id, dueDate: "2099-01-01" }); // unpaid, not overdue
    const p2 = await make(2, { supplierId: supplierB.id, amountPaidNowKobo: "10000", accountId: account.id }); // fully paid
    const p3 = await make(3, { supplierId: supplierB.id, amountPaidNowKobo: "4000", accountId: account.id }); // part paid
    const p4 = await make(4, { amountPaidNowKobo: "10000", accountId: account.id }); // supplier-less, paid
    const voided = await call(h.app, "POST", `/purchases/${p1}/void`);
    expect(voided.status).toBe(200);

    const list = async (query: string) => {
      const res = await call(h.app, "GET", `/purchases?q=${prefix}&${query}`);
      expect(res.status).toBe(200);
      return res.body as { items: Array<Record<string, any>>; nextCursor: string | null };
    };
    const ids = (page: { items: Array<Record<string, any>> }) => page.items.map((item) => item.id);

    expect(ids(await list(""))).toEqual([p4, p3, p2, p1, p0]);
    expect(ids(await list("unpaid=true"))).toEqual([p3, p0]);
    expect(ids(await list("overdue=true"))).toEqual([p0]);
    expect(ids(await list("status=VOIDED"))).toEqual([p1]);
    expect(ids(await list(`supplierId=${supplierB.id}`))).toEqual([p3, p2]);
    const nomatch = await call(h.app, "GET", `/purchases?q=${prefix}-nomatch`);
    expect(nomatch.body.items).toEqual([]);

    const full = await list("");
    expect(full.items.find((item) => item.id === p3)).toMatchObject({
      reference: `${prefix}-3`,
      supplierName: supplierB.name,
      status: "RECEIVED",
      lineCount: 1,
      totalKobo: "10000",
      paidKobo: "4000",
      balanceDueKobo: "6000",
      dueDate: null,
    });
    expect(full.items.find((item) => item.id === p1)!.balanceDueKobo).toBe("0");

    // Cursor pagination, two rows per page: every row exactly once, in order.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: Array<Record<string, any>>; nextCursor: string | null } = await list(
        `limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(seen).toEqual([p4, p3, p2, p1, p0]);
    expect(pages).toBe(3);

    const detail = await call(h.app, "GET", `/purchases/${p3}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: p3,
      reference: `${prefix}-3`,
      balanceDueKobo: "6000",
      supplier: { id: supplierB.id, name: supplierB.name },
    });
    expect(detail.body.lines).toHaveLength(1);
    expect(detail.body.lines[0]).toMatchObject({ productId: product.id, productName: product.name, lineTotalKobo: "10000" });
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.payments[0]).toMatchObject({ amountKobo: "4000", accountName: account.name, reversed: false });
    expect(detail.body.moneyEntries.supplierLedger.map((e: any) => e.type).sort()).toEqual(["PAYMENT", "PURCHASE"]);
    expect(detail.body.moneyEntries.account.map((e: any) => e.type)).toEqual(["SUPPLIER_PAYMENT"]);

    const missing = await call(h.app, "GET", `/purchases/${newId("nope")}`);
    expect(missing.status).toBe(404);
  }, 120_000);
});
