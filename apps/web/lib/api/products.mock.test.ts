// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { productsMockApi } from "./products.mock";
import { readMockStore, resetDemoData } from "./mock-store";

const product = {
  name: "Demo drink",
  sku: null,
  category: "BEER" as const,
  packName: "Crate",
  unitsPerPack: 12,
  saleChannel: "BOTH" as const,
  retailPriceKobo: "10000",
  wholesalePriceKobo: "100000",
  reorderLevelUnits: 0,
};

describe("demo product purchase classification", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemoData();
  });

  it.each(["RETURNABLE", "NON_RETURNABLE"] as const)("creates and persists a %s product", async (classification) => {
    const created = await productsMockApi.create({ ...product, emptiesClassification: classification });
    expect((await productsMockApi.getById(created.id)).name).toBe(product.name);
    expect(readMockStore().purchaseEmptiesClassifications).toContainEqual({ productId: created.id, classification });
    const saved = JSON.parse(window.localStorage.getItem("fabtyna-mock-v1")!) as {
      data: { purchaseEmptiesClassifications: unknown[] };
    };
    expect(saved.data.purchaseEmptiesClassifications).toContainEqual({ productId: created.id, classification });
  });

  it("rejects a missing classification without creating a product", async () => {
    const count = readMockStore().products.length;
    // @ts-expect-error Verify runtime validation for an untyped caller.
    await expect(productsMockApi.create(product)).rejects.toThrow();
    expect(readMockStore().products).toHaveLength(count);
  });
});
