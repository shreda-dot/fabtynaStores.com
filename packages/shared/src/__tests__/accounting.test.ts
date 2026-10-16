import { describe, expect, it } from "vitest";
import type {
  LoanLedgerEntry,
  Product,
  Purchase,
} from "../domain/types.ts";
import {
  computeFinancialPosition,
  isPurchaseOverdue,
  loanOutstandingKobo,
  loanStatus,
  purchaseBalanceKobo,
  purchasePaymentStatus,
  scaleByBpsFloor,
  validateCashSnapshot,
  validateLoanLedgerEntry,
  validatePurchasePaymentFields,
} from "../domain/accounting.ts";
import {
  addLoanCharge,
  createLoan,
  recordLoanRepayment,
} from "../domain/loans.ts";
import {
  recordPurchasePayment,
  receivePurchase,
} from "../domain/operations.ts";
import { migrateMockStoreData } from "../mock-store-migration.ts";

const baseDate = new Date("2026-10-01T10:00:00.000Z");

let idCounter = 0;
const newId = () => `id-${++idCounter}`;

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: `p-${idCounter + 1}`,
    name: "Lager",
    sku: "LAG",
    category: "BEER",
    packName: "crate",
    unitsPerPack: 12,
    saleChannel: "BOTH",
    retailPriceKobo: 500n,
    wholesalePriceKobo: 10000n,
    averageCostKobo: 0n,
    reorderLevelUnits: 12,
    deletedAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "pur-x",
    supplierId: "sup-1",
    createdById: "admin",
    status: "RECEIVED",
    reference: null,
    notes: null,
    totalKobo: 10000n,
    paidKobo: 0n,
    dueDate: null,
    purchasedAt: baseDate,
    receivedAt: baseDate,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * PART 1 — supplier credit (payables)
 * ------------------------------------------------------------------ */

describe("receivePurchase with supplier credit", () => {
  it("creates an unpaid purchase on full credit", () => {
    const product = makeProduct({ id: "p1" });
    const result = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        dueDate: "2026-11-01",
        amountPaidNowKobo: 0n,
        lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 10000n }],
      },
      [product],
      [],
      newId,
    );

    expect(result.purchase.paidKobo).toBe(0n);
    expect(result.purchase.dueDate).toBe("2026-11-01");
    expect(result.supplierPayment).toBeNull();
    expect(result.supplierPaymentLedgerEntry).toBeNull();
    expect(result.supplierLedgerEntry).not.toBeNull();
    expect(result.supplierLedgerEntry!.type).toBe("PURCHASE");
    expect(result.supplierLedgerEntry!.amountKobo).toBe(10000n);
    // Supplier ledger sum = what we owe the supplier.
    expect(result.supplierLedgerEntry!.amountKobo).toBe(10000n);
  });

  it("creates purchase + payment entries on a partial payment", () => {
    const product = makeProduct({ id: "p1" });
    const result = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        dueDate: null,
        amountPaidNowKobo: 4000n,
        lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 10000n }],
      },
      [product],
      [],
      newId,
    );

    expect(result.purchase.paidKobo).toBe(4000n);
    expect(purchaseBalanceKobo(result.purchase)).toBe(6000n);
    expect(purchasePaymentStatus(result.purchase)).toBe("PARTIAL");
    expect(result.supplierPayment).not.toBeNull();
    expect(result.supplierPayment!.amountKobo).toBe(4000n);
    expect(result.supplierPaymentLedgerEntry).not.toBeNull();
    expect(result.supplierPaymentLedgerEntry!.type).toBe("PAYMENT");
    expect(result.supplierPaymentLedgerEntry!.amountKobo).toBe(-4000n);
    expect(result.supplierPaymentLedgerEntry!.supplierPaymentId).toBe(
      result.supplierPayment!.id,
    );
    // Ledger sum: 10000 - 4000 = 6000 owed.
    const ledgerSum =
      result.supplierLedgerEntry!.amountKobo +
      result.supplierPaymentLedgerEntry!.amountKobo;
    expect(ledgerSum).toBe(6000n);
  });

  it("counts a fully paid purchase as PAID with no balance", () => {
    const product = makeProduct({ id: "p1" });
    const result = receivePurchase(
      {
        supplierId: "s1",
        createdById: "admin",
        location: "WAREHOUSE",
        purchasedAt: baseDate,
        notes: null,
        reference: null,
        amountPaidNowKobo: 10000n,
        lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 10000n }],
      },
      [product],
      [],
      newId,
    );
    expect(result.purchase.paidKobo).toBe(10000n);
    expect(purchaseBalanceKobo(result.purchase)).toBe(0n);
    expect(purchasePaymentStatus(result.purchase)).toBe("PAID");
  });

  it("rejects paying more than the total up front", () => {
    const product = makeProduct({ id: "p1" });
    expect(() =>
      receivePurchase(
        {
          supplierId: "s1",
          createdById: "admin",
          location: "WAREHOUSE",
          purchasedAt: baseDate,
          notes: null,
          reference: null,
          amountPaidNowKobo: 10001n,
          lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 10000n }],
        },
        [product],
        [],
        newId,
      ),
    ).toThrow("cannot exceed the total");
  });

  it("rejects an unpaid purchase with no supplier", () => {
    const product = makeProduct({ id: "p1" });
    expect(() =>
      receivePurchase(
        {
          supplierId: null,
          createdById: "admin",
          location: "WAREHOUSE",
          purchasedAt: baseDate,
          notes: null,
          reference: null,
          amountPaidNowKobo: 5000n,
          lines: [{ productId: "p1", unit: "PACK", quantity: 1, lineTotalKobo: 10000n }],
        },
        [product],
        [],
        newId,
      ),
    ).toThrow("supplier is required");
  });
});

