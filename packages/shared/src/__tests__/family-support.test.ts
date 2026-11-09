import { describe, expect, it } from "vitest";
import {
  createDrawingSchema,
  drawingReport,
  familyMemberInputSchema,
  ownerWithdrawalCategory,
  ownerWithdrawalTotals,
  buildAccountLedgerEntry,
  validateAccountLedgerEntry,
  validateAccountLedgerReversals,
  migrateMockStoreData,
  type DrawingReportEntry,
} from "../index.ts";

const first: DrawingReportEntry = {
  id: "drawing-1",
  beneficiaryId: "dad",
  beneficiaryName: "Dad",
  purpose: "MEDICAL",
  accountId: "bank",
  accountName: "Bank",
  amountKobo: 250000n,
  occurredAt: new Date("2026-10-28T23:30:00Z"),
  reversed: false,
};

describe("family support contracts", () => {
  it("requires a beneficiary, purpose, account and integer kobo", () => {
    const valid = {
      beneficiaryId: "dad",
      purpose: "MEDICAL",
      accountId: "bank",
      amountKobo: "250000",
      occurredAt: "2026-10-28T23:30:00.000Z",
      note: null,
    };
    expect(createDrawingSchema.safeParse(valid).success).toBe(true);
    expect(createDrawingSchema.safeParse({ ...valid, beneficiaryId: "" }).success).toBe(false);
    expect(createDrawingSchema.safeParse({ ...valid, purpose: undefined }).success).toBe(false);
    expect(createDrawingSchema.safeParse({ ...valid, amountKobo: "1.5" }).success).toBe(false);
    expect(familyMemberInputSchema.safeParse({ name: " ", relationship: "Father" }).success).toBe(false);
  });

  it("groups active drawings and uses Lagos dates at midnight", () => {
    const entries: DrawingReportEntry[] = [
      first,
      { ...first, id: "drawing-2", purpose: "TRANSPORT", accountId: "cash", accountName: "Cash", amountKobo: 100n },
      { ...first, id: "drawing-3", amountKobo: 500n, reversed: true },
      { ...first, id: "drawing-4", occurredAt: new Date("2026-10-28T20:00:00Z") },
    ];
    const result = drawingReport(entries, { from: "2026-10-29", to: "2026-10-29" });
    expect(result.totalKobo).toBe(250100n);
    expect(result.count).toBe(2);
    expect(result.byBeneficiary[0]?.byPurpose).toHaveLength(2);
    expect(result.byAccount.map((row) => row.amountKobo)).toEqual([250000n, 100n]);
    expect(drawingReport(entries, { from: "2026-10-29", to: "2026-10-29", purpose: "TRANSPORT" }).totalKobo).toBe(100n);
  });

  it("rejects duplicate documents and invalid date ranges", () => {
    expect(() => drawingReport([first, first], { from: "2026-10-01", to: "2026-10-31" })).toThrow(/Duplicate/);
    expect(() => drawingReport([], { from: "2026-10-31", to: "2026-10-01" })).toThrow(/From date/);
    expect(() => drawingReport([], { from: "2026-02-30", to: "2026-03-01" })).toThrow(/calendar/);
  });

  it("keeps large kobo amounts exact and combines filters", () => {
    const entries: DrawingReportEntry[] = [
      { ...first, amountKobo: 9007199254740993n },
      { ...first, id: "other-account", accountId: "cash", accountName: "Cash", amountKobo: 1n },
      { ...first, id: "other-beneficiary", beneficiaryId: "chika", beneficiaryName: "Chika", amountKobo: 2n },
    ];
    const report = drawingReport(entries, {
      from: "2026-10-29",
      to: "2026-10-29",
      beneficiaryId: "dad",
      accountId: "bank",
      purpose: "MEDICAL",
    });
    expect(report.totalKobo).toBe(9007199254740993n);
    expect(report.count).toBe(1);
    expect(report.byBeneficiary[0]?.amountKobo).toBe(report.totalKobo);
    expect(report.byPurpose[0]?.amountKobo).toBe(report.totalKobo);
    expect(report.byAccount[0]?.amountKobo).toBe(report.totalKobo);
  });

  it("separates documented drawings, the two confirmed legacy loans, and other withdrawals including reversals", () => {
    const documented = new Set(["family-entry"]);
    const entries = [
      { id: "family-entry", type: "OWNER_DRAWING" as const, amountKobo: -500n, reversesEntryId: null },
      { id: "family-reversal", type: "OWNER_DRAWING" as const, amountKobo: 500n, reversesEntryId: "family-entry" },
      { id: "0fac2710-1e88-4b4f-b320-1da3176cedaa", type: "OWNER_DRAWING" as const, amountKobo: -17300000n, reversesEntryId: null },
      { id: "f3f94b83-4bcc-4f20-89e9-00d8217e6915", type: "OWNER_DRAWING" as const, amountKobo: -9800000n, reversesEntryId: null },
      { id: "unknown", type: "OWNER_DRAWING" as const, amountKobo: -20n, reversesEntryId: null },
    ];
    expect(ownerWithdrawalCategory(entries[1], documented)).toBe("OWNER_DRAWING");
    expect(ownerWithdrawalCategory(entries[4], documented)).toBe("UNCLASSIFIED_WITHDRAWAL");
    expect(ownerWithdrawalTotals(entries, documented)).toEqual({
      drawingsKobo: 0n, legacyLoanKobo: 27100000n, unclassifiedKobo: 20n,
    });
  });

  it("accepts an exact drawing reversal but still rejects a wrong-signed original", () => {
    const original = buildAccountLedgerEntry({
      accountId: "cash", type: "OWNER_DRAWING", amountKobo: -500n,
      note: "Family support", occurredAt: new Date("2026-10-29T10:00:00Z"),
    }, () => "original");
    const reversal = { ...original, id: "reversal", amountKobo: 500n, reversesEntryId: original.id };
    expect(() => validateAccountLedgerEntry(reversal)).not.toThrow();
    expect(() => validateAccountLedgerReversals([original, reversal])).not.toThrow();
    expect(() => validateAccountLedgerEntry({ ...original, amountKobo: 500n })).toThrow();
    expect(() => validateAccountLedgerReversals([original, { ...reversal, amountKobo: 400n }])).toThrow();
  });

  it("adds family collections to existing mock data without changing existing ledgers", () => {
    const saved = { accounts: [{ id: "cash" }], accountLedgerEntries: [{ id: "old-entry" }] };
    const migrated = migrateMockStoreData(7, saved)!;
    expect(migrated.version).toBe(8);
    expect(migrated.data.accounts).toEqual(saved.accounts);
    expect(migrated.data.accountLedgerEntries).toEqual(saved.accountLedgerEntries);
    expect(migrated.data.familyMembers).toEqual([]);
    expect(migrated.data.drawings).toEqual([]);
    expect(migrated.data.familySupportWrites).toEqual([]);
    const next = migrateMockStoreData(8, { ...migrated.data, drawings: [{ id: "existing" }] })!;
    expect(next.data.drawings).toEqual([{ id: "existing" }]);
  });
});
