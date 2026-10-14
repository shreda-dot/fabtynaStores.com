import { describe, expect, it } from "vitest";
import {
  productDtoSchema,
  purchaseReceiveDtoSchema,
} from "../schemas/index.js";

describe("JSON DTO contracts", () => {
  it("round-trips a product with integer-kobo strings through JSON", () => {
    const dto = {
      id: "product-1",
      name: "Cola",
      sku: "COLA-1",
      category: "SOFT_DRINK",
      packName: "crate",
      unitsPerPack: 24,
      retailPriceKobo: "25000",
      wholesalePriceKobo: "500000",
      averageCostKobo: "18000",
      reorderLevelUnits: 12,
      deletedAt: null,
      createdAt: "2026-10-13T10:00:00.000Z",
      updatedAt: "2026-10-13T10:00:00.000Z",
    };

    const roundTripped = JSON.parse(JSON.stringify(dto)) as unknown;
    const parsed = productDtoSchema.parse(roundTripped);

    expect(parsed.retailPriceKobo).toBe("25000");
    expect(parsed.averageCostKobo).toBe("18000");
  });

  it("requires purchase receive lineTotalKobo as an integer string", () => {
    const request = {
      lines: [
        {
          purchaseLineId: "purchase-line-1",
          quantityUnits: 24,
          lineTotalKobo: "432000",
        },
      ],
    };

    expect(purchaseReceiveDtoSchema.parse(request).lines[0].lineTotalKobo).toBe(
      "432000",
    );
    expect(() =>
      purchaseReceiveDtoSchema.parse({
        lines: [{ ...request.lines[0], lineTotalKobo: 432000 }],
      }),
    ).toThrow();
  });
});
