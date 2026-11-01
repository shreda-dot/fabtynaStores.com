import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { runDbAudit } from "../src/db/audit.js";
import {
  connectionString,
  createHarness,
  newId,
  seedProduct,
  type Harness,
} from "./sales-fixtures.js";

/**
 * Empties tracking: immutable count movements and mutable brewery ownership.
 *
 * `empties_balances` is DERIVED: the AFTER INSERT trigger on `empties_movements`
 * is its only writer, and `trg_empties_balances_guard` rejects anything else.
 * These tests therefore assert both sides: the HTTP response AND the raw row in
 * `empties_balances`, plus the guards that stop the ledger being rewritten.
 */

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

interface OwnerDto {
  id: string;
  name: string;
  isActive: boolean;
  typeCount: number;
  activeTypeCount: number;
}

interface TypeDto {
  id: string;
  ownerId: string;
  ownerName: string;
  kind: "BOTTLE" | "CRATE";
  label: string;
  unitValueKobo: string | null;
  isActive: boolean;
}

interface MovementDto {
  id: string;
  typeId: string;
  movementType: "OPENING" | "RECEIVED" | "RETURNED_TO_OWNER" | "ADJUSTMENT";
  quantity: number;
  note: string | null;
  occurredAt: string;
  reversesEntryId: string | null;
}

interface BalanceItem {
  typeId: string;
  ownerId: string;
  ownerName: string;
  kind: "BOTTLE" | "CRATE";
  label: string;
  unitValueKobo: string | null;
  quantity: number;
  valueKobo: string | null;
}

interface BalancesDto {
  items: BalanceItem[];
  totalsByOwner: Array<{ ownerId: string; ownerName: string; quantity: number; valueKobo: string }>;
  totalsByKind: Array<{ kind: "BOTTLE" | "CRATE"; quantity: number; valueKobo: string }>;
}

interface ProductOwnerDto {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
}

interface ProductOwnerPageDto {
  items: ProductOwnerDto[];
  nextCursor: string | null;
}

interface ProductOverviewDto {
  productId: string;
  productName: string;
  isActive: boolean;
  unitsPerPack: number;
  warehouseUnits: number;
  fullCrates: number;
  looseUnits: number;
  shelfUnits: number;
  marketUnits: number;
}

interface EmptiesOverviewDto {
  owners: Array<{
    ownerId: string;
    ownerName: string;
    emptyCrates: number;
    emptyBottles: number;
    fullCrates: number;
    looseUnitsInWarehouse: number;
    bottlesOnShelfAndMarket: number;
    totalCrates: number;
    emptyValueKobo: string | null;
    products: ProductOverviewDto[];
  }>;
  warnings: {
    productsWithoutBrewery: Array<{ productId: string; productName: string; totalUnits: number }>;
    assignedCans: Array<{ productId: string; productName: string; ownerId?: string }>;
    productsAssignedToInactiveOwner: Array<{ productId: string; productName: string; ownerId?: string }>;
  };
}

interface ApiError {
  error: { code: string; message: string; details: unknown };
}

/** Labels are capped at 40 characters by `ck_empties_types_label`. */
const uniqueLabel = (): string => newId("lbl").slice(0, 40);

