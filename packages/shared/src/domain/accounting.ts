import type {
  CashSnapshot,
  Loan,
  LoanLedgerEntry,
  Purchase,
  PurchasePaymentStatus,
} from "./types.ts";

/* ------------------------------------------------------------------ *
 * Rounding rule
 *
 * Money is integer kobo; we never introduce floats. Every scaling step
 * multiplies BEFORE dividing and floors the integer division, so asset
 * valuations round DOWN. Liabilities are exact sums (no rounding). This
 * keeps the position conservative: we never claim to be able to clear
 * more than we actually could.
 * ------------------------------------------------------------------ */

/** `value x bps / 10000`, floored. Negative/zero inputs yield zero. */
export function scaleByBpsFloor(value: bigint, bps: bigint): bigint {
  if (value <= 0n) return 0n;
  if (bps <= 0n) return 0n;
  if (bps >= 10000n) return value;
  return (value * bps) / 10000n;
}

/** Integer ratio in basis points, floored. */
function ratioBpsFloor(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  const bps = (numerator * 10000n) / denominator;
  return Number(bps);
}

/* ------------------------------------------------------------------ *
 * Derived statuses (never stored)
 * ------------------------------------------------------------------ */

export function purchaseBalanceKobo(purchase: Purchase): bigint {
  const balance = purchase.totalKobo - purchase.paidKobo;
  return balance > 0n ? balance : 0n;
}

export function purchasePaymentStatus(
  purchase: Purchase,
): PurchasePaymentStatus {
  if (purchase.paidKobo <= 0n) return "UNPAID";
  if (purchase.paidKobo >= purchase.totalKobo) return "PAID";
  return "PARTIAL";
}

export function isPurchaseOverdue(
  purchase: Purchase,
  todayLagosDate: string,
): boolean {
  return (
    purchase.dueDate !== null &&
    purchase.dueDate < todayLagosDate &&
    purchaseBalanceKobo(purchase) > 0n &&
    purchase.status !== "VOIDED"
  );
}

export function loanOutstandingKobo(
  loanId: string,
  entries: readonly LoanLedgerEntry[],
): bigint {
  let outstanding = 0n;
  for (const entry of entries) {
    if (entry.loanId !== loanId) continue;
    outstanding += entry.amountKobo;
  }
  return outstanding;
}

export function loanStatus(
  loan: Loan,
  entries: readonly LoanLedgerEntry[],
  todayLagosDate: string,
): "ACTIVE" | "PAID" | "OVERDUE" {
  const outstanding = loanOutstandingKobo(loan.id, entries);
  if (outstanding <= 0n) return "PAID";
  if (loan.dueDate !== null && loan.dueDate < todayLagosDate) return "OVERDUE";
  return "ACTIVE";
}

/* ------------------------------------------------------------------ *
 * Financial position ("can I clear everything?")
 * ------------------------------------------------------------------ */

export type FinancialPositionScenario = "EXPECTED" | "BEST" | "FLOOR";

export const FINANCIAL_POSITION_SCENARIOS: readonly FinancialPositionScenario[] =
  ["EXPECTED", "BEST", "FLOOR"];

export interface FinancialPositionProductInput {
  productId: string;
  productName?: string;
  /** Whole packs sitting in the warehouse. */
  warehousePacks: number;
  /** Loose warehouse units that do not form a full pack. Defaults to 0. */
  warehouseLooseUnits?: number;
  /** Units on the retail shelf / market. */
  fridgeUnits: number;
  packSizeUnits: number;
  /** Per unit. */
  retailPriceKobo: bigint;
  /** Per pack (crate). */
  wholesalePriceKobo: bigint;
  /** Per UNIT — matches `stockWorthAtCost` and `Product.averageCostKobo`. */
  averageCostKobo: bigint;
}

export interface FinancialPositionSupplierLine {
  supplierId: string;
  supplierName: string;
  amountKobo: bigint;
}

export interface FinancialPositionLenderLine {
  loanId: string;
  lenderName: string;
  amountKobo: bigint;
}

export interface FinancialPositionLiabilitiesBreakdown {
  payablesBySupplier: FinancialPositionSupplierLine[];
  loansByLender: FinancialPositionLenderLine[];
}

export type ObligationUrgency = "OVERDUE" | "DUE_IN_7_DAYS" | "LATER";

export interface FinancialObligation {
  kind: "SUPPLIER_PURCHASE" | "LOAN";
  id: string;
  label: string;
  balanceKobo: bigint;
  dueDate: string | null;
  urgency: ObligationUrgency;
}

export interface FinancialPositionOptions {
  /** 0..10000. Applied to stock value only. */
  stockDiscountBps?: number;
  /** 0..10000. Applied to customer debts. */
  receivablesCollectibleBps?: number;
  includeReceivables?: boolean;
  includeCash?: boolean;
}

