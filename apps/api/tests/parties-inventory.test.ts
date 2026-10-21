import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createHarness,
  newId,
  purchaseBody,
  saleBody,
  seedBlankProduct,
  seedProduct,
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

describe("catalogue and inventory read APIs", () => {
  it("enforces active SKU uniqueness, supports reactivation rules, and protects used pack sizes", async () => {
    const sku = newId("sku").toUpperCase();
    const body = (name: string) => ({
      name,
      sku,
      category: "OTHER",
      packName: "case",
      unitsPerPack: 3,
      saleChannel: "BOTH",
      retailPriceKobo: "12000",
      wholesalePriceKobo: "9000",
      reorderLevelUnits: 0,
    });
    const first = await call(h.app, "POST", "/products", body(`5A unique ${newId("product")}`));
    expect(first.status).toBe(201);
    const duplicate = await call(h.app, "POST", "/products", body(`5A duplicate ${newId("product")}`));
    expect(duplicate.status).toBe(409);

    const deactivated = await call(h.app, "POST", `/products/${first.body.id as string}/deactivate`, {});
    expect(deactivated.status).toBe(200);
    const replacement = await call(h.app, "POST", "/products", body(`5A replacement ${newId("product")}`));
    expect(replacement.status).toBe(201);
    const blockedReactivation = await call(h.app, "POST", `/products/${first.body.id as string}/reactivate`, {});
    expect(blockedReactivation.status).toBe(409);
    expect(blockedReactivation.body.error.message).toContain("another active product");

    const movedProduct = await seedProduct(h.pg, { stock: 2, location: "WAREHOUSE" });
    const changedPack = await call(h.app, "PATCH", `/products/${movedProduct.id}`, { unitsPerPack: 4 });
    expect(changedPack.status).toBe(409);
    expect(changedPack.body.error.message).toContain("Pack size cannot change");
  });

  it("creates and updates a product, and reads stock and low-stock values", async () => {
    const create = await call(h.app, "POST", "/products", {
      name: `5A ${newId("product")}`,
      sku: newId("sku"),
      category: "OTHER",
      packName: "case",
      unitsPerPack: 3,
      saleChannel: "BOTH",
      retailPriceKobo: "12000",
      wholesalePriceKobo: "9000",
      reorderLevelUnits: 6,
    });
    expect(create.status).toBe(201);
    const productId = create.body.id as string;

    const patch = await call(h.app, "PATCH", `/products/${productId}`, { name: "5A product renamed" });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("5A product renamed");
    const detail = await call(h.app, "GET", `/products/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe("5A product renamed");

    const productName = "5A product renamed";
    const lowStock = await call(h.app, "GET", `/stock/low?q=${encodeURIComponent(productName)}`);
    expect(lowStock.status).toBe(200);
    expect(lowStock.body.items).toContainEqual(expect.objectContaining({ id: productId, units: 0, shortfallUnits: 6 }));
    const stock = await call(h.app, "GET", `/stock?q=${encodeURIComponent(productName)}&nonZero=false`);
    expect(stock.status).toBe(200);
    expect(stock.body.items).toContainEqual(expect.objectContaining({
      id: productId,
      totalUnits: 0,
      worthAtCostKobo: "0",
    }));
  });

  it("lists stock by location and includes loose units in wholesale valuation", async () => {
    const product = await seedProduct(h.pg, {
      name: `5A stock ${newId("product")}`,
      unitsPerPack: 3,
      stock: 5,
      location: "WAREHOUSE",
      averageCostKobo: 100n,
    });
    await h.pg.query(`UPDATE products SET "reorderLevelUnits" = 6 WHERE id = $1`, [product.id]);
    const response = await call(h.app, "GET", `/stock?location=WAREHOUSE&q=${encodeURIComponent(product.name)}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toContainEqual(expect.objectContaining({
      id: product.id,
      totalUnits: 5,
      worthAtWholesaleKobo: "15000",
    }));

    const lowInWarehouse = await call(
      h.app,
      "GET",
      `/stock/low?location=WAREHOUSE&q=${encodeURIComponent(product.name)}`,
    );
    expect(lowInWarehouse.status).toBe(200);
    expect(lowInWarehouse.body.items).toContainEqual(expect.objectContaining({
      id: product.id,
      units: 5,
      shortfallUnits: 1,
    }));

    const lowOnMarket = await call(
      h.app,
      "GET",
      `/stock/low?location=MARKET&q=${encodeURIComponent(product.name)}`,
    );
    expect(lowOnMarket.status).toBe(200);
    expect(lowOnMarket.body.items).toContainEqual(expect.objectContaining({
      id: product.id,
      units: 0,
      shortfallUnits: 6,
    }));
  });
});

describe("customer and supplier APIs", () => {
  it("patches and deactivates/reactivates customers and suppliers", async () => {
    const customer = await call(h.app, "POST", "/customers", { name: `5A party ${newId("customer")}` });
    expect(customer.status).toBe(201);
    const customerId = customer.body.id as string;
    const customerPatch = await call(h.app, "PATCH", `/customers/${customerId}`, { phone: "08000000000" });
    expect(customerPatch.status).toBe(200);
    expect(customerPatch.body.phone).toBe("08000000000");
    expect((await call(h.app, "POST", `/customers/${customerId}/deactivate`, {})).status).toBe(200);
    expect((await call(h.app, "GET", `/customers/${customerId}`)).body.customer.active).toBe(false);
    expect((await call(h.app, "POST", `/customers/${customerId}/reactivate`, {})).status).toBe(200);

    const supplier = await call(h.app, "POST", "/suppliers", { name: `5A party ${newId("supplier")}` });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.id as string;
    const supplierPatch = await call(h.app, "PATCH", `/suppliers/${supplierId}`, { phone: "08000000001" });
    expect(supplierPatch.status).toBe(200);
    expect(supplierPatch.body.phone).toBe("08000000001");
    expect((await call(h.app, "POST", `/suppliers/${supplierId}/deactivate`, {})).status).toBe(200);
    expect((await call(h.app, "GET", `/suppliers/${supplierId}`)).body.supplier.active).toBe(false);
    expect((await call(h.app, "POST", `/suppliers/${supplierId}/reactivate`, {})).status).toBe(200);
  });

  it("creates a customer and derives customer statement and debtor balances from the ledger", async () => {
    const customerName = `5A customer ${newId("party")}`;
    const created = await call(h.app, "POST", "/customers", {
      name: customerName,
      type: "RETAIL",
      creditLimitKobo: "50000",
    });
    expect(created.status).toBe(201);
    const customerId = created.body.id as string;
    const product = await seedProduct(h.pg, { stock: 10, location: "RETAIL_SHELF" });
    const sale = await call(h.app, "POST", "/sales", saleBody({
      customerId,
      productId: product.id,
      quantity: 2,
      paidKobo: "0",
    }));
    expect(sale.status).toBe(201);

    const statement = await call(h.app, "GET", `/customers/${customerId}/statement`);
    expect(statement.status).toBe(200);
    expect(statement.body.entries).toContainEqual(expect.objectContaining({ type: "SALE", amountKobo: "20000" }));
    expect(statement.body.closingBalanceKobo).toBe("20000");

    const debtors = await call(h.app, "GET", `/debtors?q=${encodeURIComponent(customerName)}`);
    expect(debtors.status).toBe(200);
    expect(debtors.body.items).toContainEqual(expect.objectContaining({
      id: customerId,
      balanceKobo: "20000",
    }));

    const profile = await call(h.app, "GET", `/customers/${customerId}`);
    expect(profile.status).toBe(200);
    expect(profile.body.balanceKobo).toBe("20000");
    expect(profile.body.unpaidSales).toHaveLength(1);
  });

  it("creates a supplier, records a credit purchase and lists the payable balance", async () => {
    const supplierName = `5A supplier ${newId("party")}`;
    const created = await call(h.app, "POST", "/suppliers", {
      name: supplierName,
    });
    expect(created.status).toBe(201);
    const supplierId = created.body.id as string;
    const product = await seedBlankProduct(h.pg);
    const purchase = await call(
      h.app,
      "POST",
      "/purchases",
      purchaseBody({
        productId: product.id,
        supplierId,
        quantity: 4,
        lineTotalKobo: "12000",
      }),
    );
    expect(purchase.status).toBe(201);

    const statement = await call(h.app, "GET", `/suppliers/${supplierId}/statement`);
    expect(statement.status).toBe(200);
    expect(statement.body.entries).toContainEqual(expect.objectContaining({ type: "PURCHASE", amountKobo: "12000" }));
    expect(statement.body.closingBalanceKobo).toBe("12000");

    const payables = await call(h.app, "GET", `/payables?q=${encodeURIComponent(supplierName)}`);
    expect(payables.status).toBe(200);
    expect(payables.body.items).toContainEqual(expect.objectContaining({
      id: supplierId,
      balanceKobo: "12000",
    }));
  });

  it("totals only overdue purchase balances in the overdue payable total", async () => {
    const before = await call(h.app, "GET", "/payables");
    expect(before.status).toBe(200);
    const supplierName = `5A mixed payable ${newId("party")}`;
    const created = await call(h.app, "POST", "/suppliers", { name: supplierName });
    expect(created.status).toBe(201);
    const supplierId = created.body.id as string;
    const overdueProduct = await seedBlankProduct(h.pg);
    const currentProduct = await seedBlankProduct(h.pg);
    const pastDueDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureDueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const overduePurchase = await call(h.app, "POST", "/purchases", purchaseBody({
      productId: overdueProduct.id,
      supplierId,
      quantity: 1,
      lineTotalKobo: "12000",
      dueDate: pastDueDate,
    }));
    const currentPurchase = await call(h.app, "POST", "/purchases", purchaseBody({
      productId: currentProduct.id,
      supplierId,
      quantity: 1,
      lineTotalKobo: "5000",
      dueDate: futureDueDate,
    }));
    expect(overduePurchase.status).toBe(201);
    expect(currentPurchase.status).toBe(201);

    const payables = await call(h.app, "GET", "/payables");
    expect(payables.status).toBe(200);
    expect(BigInt(payables.body.grandTotalKobo) - BigInt(before.body.grandTotalKobo)).toBe(17000n);
    expect(BigInt(payables.body.overdueTotalKobo) - BigInt(before.body.overdueTotalKobo)).toBe(12000n);
  });
});