describe("recordPurchasePayment", () => {
  it("increments paidKobo and writes a negative PAYMENT entry", () => {
    const purchase = makePurchase({ id: "pur1", totalKobo: 10000n, paidKobo: 2000n });
    const result = recordPurchasePayment(
      {
        purchaseId: "pur1",
        amountKobo: 3000n,
        paidAt: baseDate,
        method: "TRANSFER",
        note: "part payment",
      },
      [purchase],
      newId,
    );
    expect(result.purchase.paidKobo).toBe(5000n);
    expect(result.supplierPayment.amountKobo).toBe(3000n);
    expect(result.supplierPayment.method).toBe("TRANSFER");
    expect(result.supplierLedgerEntry.type).toBe("PAYMENT");
    expect(result.supplierLedgerEntry.amountKobo).toBe(-3000n);
    expect(result.supplierLedgerEntry.purchaseId).toBeNull();
    expect(result.supplierLedgerEntry.supplierPaymentId).toBe(
      result.supplierPayment.id,
    );
  });

  it("rejects a zero or negative amount", () => {
    const purchase = makePurchase({ paidKobo: 0n });
    expect(() =>
      recordPurchasePayment(
        { purchaseId: purchase.id, amountKobo: 0n, paidAt: baseDate, method: "CASH", note: null },
        [purchase],
        newId,
      ),
    ).toThrow("must be positive");
  });

  it("rejects overpaying the remaining balance", () => {
    const purchase = makePurchase({ totalKobo: 10000n, paidKobo: 8000n });
    expect(() =>
      recordPurchasePayment(
        { purchaseId: purchase.id, amountKobo: 2001n, paidAt: baseDate, method: "CASH", note: null },
        [purchase],
        newId,
      ),
    ).toThrow("exceeds the remaining balance");
  });

  it("rejects a payment on a fully paid purchase", () => {
    const purchase = makePurchase({ totalKobo: 10000n, paidKobo: 10000n });
    expect(() =>
      recordPurchasePayment(
        { purchaseId: purchase.id, amountKobo: 100n, paidAt: baseDate, method: "CASH", note: null },
        [purchase],
        newId,
      ),
    ).toThrow("already fully paid");
  });

  it("rejects a payment on a voided purchase", () => {
    const purchase = makePurchase({ status: "VOIDED", paidKobo: 0n });
    expect(() =>
      recordPurchasePayment(
        { purchaseId: purchase.id, amountKobo: 100n, paidAt: baseDate, method: "CASH", note: null },
        [purchase],
        newId,
      ),
    ).toThrow("voided purchase");
  });

  it("rejects a payment on a purchase without a supplier", () => {
    const purchase = makePurchase({ supplierId: null, paidKobo: 0n });
    expect(() =>
      recordPurchasePayment(
        { purchaseId: purchase.id, amountKobo: 100n, paidAt: baseDate, method: "CASH", note: null },
        [purchase],
        newId,
      ),
    ).toThrow("no supplier");
  });
});

