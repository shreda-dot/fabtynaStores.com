import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { buildApp } from "../src/app.js";
import { hashSessionToken, SESSION_COOKIE_BASE_NAME } from "../src/auth/session.js";
import type { Actor } from "../src/auth/actor.js";
import { createPrismaClient } from "../src/lib/prisma.js";

const expectedDatabase = "fabtyna_prod";
const ownerSizes = new Map([
  ["Guinness Nigeria", [12, 24]],
  ["International Breweries", [12, 20]],
  ["Nigerian Breweries", [12, 20, 24]],
]);
const openingCounts = new Map([
  ["Guinness Nigeria:12", { emptyCrates: 1, looseBottles: 4 }],
  ["Guinness Nigeria:24", { emptyCrates: 2, looseBottles: 5 }],
  ["International Breweries:12", { emptyCrates: 5, looseBottles: 3 }],
  ["International Breweries:20", { emptyCrates: 2, looseBottles: 4 }],
  ["Nigerian Breweries:12", { emptyCrates: 4, looseBottles: 6 }],
  ["Nigerian Breweries:20", { emptyCrates: 3, looseBottles: 7 }],
  ["Nigerian Breweries:24", { emptyCrates: 1, looseBottles: 11 }],
]);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
}

function hostOf(value: string): string {
  return new URL(value).hostname.toLowerCase();
}

function databaseOf(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
}

