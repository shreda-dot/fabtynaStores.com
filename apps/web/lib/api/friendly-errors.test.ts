import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { findQuotedId, friendlyWriteError, replaceIdWithName } from "./friendly-errors";

describe("product id in server messages", () => {
  const id = "a00446bc-f377-45db-89c5-5ba0f943ae54";
  const msg = `Voiding this purchase would make stock for product '${id}' at WAREHOUSE negative (-600).`;
  it("finds and replaces the id with the product name", () => {
    expect(findQuotedId(msg)).toBe(id);
    expect(replaceIdWithName(msg, id, "Star Lager")).toBe(
      "Voiding this purchase would make stock for product 'Star Lager' at WAREHOUSE negative (-600).",
    );
  });
  it("returns null when there is no id", () => {
    expect(findQuotedId("Already paid.")).toBeNull();
  });
});

function err(code: string, message: string, details: unknown, status = 409) {
  return new ApiError("unknown", message, { code, details, status });
}

describe("friendlyWriteError", () => {
  it("explains insufficient stock with product and on-hand", () => {
    const result = friendlyWriteError(
      err("INSUFFICIENT_STOCK", "raw", {
        productName: "Star Lager",
        location: "RETAIL_SHELF",
        availableUnits: 3,
        requestedUnits: 5,
      }),
    );
    expect(result.message).toBe("Not enough 'Star Lager' in the retail shelf: 3 on hand, 5 needed.");
  });

  it("explains an account overdraw with balance, amount and the hint", () => {
    const result = friendlyWriteError(
      err("BUSINESS_RULE", "raw", {
        accountName: "Cash on hand",
        balanceKobo: "100000",
        amountKobo: "250000",
      }),
    );
    expect(result.message).toContain("Cash on hand");
    expect(result.message).toContain("Record income or reconcile");
  });

  it("explains an overpayment with the amount due", () => {
    const result = friendlyWriteError(
      err("VALIDATION", "raw", { field: "amountKobo", amountDueKobo: "50000" }, 400),
    );
    expect(result.message).toContain("amount due");
  });

  it("flags a void blocked by a live payment", () => {
    const result = friendlyWriteError(
      err("BUSINESS_RULE", "This sale has an on-account payment recorded and cannot be voided. Reverse the payment first.", null),
    );
    expect(result.action).toBe("reverse-payments");
  });

  it("explains already sold or moved", () => {
    const result = friendlyWriteError(
      err("BUSINESS_RULE", "raw", { productName: "Malt", onHandUnits: 2, neededUnits: 24 }),
    );
    expect(result.message).toContain("already been sold or moved");
  });

  it("tells the user to reload on an idempotency mismatch", () => {
    const result = friendlyWriteError(err("IDEMPOTENCY_MISMATCH", "raw", null, 422));
    expect(result.action).toBe("reload");
  });

  it("falls back to the server message for other business errors", () => {
    expect(friendlyWriteError(err("BUSINESS_RULE", "Already paid.", null)).message).toBe("Already paid.");
  });
});