async function createOwner(name = `Owner ${newId("empties")}`): Promise<OwnerDto> {
  const response = await h.app.inject({
    method: "POST",
    url: "/empties/owners",
    payload: { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<OwnerDto>();
}

async function createType(input: {
  ownerId: string;
  kind?: "BOTTLE" | "CRATE";
  label?: string;
  unitValueKobo?: string | null;
}): Promise<TypeDto> {
  const response = await h.app.inject({
    method: "POST",
    url: "/empties/types",
    payload: {
      ownerId: input.ownerId,
      kind: input.kind ?? "BOTTLE",
      label: input.label ?? uniqueLabel(),
      ...(input.unitValueKobo === undefined ? {} : { unitValueKobo: input.unitValueKobo }),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<TypeDto>();
}

function record(
  typeId: string,
  movementType: MovementDto["movementType"],
  quantity: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: "POST",
    url: "/empties/movements",
    payload: { typeId, movementType, quantity, ...extra },
    headers,
  });
}

async function balanceOf(typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ n: number }>(
    `SELECT COALESCE(quantity, 0)::int AS n FROM empties_balances WHERE "typeId" = $1`,
    [typeId],
  );
  return rows[0]?.n ?? 0;
}

async function movementCountOf(typeId: string): Promise<number> {
  const { rows } = await h.pg.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM empties_movements WHERE "typeId" = $1`,
    [typeId],
  );
  return Number(rows[0]!.n);
}

async function addStockUnits(
  productId: string,
  location: "WAREHOUSE" | "RETAIL_SHELF" | "MARKET",
  quantityUnits: number,
): Promise<void> {
  await h.pg.query(
    `INSERT INTO stock_movements
       (id, "productId", location, type, "quantityUnits", "unitCostKobo", "returnLineId")
     VALUES ($1, $2, $3::"StockLocation", 'PURCHASE', $4, 0::bigint, $5)`,
    [newId("empties_stock"), productId, location, quantityUnits, newId("empties_stock_source")],
  );
}

async function setProductOwner(productId: string, ownerId: string | null, key?: string) {
  return h.app.inject({
    method: "PUT",
    url: `/empties/product-owners/${productId}`,
    payload: { ownerId },
    headers: key === undefined ? {} : { "idempotency-key": key },
  });
}

describe("empties movements update the derived balance", () => {
  it("records every movement type with the right sign and keeps the balance in step", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, kind: "BOTTLE", unitValueKobo: "100" });

    const opening = await record(type.id, "OPENING", 12);
    expect(opening.statusCode, opening.body).toBe(201);
    expect(opening.json<MovementDto>().quantity).toBe(12);
    expect(await balanceOf(type.id)).toBe(12);
    console.log("STATEMENTS POST /empties/movements:", h.txLog.at(-1)?.queries);

    const received = await record(type.id, "RECEIVED", 5);
    expect(received.statusCode, received.body).toBe(201);
    expect(received.json<MovementDto>().quantity).toBe(5);
    expect(await balanceOf(type.id)).toBe(17);

    // The server owns the direction for a return: the body is a positive count.
    const returned = await record(type.id, "RETURNED_TO_OWNER", 7);
    expect(returned.statusCode, returned.body).toBe(201);
    expect(returned.json<MovementDto>().quantity).toBe(-7);
    expect(await balanceOf(type.id)).toBe(10);

    const adjustedUp = await record(type.id, "ADJUSTMENT", 3, { note: "Found three extra crates" });
    expect(adjustedUp.statusCode, adjustedUp.body).toBe(201);
    expect(adjustedUp.json<MovementDto>().quantity).toBe(3);
    expect(await balanceOf(type.id)).toBe(13);

    // An ADJUSTMENT carries its own sign.
    const adjustedDown = await record(type.id, "ADJUSTMENT", -1, { note: "One crate was broken" });
    expect(adjustedDown.statusCode, adjustedDown.body).toBe(201);
    expect(adjustedDown.json<MovementDto>().quantity).toBe(-1);
    expect(await balanceOf(type.id)).toBe(12);

    const balances = await h.app.inject({ method: "GET", url: "/empties/balances" });
    expect(balances.statusCode, balances.body).toBe(200);
    const item = balances.json<BalancesDto>().items.find((entry) => entry.typeId === type.id);
    expect(item).toMatchObject({ quantity: 12, unitValueKobo: "100", valueKobo: "1200" });

    const today = getLagosBusinessDate(new Date());
    const movements = await h.app.inject({
      method: "GET",
      url: `/empties/movements?typeId=${type.id}&from=${today}&to=${today}`,
    });
    expect(movements.statusCode, movements.body).toBe(200);
    const page = movements.json<{ items: MovementDto[]; nextCursor: string | null }>();
    expect(page.items).toHaveLength(5);
    expect(page.items.map((movement) => movement.movementType).sort()).toEqual(
      ["ADJUSTMENT", "ADJUSTMENT", "OPENING", "RECEIVED", "RETURNED_TO_OWNER"].sort(),
    );
    expect(page.nextCursor).toBeNull();
  }, 120_000);
});

describe("empties guards", () => {
  it("refuses a return of more empties than are on hand with a friendly 409", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const opening = await record(type.id, "OPENING", 3);
    expect(opening.statusCode, opening.body).toBe(201);
    const before = await movementCountOf(type.id);

    const response = await record(type.id, "RETURNED_TO_OWNER", 4);
    expect(response.statusCode, response.body).toBe(409);
    const body = response.json<ApiError>();
    expect(body.error.code).toBe("BUSINESS_RULE");
    expect(body.error.message).toContain("Only 3");
    expect(body.error.message).toContain(type.label);
    expect(body.error.message).toContain(owner.name);
    expect(await balanceOf(type.id)).toBe(3);
    expect(await movementCountOf(type.id)).toBe(before);

    // A negative adjustment is the other way to push a balance below zero.
    const adjustment = await record(type.id, "ADJUSTMENT", -5, { note: "Write off five" });
    expect(adjustment.statusCode, adjustment.body).toBe(409);
    expect(adjustment.json<ApiError>().error.message).toContain("Only 3");
    expect(await balanceOf(type.id)).toBe(3);
  }, 120_000);

  it("lets exactly one of two simultaneous returns of the last units through (5 iterations)", async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const owner = await createOwner();
      const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
      const opening = await record(type.id, "OPENING", 5);
      expect(opening.statusCode, opening.body).toBe(201);

      const responses = await Promise.all([0, 1].map(() => record(type.id, "RETURNED_TO_OWNER", 5)));
      const statuses = responses.map((response) => response.statusCode);
      expect(statuses.filter((status) => status === 201), JSON.stringify(statuses)).toHaveLength(1);
      // The loser may be the friendly 409 ("Only N ... on hand") or, if it
      // waited past `lockTimeoutMs`, the 503 the write runner returns for a
      // lost lock race. `accounts-gate.test.ts` asserts only that exactly one
      // succeeded, so the loser's status is deliberately not pinned.
      expect(statuses.filter((status) => status !== 201), JSON.stringify(statuses)).toHaveLength(1);
      expect(await balanceOf(type.id)).toBe(0);
    }
  }, 180_000);

  it("refuses direct UPDATE and DELETE on the append-only tables", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const movement = await record(type.id, "OPENING", 2);
    expect(movement.statusCode, movement.body).toBe(201);

    await expect(
      h.pg.query(`UPDATE empties_movements SET quantity = 99 WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`DELETE FROM empties_movements WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`UPDATE empties_balances SET quantity = 99 WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      h.pg.query(`DELETE FROM empties_balances WHERE "typeId" = $1`, [type.id]),
    ).rejects.toMatchObject({ code: "P0001" });

    expect(await balanceOf(type.id)).toBe(2);
    expect(await movementCountOf(type.id)).toBe(1);
  });
});