export interface FinancialPositionInput {
  /** Lagos business date (YYYY-MM-DD) used for overdue classification. */
  todayLagosDate: string;
  products: readonly FinancialPositionProductInput[];
  receivablesKobo: bigint;
  cashKobo: bigint;
  supplierPayablesKobo: bigint;
  loansOutstandingKobo: bigint;
  options?: FinancialPositionOptions;
  liabilitiesBreakdown?: FinancialPositionLiabilitiesBreakdown;
  obligations?: readonly Omit<FinancialObligation, "urgency">[];
}

export interface FinancialPositionScenarioResult {
  scenario: FinancialPositionScenario;
  stockValueKobo: bigint;
  receivablesKobo: bigint;
  cashKobo: bigint;
  totalAssetsKobo: bigint;
  totalLiabilitiesKobo: bigint;
  netPositionKobo: bigint;
  canClearAll: boolean;
  /** Assets x 10000 / liabilities. Null when there are no liabilities. */
  coverageBps: number | null;
  /** Stock alone x 10000 / liabilities. Null when there are no liabilities. */
  stockOnlyCoverageBps: number | null;
  /** Stock alone minus liabilities. */
  stockOnlyNetKobo: bigint;
}

export interface FinancialPositionResult {
  scenarios: Record<
    FinancialPositionScenario,
    FinancialPositionScenarioResult
  >;
  liabilitiesBreakdown: FinancialPositionLiabilitiesBreakdown;
  obligations: FinancialObligation[];
}