describe("purchase derived helpers", () => {
  it("derives UNPAID / PARTIAL / PAID", () => {
    expect(purchasePaymentStatus(makePurchase({ totalKobo: 100n, paidKobo: 0n }))).toBe("UNPAID");
    expect(purchasePaymentStatus(makePurchase({ totalKobo: 100n, paidKobo: 40n }))).toBe("PARTIAL");
    expect(purchasePaymentStatus(makePurchase({ totalKobo: 100n, paidKobo: 100n }))).toBe("PAID");
  });

  it("flags OVERDUE only when past due and still owing", () => {
    const overdue = makePurchase({ totalKobo: 100n, paidKobo: 0n, dueDate: "2026-09-01" });
    expect(isPurchaseOverdue(overdue, "2026-10-01")).toBe(true);
    const settled = makePurchase({ totalKobo: 100n, paidKobo: 100n, dueDate: "2026-09-01" });
    expect(isPurchaseOverdue(settled, "2026-10-01")).toBe(false);
    const future = makePurchase({ totalKobo: 100n, paidKobo: 0n, dueDate: "2026-12-01" });
    expect(isPurchaseOverdue(future, "2026-10-01")).toBe(false);
  });

  it("validates purchase payment fields", () => {
    expect(() =>
      validatePurchasePaymentFields(makePurchase({ totalKobo: 100n, paidKobo: 101n })),
    ).toThrow("may not exceed");
    expect(() =>
      validatePurchasePaymentFields(makePurchase({ dueDate: "01-01-2026" })),
    ).toThrow("business date");
    expect(() =>
      validatePurchasePaymentFields(makePurchase({ totalKobo: 100n, paidKobo: 100n, dueDate: "2026-12-01" })),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * PART 2 — loans
 * ------------------------------------------------------------------ */

describe("createLoan", () => {
  it("writes a DISBURSEMENT and an agreed-interest CHARGE", () => {
    const { loan, ledgerEntries } = createLoan(
      {
        lenderName: "  Chief Obi  ",
        principalKobo: 100000n,
        agreedInterestKobo: 10000n,
        disbursedAt: baseDate,
        dueDate: "2026-12-01",
        note: null,
      },
      newId,
    );
    expect(loan.lenderName).toBe("Chief Obi");
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries[0].type).toBe("DISBURSEMENT");
    expect(ledgerEntries[0].amountKobo).toBe(100000n);
    expect(ledgerEntries[1].type).toBe("CHARGE");
    expect(ledgerEntries[1].amountKobo).toBe(10000n);
    expect(loanOutstandingKobo(loan.id, ledgerEntries)).toBe(110000n);
  });

  it("omits the CHARGE when interest is zero", () => {
    const { loan, ledgerEntries } = createLoan(
      {
        lenderName: "Auntie",
        principalKobo: 50000n,
        agreedInterestKobo: 0n,
        disbursedAt: baseDate,
        dueDate: null,
        note: null,
      },
      newId,
    );
    expect(ledgerEntries).toHaveLength(1);
    expect(loanOutstandingKobo(loan.id, ledgerEntries)).toBe(50000n);
  });
});

describe("loan charges, repayments and status", () => {
  function loanWithLedger() {
    const { loan, ledgerEntries } = createLoan(
      {
        lenderName: "Bank",
        principalKobo: 100000n,
        agreedInterestKobo: 10000n,
        disbursedAt: baseDate,
        dueDate: "2026-09-01",
        note: null,
      },
      newId,
    );
    return { loan, ledgerEntries: [...ledgerEntries] };
  }

  it("adds a charge to the outstanding balance", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    const charge = addLoanCharge(
      { loanId: loan.id, amountKobo: 5000n, reason: "Late penalty", occurredAt: baseDate },
      [loan],
      newId,
    );
    expect(charge.type).toBe("CHARGE");
    expect(charge.amountKobo).toBe(5000n);
    expect(loanOutstandingKobo(loan.id, [...ledgerEntries, charge])).toBe(115000n);
  });

  it("reduces the outstanding balance on repayment", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    const result = recordLoanRepayment(
      { loanId: loan.id, amountKobo: 15000n, interestPortionKobo: 0n, paidAt: baseDate, note: null },
      [loan],
      ledgerEntries,
      newId,
    );
    expect(result.ledgerEntry.type).toBe("REPAYMENT");
    expect(result.ledgerEntry.amountKobo).toBe(-15000n);
    expect(loanOutstandingKobo(loan.id, [...ledgerEntries, result.ledgerEntry])).toBe(95000n);
    expect(result.expense).toBeNull();
  });

  it("rejects overpaying a loan", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    expect(() =>
      recordLoanRepayment(
        { loanId: loan.id, amountKobo: 110001n, interestPortionKobo: 0n, paidAt: baseDate, note: null },
        [loan],
        ledgerEntries,
        newId,
      ),
    ).toThrow("exceeds the outstanding balance");
  });

  it("rejects an interest portion larger than the repayment", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    expect(() =>
      recordLoanRepayment(
        { loanId: loan.id, amountKobo: 1000n, interestPortionKobo: 2000n, paidAt: baseDate, note: null },
        [loan],
        ledgerEntries,
        newId,
      ),
    ).toThrow("Interest portion may not exceed");
  });

  it("creates a linked LOAN_INTEREST expense only for the interest portion", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    const withInterest = recordLoanRepayment(
      { loanId: loan.id, amountKobo: 20000n, interestPortionKobo: 10000n, paidAt: baseDate, note: null },
      [loan],
      ledgerEntries,
      newId,
    );
    expect(withInterest.expense).not.toBeNull();
    expect(withInterest.expense!.category).toBe("LOAN_INTEREST");
    expect(withInterest.expense!.channel).toBe("BOTH");
    expect(withInterest.expense!.amountKobo).toBe(10000n);
    expect(withInterest.expense!.loanRepaymentId).toBe(withInterest.repayment.id);
    expect(withInterest.repayment.expenseId).toBe(withInterest.expense!.id);
    expect(withInterest.expense!.description).toContain("Bank");

    const principalOnly = recordLoanRepayment(
      { loanId: loan.id, amountKobo: 20000n, interestPortionKobo: 0n, paidAt: baseDate, note: null },
      [loan],
      ledgerEntries,
      newId,
    );
    expect(principalOnly.expense).toBeNull();
    expect(principalOnly.repayment.expenseId).toBeNull();
  });

  it("derives ACTIVE / OVERDUE / PAID status", () => {
    const { loan, ledgerEntries } = loanWithLedger();
    expect(loanStatus(loan, ledgerEntries, "2026-10-01")).toBe("OVERDUE");
    expect(loanStatus(loan, ledgerEntries, "2026-08-01")).toBe("ACTIVE");
    const settled: LoanLedgerEntry[] = [
      ...ledgerEntries,
      {
        id: "lr1",
        loanId: loan.id,
        type: "REPAYMENT",
        amountKobo: -110000n,
        loanRepaymentId: "rep1",
        reversesEntryId: null,
        note: null,
        occurredAt: baseDate,
      },
    ];
    expect(loanStatus(loan, settled, "2026-10-01")).toBe("PAID");
  });

  it("validates loan ledger entry signs", () => {
    expect(() =>
      validateLoanLedgerEntry({
        id: "e1",
        loanId: "l1",
        type: "REPAYMENT",
        amountKobo: 10n,
        loanRepaymentId: "r1",
        reversesEntryId: null,
        note: null,
        occurredAt: baseDate,
      }),
    ).toThrow("must be negative");
    expect(() =>
      validateLoanLedgerEntry({
        id: "e2",
        loanId: "l1",
        type: "REPAYMENT",
        amountKobo: -10n,
        loanRepaymentId: null,
        reversesEntryId: null,
        note: null,
        occurredAt: baseDate,
      }),
    ).toThrow("must reference a repayment");
  });
});