describe("empties reversals", () => {
  it("replays an idempotent movement without recording it twice", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const key = newId("empties-idem");

    const first = await record(type.id, "OPENING", 6, {}, { "idempotency-key": key });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const firstId = first.json<MovementDto>().id;

    const replay = await record(type.id, "OPENING", 6, {}, { "idempotency-key": key });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json<MovementDto>().id).toBe(firstId);

    expect(await movementCountOf(type.id)).toBe(1);
    expect(await balanceOf(type.id)).toBe(6);
  }, 120_000);

  it("restores the balance, refuses a second reversal, and refuses a second opening", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    const opening = await record(type.id, "OPENING", 10);
    expect(opening.statusCode, opening.body).toBe(201);
    const openingDto = opening.json<MovementDto>();
    expect(await balanceOf(type.id)).toBe(10);

    const reversal = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${openingDto.id}/reverse`,
      payload: { reason: "Counted the wrong type" },
    });
    expect(reversal.statusCode, reversal.body).toBe(201);
    const reversalDto = reversal.json<MovementDto>();
    expect(reversalDto.reversesEntryId).toBe(openingDto.id);
    expect(reversalDto.movementType).toBe("OPENING");
    expect(reversalDto.quantity).toBe(-10);
    expect(await balanceOf(type.id)).toBe(0);
    console.log("STATEMENTS POST /empties/movements/:id/reverse:", h.txLog.at(-1)?.queries);

    const again = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${openingDto.id}/reverse`,
      payload: { reason: "Duplicate reversal attempt" },
    });
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json<ApiError>().error.message).toContain("already been reversed");

    const reverseTheReversal = await h.app.inject({
      method: "POST",
      url: `/empties/movements/${reversalDto.id}/reverse`,
      payload: { reason: "Try to undo the undo" },
    });
    expect(reverseTheReversal.statusCode, reverseTheReversal.body).toBe(409);
    expect(reverseTheReversal.json<ApiError>().error.message).toContain("cannot itself be reversed");

    // The opening row is immutable, so it keeps `reversesEntryId IS NULL`
    // forever and never leaves `ux_empties_movement_opening_active`. A second
    // OPENING is therefore refused for the life of the type — the same rule
    // the accounts ledger enforces (`ux_account_ledger_opening_balance_active`:
    // "Later corrections go through a reconcile ADJUSTMENT, never a second
    // opening balance"). Corrections after a reversal go through an ADJUSTMENT.
    const secondOpening = await record(type.id, "OPENING", 4);
    expect(secondOpening.statusCode, secondOpening.body).toBe(409);
    expect(secondOpening.json<ApiError>().error.details).toMatchObject({
      constraint: "ux_empties_movement_opening_active",
    });
    expect(await balanceOf(type.id)).toBe(0);

    const correction = await record(type.id, "ADJUSTMENT", 4, { note: "Recounted: four on hand" });
    expect(correction.statusCode, correction.body).toBe(201);
    expect(await balanceOf(type.id)).toBe(4);
  }, 180_000);
});