function directUrlOf(poolUrl: string): string {
  const url = new URL(poolUrl);
  if (!url.hostname.includes("-pooler.")) {
    throw new Error("The rehearsal B URL must be its verified Neon pooler endpoint.");
  }
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface ApiResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

function parseResponse(response: { statusCode: number; body: string }): ApiResponse {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    body = { raw: response.body };
  }
  return { statusCode: response.statusCode, body };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const poolUrl = requiredEnv("REHEARSAL_B_DATABASE_URL");
  const productionUrl = requiredEnv("PROD_DIRECT_URL");
  const poolHost = hostOf(poolUrl);
  const productionHost = hostOf(productionUrl);
  const directUrl = directUrlOf(poolUrl);
  const targetHost = hostOf(directUrl);
  const targetDatabase = databaseOf(directUrl);

  assert(targetDatabase === expectedDatabase, "Rehearsal B must connect to fabtyna_prod.");
  assert(targetHost === poolHost.replace("-pooler.", "."), "The direct endpoint does not match rehearsal B.");
  assert(targetHost !== productionHost, "The rehearsal endpoint matches the production endpoint; refusing.");
  assert(databaseOf(productionUrl) === expectedDatabase, "The production URL database name is unexpected.");

  const pg = new Client({ connectionString: directUrl });
  const prisma = createPrismaClient(directUrl, { maxConnections: 4 });
  let app: ReturnType<typeof buildApp> | null = null;
  let sessionId: string | null = null;
  try {
    await pg.connect();
    await pg.query("BEGIN READ ONLY");
    const identity = await pg.query<{ database: string; adminId: string | null; ownerCount: string; productCount: string }>(
      `SELECT current_database() AS database,
              (SELECT id FROM admin_users WHERE "isActive" = true ORDER BY id LIMIT 1) AS "adminId",
              (SELECT count(*)::text FROM empties_owners WHERE "isActive" = true
                AND name = ANY($1::text[])) AS "ownerCount",
              (SELECT count(*)::text FROM products WHERE "deletedAt" IS NULL) AS "productCount"`,
      [[...ownerSizes.keys()]],
    );
    const selected = identity.rows[0];
    assert(selected !== undefined && selected.database === expectedDatabase, "Database identity check failed.");
    assert(selected.adminId !== null, "No active admin user exists on rehearsal B.");
    assert(Number(selected.ownerCount) === ownerSizes.size, "The three expected active breweries were not found.");
    assert(Number(selected.productCount) >= 20, "Expected production-copy products were not found.");
    const owners = await pg.query<{ id: string; name: string }>(
      `SELECT id, name FROM empties_owners WHERE "isActive" = true AND name = ANY($1::text[]) ORDER BY name`,
      [[...ownerSizes.keys()]],
    );
    const products = await pg.query<{
      id: string;
      name: string;
      unitsPerPack: number;
      ownerId: string | null;
      ownerName: string | null;
    }>(
      `SELECT p.id, p.name, p."unitsPerPack", po."ownerId", o.name AS "ownerName"
         FROM products p
         LEFT JOIN empties_product_owners po ON po."productId" = p.id
         LEFT JOIN empties_owners o ON o.id = po."ownerId"
        WHERE p."deletedAt" IS NULL ORDER BY p.name`,
    );
    const mode = await pg.query<{ phase: string }>(
      `SELECT phase::text FROM empties_size_class_mode WHERE id = 1`,
    );
    const reset = await pg.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_logs
        WHERE action = 'EMPTIES_PRELAUNCH_RESET_APPLIED'`,
    );
    const currentBalance = await pg.query<{ n: string }>(
      `SELECT COALESCE(sum(b.quantity), 0)::text AS n
         FROM empties_balances b
         JOIN empties_types t ON t.id = b."typeId"
        WHERE t.capacity IS NULL AND t."ownerId" IN (
          SELECT id FROM empties_owners WHERE name = ANY($1::text[])
        )`,
      [[...ownerSizes.keys()]],
    );
    await pg.query("ROLLBACK");

    console.log(`REHEARSAL PREFLIGHT database=${targetDatabase} host=${targetHost} production_host=${productionHost}`);
    console.log(`active_admin_id=${selected.adminId} active_breweries=${selected.ownerCount} active_products=${selected.productCount}`);
    console.log(`size_class_phase=${mode.rows[0]?.phase ?? "MISSING"} reset_markers=${reset.rows[0]?.n ?? "0"} legacy_balance=${currentBalance.rows[0]?.n ?? "0"}`);
    console.log(`run_mode=${apply ? "APPLY" : "READ_ONLY_PREFLIGHT"}`);

    if (!apply) return;
    const phase = mode.rows[0]?.phase;
    assert(phase === "LEGACY" || phase === "READY", "Expected the rehearsal to be in LEGACY or READY mode.");
    assert(Number(currentBalance.rows[0]?.n ?? 0) === 0, "Legacy balances must be reset before this rehearsal.");
    assert(Number(reset.rows[0]?.n ?? 0) === 1, "The audited reset marker must exist exactly once.");
    assert(owners.rows.length === ownerSizes.size, "Expected owner rows were not loaded.");

    for (const product of products.rows) {
      assert(product.ownerName !== null && product.ownerId !== null, `Product '${product.name}' has no brewery mapping.`);
      assert(ownerSizes.has(product.ownerName), `Product '${product.name}' has an unexpected brewery mapping.`);
      if (!/\bcan\b/i.test(product.name)) {
        const sizes = ownerSizes.get(product.ownerName)!;
        assert(sizes.includes(product.unitsPerPack), `Product '${product.name}' has an unsupported units-per-pack value.`);
      }
    }

    const adminEmail = await pg.query<{ email: string }>(
      `SELECT email FROM admin_users WHERE id = $1 AND "isActive" = true`,
      [selected.adminId],
    );
    const actor: Actor = { id: selected.adminId, email: adminEmail.rows[0]!.email };
    const sessionToken = randomBytes(32).toString("base64url");
    sessionId = id("stage5_session");
    const now = new Date();
    await pg.query(
      `INSERT INTO admin_sessions (id, "adminUserId", "tokenHash", "createdAt", "lastSeenAt", "expiresAt")
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [sessionId, actor.id, hashSessionToken(sessionToken), now, new Date(now.getTime() + 60 * 60 * 1000)],
    );
    app = buildApp({
      prisma,
      auth: {
        nodeEnv: "test",
        webOrigin: "http://localhost:3000",
        cookieDomain: null,
        sessionIdleTimeoutHours: 12,
        sessionAbsoluteTimeoutDays: 1,
      },
      trustProxy: false,
      logger: false,
    });
    await app.ready();

    const prefix = `stage5-${randomUUID()}`;
    const authHeaders = {
      origin: "http://localhost:3000",
      cookie: `${SESSION_COOKIE_BASE_NAME}=${sessionToken}`,
    };
    async function call(method: string, url: string, payload?: unknown, expected: number[] = [200]): Promise<Record<string, unknown>> {
      const response = parseResponse(await app!.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as object }),
        headers: {
          ...authHeaders,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          "idempotency-key": id(prefix),
        },
      }));
      assert(expected.includes(response.statusCode), `${method} ${url} returned ${response.statusCode}: ${JSON.stringify(response.body)}`);
      return response.body;
    }

    const ownerIdByName = new Map(owners.rows.map((owner) => [owner.name, owner.id]));
    const types = await pg.query<{ id: string; ownerId: string; capacity: number; isActive: boolean }>(
      `SELECT id, "ownerId", capacity, "isActive" FROM empties_types
        WHERE kind = 'BOTTLE' AND capacity IS NOT NULL
          AND "ownerId" = ANY($1::text[])`,
      [owners.rows.map((owner) => owner.id)],
    );
    const typeIdByClass = new Map<string, string>();
    for (const type of types.rows) {
      const ownerName = owners.rows.find((owner) => owner.id === type.ownerId)?.name;
      assert(ownerName !== undefined && ownerSizes.get(ownerName)?.includes(type.capacity), "Unexpected existing size-class type.");
      assert(type.isActive, `Size-class type ${ownerName}:${type.capacity} is inactive.`);
      const key = `${ownerName}:${type.capacity}`;
      assert(!typeIdByClass.has(key), `Duplicate size-class type ${key}.`);
      typeIdByClass.set(key, type.id);
    }
    if (phase === "LEGACY") {
      for (const [ownerName, capacities] of ownerSizes) {
        const ownerId = ownerIdByName.get(ownerName);
        assert(ownerId !== undefined, `Missing owner '${ownerName}'.`);
        for (const capacity of capacities) {
          const key = `${ownerName}:${capacity}`;
          if (typeIdByClass.has(key)) continue;
          const created = await call("POST", "/empties/types", {
            ownerId,
            kind: "BOTTLE",
            label: `Bottle ${capacity}`,
            capacity,
          }, [201]);
          assert(typeof created.id === "string", `Type creation failed for ${key}.`);
          typeIdByClass.set(key, created.id);
        }
      }
    }
    assert(typeIdByClass.size === 7, "Exactly seven size classes are required for this rehearsal.");

    if (phase === "LEGACY") {
      for (const product of products.rows) {
        const isCan = /\bcan\b/i.test(product.name);
        const classKey = `${product.ownerName}:${product.unitsPerPack}`;
        const typeId = isCan ? null : typeIdByClass.get(classKey);
        if (!isCan) assert(typeId !== undefined, `No size class found for product '${product.name}'.`);
        await call("PUT", `/empties/products/${product.id}/packaging`, {
          mappings: isCan ? [] : [{
            typeId,
            kind: "BOTTLE",
            retailQuantityPerUnit: 1,
            wholesaleQuantityPerPack: product.unitsPerPack,
          }],
        });
        await call("PUT", `/empties/products/${product.id}/purchase-setup`, {
          classification: isCan ? "NON_RETURNABLE" : "RETURNABLE",
          mappings: isCan ? [] : [{
            typeId,
            kind: "BOTTLE",
            countPerUnit: 1,
            cratesPerPack: 1,
          }],
        });
      }
      console.log(`product_setup configured=${products.rows.length} bottle_products=${products.rows.filter((p) => !/\bcan\b/i.test(p.name)).length} cans_without_bottle_mapping=${products.rows.filter((p) => /\bcan\b/i.test(p.name)).length}`);
    } else {
      assert(types.rows.length === 7, "READY mode requires exactly seven existing size classes.");
      console.log("product_setup reused from the prior rehearsal attempt");
    }

    const counts = [...openingCounts.entries()].map(([key, count]) => {
      const typeId = typeIdByClass.get(key);
      assert(typeId !== undefined, `Opening count has no configured class ${key}.`);
      return { typeId, ...count };
    });
    await call("POST", "/empties/size-class-recount/begin", {}, [200]);
    await call("POST", "/empties/size-class-recount", {
      counts,
      reason: "Stage 5 rehearsal opening count",
    }, [200]);

    const trophy = products.rows.find((product) => product.name === "Trophy");
    assert(trophy?.ownerName === "International Breweries" && trophy.unitsPerPack === 12, "Expected International Breweries Trophy 12-pack was not found.");
    const intl12TypeId = typeIdByClass.get("International Breweries:12")!;

    async function state(typeId: string, capacity: number) {
      const [emptyRows, stockRows] = await Promise.all([
        pg.query<{ n: string }>(
          `SELECT COALESCE(quantity, 0)::text AS n FROM empties_balances WHERE "typeId" = $1`,
          [typeId],
        ),
        pg.query<{ n: string }>(
          `SELECT COALESCE(sum(sb."quantityUnits"), 0)::text AS n
             FROM stock_balances sb
             JOIN purchase_empties_packaging pep
               ON pep."productId" = sb."productId" AND pep."typeId" = $1 AND pep.kind = 'BOTTLE'
             JOIN purchase_empties_products pp ON pp."productId" = pep."productId"
            WHERE pp.classification = 'RETURNABLE'`,
          [typeId],
        ),
      ]);
      const emptyBottles = Number(emptyRows.rows[0]?.n ?? 0);
      const stockBottles = Number(stockRows.rows[0]?.n ?? 0);
      const totalBottles = emptyBottles + stockBottles;
      return {
        emptyBottles,
        stockBottles,
        totalBottles,
        totalCrates: Math.floor(totalBottles / capacity),
        looseTotalBottles: totalBottles % capacity,
        emptyCrates: Math.floor(emptyBottles / capacity),
        looseEmptyBottles: emptyBottles % capacity,
      };
    }

    function conserved(before: Awaited<ReturnType<typeof state>>, after: Awaited<ReturnType<typeof state>>, label: string) {
      assert(before.totalBottles === after.totalBottles, `${label} changed total bottles: ${before.totalBottles} -> ${after.totalBottles}.`);
      assert(before.totalCrates === after.totalCrates && before.looseTotalBottles === after.looseTotalBottles, `${label} changed total crates/loose remainder.`);
    }

    async function assertOverview(typeId: string, expected: Awaited<ReturnType<typeof state>>) {
      const result = await call("GET", "/empties/overview");
      const ownersData = result.owners as Array<{ sizeClasses: Array<Record<string, unknown>> }>;
      const found = ownersData.flatMap((owner) => owner.sizeClasses).find((row) => row.typeId === typeId);
      assert(found !== undefined, "Size class is missing from the API overview.");
      assert(found.emptyBottles === expected.emptyBottles
        && found.stockBottles === expected.stockBottles
        && found.totalCrates === expected.totalCrates
        && found.looseTotalBottles === expected.looseTotalBottles,
      `API overview disagrees with the verified size-class total: ${JSON.stringify(found)}.`);
    }

    const beforeSale = await state(intl12TypeId, 12);
    const customerRetailId = id("stage5_retail_customer");
    const customerWholesaleId = id("stage5_wholesale_customer");
    const supplierId = id("stage5_supplier");
    await pg.query(
      `INSERT INTO customers (id, name, type, "updatedAt") VALUES
        ($1, $2, 'RETAIL', now()), ($3, $4, 'WHOLESALE', now())`,
      [customerRetailId, `${prefix} retail`, customerWholesaleId, `${prefix} wholesale`],
    );
    await pg.query(
      `INSERT INTO suppliers (id, name, "updatedAt") VALUES ($1, $2, now())`,
      [supplierId, `${prefix} supplier`],
    );

    const saleBody = {
      customerId: customerRetailId,
      customerName: null,
      channel: "RETAIL",
      location: "RETAIL_SHELF",
      soldAt: new Date().toISOString(),
      notes: null,
      reference: `${prefix}-sale`,
      paidKobo: "0",
      accountId: null,
      lines: [{ productId: trophy.id, unit: "UNIT", quantity: 12, unitPriceKobo: "10000" }],
    };
    const sale = await call("POST", "/sales", saleBody, [201]);
    assert(typeof sale.id === "string", "Retail sale did not return an ID.");
    const afterSale = await state(intl12TypeId, 12);
    conserved(beforeSale, afterSale, "12-bottle retail sale");
    assert(afterSale.emptyCrates === beforeSale.emptyCrates + 1, "Selling 12 Trophy bottles did not add one empty crate.");
    await assertOverview(intl12TypeId, afterSale);
    console.log(`sale_12_Trophy emptyCrates=${beforeSale.emptyCrates}->${afterSale.emptyCrates} total=${afterSale.totalCrates}+${afterSale.looseTotalBottles}`);

    const currentCounts = [];
    for (const [key, count] of openingCounts) {
      const typeId = typeIdByClass.get(key)!;
      const capacity = Number(key.split(":")[1]);
      const balance = key === "International Breweries:12"
        ? afterSale.emptyBottles
        : (count.emptyCrates * capacity + count.looseBottles);
      currentCounts.push({
        typeId,
        emptyCrates: Math.floor(balance / capacity),
        looseBottles: balance % capacity,
      });
    }
    await call("POST", "/empties/size-class-recount/begin", {}, [200]);
    await call("POST", "/empties/size-class-recount", {
      counts: currentCounts,
      reason: "Stage 5 rehearsal recount after 12-bottle retail sale",
    }, [200]);
    const afterRecount = await state(intl12TypeId, 12);
    assert(afterRecount.emptyBottles === afterSale.emptyBottles, "Recount changed the counted bottle balance.");
    await assertOverview(intl12TypeId, afterRecount);
    console.log(`recount_after_sale emptyBottles=${afterRecount.emptyBottles} crates=${afterRecount.emptyCrates} loose=${afterRecount.looseEmptyBottles}`);

    await call("POST", `/sales/${sale.id}/void`, {}, [200]);
    const afterVoid = await state(intl12TypeId, 12);
    conserved(afterRecount, afterVoid, "sale void");
    await assertOverview(intl12TypeId, afterVoid);

    async function transfer(quantityUnits: number, to: "MARKET" | "RETAIL_SHELF", reason: string) {
      const before = await state(intl12TypeId, 12);
      await call("POST", "/transfers", {
        from: "WAREHOUSE",
        to,
        reason,
        transferredAt: new Date().toISOString(),
        lines: [{ productId: trophy.id, quantityUnits }],
      }, [201]);
      const after = await state(intl12TypeId, 12);
      conserved(before, after, reason);
      return after;
    }
    await transfer(12, "MARKET", "Stage 5 rehearsal transfer");
    await transfer(12, "RETAIL_SHELF", "Stage 5 rehearsal break one 12-bottle pack into loose units");
    const afterTransfers = await state(intl12TypeId, 12);
    await assertOverview(intl12TypeId, afterTransfers);

    const beforeWholesale = await state(intl12TypeId, 12);
    await call("POST", "/sales", {
      customerId: customerWholesaleId,
      customerName: null,
      channel: "WHOLESALE",
      location: "WAREHOUSE",
      soldAt: new Date().toISOString(),
      notes: null,
      reference: `${prefix}-partial-wholesale`,
      paidKobo: "0",
      accountId: null,
      lines: [{ productId: trophy.id, unit: "PACK", quantity: 0.5, unitPriceKobo: "9000" }],
    }, [201]);
    const afterWholesale = await state(intl12TypeId, 12);
    conserved(beforeWholesale, afterWholesale, "partial wholesale sale");
    assert(afterWholesale.emptyBottles === beforeWholesale.emptyBottles + 6, "Partial wholesale sale did not return six bottles.");
    await assertOverview(intl12TypeId, afterWholesale);

    const beforePurchase = await state(intl12TypeId, 12);
    assert(beforePurchase.emptyBottles === 69, `Expected 69 bottles before the shortage purchase, got ${beforePurchase.emptyBottles}.`);
    const purchase = await call("POST", "/purchases", {
      supplierId,
      location: "WAREHOUSE",
      purchasedAt: new Date().toISOString(),
      notes: null,
      reference: `${prefix}-purchase-shortage`,
      amountPaidNowKobo: "0",
      dueDate: null,
      accountId: null,
      lines: [{
        productId: trophy.id,
        unit: "PACK",
        quantity: 6,
        lineTotalKobo: "720000",
        emptiesCrateCount: 6,
      }],
      emptiesResolutions: [{ typeId: intl12TypeId, suppliedFree: 0, owed: 12 }],
    }, [201]);
    assert(typeof purchase.id === "string", "Purchase did not return an ID.");
    const afterPurchase = await state(intl12TypeId, 12);
    assert(afterPurchase.emptyBottles === beforePurchase.emptyBottles - 60, "Purchase did not return five whole crates.");
    assert(afterPurchase.totalBottles === beforePurchase.totalBottles + 12, "Purchase total did not increase by stock received minus empties returned.");
    assert(afterPurchase.totalCrates === beforePurchase.totalCrates + 1
      && afterPurchase.looseTotalBottles === beforePurchase.looseTotalBottles,
    "Purchase did not add exactly one net crate.");
    const debtEvents = await pg.query<{ eventType: string; quantity: number }>(
      `SELECT "eventType"::text AS "eventType", quantity
         FROM supplier_empties_events
        WHERE "purchaseId" = $1 AND "reversesEntryId" IS NULL
        ORDER BY "eventType"`,
      [purchase.id],
    );
    assert(JSON.stringify(debtEvents.rows) === JSON.stringify([
      { eventType: "PURCHASE_DEBT", quantity: 12 },
      { eventType: "RETURNED_FOR_PURCHASE", quantity: -60 },
    ]), `Unexpected purchase empties events: ${JSON.stringify(debtEvents.rows)}.`);
    await assertOverview(intl12TypeId, afterPurchase);
    console.log(`purchase_shortage available=${beforePurchase.emptyBottles} returned=60 owed=12 totalBottles=${beforePurchase.totalBottles}->${afterPurchase.totalBottles}`);
    console.log("API rehearsal scenarios passed.");
  } finally {
    if (app !== null) await app.close();
    if (sessionId !== null) {
      await pg.query(`UPDATE admin_sessions SET "revokedAt" = now() WHERE id = $1`, [sessionId]).catch(() => undefined);
    }
    await prisma.$disconnect();
    await pg.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Rehearsal stopped: ${message}`);
  process.exitCode = 1;
});