/* ------------------------------------------------------------------ *
 * PART 3 — cash snapshots
 * ------------------------------------------------------------------ */

describe("validateCashSnapshot", () => {
  it("rejects negative cash and malformed dates", () => {
    expect(() =>
      validateCashSnapshot({ id: "c1", asOfDate: "2026-10-01", amountKobo: -1n, note: null, createdAt: baseDate }),
    ).toThrow("must not be negative");
    expect(() =>
      validateCashSnapshot({ id: "c2", asOfDate: "10/01/2026", amountKobo: 0n, note: null, createdAt: baseDate }),
    ).toThrow("business date");
    expect(() =>
      validateCashSnapshot({ id: "c3", asOfDate: "2026-10-01", amountKobo: 0n, note: null, createdAt: baseDate }),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * PART 4 — financial position
 * ------------------------------------------------------------------ */

describe("scaleByBpsFloor", () => {
  it("multiplies before dividing and floors the result", () => {
    expect(scaleByBpsFloor(4650n, 6667n)).toBe(3100n); // 4650*6667/10000 = 3100.155
    expect(scaleByBpsFloor(1n, 9999n)).toBe(0n);
    expect(scaleByBpsFloor(100n, 10000n)).toBe(100n);
    expect(scaleByBpsFloor(100n, 0n)).toBe(0n);
    expect(scaleByBpsFloor(-50n, 5000n)).toBe(0n);
  });
});

describe("computeFinancialPosition", () => {
  // A: 2 crates (24/crate) + 10 shelf units. B: 1 crate (12/crate).
  const products = [
    {
      productId: "A",
      warehousePacks: 2,
      fridgeUnits: 10,
      packSizeUnits: 24,
      retailPriceKobo: 500n,
      wholesalePriceKobo: 10000n,
      averageCostKobo: 300n,
    },
    {
      productId: "B",
      warehousePacks: 1,
      fridgeUnits: 0,
      packSizeUnits: 12,
      retailPriceKobo: 200n,
      wholesalePriceKobo: 2000n,
      averageCostKobo: 150n,
    },
  ];

  const baseInput = {
    todayLagosDate: "2026-10-01",
    products,
    receivablesKobo: 5000n,
    cashKobo: 3000n,
    supplierPayablesKobo: 2000n,
    loansOutstandingKobo: 1000n,
  };

  it("computes EXPECTED / BEST / FLOOR with hand-checked numbers", () => {
    const result = computeFinancialPosition(baseInput);

    // EXPECTED = 2*10000 + 10*500 + 1*2000 = 27000
    expect(result.scenarios.EXPECTED.stockValueKobo).toBe(27000n);
    // BEST = (48+10)*500 + 12*200 = 29000 + 2400 = 31400
    expect(result.scenarios.BEST.stockValueKobo).toBe(31400n);
    // FLOOR = (48+10)*300 + 12*150 = 17400 + 1800 = 19200
    expect(result.scenarios.FLOOR.stockValueKobo).toBe(19200n);

    const expected = result.scenarios.EXPECTED;
    expect(expected.receivablesKobo).toBe(5000n);
    expect(expected.cashKobo).toBe(3000n);
    expect(expected.totalAssetsKobo).toBe(35000n); // 27000+5000+3000
    expect(expected.totalLiabilitiesKobo).toBe(3000n); // 2000+1000
    expect(expected.netPositionKobo).toBe(32000n);
    expect(expected.canClearAll).toBe(true);
    expect(expected.coverageBps).toBe(116666); // 35000*10000/3000
    expect(expected.stockOnlyCoverageBps).toBe(90000); // 27000*10000/3000
    expect(expected.stockOnlyNetKobo).toBe(24000n);
  });

  it("returns null coverage and canClearAll=true with no liabilities", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      supplierPayablesKobo: 0n,
      loansOutstandingKobo: 0n,
    });
    const expected = result.scenarios.EXPECTED;
    expect(expected.totalLiabilitiesKobo).toBe(0n);
    expect(expected.coverageBps).toBeNull();
    expect(expected.stockOnlyCoverageBps).toBeNull();
    expect(expected.canClearAll).toBe(true);
  });

  it("reports a negative net and canClearAll=false when liabilities exceed assets", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      supplierPayablesKobo: 50000n,
      loansOutstandingKobo: 10000n,
    });
    const expected = result.scenarios.EXPECTED;
    expect(expected.totalLiabilitiesKobo).toBe(60000n);
    expect(expected.netPositionKobo).toBe(-25000n); // 35000 - 60000
    expect(expected.canClearAll).toBe(false);
    expect(expected.stockOnlyNetKobo).toBe(-33000n); // 27000 - 60000
  });

  it("applies the stock discount and receivables collectible percentages", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      options: { stockDiscountBps: 1000, receivablesCollectibleBps: 5000 },
    });
    const expected = result.scenarios.EXPECTED;
    // 27000 * 9000/10000 = 24300
    expect(expected.stockValueKobo).toBe(24300n);
    // 5000 * 5000/10000 = 2500
    expect(expected.receivablesKobo).toBe(2500n);
    expect(expected.totalAssetsKobo).toBe(24300n + 2500n + 3000n);
  });

  it("can exclude receivables and cash", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      options: { includeReceivables: false, includeCash: false },
    });
    const expected = result.scenarios.EXPECTED;
    expect(expected.receivablesKobo).toBe(0n);
    expect(expected.cashKobo).toBe(0n);
    expect(expected.totalAssetsKobo).toBe(27000n);
  });

  it("ignores zero and negative stock quantities", () => {
    const result = computeFinancialPosition({
      todayLagosDate: "2026-10-01",
      products: [
        {
          productId: "Z",
          warehousePacks: 0,
          fridgeUnits: 0,
          packSizeUnits: 24,
          retailPriceKobo: 500n,
          wholesalePriceKobo: 10000n,
          averageCostKobo: 300n,
        },
        {
          productId: "N",
          warehousePacks: -5,
          fridgeUnits: -2,
          packSizeUnits: 24,
          retailPriceKobo: 500n,
          wholesalePriceKobo: 10000n,
          averageCostKobo: 300n,
        },
      ],
      receivablesKobo: 0n,
      cashKobo: 0n,
      supplierPayablesKobo: 0n,
      loansOutstandingKobo: 0n,
    });
    expect(result.scenarios.EXPECTED.stockValueKobo).toBe(0n);
    expect(result.scenarios.BEST.stockValueKobo).toBe(0n);
    expect(result.scenarios.FLOOR.stockValueKobo).toBe(0n);
  });

  it("counts a product that still holds stock by its quantities", () => {
    const result = computeFinancialPosition({
      todayLagosDate: "2026-10-01",
      products: [
        {
          productId: "inactive-with-stock",
          productName: "Old Stock",
          warehousePacks: 1,
          fridgeUnits: 0,
          packSizeUnits: 6,
          retailPriceKobo: 100n,
          wholesalePriceKobo: 600n,
          averageCostKobo: 50n,
        },
      ],
      receivablesKobo: 0n,
      cashKobo: 0n,
      supplierPayablesKobo: 0n,
      loansOutstandingKobo: 0n,
    });
    expect(result.scenarios.EXPECTED.stockValueKobo).toBe(600n);
    expect(result.scenarios.BEST.stockValueKobo).toBe(600n);
    expect(result.scenarios.FLOOR.stockValueKobo).toBe(300n);
  });

  it("classifies obligation urgency", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      obligations: [
        { kind: "SUPPLIER_PURCHASE", id: "o1", label: "Overdue", balanceKobo: 100n, dueDate: "2026-09-01" },
        { kind: "LOAN", id: "o2", label: "Soon", balanceKobo: 200n, dueDate: "2026-10-05" },
        { kind: "LOAN", id: "o3", label: "Later", balanceKobo: 300n, dueDate: "2026-12-01" },
        { kind: "SUPPLIER_PURCHASE", id: "o4", label: "No due date", balanceKobo: 400n, dueDate: null },
      ],
    });
    expect(result.obligations.map((o) => o.urgency)).toEqual([
      "OVERDUE",
      "DUE_IN_7_DAYS",
      "LATER",
      "LATER",
    ]);
  });

  it("passes through the liabilities breakdown", () => {
    const result = computeFinancialPosition({
      ...baseInput,
      liabilitiesBreakdown: {
        payablesBySupplier: [{ supplierId: "s1", supplierName: "NBC", amountKobo: 2000n }],
        loansByLender: [{ loanId: "l1", lenderName: "Bank", amountKobo: 1000n }],
      },
    });
    expect(result.liabilitiesBreakdown.payablesBySupplier[0].supplierName).toBe("NBC");
    expect(result.liabilitiesBreakdown.loansByLender[0].lenderName).toBe("Bank");
  });
});

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