function addDaysToLagosDate(date: string, days: number): string {
  const parts = date.split("-").map((part) => Number(part));
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function classifyUrgency(
  dueDate: string | null,
  todayLagosDate: string,
): ObligationUrgency {
  if (dueDate === null) return "LATER";
  if (dueDate < todayLagosDate) return "OVERDUE";
  const soonest = addDaysToLagosDate(todayLagosDate, 7);
  if (dueDate <= soonest) return "DUE_IN_7_DAYS";
  return "LATER";
}

function stockValueForScenario(
  products: readonly FinancialPositionProductInput[],
  scenario: FinancialPositionScenario,
  discountBps: bigint,
): bigint {
  let raw = 0n;
  for (const product of products) {
    if (!Number.isFinite(product.packSizeUnits) || product.packSizeUnits <= 0) {
      continue;
    }
    const packs = Math.max(0, Math.floor(product.warehousePacks));
    const loose = Math.max(0, Math.floor(product.warehouseLooseUnits ?? 0));
    const fridge = Math.max(0, Math.floor(product.fridgeUnits));
    if (packs === 0 && loose === 0 && fridge === 0) continue;

    const warehouseUnits = packs * product.packSizeUnits + loose;

    if (scenario === "EXPECTED") {
      // Whole warehouse packs fetch the wholesale (per-crate) price; shelf
      // units fetch retail. Loose warehouse units have no whole-pack price
      // and are excluded from this scenario.
      raw +=
        BigInt(packs) * product.wholesalePriceKobo +
        BigInt(fridge) * product.retailPriceKobo;
    } else if (scenario === "BEST") {
      raw += BigInt(warehouseUnits + fridge) * product.retailPriceKobo;
    } else {
      // FLOOR: every unit at cost. averageCostKobo is per unit.
      raw += BigInt(warehouseUnits + fridge) * product.averageCostKobo;
    }
  }
  return scaleByBpsFloor(raw, 10000n - discountBps);
}

export function computeFinancialPosition(
  input: FinancialPositionInput,
): FinancialPositionResult {
  const options = input.options ?? {};
  const discountBpsRaw = options.stockDiscountBps ?? 0;
  const collectibleBpsRaw = options.receivablesCollectibleBps ?? 10000;

  if (discountBpsRaw < 0 || discountBpsRaw > 10000) {
    throw new RangeError("stockDiscountBps must be between 0 and 10000.");
  }
  if (collectibleBpsRaw < 0 || collectibleBpsRaw > 10000) {
    throw new RangeError("receivablesCollectibleBps must be between 0 and 10000.");
  }

  const discountBps = BigInt(discountBpsRaw);
  const collectibleBps = BigInt(collectibleBpsRaw);

  const includeReceivables = options.includeReceivables ?? true;
  const includeCash = options.includeCash ?? true;

  const receivablesKobo = includeReceivables
    ? scaleByBpsFloor(input.receivablesKobo, collectibleBps)
    : 0n;
  const cashKobo = includeCash ? (input.cashKobo > 0n ? input.cashKobo : 0n) : 0n;

  // Liabilities are exact sums; never discounted.
  const totalLiabilitiesKobo =
    input.supplierPayablesKobo + input.loansOutstandingKobo;

  const scenarios = {} as Record<
    FinancialPositionScenario,
    FinancialPositionScenarioResult
  >;

  for (const scenario of FINANCIAL_POSITION_SCENARIOS) {
    const stockValueKobo = stockValueForScenario(
      input.products,
      scenario,
      discountBps,
    );
    const totalAssetsKobo = stockValueKobo + receivablesKobo + cashKobo;
    const netPositionKobo = totalAssetsKobo - totalLiabilitiesKobo;
    const stockOnlyNetKobo = stockValueKobo - totalLiabilitiesKobo;

    scenarios[scenario] = {
      scenario,
      stockValueKobo,
      receivablesKobo,
      cashKobo,
      totalAssetsKobo,
      totalLiabilitiesKobo,
      netPositionKobo,
      canClearAll: netPositionKobo >= 0n,
      coverageBps:
        totalLiabilitiesKobo === 0n
          ? null
          : ratioBpsFloor(totalAssetsKobo, totalLiabilitiesKobo),
      stockOnlyCoverageBps:
        totalLiabilitiesKobo === 0n
          ? null
          : ratioBpsFloor(stockValueKobo, totalLiabilitiesKobo),
      stockOnlyNetKobo,
    };
  }

  const obligations: FinancialObligation[] = (input.obligations ?? []).map(
    (obligation) => ({
      ...obligation,
      urgency: classifyUrgency(obligation.dueDate, input.todayLagosDate),
    }),
  );

  return {
    scenarios,
    liabilitiesBreakdown: input.liabilitiesBreakdown ?? {
      payablesBySupplier: [],
      loansByLender: [],
    },
    obligations,
  };
}

/* ------------------------------------------------------------------ *
 * Validators used by the store invariants
 * ------------------------------------------------------------------ */

export function validatePurchasePaymentFields(purchase: Purchase): void {
  if (purchase.paidKobo < 0n) {
    throw new RangeError("Purchase paid amount must not be negative.");
  }
  if (purchase.paidKobo > purchase.totalKobo) {
    throw new RangeError("Purchase paid amount may not exceed the purchase total.");
  }
  if (purchase.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(purchase.dueDate)) {
    throw new RangeError("Purchase due date must be a YYYY-MM-DD business date.");
  }
}

const LOAN_LEDGER_SIGNS: Record<LoanLedgerEntry["type"], "positive" | "negative"> =
  {
    DISBURSEMENT: "positive",
    CHARGE: "positive",
    REPAYMENT: "negative",
  };

export function validateLoanLedgerEntry(entry: LoanLedgerEntry): void {
  if (entry.amountKobo === 0n) {
    throw new RangeError(`${entry.type} loan ledger amounts must not be zero.`);
  }
  const rule = LOAN_LEDGER_SIGNS[entry.type];
  if (rule === "positive" && entry.amountKobo < 0n) {
    throw new RangeError(`${entry.type} loan ledger amounts must be positive.`);
  }
  if (rule === "negative" && entry.amountKobo > 0n) {
    throw new RangeError(`${entry.type} loan ledger amounts must be negative.`);
  }
  if (entry.type === "REPAYMENT" && entry.loanRepaymentId === null) {
    throw new RangeError("A REPAYMENT loan ledger entry must reference a repayment.");
  }
  if (entry.type !== "REPAYMENT" && entry.loanRepaymentId !== null) {
    throw new RangeError(
      `A ${entry.type} loan ledger entry must not reference a repayment.`,
    );
  }
}

export function validateLoanLedgerReversals(
  entries: readonly LoanLedgerEntry[],
): void {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversed = new Set<string>();
  for (const entry of entries) {
    if (entry.reversesEntryId === null) continue;
    const target = byId.get(entry.reversesEntryId);
    if (!target) {
      throw new RangeError(
        `Loan ledger reversal '${entry.id}' references a missing target.`,
      );
    }
    if (target.reversesEntryId !== null) {
      throw new RangeError("A loan ledger reversal cannot target another reversal.");
    }
    if (reversed.has(target.id)) {
      throw new RangeError(`Loan ledger entry '${target.id}' was already reversed.`);
    }
    reversed.add(target.id);
    if (entry.loanId !== target.loanId || entry.type !== target.type) {
      throw new RangeError(
        "A loan ledger reversal must keep the same loan and type as its target.",
      );
    }
    if (entry.amountKobo !== -target.amountKobo) {
      throw new RangeError("A loan ledger reversal must negate the target amount.");
    }
  }
}

export function validateCashSnapshot(snapshot: CashSnapshot): void {
  if (snapshot.amountKobo < 0n) {
    throw new RangeError("A cash snapshot amount must not be negative.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOfDate)) {
    throw new RangeError("A cash snapshot date must be a YYYY-MM-DD business date.");
  }
}
