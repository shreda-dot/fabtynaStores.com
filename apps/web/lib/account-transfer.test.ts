import { describe, expect, it } from "vitest";
import { transferDraftError, type TransferDraft } from "./account-transfer";

function draft(overrides: Partial<TransferDraft> = {}): TransferDraft {
  return { fromAccountId: "cash", toAccountId: "bank", amountKobo: "100", ...overrides };
}

describe("transferDraftError", () => {
  it("accepts a complete draft", () => {
    expect(transferDraftError(draft())).toBeNull();
  });

  it("asks for the account money leaves when From is empty", () => {
    expect(transferDraftError(draft({ fromAccountId: "" }))).toBe(
      "Choose the account to transfer from",
    );
  });

  it("asks for the account money enters when To is empty", () => {
    expect(transferDraftError(draft({ toAccountId: "" }))).toBe(
      "Choose the account to transfer to",
    );
  });

  it("refuses the same account on both sides", () => {
    expect(transferDraftError(draft({ toAccountId: "cash" }))).toBe(
      "From and To must be different accounts",
    );
  });

  it("refuses a zero or missing amount", () => {
    expect(transferDraftError(draft({ amountKobo: "0" }))).toBe(
      "Enter an amount greater than zero",
    );
    expect(transferDraftError(draft({ amountKobo: "" }))).toBe(
      "Enter an amount greater than zero",
    );
  });
});