describe("migrateMockStoreData", () => {
  it("preserves v3 data and marks legacy purchases paid", () => {
    const v3 = {
      purchases: [
        { id: "pur1", totalKobo: "5000", supplierId: "s1", status: "RECEIVED" },
        { id: "pur2", totalKobo: "700", paidKobo: "200", supplierId: "s2", status: "RECEIVED" },
      ],
      expenses: [{ id: "e1", amountKobo: "100", category: "RENT" }],
      products: [{ id: "p1", name: "Lager" }],
      custom: { keep: true },
    };

    const result = migrateMockStoreData(3, v3);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(5);

    const purchases = result!.data.purchases as Array<Record<string, unknown>>;
    // Legacy purchase with no paidKobo defaults to fully paid.
    expect(purchases[0].paidKobo).toBe("5000");
    expect(purchases[0].dueDate).toBeNull();
    // An existing paidKobo is preserved.
    expect(purchases[1].paidKobo).toBe("200");

    const expenses = result!.data.expenses as Array<Record<string, unknown>>;
    expect(expenses[0].loanRepaymentId).toBeNull();
    expect(expenses[0].category).toBe("RENT");

    // Existing data survives untouched.
    expect((result!.data.products as unknown[])[0]).toEqual({ id: "p1", name: "Lager" });
    expect(result!.data.custom).toEqual({ keep: true });

    // New collections are created empty.
    expect(result!.data.loans).toEqual([]);
    expect(result!.data.cashSnapshots).toEqual([]);
    expect(result!.data.supplierPayments).toEqual([]);
    expect(result!.data.loanLedgerEntries).toEqual([]);
    expect(result!.data.loanRepayments).toEqual([]);
  });

  it("is idempotent from the current version", () => {
    const current = { purchases: [{ id: "pur1", totalKobo: "100", paidKobo: "100" }] };
    const once = migrateMockStoreData(5, current)!;
    const twice = migrateMockStoreData(5, once.data)!;
    expect(twice.data.purchases).toEqual(once.data.purchases);
  });

  it("refuses a future version so the caller can reseed", () => {
    expect(migrateMockStoreData(99, {})).toBeNull();
    expect(migrateMockStoreData(0, {})).toBeNull();
  });
});
