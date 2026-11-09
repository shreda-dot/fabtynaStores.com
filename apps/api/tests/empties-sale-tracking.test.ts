import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  newId,
  postSale,
  saleBody,
  seedCustomer,
  seedProduct,
  stockOf,
  type Harness,
} from "./sales-fixtures.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

async function setup(unitsPerPack = 12) {
  const product = await seedProduct(h.pg, {
    stock: 20 * unitsPerPack,
    unitsPerPack,
    location: "WAREHOUSE",
    saleChannel: "WHOLESALE",
  });
  const customer = await seedCustomer(h.pg, { type: "WHOLESALE" });
  const ownerResponse = await h.app.inject({
    method: "POST",
    url: "/empties/owners",
    payload: { name: `Brewery ${newId("tracking")}`.slice(0, 60) },
  });
  expect(ownerResponse.statusCode, ownerResponse.body).toBe(201);
  const owner = ownerResponse.json<{ id: string }>();
  const createType = async (kind: "CRATE" | "BOTTLE") => {
    const response = await h.app.inject({
      method: "POST",
      url: "/empties/types",
      payload: { ownerId: owner.id, kind, label: `${kind} ${newId("type")}`.slice(0, 40) },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>();
  };
  const crate = await createType("CRATE");
  const bottle = await createType("BOTTLE");
  const assignment = await h.app.inject({
    method: "PUT",
    url: `/empties/product-owners/${product.id}`,
    payload: { ownerId: owner.id },
  });
  expect(assignment.statusCode, assignment.body).toBe(200);
  const packaging = await h.app.inject({
    method: "PUT",
    url: `/empties/products/${product.id}/packaging`,
    payload: {
      mappings: [
        { typeId: crate.id, kind: "CRATE", retailQuantityPerUnit: 0, wholesaleQuantityPerPack: 1 },
        { typeId: bottle.id, kind: "BOTTLE", retailQuantityPerUnit: 1, wholesaleQuantityPerPack: unitsPerPack },
      ],
    },
  });
  expect(packaging.statusCode, packaging.body).toBe(200);
  const opening = await h.app.inject({
    method: "POST",
    url: "/empties/movements",
    payload: { typeId: crate.id, movementType: "OPENING", quantity: 20 },
  });
  expect(opening.statusCode, opening.body).toBe(201);
  return { product, customer, owner, crate, bottle };
}

async function onHand(typeId: string): Promise<number> {
  const result = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_balances WHERE "typeId" = $1`,
    [typeId],
  );
  return result.rows[0]?.quantity ?? 0;
}

async function owed(customerId: string, typeId: string): Promise<number> {
  const result = await h.pg.query<{ quantity: number }>(
    `SELECT quantity FROM empties_customer_balances WHERE "customerId" = $1 AND "typeId" = $2`,
    [customerId, typeId],
  );
  return result.rows[0]?.quantity ?? 0;
}

describe("silent sale-linked empties", () => {
  describe("20 full and 20 empty crates", () => {
    let fixture: Awaited<ReturnType<typeof setup>>;

    beforeAll(async () => {
      fixture = await setup();
    });

    it("moves 20 full + 20 empty crates to 18 full + 22 empty, then void reverses both", async () => {
      const { product, customer, owner, crate, bottle } = fixture;
      const sale = await postSale(
        h.app,
        saleBody({
          productId: product.id,
          customerId: customer.id,
          channel: "WHOLESALE",
          location: "WAREHOUSE",
          unit: "PACK",
          quantity: 2,
        }),
      );
      expect(sale.status, JSON.stringify(sale.body)).toBe(201);
      expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(216);
      expect(await onHand(crate.id)).toBe(22);
      expect(await onHand(bottle.id)).toBe(24);
      expect(await owed(customer.id, crate.id)).toBe(0);
      const overview = await h.app.inject({ method: "GET", url: "/empties/overview" });
      const summary = overview.json<{ owners: Array<{ ownerId: string; fullCrates: number; emptyCrates: number; totalCrates: number }> }>()
        .owners.find((row) => row.ownerId === owner.id);
      expect(summary).toMatchObject({ fullCrates: 18, emptyCrates: 22, totalCrates: 40 });

      const voided = await h.app.inject({ method: "POST", url: `/sales/${sale.body.id}/void` });
      expect(voided.statusCode, voided.body).toBe(200);
      expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(240);
      expect(await onHand(crate.id)).toBe(20);
      expect(await onHand(bottle.id)).toBe(0);
    });
  });

  it("takes crates without a deposit and reverses the customer and on-hand movements together", async () => {
    const { customer, crate } = await setup();
    const taken = await h.app.inject({
      method: "POST",
      url: "/empties/customer-movements",
      payload: { customerId: customer.id, typeId: crate.id, movementType: "TAKEN", quantity: 2 },
    });
    expect(taken.statusCode, taken.body).toBe(201);
    const movement = taken.json<{ id: string; emptiesMovementId: string }>();
    expect(await onHand(crate.id)).toBe(18);
    expect(await owed(customer.id, crate.id)).toBe(2);
    const direct = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${movement.emptiesMovementId}/reverse`,
      payload: { reason: "Wrong action" },
    });
    expect(direct.statusCode).toBe(409);
    const reversed = await h.app.inject({
      method: "POST",
      url: `/empties/customer-movements/${movement.id}/reverse`,
      payload: { reason: "Entered in error" },
    });
    expect(reversed.statusCode, reversed.body).toBe(201);
    expect(await onHand(crate.id)).toBe(20);
    expect(await owed(customer.id, crate.id)).toBe(0);
  });

  it("counts partial packs as bottles and counts only whole crates per sale", async () => {
    const { product, customer, crate, bottle } = await setup();
    for (const [quantity, expectedBottles, expectedCrates] of [
      [0.5, 6, 20],
      [0.25, 9, 20],
      [1.5, 27, 21],
    ]) {
      const sale = await postSale(
        h.app,
        saleBody({
          productId: product.id,
          customerId: customer.id,
          channel: "WHOLESALE",
          location: "WAREHOUSE",
          unit: "PACK",
          quantity,
        }),
      );
      expect(sale.status, JSON.stringify(sale.body)).toBe(201);
      expect(await onHand(bottle.id)).toBe(expectedBottles);
      expect(await onHand(crate.id)).toBe(expectedCrates);
    }
  });

  it("uses the actual pack size for half and quarter sales", async () => {
    const { product, customer, crate, bottle } = await setup(24);
    for (const [quantity, expectedBottles] of [[0.5, 12], [0.25, 18]]) {
      const sale = await postSale(
        h.app,
        saleBody({
          productId: product.id,
          customerId: customer.id,
          channel: "WHOLESALE",
          location: "WAREHOUSE",
          unit: "PACK",
          quantity,
        }),
      );
      expect(sale.status, JSON.stringify(sale.body)).toBe(201);
      expect(await onHand(bottle.id)).toBe(expectedBottles);
      expect(await onHand(crate.id)).toBe(20);
    }
  });

  it("refuses a customer take that exceeds on-hand stock without changing either balance", async () => {
    const { customer, crate } = await setup();
    const taken = await h.app.inject({
      method: "POST",
      url: "/empties/customer-movements",
      payload: { customerId: customer.id, typeId: crate.id, movementType: "TAKEN", quantity: 21 },
    });
    expect(taken.statusCode).toBe(409);
    expect(await onHand(crate.id)).toBe(20);
    expect(await owed(customer.id, crate.id)).toBe(0);
  });

  it("refuses to void a sale if its assumed returned crates have left the shop", async () => {
    const { product, customer, crate } = await setup();
    const sale = await postSale(
      h.app,
      saleBody({
        productId: product.id,
        customerId: customer.id,
        channel: "WHOLESALE",
        location: "WAREHOUSE",
        unit: "PACK",
        quantity: 2,
      }),
    );
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const taken = await h.app.inject({
      method: "POST",
      url: "/empties/customer-movements",
      payload: { customerId: customer.id, typeId: crate.id, movementType: "TAKEN", quantity: 21 },
    });
    expect(taken.statusCode, taken.body).toBe(201);
    const voided = await h.app.inject({ method: "POST", url: `/sales/${sale.body.id}/void` });
    expect(voided.statusCode).toBe(409);
    expect(await stockOf(h.pg, product.id, "WAREHOUSE")).toBe(216);
    expect(await onHand(crate.id)).toBe(1);
    expect(await owed(customer.id, crate.id)).toBe(21);
  });

  it("requires a real on-hand issue for a new raw customer TAKE", async () => {
    const { customer, crate } = await setup();
    await expect(h.pg.query(
      `INSERT INTO empties_customer_movements
         (id, "customerId", "typeId", "movementType", quantity, "createdById")
       VALUES ($1, $2, $3, 'TAKEN', 1, $4)`,
      [newId("unlinked_take"), customer.id, crate.id, h.actor.id],
    )).rejects.toThrow("must link to an on-hand issue");
    expect(await onHand(crate.id)).toBe(20);
    expect(await owed(customer.id, crate.id)).toBe(0);
  });

  it("serializes simultaneous customer takes against the same on-hand crates", async () => {
    const { customer, crate } = await setup();
    const take = () => h.app.inject({
      method: "POST",
      url: "/empties/customer-movements",
      payload: { customerId: customer.id, typeId: crate.id, movementType: "TAKEN", quantity: 12 },
    });
    const responses = await Promise.all([take(), take()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await onHand(crate.id)).toBe(8);
    expect(await owed(customer.id, crate.id)).toBe(12);
  });
});