describe("empties owner and type management", () => {
  it("renames, deactivates and reactivates owners and types", async () => {
    const owner = await createOwner();
    console.log("STATEMENTS POST /empties/owners:", h.txLog.at(-1)?.queries);

    const renamed = await h.app.inject({
      method: "PATCH",
      url: `/empties/owners/${owner.id}`,
      payload: { name: `Renamed ${newId("owner")}`.slice(0, 60) },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    console.log("STATEMENTS PATCH /empties/owners/:id:", h.txLog.at(-1)?.queries);

    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    console.log("STATEMENTS POST /empties/types:", h.txLog.at(-1)?.queries);

    const patched = await h.app.inject({
      method: "PATCH",
      url: `/empties/types/${type.id}`,
      payload: { label: uniqueLabel(), unitValueKobo: "250" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<TypeDto>().unitValueKobo).toBe("250");
    console.log("STATEMENTS PATCH /empties/types/:id:", h.txLog.at(-1)?.queries);

    // An owner with live types cannot be deactivated, so the type goes first.
    const typeOff = await h.app.inject({
      method: "POST",
      url: `/empties/types/${type.id}/deactivate`,
    });
    expect(typeOff.statusCode, typeOff.body).toBe(200);
    console.log("STATEMENTS POST /empties/types/:id/deactivate:", h.txLog.at(-1)?.queries);

    const typeOn = await h.app.inject({
      method: "POST",
      url: `/empties/types/${type.id}/reactivate`,
    });
    expect(typeOn.statusCode, typeOn.body).toBe(200);
    console.log("STATEMENTS POST /empties/types/:id/reactivate:", h.txLog.at(-1)?.queries);

    // Reactivating the type again blocks the owner, so deactivate it once more.
    await h.app.inject({ method: "POST", url: `/empties/types/${type.id}/deactivate` });
    const ownerOff = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(ownerOff.statusCode, ownerOff.body).toBe(200);
    expect(ownerOff.json<OwnerDto>().isActive).toBe(false);
    console.log("STATEMENTS POST /empties/owners/:id/deactivate:", h.txLog.at(-1)?.queries);

    const ownerOn = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/reactivate`,
    });
    expect(ownerOn.statusCode, ownerOn.body).toBe(200);
    expect(ownerOn.json<OwnerDto>().isActive).toBe(true);
    console.log("STATEMENTS POST /empties/owners/:id/reactivate:", h.txLog.at(-1)?.queries);
  }, 180_000);

  it("refuses to deactivate an owner that still has an active type", async () => {
    const owner = await createOwner();
    const type = await createType({ ownerId: owner.id, label: uniqueLabel() });
    expect(type.isActive).toBe(true);

    const response = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<ApiError>().error.message).toContain("active empties type");
    expect((await h.app.inject({ method: "GET", url: "/empties/owners" })).json<OwnerDto[]>().map((o) => o.id)).toContain(owner.id);
  }, 120_000);
});

describe("empties brewery product ownership", () => {
  it("registers the three routes and requires an authenticated actor", async () => {
    const expected = [
      { method: "GET", url: "/empties/overview" },
      { method: "GET", url: "/empties/product-owners" },
      { method: "PUT", url: "/empties/product-owners/:productId" },
    ];
    for (const route of expected) {
      expect(
        h.routes.some((registered) =>
          (Array.isArray(registered.method)
            ? registered.method.includes(route.method)
            : registered.method === route.method) && registered.url === route.url,
        ),
        `${route.method} ${route.url} is registered`,
      ).toBe(true);
    }

    const requests = await Promise.all([
      h.injectAnonymous({ method: "GET", url: "/empties/overview" }),
      h.injectAnonymous({ method: "GET", url: "/empties/product-owners" }),
      h.injectAnonymous({
        method: "PUT",
        url: "/empties/product-owners/nonexistent-product",
        headers: { origin: "http://localhost:3000" },
        payload: { ownerId: null },
      }),
    ]);
    expect(requests.map((response) => response.statusCode)).toEqual([401, 401, 401]);
  });

  it("calculates warehouse crates, loose units, separate shelf stock, warnings, and inactive stock", async () => {
    const brewery = await createOwner();
    const secondBrewery = await createOwner();
    const crateType = await createType({
      ownerId: brewery.id,
      kind: "CRATE",
      unitValueKobo: "5000",
    });
    const bottleType = await createType({ ownerId: brewery.id, kind: "BOTTLE" });
    expect((await record(crateType.id, "OPENING", 10)).statusCode).toBe(201);
    expect((await record(bottleType.id, "OPENING", 3)).statusCode).toBe(201);

    const returnable = await seedProduct(h.pg, {
      name: `ZZTEST returnable ${newId("beer")}`,
      unitsPerPack: 24,
      stock: 100,
      location: "WAREHOUSE",
    });
    await addStockUnits(returnable.id, "RETAIL_SHELF", 30);
    await addStockUnits(returnable.id, "MARKET", 5);
    expect((await setProductOwner(returnable.id, brewery.id)).statusCode).toBe(200);

    const unassigned = await seedProduct(h.pg, {
      name: `ZZTEST unassigned ${newId("beer")}`,
      stock: 3,
      location: "MARKET",
    });
    const cans = await seedProduct(h.pg, {
      name: `ZZTEST cans ${newId("beer")}`,
      unitsPerPack: 1,
      stock: 12,
      location: "WAREHOUSE",
    });
    expect((await setProductOwner(cans.id, brewery.id)).statusCode).toBe(200);

    const inactiveProduct = await seedProduct(h.pg, {
      name: `ZZTEST inactive ${newId("beer")}`,
      unitsPerPack: 12,
      stock: 24,
      location: "WAREHOUSE",
      deactivated: true,
    });
    expect((await setProductOwner(inactiveProduct.id, secondBrewery.id)).statusCode).toBe(200);

    const response = await h.app.inject({ method: "GET", url: "/empties/overview" });
    expect(response.statusCode, response.body).toBe(200);
    const overview = response.json<EmptiesOverviewDto>();
    const first = overview.owners.find((owner) => owner.ownerId === brewery.id)!;
    const second = overview.owners.find((owner) => owner.ownerId === secondBrewery.id)!;

    // Hand check: 100 / 24 = 4 crates with 4 loose warehouse units.
    // The 30 shelf and 5 MARKET units are bottles, not crates; 10 empties + 4 full = 14.
    expect(first).toMatchObject({
      emptyCrates: 10,
      emptyBottles: 3,
      fullCrates: 4,
      totalCrates: 14,
      bottlesOnShelfAndMarket: 35,
      emptyValueKobo: "50000",
    });
    expect(
      first.products.find((product) => product.productId === returnable.id),
    ).toMatchObject({
      warehouseUnits: 100,
      fullCrates: 4,
      looseUnits: 4,
      shelfUnits: 30,
      marketUnits: 5,
    });
    expect(first.products.find((product) => product.productId === cans.id)).toMatchObject({
      fullCrates: 0,
      looseUnits: 12,
    });
    expect(second).toMatchObject({ fullCrates: 2, totalCrates: 2 });
    expect(
      second.products.find((product) => product.productId === inactiveProduct.id),
    ).toMatchObject({ isActive: false, fullCrates: 2 });
    expect(overview.warnings.productsWithoutBrewery).toContainEqual(
      expect.objectContaining({ productId: unassigned.id, productName: unassigned.name, totalUnits: 3 }),
    );
    expect(overview.warnings.assignedCans).toContainEqual(
      expect.objectContaining({ productId: cans.id, productName: cans.name, ownerId: brewery.id }),
    );
  }, 180_000);

  it("filters and paginates active products with a stable cursor", async () => {
    const owner = await createOwner();
    const prefix = `ZZTEST owner page ${newId("products")}`;
    const firstProduct = await seedProduct(h.pg, { name: `${prefix} A` });
    const secondProduct = await seedProduct(h.pg, { name: `${prefix} B` });
    const inactiveProduct = await seedProduct(h.pg, { name: `${prefix} inactive`, deactivated: true });
    expect((await setProductOwner(firstProduct.id, owner.id)).statusCode).toBe(200);

    const firstPageResponse = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&limit=1`,
    });
    expect(firstPageResponse.statusCode, firstPageResponse.body).toBe(200);
    const firstPage = firstPageResponse.json<ProductOwnerPageDto>();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPageResponse = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = secondPageResponse.json<ProductOwnerPageDto>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.productId).not.toBe(firstPage.items[0]?.productId);

    const assigned = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&assigned=assigned`,
    });
    expect(assigned.json<ProductOwnerPageDto>().items.map((item) => item.productId)).toEqual([
      firstProduct.id,
    ]);
    const unassigned = await h.app.inject({
      method: "GET",
      url: `/empties/product-owners?q=${encodeURIComponent(prefix)}&assigned=unassigned`,
    });
    expect(unassigned.json<ProductOwnerPageDto>().items.map((item) => item.productId).sort()).toEqual(
      [secondProduct.id].sort(),
    );
    expect(
      [...firstPage.items, ...secondPage.items].some((item) => item.productId === inactiveProduct.id),
    ).toBe(false);
  }, 120_000);

  it("assigns, reassigns, unassigns idempotently and audit-logs only actual changes", async () => {
    const firstOwner = await createOwner();
    const secondOwner = await createOwner();
    const product = await seedProduct(h.pg, { name: `ZZTEST assignment ${newId("beer")}` });
    const key = newId("empties-owner-key");

    const first = await setProductOwner(product.id, firstOwner.id, key);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<ProductOwnerDto>()).toMatchObject({
      productId: product.id,
      ownerId: firstOwner.id,
    });
    expect(h.txLog.at(-1)?.queries).toBe(9);

    const replay = await setProductOwner(product.id, firstOwner.id, key);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");

    const sameOwner = await setProductOwner(product.id, firstOwner.id);
    expect(sameOwner.statusCode, sameOwner.body).toBe(200);

    const reassigned = await setProductOwner(product.id, secondOwner.id);
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json<ProductOwnerDto>().ownerId).toBe(secondOwner.id);

    const unassigned = await setProductOwner(product.id, null);
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    expect(unassigned.json<ProductOwnerDto>()).toMatchObject({
      productId: product.id,
      ownerId: null,
      ownerName: null,
    });

    const auditRows = await h.pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
        WHERE action = 'EMPTIES_PRODUCT_OWNER_CHANGED' AND "entityId" = $1`,
      [product.id],
    );
    expect(auditRows.rows[0]?.count).toBe("3");
  }, 120_000);

  it("refuses inactive or missing owners and warns when an assigned brewery is deactivated", async () => {
    const owner = await createOwner();
    const product = await seedProduct(h.pg, {
      name: `ZZTEST inactive owner ${newId("beer")}`,
      unitsPerPack: 24,
      stock: 50,
      location: "WAREHOUSE",
    });
    expect((await setProductOwner(product.id, newId("missing_owner"))).statusCode).toBe(404);
    expect((await setProductOwner(product.id, owner.id)).statusCode).toBe(200);

    const deactivated = await h.app.inject({
      method: "POST",
      url: `/empties/owners/${owner.id}/deactivate`,
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    const overview = await h.app.inject({ method: "GET", url: "/empties/overview" });
    const body = overview.json<EmptiesOverviewDto>();
    expect(body.owners.some((item) => item.ownerId === owner.id)).toBe(false);
    expect(body.warnings.productsAssignedToInactiveOwner).toContainEqual(
      expect.objectContaining({ productId: product.id, productName: product.name, ownerId: owner.id }),
    );
  }, 120_000);
});

describe("empties db:audit", () => {
  it("leaves every fatal audit check with zero offending rows", async () => {
    const audit = await runDbAudit(connectionString);
    const failing = audit.checks.filter(
      (check) => check.error !== undefined || (check.severity === "fatal" && check.rowCount > 0),
    );
    expect(
      failing,
      JSON.stringify(
        failing.map((check) => `${check.name}: ${check.rowCount} (${check.error ?? "rows"})`),
        null,
        2,
      ),
    ).toEqual([]);
    expect(audit.ok).toBe(true);
  });
});
