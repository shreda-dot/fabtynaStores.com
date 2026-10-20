import type {
  Account,
  AccountLedgerEntry,
  CustomerLedgerEntry,
  Expense,
  PaymentMethod,
  Product,
  Purchase,
  PurchaseLine,
  Sale,
  SaleChannel,
  SaleLine,
  SalePayment,
  StockAdjustment,
  StockAdjustmentLine,
  StockLocation,
  StockMovement,
  StockTransfer,
  StockTransferLeg,
  StockTransferLine,
  SupplierLedgerEntry,
  SupplierPayment,
  Unit,
} from "./types.ts";
import {
  accountBalanceKobo,
  assertAccountWillRemainNonnegative,
  assertStockWillRemainNonnegative,
  buildAccountLedgerEntry,
  buildLedgerReversal,
  buildStockMovementReversal,
  calculateWeightedAverageCostKobo,
  recomputeAverageCostKobo,
  totalUnitsForProduct,
} from "./index.ts";
import { getLagosBusinessDate } from "../lagos-time.ts";

/**
 * Names an account for an error message. Falls back to the id so a caller that
 * did not pass its account list still gets a message naming the account.
 */
function accountRef(
  accounts: readonly Account[],
  accountId: string,
): { id: string; name: string } {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return account
    ? { id: account.id, name: account.name }
    : { id: accountId, name: accountId };
}

export function requireAccountId(
  accountId: string | null | undefined,
  what: string,
): string {
  if (accountId === null || accountId === undefined || accountId === "") {
    throw new RangeError(`An account is required when ${what}.`);
  }
  return accountId;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Denominator must be positive.");
  }
  if (numerator < 0n) {
    return -roundHalfUp(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
}

/**
 * Decimal places kept on a line quantity. Matches `NUMERIC(12, 4)` in
 * `sale_lines.quantity` / `purchase_lines.quantity`.
 */
const QUANTITY_SCALE = 4;
const QUANTITY_SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/**
 * Turns a line quantity into an exact scaled integer (scale 4) so that
 * fractional quantities — a wholesale customer buying half a crate — can be
 * converted to base units and to money without ever multiplying two floats.
 */
function toScaledQuantity(quantity: number): bigint {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RangeError("Line quantity must be a positive number.");
  }
  const text = quantity.toString();
  if (text.includes("e") || text.includes("E")) {
    throw new RangeError("Line quantity must not use exponent notation.");
  }
  const [wholePart, fractionPart = ""] = text.split(".");
  if (fractionPart.length > QUANTITY_SCALE) {
    throw new RangeError(
      `Line quantity must not have more than ${QUANTITY_SCALE} decimal places.`,
    );
  }
  return (
    BigInt(wholePart) * QUANTITY_SCALE_FACTOR +
    BigInt(fractionPart.padEnd(QUANTITY_SCALE, "0"))
  );
}

export type IdGenerator = () => string;

export interface ReceivePurchaseLineInput {
  productId: string;
  unit: Unit;
  quantity: number;
  lineTotalKobo: bigint;
}

export interface ReceivePurchaseInput {
  supplierId: string | null;
  createdById: string;
  location: StockLocation;
  purchasedAt: Date;
  notes: string | null;
  reference: string | null;
  /**
   * Lagos business date (YYYY-MM-DD) the balance becomes overdue. Optional for
   * backwards compatibility; defaults to null (no due date).
   */
  dueDate?: string | null;
  /**
   * Amount paid to the supplier up front. 0..totalKobo; a balance above zero
   * requires a supplier. Optional for backwards compatibility; defaults to the
   * full total, i.e. a legacy fully-paid purchase.
   */
  amountPaidNowKobo?: bigint;
  /** How the up-front payment was made. Optional; defaults to CASH. */
  paymentMethod?: PaymentMethod;
  /**
   * The account the up-front payment left. Required whenever anything is paid
   * now, because money that left the business must be recorded against an
   * account.
   */
  accountId?: string | null;
  lines: ReceivePurchaseLineInput[];
}

export interface ReceivePurchaseResult {
  purchase: Purchase;
  purchaseLines: PurchaseLine[];
  movements: StockMovement[];
  /** The PURCHASE ledger entry (the amount owed to the supplier). */
  supplierLedgerEntry: SupplierLedgerEntry | null;
  /** The up-front payment, when `amountPaidNowKobo > 0`. */
  supplierPayment: SupplierPayment | null;
  /** The negative PAYMENT ledger entry for the up-front payment. */
  supplierPaymentLedgerEntry: SupplierLedgerEntry | null;
  /**
   * The account entry for the up-front payment: SUPPLIER_PAYMENT when a
   * supplier was paid, PURCHASE_PAYMENT when a supplier-less cash purchase was
   * paid. Null when nothing was paid now.
   */
  accountLedgerEntry: AccountLedgerEntry | null;
  productUpdates: Array<{ id: string; averageCostKobo: bigint }>;
}

export function receivePurchase(
  input: ReceivePurchaseInput,
  existingProducts: readonly Product[],
  existingMovements: readonly StockMovement[],
  newId: IdGenerator,
): ReceivePurchaseResult {
  if (input.lines.length === 0) {
    throw new RangeError("A purchase must have at least one line.");
  }
  if (!Number.isFinite(input.purchasedAt.getTime())) {
    throw new RangeError("Purchase date must be valid.");
  }

  const productById = new Map(existingProducts.map((p) => [p.id, p]));
  const purchaseId = newId();

  const purchaseLines: PurchaseLine[] = [];
  const movements: StockMovement[] = [];
  const productUpdates: Array<{ id: string; averageCostKobo: bigint }> = [];
  let totalKobo = 0n;
  const runningUnitsByProduct = new Map<string, bigint>();
  const runningAverageByProduct = new Map<string, bigint>();

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new RangeError(`Product '${line.productId}' not found.`);
    }
    if (line.lineTotalKobo < 0n) {
      throw new RangeError("Purchase line total must not be negative.");
    }

    const unitsPerPackSnapshot = product.unitsPerPack;
    // A PACK line may be fractional (half a crate), so the conversion to base
    // units is done in scaled integers — never by multiplying two floats —
    // exactly as `recordSale` does for the sales side.
    const scaledQuantity = toScaledQuantity(line.quantity);
    const scaledUnits =
      line.unit === "UNIT"
        ? scaledQuantity
        : scaledQuantity * BigInt(unitsPerPackSnapshot);

    if (scaledUnits % QUANTITY_SCALE_FACTOR !== 0n) {
      throw new RangeError(
        "Purchase line quantity must result in a positive whole number of units.",
      );
    }

    const quantityUnits = Number(scaledUnits / QUANTITY_SCALE_FACTOR);
    if (!Number.isSafeInteger(quantityUnits) || quantityUnits <= 0) {
      throw new RangeError("Purchase line quantity must be a positive whole number of units.");
    }

    const unitCostKobo = roundHalfUp(line.lineTotalKobo, BigInt(quantityUnits));

    const purchaseLineId = newId();
    purchaseLines.push({
      id: purchaseLineId,
      purchaseId,
      productId: line.productId,
      unit: line.unit,
      quantity: line.quantity,
      unitsPerPackSnapshot,
      quantityUnits,
      unitCostKobo,
      lineTotalKobo: line.lineTotalKobo,
    });

    movements.push({
      id: newId(),
      productId: line.productId,
      location: input.location,
      type: "PURCHASE",
      quantityUnits,
      unitCostKobo,
      purchaseLineId,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: input.purchasedAt,
      createdAt: input.purchasedAt,
    });

    // Several lines may be the same product: each one must average on top of
    // the previous line, not on the pre-purchase stock.
    const runningUnits =
      runningUnitsByProduct.get(line.productId) ??
      BigInt(totalUnitsForProduct(existingMovements, line.productId));
    const runningAverage =
      runningAverageByProduct.get(line.productId) ?? product.averageCostKobo;
    const newAverage = calculateWeightedAverageCostKobo(
      runningUnits,
      runningAverage,
      BigInt(quantityUnits),
      line.lineTotalKobo,
    );
    runningUnitsByProduct.set(line.productId, runningUnits + BigInt(quantityUnits));
    runningAverageByProduct.set(line.productId, newAverage);
    const updateIndex = productUpdates.findIndex((update) => update.id === line.productId);
    if (updateIndex >= 0) {
      productUpdates[updateIndex] = { id: line.productId, averageCostKobo: newAverage };
    } else {
      productUpdates.push({ id: line.productId, averageCostKobo: newAverage });
    }

    totalKobo += line.lineTotalKobo;
  }

  // Backwards compatibility: an absent "paid now" means the purchase is
  // settled in full, matching the pre-supplier-credit behaviour.
  const amountPaidNowKobo = input.amountPaidNowKobo ?? totalKobo;
  const dueDate = input.dueDate ?? null;

  if (amountPaidNowKobo < 0n) {
    throw new RangeError("The amount paid now must not be negative.");
  }
  if (amountPaidNowKobo > totalKobo) {
    throw new RangeError(
      `The amount paid now (${amountPaidNowKobo.toString()} kobo) cannot exceed the total (${totalKobo.toString()} kobo).`,
    );
  }
  const unpaidKobo = totalKobo - amountPaidNowKobo;
  if (unpaidKobo > 0n && input.supplierId === null) {
    throw new RangeError(
      "A supplier is required when a purchase is not fully paid.",
    );
  }

  const purchase: Purchase = {
    id: purchaseId,
    supplierId: input.supplierId,
    createdById: input.createdById,
    status: "RECEIVED",
    reference: input.reference,
    notes: input.notes,
    totalKobo,
    paidKobo: amountPaidNowKobo,
    dueDate,
    purchasedAt: input.purchasedAt,
    receivedAt: input.purchasedAt,
    createdAt: input.purchasedAt,
    updatedAt: input.purchasedAt,
  };

  let supplierLedgerEntry: SupplierLedgerEntry | null = null;
  let supplierPayment: SupplierPayment | null = null;
  let supplierPaymentLedgerEntry: SupplierLedgerEntry | null = null;
  let accountLedgerEntry: AccountLedgerEntry | null = null;

  if (input.supplierId !== null) {
    supplierLedgerEntry = {
      id: newId(),
      supplierId: input.supplierId,
      type: "PURCHASE",
      amountKobo: totalKobo,
      purchaseId,
      supplierPaymentId: null,
      reversesEntryId: null,
      note: null,
      occurredAt: input.purchasedAt,
    };
  }

  if (amountPaidNowKobo > 0n) {
    // Money left the business, so it must leave a named account. The store
    // layer resolves the account (by method for legacy data, by choice for new
    // records); the domain only insists that one is supplied.
    const accountId = requireAccountId(input.accountId, "a purchase is paid now");

    if (input.supplierId !== null) {
      supplierPayment = {
        id: newId(),
        supplierId: input.supplierId,
        purchaseId,
        accountId,
        amountKobo: amountPaidNowKobo,
        method: input.paymentMethod ?? "CASH",
        note: "Paid at receipt",
        paidAt: input.purchasedAt,
        createdAt: input.purchasedAt,
      };
      supplierPaymentLedgerEntry = {
        id: newId(),
        supplierId: input.supplierId,
        type: "PAYMENT",
        amountKobo: -amountPaidNowKobo,
        purchaseId: null,
        supplierPaymentId: supplierPayment.id,
        reversesEntryId: null,
        note: null,
        occurredAt: input.purchasedAt,
      };
      accountLedgerEntry = buildAccountLedgerEntry(
        {
          accountId,
          type: "SUPPLIER_PAYMENT",
          amountKobo: -amountPaidNowKobo,
          supplierPaymentId: supplierPayment.id,
          occurredAt: input.purchasedAt,
        },
        newId,
      );
    } else {
      // A supplier-less cash purchase has no supplier payment row to hang the
      // outflow on, so the account entry is keyed on the purchase itself.
      accountLedgerEntry = buildAccountLedgerEntry(
        {
          accountId,
          type: "PURCHASE_PAYMENT",
          amountKobo: -amountPaidNowKobo,
          purchaseId,
          occurredAt: input.purchasedAt,
        },
        newId,
      );
    }
  }

  return {
    purchase,
    purchaseLines,
    movements,
    supplierLedgerEntry,
    supplierPayment,
    supplierPaymentLedgerEntry,
    accountLedgerEntry,
    productUpdates,
  };
}

export interface BuildTransferLineInput {
  productId: string;
  quantityUnits: number;
}

export interface BuildTransferInput {
  createdById: string;
  from: StockLocation;
  to: StockLocation;
  reason: string | null;
  reference: string | null;
  transferredAt: Date;
  lines: BuildTransferLineInput[];
}

export interface BuildTransferResult {
  transfer: StockTransfer;
  transferLines: StockTransferLine[];
  transferLegs: StockTransferLeg[];
  movements: StockMovement[];
}

export function buildTransfer(
  input: BuildTransferInput,
  existingProducts: readonly Product[],
  existingMovements: readonly StockMovement[],
  newId: IdGenerator,
): BuildTransferResult {
  if (input.from === input.to) {
    throw new RangeError("A stock transfer must move stock between two different locations.");
  }
  if (input.lines.length === 0) {
    throw new RangeError("A stock transfer must have at least one line.");
  }
  if (!Number.isFinite(input.transferredAt.getTime())) {
    throw new RangeError("Transfer date must be valid.");
  }

  const productById = new Map(existingProducts.map((p) => [p.id, p]));
  const transferId = newId();

  const transferLines: StockTransferLine[] = [];
  const transferLegs: StockTransferLeg[] = [];
  const movements: StockMovement[] = [];

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new RangeError(`Product '${line.productId}' not found.`);
    }
    if (!Number.isSafeInteger(line.quantityUnits) || line.quantityUnits <= 0) {
      throw new RangeError("Transfer quantity must be a positive safe integer.");
    }

    const currentAtSource = existingMovements
      .filter(
        (m) =>
          m.productId === line.productId &&
          m.location === input.from &&
          m.reversesEntryId === null,
      )
      .reduce((sum, m) => sum + m.quantityUnits, 0);

    assertStockWillRemainNonnegative(
      BigInt(currentAtSource),
      BigInt(-line.quantityUnits),
    );

    const transferLineId = newId();
    transferLines.push({
      id: transferLineId,
      transferId,
      productId: line.productId,
      quantityUnits: line.quantityUnits,
    });

    const outLegId = newId();
    const inLegId = newId();
    transferLegs.push(
      { id: outLegId, transferLineId, location: input.from, direction: "OUT" },
      { id: inLegId, transferLineId, location: input.to, direction: "IN" },
    );

    movements.push({
      id: newId(),
      productId: line.productId,
      location: input.from,
      type: "TRANSFER",
      quantityUnits: -line.quantityUnits,
      unitCostKobo: product.averageCostKobo,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: outLegId,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: input.transferredAt,
      createdAt: input.transferredAt,
    });

    movements.push({
      id: newId(),
      productId: line.productId,
      location: input.to,
      type: "TRANSFER",
      quantityUnits: line.quantityUnits,
      unitCostKobo: product.averageCostKobo,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: inLegId,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: input.transferredAt,
      createdAt: input.transferredAt,
    });
  }

  const transfer: StockTransfer = {
    id: transferId,
    createdById: input.createdById,
    from: input.from,
    to: input.to,
    reason: input.reason,
    reference: input.reference,
    transferredAt: input.transferredAt,
    createdAt: input.transferredAt,
  };

  return {
    transfer,
    transferLines,
    transferLegs,
    movements,
  };
}

export interface BuildAdjustmentLineInput {
  productId: string;
  location: StockLocation;
  quantityDeltaUnits: number;
  unitCostKobo: bigint | null;
}

export interface BuildAdjustmentInput {
  createdById: string;
  reason: string;
  adjustedAt: Date;
  lines: BuildAdjustmentLineInput[];
}

export interface BuildAdjustmentResult {
  adjustment: StockAdjustment;
  adjustmentLines: StockAdjustmentLine[];
  movements: StockMovement[];
  productUpdates: Array<{ id: string; averageCostKobo: bigint }>;
}

export function buildAdjustment(
  input: BuildAdjustmentInput,
  existingProducts: readonly Product[],
  existingMovements: readonly StockMovement[],
  newId: IdGenerator,
): BuildAdjustmentResult {
  if (!input.reason || input.reason.trim() === "") {
    throw new RangeError("Stock adjustment reason is required.");
  }
  if (input.lines.length === 0) {
    throw new RangeError("A stock adjustment must have at least one line.");
  }
  if (!Number.isFinite(input.adjustedAt.getTime())) {
    throw new RangeError("Adjustment date must be valid.");
  }

  const productById = new Map(existingProducts.map((p) => [p.id, p]));
  const adjustmentId = newId();

  const adjustmentLines: StockAdjustmentLine[] = [];
  const movements: StockMovement[] = [];
  const productUpdates: Array<{ id: string; averageCostKobo: bigint }> = [];
  const updatedProducts = new Set<string>();

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new RangeError(`Product '${line.productId}' not found.`);
    }
    if (
      !Number.isSafeInteger(line.quantityDeltaUnits) ||
      line.quantityDeltaUnits === 0
    ) {
      throw new RangeError(
        "Stock adjustment quantity delta must be a nonzero safe integer.",
      );
    }

    const isPositive = line.quantityDeltaUnits > 0;
    const unitCostKobo = isPositive
      ? line.unitCostKobo ?? product.averageCostKobo
      : product.averageCostKobo;

    if (unitCostKobo < 0n) {
      throw new RangeError("Stock adjustment unit cost must not be negative.");
    }

    if (!isPositive) {
      const currentAtLocation = existingMovements
        .filter(
          (m) =>
            m.productId === line.productId &&
            m.location === line.location &&
            m.reversesEntryId === null,
        )
        .reduce((sum, m) => sum + m.quantityUnits, 0);
      assertStockWillRemainNonnegative(
        BigInt(currentAtLocation),
        BigInt(line.quantityDeltaUnits),
      );
    }

    const adjustmentLineId = newId();
    adjustmentLines.push({
      id: adjustmentLineId,
      adjustmentId,
      productId: line.productId,
      location: line.location,
      quantityDeltaUnits: line.quantityDeltaUnits,
      unitCostKobo,
      reason: null,
    });

    movements.push({
      id: newId(),
      productId: line.productId,
      location: line.location,
      type: "ADJUSTMENT",
      quantityUnits: line.quantityDeltaUnits,
      unitCostKobo,
      purchaseLineId: null,
      saleLineId: null,
      transferLegId: null,
      adjustmentLineId,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: input.adjustedAt,
      createdAt: input.adjustedAt,
    });

    if (isPositive && !updatedProducts.has(line.productId)) {
      const existingUnits = BigInt(
        totalUnitsForProduct(existingMovements, line.productId),
      );
      const newAverage = calculateWeightedAverageCostKobo(
        existingUnits,
        product.averageCostKobo,
        BigInt(line.quantityDeltaUnits),
        BigInt(line.quantityDeltaUnits) * unitCostKobo,
      );
      productUpdates.push({ id: line.productId, averageCostKobo: newAverage });
      updatedProducts.add(line.productId);
    }
  }

  const adjustment: StockAdjustment = {
    id: adjustmentId,
    createdById: input.createdById,
    reason: input.reason.trim(),
    status: "COMPLETED",
    adjustedAt: input.adjustedAt,
    createdAt: input.adjustedAt,
  };

  return {
    adjustment,
    adjustmentLines,
    movements,
    productUpdates,
  };
}

export interface VoidResult {
  reversalMovements: StockMovement[];
  reversalSupplierLedgerEntry: SupplierLedgerEntry | null;
  /** Money that must travel back into the account when the document is voided. */
  reversalAccountLedgerEntries: AccountLedgerEntry[];
  productUpdates: Array<{ id: string; averageCostKobo: bigint }>;
}

/**
 * Builds the account reversals for a void. Refuses up front — before writing
 * anything — when the money has already been spent and the reversal would take
 * an account below zero, so the caller gets a message naming the account
 * instead of a raw CHECK violation.
 */
export function buildAccountReversals(
  targets: readonly AccountLedgerEntry[],
  existingAccountLedger: readonly AccountLedgerEntry[],
  accounts: readonly Account[],
  reversedAt: Date,
  newId: IdGenerator,
  note?: string,
): AccountLedgerEntry[] {
  if (targets.length === 0) return [];

  const deltaByAccount = new Map<string, bigint>();
  for (const target of targets) {
    deltaByAccount.set(
      target.accountId,
      (deltaByAccount.get(target.accountId) ?? 0n) - target.amountKobo,
    );
  }
  for (const [accountId, delta] of deltaByAccount) {
    assertAccountWillRemainNonnegative(
      accountRef(accounts, accountId),
      accountBalanceKobo(accountId, existingAccountLedger),
      delta,
      "reversal",
    );
  }

  const created: AccountLedgerEntry[] = [];
  const all: AccountLedgerEntry[] = [...existingAccountLedger];
  for (const target of targets) {
    const built = buildLedgerReversal(target, all, newId(), reversedAt);
    const reversal = note === undefined ? built : { ...built, note };
    all.push(reversal);
    created.push(reversal);
  }
  return created;
}

/** Ids of account entries that already have a reversal row. */
function reversedAccountEntryIds(
  accountLedger: readonly AccountLedgerEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of accountLedger) {
    if (entry.reversesEntryId !== null) ids.add(entry.reversesEntryId);
  }
  return ids;
}

/**
 * Ids of supplier payments that have been reversed. A payment is live until
 * the account entry it posted is reversed; the payment tables carry no flag.
 */
export function reversedSupplierPaymentIds(
  accountLedger: readonly AccountLedgerEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of accountLedger) {
    if (
      entry.type === "SUPPLIER_PAYMENT" &&
      entry.reversesEntryId !== null &&
      entry.supplierPaymentId !== null
    ) {
      ids.add(entry.supplierPaymentId);
    }
  }
  return ids;
}

/** Ids of sale payments whose customer PAYMENT ledger entry has been reversed. */
export function reversedSalePaymentIds(
  customerLedger: readonly CustomerLedgerEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of customerLedger) {
    if (
      entry.type === "PAYMENT" &&
      entry.reversesEntryId !== null &&
      entry.salePaymentId !== null
    ) {
      ids.add(entry.salePaymentId);
    }
  }
  return ids;
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === "") {
    throw new RangeError("A reason is required to reverse a payment.");
  }
  return trimmed;
}

export interface ReverseSalePaymentResult {
  sale: Sale;
  customerReversal: CustomerLedgerEntry;
  /** Money out of the account the payment was taken into. */
  accountReversal: AccountLedgerEntry;
}

/**
 * Reverses a LATER (on-account) sale payment: the customer owes it again, the
 * account gives the money back and `paidKobo` drops. An up-front payment has
 * no customer PAYMENT entry and is corrected through void or amend instead.
 */
export function reverseSalePayment(
  saleId: string,
  paymentId: string,
  reason: string,
  reversedAt: Date,
  existingSales: readonly Sale[],
  existingSalePayments: readonly SalePayment[],
  existingCustomerLedger: readonly CustomerLedgerEntry[],
  existingAccountLedger: readonly AccountLedgerEntry[],
  existingAccounts: readonly Account[],
  newId: IdGenerator,
): ReverseSalePaymentResult {
  if (!Number.isFinite(reversedAt.getTime())) {
    throw new RangeError("Reversal date must be valid.");
  }
  const note = requireReason(reason);

  const sale = existingSales.find((s) => s.id === saleId);
  if (!sale) throw new RangeError(`Sale '${saleId}' not found.`);
  if (sale.status === "VOIDED") {
    throw new RangeError("This sale has been voided, so its payments cannot be reversed.");
  }
  const payment = existingSalePayments.find(
    (p) => p.id === paymentId && p.saleId === saleId,
  );
  if (!payment) throw new RangeError("That payment does not belong to this sale.");
  if (sale.customerId === null) {
    throw new RangeError(
      "A sale with no customer cannot have a payment reversed. Void the sale instead.",
    );
  }

  const customerTarget = existingCustomerLedger.find(
    (e) =>
      e.type === "PAYMENT" &&
      e.salePaymentId === paymentId &&
      e.reversesEntryId === null,
  );
  if (!customerTarget) {
    throw new RangeError(
      "This payment was taken when the sale was recorded. Void or amend the sale to correct it.",
    );
  }
  if (existingCustomerLedger.some((e) => e.reversesEntryId === customerTarget.id)) {
    throw new RangeError("This payment has already been reversed.");
  }

  const accountTarget = existingAccountLedger.find(
    (e) =>
      e.type === "SALE_PAYMENT" &&
      e.salePaymentId === paymentId &&
      e.reversesEntryId === null,
  );
  if (!accountTarget) {
    throw new RangeError("The money entry for this payment was not found.");
  }

  const [accountReversal] = buildAccountReversals(
    [accountTarget],
    existingAccountLedger,
    existingAccounts,
    reversedAt,
    newId,
    note,
  );
  const customerReversal = buildLedgerReversal(
    customerTarget,
    existingCustomerLedger,
    newId(),
    reversedAt,
  );

  return {
    sale: {
      ...sale,
      paidKobo: sale.paidKobo - payment.amountKobo,
      updatedAt: reversedAt,
    },
    customerReversal,
    accountReversal: accountReversal!,
  };
}

export interface ReversePurchasePaymentResult {
  purchase: Purchase;
  supplierReversal: SupplierLedgerEntry;
  /** Money back into the account the payment left. */
  accountReversal: AccountLedgerEntry;
}

/** Reverses any supplier payment, including one paid at receipt. */
export function reversePurchasePayment(
  purchaseId: string,
  paymentId: string,
  reason: string,
  reversedAt: Date,
  existingPurchases: readonly Purchase[],
  existingSupplierPayments: readonly SupplierPayment[],
  existingSupplierLedger: readonly SupplierLedgerEntry[],
  existingAccountLedger: readonly AccountLedgerEntry[],
  existingAccounts: readonly Account[],
  newId: IdGenerator,
): ReversePurchasePaymentResult {
  if (!Number.isFinite(reversedAt.getTime())) {
    throw new RangeError("Reversal date must be valid.");
  }
  const note = requireReason(reason);

  const purchase = existingPurchases.find((p) => p.id === purchaseId);
  if (!purchase) throw new RangeError(`Purchase '${purchaseId}' not found.`);
  if (purchase.status === "VOIDED") {
    throw new RangeError("This purchase has been voided, so its payments cannot be reversed.");
  }
  const payment = existingSupplierPayments.find(
    (p) => p.id === paymentId && p.purchaseId === purchaseId,
  );
  if (!payment) throw new RangeError("That payment does not belong to this purchase.");

  const supplierTarget = existingSupplierLedger.find(
    (e) =>
      e.type === "PAYMENT" &&
      e.supplierPaymentId === paymentId &&
      e.reversesEntryId === null,
  );
  if (!supplierTarget) {
    throw new RangeError("The supplier ledger entry for this payment was not found.");
  }
  if (
    existingAccountLedger.some(
      (e) =>
        e.type === "SUPPLIER_PAYMENT" &&
        e.supplierPaymentId === paymentId &&
        e.reversesEntryId !== null,
    )
  ) {
    throw new RangeError("This payment has already been reversed.");
  }
  const accountTarget = existingAccountLedger.find(
    (e) =>
      e.type === "SUPPLIER_PAYMENT" &&
      e.supplierPaymentId === paymentId &&
      e.reversesEntryId === null,
  );
  if (!accountTarget) {
    throw new RangeError("The money entry for this payment was not found.");
  }

  const [accountReversal] = buildAccountReversals(
    [accountTarget],
    existingAccountLedger,
    existingAccounts,
    reversedAt,
    newId,
    note,
  );
  const supplierReversal = buildLedgerReversal(
    supplierTarget,
    existingSupplierLedger,
    newId(),
    reversedAt,
  );

  return {
    purchase: {
      ...purchase,
      paidKobo: purchase.paidKobo - payment.amountKobo,
      updatedAt: reversedAt,
    },
    supplierReversal,
    accountReversal: accountReversal!,
  };
}

export function voidPurchase(
  purchaseId: string,
  voidedAt: Date,
  existingPurchases: readonly Purchase[],
  existingPurchaseLines: readonly PurchaseLine[],
  existingMovements: readonly StockMovement[],
  existingSupplierLedger: readonly SupplierLedgerEntry[],
  newId: IdGenerator,
  existingSupplierPayments: readonly SupplierPayment[] = [],
  existingAccountLedger: readonly AccountLedgerEntry[] = [],
  existingAccounts: readonly Account[] = [],
): VoidResult {
  if (!Number.isFinite(voidedAt.getTime())) {
    throw new RangeError("Void date must be valid.");
  }

  const purchase = existingPurchases.find((p) => p.id === purchaseId);
  if (!purchase) {
    throw new RangeError(`Purchase '${purchaseId}' not found.`);
  }
  if (purchase.status === "VOIDED") {
    throw new RangeError("This purchase has already been voided.");
  }

  // A payment blocks the void only while it is LIVE (its account entry has no
  // reversal row). Mirrors `trg_purchase_void_guard`.
  const reversedPayments = reversedSupplierPaymentIds(existingAccountLedger);
  const hasLivePayments = existingSupplierPayments.some(
    (payment) =>
      payment.purchaseId === purchaseId && !reversedPayments.has(payment.id),
  );
  if (hasLivePayments) {
    throw new RangeError(
      "This purchase has supplier payments recorded and cannot be voided. Reverse the payments first.",
    );
  }

  const lines = existingPurchaseLines.filter((l) => l.purchaseId === purchaseId);
  const lineIds = new Set(lines.map((l) => l.id));

  const purchaseMovements = existingMovements.filter(
    (m) =>
      m.type === "PURCHASE" &&
      m.purchaseLineId !== null &&
      lineIds.has(m.purchaseLineId) &&
      m.reversesEntryId === null,
  );

  const reversalMovements: StockMovement[] = [];
  for (const movement of purchaseMovements) {
    reversalMovements.push(
      buildStockMovementReversal(movement, existingMovements, newId(), voidedAt),
    );
  }

  const balancesAfter = new Map<string, number>();
  for (const movement of existingMovements) {
    const key = `${movement.productId}:${movement.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + movement.quantityUnits);
  }
  for (const reversal of reversalMovements) {
    const key = `${reversal.productId}:${reversal.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + reversal.quantityUnits);
  }
  for (const [key, balance] of balancesAfter) {
    if (balance < 0) {
      const [productId, location] = key.split(":");
      throw new RangeError(
        `Voiding this purchase would make stock for product '${productId}' at ${location} negative (${balance}).`,
      );
    }
  }

  const allMovements = [...existingMovements, ...reversalMovements];
  const affectedProductIds = new Set(purchaseMovements.map((m) => m.productId));
  const productUpdates: Array<{ id: string; averageCostKobo: bigint }> = [];
  for (const productId of affectedProductIds) {
    const productMovements = allMovements.filter((m) => m.productId === productId);
    productUpdates.push({
      id: productId,
      averageCostKobo: recomputeAverageCostKobo(productMovements),
    });
  }

  let reversalSupplierLedgerEntry: SupplierLedgerEntry | null = null;
  const ledgerEntry = existingSupplierLedger.find(
    (e) => e.purchaseId === purchaseId && e.reversesEntryId === null,
  );
  if (ledgerEntry) {
    reversalSupplierLedgerEntry = buildLedgerReversal(
      ledgerEntry,
      existingSupplierLedger,
      newId(),
      voidedAt,
    );
  }

  // A supplier-less cash purchase posted a PURCHASE_PAYMENT entry and no
  // supplier payment row, so voiding it must put that money back. A purchase
  // with a supplier is blocked above when any supplier payment exists.
  const reversedPurchaseEntries = reversedAccountEntryIds(existingAccountLedger);
  const accountTargets = existingAccountLedger.filter(
    (entry) =>
      entry.type === "PURCHASE_PAYMENT" &&
      entry.purchaseId === purchaseId &&
      entry.reversesEntryId === null &&
      !reversedPurchaseEntries.has(entry.id),
  );
  const reversalAccountLedgerEntries = buildAccountReversals(
    accountTargets,
    existingAccountLedger,
    existingAccounts,
    voidedAt,
    newId,
  );

  return {
    reversalMovements,
    reversalSupplierLedgerEntry,
    reversalAccountLedgerEntries,
    productUpdates,
  };
}

export function voidAdjustment(
  adjustmentId: string,
  voidedAt: Date,
  existingAdjustments: readonly StockAdjustment[],
  existingAdjustmentLines: readonly StockAdjustmentLine[],
  existingMovements: readonly StockMovement[],
  newId: IdGenerator,
): VoidResult {
  if (!Number.isFinite(voidedAt.getTime())) {
    throw new RangeError("Void date must be valid.");
  }

  const adjustment = existingAdjustments.find((a) => a.id === adjustmentId);
  if (!adjustment) {
    throw new RangeError(`Stock adjustment '${adjustmentId}' not found.`);
  }
  if (adjustment.status === "VOIDED") {
    throw new RangeError("This stock adjustment has already been voided.");
  }

  const lines = existingAdjustmentLines.filter((l) => l.adjustmentId === adjustmentId);
  const lineIds = new Set(lines.map((l) => l.id));

  const adjustmentMovements = existingMovements.filter(
    (m) =>
      m.type === "ADJUSTMENT" &&
      m.adjustmentLineId !== null &&
      lineIds.has(m.adjustmentLineId) &&
      m.reversesEntryId === null,
  );

  const reversalMovements: StockMovement[] = [];
  for (const movement of adjustmentMovements) {
    reversalMovements.push(
      buildStockMovementReversal(movement, existingMovements, newId(), voidedAt),
    );
  }

  const balancesAfter = new Map<string, number>();
  for (const movement of existingMovements) {
    const key = `${movement.productId}:${movement.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + movement.quantityUnits);
  }
  for (const reversal of reversalMovements) {
    const key = `${reversal.productId}:${reversal.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + reversal.quantityUnits);
  }
  for (const [key, balance] of balancesAfter) {
    if (balance < 0) {
      const [productId, location] = key.split(":");
      throw new RangeError(
        `Voiding this adjustment would make stock for product '${productId}' at ${location} negative (${balance}).`,
      );
    }
  }

  const allMovements = [...existingMovements, ...reversalMovements];
  const affectedProductIds = new Set(adjustmentMovements.map((m) => m.productId));
  const productUpdates: Array<{ id: string; averageCostKobo: bigint }> = [];
  for (const productId of affectedProductIds) {
    const productMovements = allMovements.filter((m) => m.productId === productId);
    productUpdates.push({
      id: productId,
      averageCostKobo: recomputeAverageCostKobo(productMovements),
    });
  }

  return {
    reversalMovements,
    reversalSupplierLedgerEntry: null,
    reversalAccountLedgerEntries: [],
    productUpdates,
  };
}

export interface RecordSaleLineInput {
  productId: string;
  unit: Unit;
  quantity: number;
  unitPriceKobo: bigint;
}

export interface RecordSaleInput {
  customerId: string | null;
  customerName: string | null;
  createdById: string;
  channel: SaleChannel;
  location: StockLocation;
  soldAt: Date;
  notes: string | null;
  reference: string | null;
  paidKobo: bigint;
  /** The account taking the money. Required whenever `paidKobo > 0`. */
  accountId?: string | null;
  lines: RecordSaleLineInput[];
}

export interface RecordSaleResult {
  sale: Sale;
  saleLines: SaleLine[];
  movements: StockMovement[];
  customerLedgerEntry: CustomerLedgerEntry | null;
  salePayment: SalePayment | null;
  /** The positive SALE_PAYMENT account entry for money taken now. */
  accountLedgerEntry: AccountLedgerEntry | null;
}

export function recordSale(
  input: RecordSaleInput,
  existingProducts: readonly Product[],
  existingMovements: readonly StockMovement[],
  newId: IdGenerator,
): RecordSaleResult {
  if (input.lines.length === 0) {
    throw new RangeError("A sale must have at least one line.");
  }
  if (!Number.isFinite(input.soldAt.getTime())) {
    throw new RangeError("Sale date must be valid.");
  }
  if (input.paidKobo < 0n) {
    throw new RangeError("Paid amount must not be negative.");
  }

  const productById = new Map(existingProducts.map((p) => [p.id, p]));
  const saleId = newId();

  const saleLines: SaleLine[] = [];
  const movements: StockMovement[] = [];
  let totalKobo = 0n;

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new RangeError(`Product '${line.productId}' not found.`);
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new RangeError("Sale line quantity must be a positive number.");
    }
    if (line.unitPriceKobo < 0n) {
      throw new RangeError("Sale line unit price must not be negative.");
    }

    const unitsPerPackSnapshot = product.unitsPerPack;
    const scaledQuantity = toScaledQuantity(line.quantity);
    const scaledUnits =
      line.unit === "UNIT"
        ? scaledQuantity
        : scaledQuantity * BigInt(unitsPerPackSnapshot);

    if (scaledUnits % QUANTITY_SCALE_FACTOR !== 0n) {
      throw new RangeError(
        "Sale line quantity must result in a positive whole number of units.",
      );
    }

    const quantityUnits = Number(scaledUnits / QUANTITY_SCALE_FACTOR);
    if (!Number.isSafeInteger(quantityUnits) || quantityUnits <= 0) {
      throw new RangeError(
        "Sale line quantity must result in a positive whole number of units.",
      );
    }

    // Money is never multiplied as a float: the quantity is scaled to an
    // integer first, so a fraction such as 1/2 of a 24-pack cannot drift.
    const lineTotalKobo = roundHalfUp(
      scaledQuantity * line.unitPriceKobo,
      QUANTITY_SCALE_FACTOR,
    );

    const currentAtLocation = existingMovements
      .filter(
        (m) =>
          m.productId === line.productId &&
          m.location === input.location &&
          m.reversesEntryId === null,
      )
      .reduce((sum, m) => sum + m.quantityUnits, 0);

    // Earlier lines of this same sale have already taken stock; without them
    // two lines for one product could each pass while together overselling.
    const takenByEarlierLines = movements
      .filter((m) => m.productId === line.productId)
      .reduce((sum, m) => sum + m.quantityUnits, 0);

    assertStockWillRemainNonnegative(
      BigInt(currentAtLocation + takenByEarlierLines),
      BigInt(-quantityUnits),
    );

    const saleLineId = newId();
    saleLines.push({
      id: saleLineId,
      saleId,
      productId: line.productId,
      unit: line.unit,
      quantity: line.quantity,
      unitsPerPackSnapshot,
      quantityUnits,
      unitPriceKobo: line.unitPriceKobo,
      lineTotalKobo,
    });

    movements.push({
      id: newId(),
      productId: line.productId,
      location: input.location,
      type: "SALE",
      quantityUnits: -quantityUnits,
      unitCostKobo: product.averageCostKobo,
      purchaseLineId: null,
      saleLineId,
      transferLegId: null,
      adjustmentLineId: null,
      returnLineId: null,
      reversesEntryId: null,
      occurredAt: input.soldAt,
      createdAt: input.soldAt,
    });

    totalKobo += lineTotalKobo;
  }

  if (input.paidKobo > totalKobo) {
    throw new RangeError("Paid amount may not exceed the sale total.");
  }

  const unpaidKobo = totalKobo - input.paidKobo;

  // A sale that is not fully paid creates a SALE entry on the customer ledger,
  // so it cannot be anonymous. This mirrors validateCompletedSalePayment() and
  // the `ck_sales_unpaid_requires_customer` CHECK added in migration
  // `20261017000700_sale_purchase_rules`, so an invalid sale fails in the
  // domain layer with the same message the database would raise.
  if (unpaidKobo > 0n && input.customerId === null) {
    throw new RangeError("A customer is required when a sale is not fully paid.");
  }

  const sale: Sale = {
    id: saleId,
    customerId: input.customerId,
    customerName: input.customerName,
    createdById: input.createdById,
    channel: input.channel,
    status: "COMPLETED",
    reference: input.reference,
    notes: input.notes,
    totalKobo,
    paidKobo: input.paidKobo,
    soldAt: input.soldAt,
    createdAt: input.soldAt,
    updatedAt: input.soldAt,
  };

  let customerLedgerEntry: CustomerLedgerEntry | null = null;
  if (input.customerId !== null && unpaidKobo > 0n) {
    customerLedgerEntry = {
      id: newId(),
      customerId: input.customerId,
      type: "SALE",
      amountKobo: unpaidKobo,
      saleId,
      salePaymentId: null,
      customerPaymentId: null,
      saleReturnId: null,
      customerRefundId: null,
      reversesEntryId: null,
      note: null,
      occurredAt: input.soldAt,
    };
  }

  let salePayment: SalePayment | null = null;
  let accountLedgerEntry: AccountLedgerEntry | null = null;
  if (input.paidKobo > 0n) {
    const accountId = requireAccountId(input.accountId, "a sale is paid");
    salePayment = {
      id: newId(),
      saleId,
      accountId,
      amountKobo: input.paidKobo,
      paidAt: input.soldAt,
      createdAt: input.soldAt,
    };
    accountLedgerEntry = buildAccountLedgerEntry(
      {
        accountId,
        type: "SALE_PAYMENT",
        amountKobo: input.paidKobo,
        salePaymentId: salePayment.id,
        occurredAt: input.soldAt,
      },
      newId,
    );
  }

  return {
    sale,
    saleLines,
    movements,
    customerLedgerEntry,
    salePayment,
    accountLedgerEntry,
  };
}

export interface VoidSaleResult {
  reversalMovements: StockMovement[];
  reversalCustomerLedgerEntry: CustomerLedgerEntry | null;
  /** Money that must travel back out of the account when the sale is voided. */
  reversalAccountLedgerEntries: AccountLedgerEntry[];
}

export function voidSale(
  saleId: string,
  voidedAt: Date,
  existingSales: readonly Sale[],
  existingSaleLines: readonly SaleLine[],
  existingMovements: readonly StockMovement[],
  existingCustomerLedger: readonly CustomerLedgerEntry[],
  newId: IdGenerator,
  existingSalePayments: readonly SalePayment[] = [],
  existingAccountLedger: readonly AccountLedgerEntry[] = [],
  existingAccounts: readonly Account[] = [],
): VoidSaleResult {
  if (!Number.isFinite(voidedAt.getTime())) {
    throw new RangeError("Void date must be valid.");
  }

  const sale = existingSales.find((s) => s.id === saleId);
  if (!sale) {
    throw new RangeError(`Sale '${saleId}' not found.`);
  }
  if (sale.status === "VOIDED") {
    throw new RangeError("This sale has already been voided.");
  }

  // Payments are immutable and cannot be silently discarded by a void, so a
  // debtor sale is blocked here: voiding it would reverse the SALE ledger entry
  // and leave the later payment stranded, turning the customer's balance from
  // zero into a credit with nothing to apply it to. A cash sale also has a
  // payment row, but it wrote no on-account ledger entry, so there is nothing
  // for the void to duplicate and it stays voidable. This mirrors the database
  // trigger `trg_sale_void_guard` (migration `20261017092000_sale_void_guard`),
  // including its exact predicate, so the domain and the database agree.
  const salePaymentIds = new Set(
    existingSalePayments.filter((p) => p.saleId === saleId).map((p) => p.id),
  );
  // A later payment blocks the void only while it is LIVE (not reversed).
  const reversedLater = reversedSalePaymentIds(existingCustomerLedger);
  const hasOnAccountPayment = existingCustomerLedger.some(
    (e) =>
      e.type === "PAYMENT" &&
      e.reversesEntryId === null &&
      e.salePaymentId !== null &&
      salePaymentIds.has(e.salePaymentId) &&
      !reversedLater.has(e.salePaymentId),
  );
  if (hasOnAccountPayment) {
    throw new RangeError(
      "This sale has an on-account payment recorded and cannot be voided. Reverse the payment first.",
    );
  }

  const lines = existingSaleLines.filter((l) => l.saleId === saleId);
  const lineIds = new Set(lines.map((l) => l.id));

  const saleMovements = existingMovements.filter(
    (m) =>
      m.type === "SALE" &&
      m.saleLineId !== null &&
      lineIds.has(m.saleLineId) &&
      m.reversesEntryId === null,
  );

  const reversalMovements: StockMovement[] = [];
  for (const movement of saleMovements) {
    reversalMovements.push(
      buildStockMovementReversal(movement, existingMovements, newId(), voidedAt),
    );
  }

  const balancesAfter = new Map<string, number>();
  for (const movement of existingMovements) {
    const key = `${movement.productId}:${movement.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + movement.quantityUnits);
  }
  for (const reversal of reversalMovements) {
    const key = `${reversal.productId}:${reversal.location}`;
    balancesAfter.set(key, (balancesAfter.get(key) ?? 0) + reversal.quantityUnits);
  }
  for (const [key, balance] of balancesAfter) {
    if (balance < 0) {
      const [productId, location] = key.split(":");
      throw new RangeError(
        `Voiding this sale would make stock for product '${productId}' at ${location} negative (${balance}).`,
      );
    }
  }

  let reversalCustomerLedgerEntry: CustomerLedgerEntry | null = null;
  const ledgerEntry = existingCustomerLedger.find(
    (e) => e.saleId === saleId && e.reversesEntryId === null,
  );
  if (ledgerEntry) {
    reversalCustomerLedgerEntry = buildLedgerReversal(
      ledgerEntry,
      existingCustomerLedger,
      newId(),
      voidedAt,
    );
  }

  // Every sale payment took money into an account, so voiding the sale has to
  // put it back. If that cash has already been spent the reversal is refused
  // with a message naming the account, rather than leaving a negative balance.
  const alreadyReversedAccountEntries = reversedAccountEntryIds(existingAccountLedger);
  const accountTargets = existingAccountLedger.filter(
    (entry) =>
      entry.type === "SALE_PAYMENT" &&
      entry.salePaymentId !== null &&
      salePaymentIds.has(entry.salePaymentId) &&
      entry.reversesEntryId === null &&
      !alreadyReversedAccountEntries.has(entry.id),
  );
  const reversalAccountLedgerEntries = buildAccountReversals(
    accountTargets,
    existingAccountLedger,
    existingAccounts,
    voidedAt,
    newId,
  );

  return {
    reversalMovements,
    reversalCustomerLedgerEntry,
    reversalAccountLedgerEntries,
  };
}

export interface RecordSalePaymentInput {
  saleId: string;
  amountKobo: bigint;
  paidAt: Date;
  /** The account taking the money. Required because a payment moves money. */
  accountId?: string | null;
}

export interface RecordSalePaymentResult {
  sale: Sale;
  customerLedgerEntry: CustomerLedgerEntry | null;
  salePayment: SalePayment;
  /** The positive SALE_PAYMENT account entry for the money taken. */
  accountLedgerEntry: AccountLedgerEntry;
}

export function recordSalePayment(
  input: RecordSalePaymentInput,
  existingSales: readonly Sale[],
  newId: IdGenerator,
): RecordSalePaymentResult {
  if (!Number.isFinite(input.paidAt.getTime())) {
    throw new RangeError("Payment date must be valid.");
  }
  if (input.amountKobo <= 0n) {
    throw new RangeError("Payment amount must be positive.");
  }

  const accountId = requireAccountId(input.accountId, "a sale payment is recorded");

  const sale = existingSales.find((s) => s.id === input.saleId);
  if (!sale) {
    throw new RangeError(`Sale '${input.saleId}' not found.`);
  }
  if (sale.status === "VOIDED") {
    throw new RangeError("Cannot record payment for a voided sale.");
  }

  const remainingKobo = sale.totalKobo - sale.paidKobo;
  if (remainingKobo <= 0n) {
    throw new RangeError("This sale is already fully paid.");
  }
  if (input.amountKobo > remainingKobo) {
    throw new RangeError(
      `Payment amount exceeds the remaining balance of ${remainingKobo.toString()} kobo.`,
    );
  }

  const updatedSale: Sale = {
    ...sale,
    paidKobo: sale.paidKobo + input.amountKobo,
    updatedAt: input.paidAt,
  };

  const salePayment: SalePayment = {
    id: newId(),
    saleId: sale.id,
    accountId,
    amountKobo: input.amountKobo,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
  };

  // Money that came in must land somewhere: every payment posts a positive
  // SALE_PAYMENT entry against the account it was taken into.
  const accountLedgerEntry = buildAccountLedgerEntry(
    {
      accountId,
      type: "SALE_PAYMENT",
      amountKobo: input.amountKobo,
      salePaymentId: salePayment.id,
      occurredAt: input.paidAt,
    },
    newId,
  );

  let customerLedgerEntry: CustomerLedgerEntry | null = null;
  if (sale.customerId !== null) {
    customerLedgerEntry = {
      id: newId(),
      customerId: sale.customerId,
      type: "PAYMENT",
      amountKobo: -input.amountKobo,
      // Deliberately null: `ux_customer_ledger_sale_active` allows only one
      // live entry per sale, and the SALE entry already holds it. The payment
      // is attributed through `salePaymentId` instead.
      saleId: null,
      salePaymentId: salePayment.id,
      customerPaymentId: null,
      saleReturnId: null,
      customerRefundId: null,
      reversesEntryId: null,
      note: null,
      occurredAt: input.paidAt,
    };
  }

  return {
    sale: updatedSale,
    customerLedgerEntry,
    salePayment,
    accountLedgerEntry,
  };
}

export interface RecordPurchasePaymentInput {
  purchaseId: string;
  amountKobo: bigint;
  paidAt: Date;
  method: PaymentMethod;
  note: string | null;
  /** The account the money left. Required because a payment moves money. */
  accountId?: string | null;
}

export interface RecordPurchasePaymentResult {
  purchase: Purchase;
  supplierPayment: SupplierPayment;
  supplierLedgerEntry: SupplierLedgerEntry;
  /** The negative SUPPLIER_PAYMENT account entry for the money paid out. */
  accountLedgerEntry: AccountLedgerEntry;
}

/**
 * Records a payment against a supplier purchase. Mirrors `recordSalePayment`:
 * validates, increments `paidKobo`, and writes a negative PAYMENT ledger entry
 * referencing the new `SupplierPayment` row. Never deletes the purchase.
 */
export function recordPurchasePayment(
  input: RecordPurchasePaymentInput,
  existingPurchases: readonly Purchase[],
  newId: IdGenerator,
): RecordPurchasePaymentResult {
  if (!Number.isFinite(input.paidAt.getTime())) {
    throw new RangeError("Payment date must be valid.");
  }
  if (input.amountKobo <= 0n) {
    throw new RangeError("Payment amount must be positive.");
  }

  const accountId = requireAccountId(
    input.accountId,
    "a supplier payment is recorded",
  );

  const purchase = existingPurchases.find((p) => p.id === input.purchaseId);
  if (!purchase) {
    throw new RangeError(`Purchase '${input.purchaseId}' not found.`);
  }
  if (purchase.status === "VOIDED") {
    throw new RangeError("Cannot record payment for a voided purchase.");
  }
  if (purchase.supplierId === null) {
    throw new RangeError(
      "Cannot record a payment for a purchase that has no supplier.",
    );
  }

  const remainingKobo = purchase.totalKobo - purchase.paidKobo;
  if (remainingKobo <= 0n) {
    throw new RangeError("This purchase is already fully paid.");
  }
  if (input.amountKobo > remainingKobo) {
    throw new RangeError(
      `Payment amount exceeds the remaining balance of ${remainingKobo.toString()} kobo.`,
    );
  }

  const updatedPurchase: Purchase = {
    ...purchase,
    paidKobo: purchase.paidKobo + input.amountKobo,
    updatedAt: input.paidAt,
  };

  const supplierPayment: SupplierPayment = {
    id: newId(),
    supplierId: purchase.supplierId,
    purchaseId: purchase.id,
    accountId,
    amountKobo: input.amountKobo,
    method: input.method,
    note: input.note,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
  };

  const supplierLedgerEntry: SupplierLedgerEntry = {
    id: newId(),
    supplierId: purchase.supplierId,
    type: "PAYMENT",
    amountKobo: -input.amountKobo,
    purchaseId: null,
    supplierPaymentId: supplierPayment.id,
    reversesEntryId: null,
    note: null,
    occurredAt: input.paidAt,
  };

  // Money that left the business must leave a named account: a supplier
  // payment posts a negative SUPPLIER_PAYMENT entry keyed on the payment row.
  const accountLedgerEntry = buildAccountLedgerEntry(
    {
      accountId,
      type: "SUPPLIER_PAYMENT",
      amountKobo: -input.amountKobo,
      supplierPaymentId: supplierPayment.id,
      occurredAt: input.paidAt,
    },
    newId,
  );

  return {
    purchase: updatedPurchase,
    supplierPayment,
    supplierLedgerEntry,
    accountLedgerEntry,
  };
}

export interface SalesSummaryDay {
  date: string;
  retailSupposedRevenueKobo: bigint;
  wholesaleSupposedRevenueKobo: bigint;
  totalSupposedRevenueKobo: bigint;
  retailRevenueGottenKobo: bigint;
  wholesaleRevenueGottenKobo: bigint;
  totalRevenueGottenKobo: bigint;
  retailStandardRevenueKobo: bigint;
  wholesaleStandardRevenueKobo: bigint;
  totalStandardRevenueKobo: bigint;
  retailRevenueKobo: bigint;
  wholesaleRevenueKobo: bigint;
  totalRevenueKobo: bigint;
  retailCogsKobo: bigint;
  wholesaleCogsKobo: bigint;
  totalCogsKobo: bigint;
  retailGrossProfitKobo: bigint;
  wholesaleGrossProfitKobo: bigint;
  totalGrossProfitKobo: bigint;
  retailExpensesKobo: bigint;
  wholesaleExpensesKobo: bigint;
  totalExpensesKobo: bigint;
  retailNetProfitKobo: bigint;
  wholesaleNetProfitKobo: bigint;
  totalNetProfitKobo: bigint;
}

export interface SalesSummaryResult {
  days: SalesSummaryDay[];
  totals: {
    retailSupposedRevenueKobo: bigint;
    wholesaleSupposedRevenueKobo: bigint;
    totalSupposedRevenueKobo: bigint;
    retailRevenueGottenKobo: bigint;
    wholesaleRevenueGottenKobo: bigint;
    totalRevenueGottenKobo: bigint;
    retailStandardRevenueKobo: bigint;
    wholesaleStandardRevenueKobo: bigint;
    totalStandardRevenueKobo: bigint;
    retailRevenueKobo: bigint;
    wholesaleRevenueKobo: bigint;
    totalRevenueKobo: bigint;
    retailCogsKobo: bigint;
    wholesaleCogsKobo: bigint;
    totalCogsKobo: bigint;
    retailGrossProfitKobo: bigint;
    wholesaleGrossProfitKobo: bigint;
    totalGrossProfitKobo: bigint;
    retailExpensesKobo: bigint;
    wholesaleExpensesKobo: bigint;
    totalExpensesKobo: bigint;
    retailNetProfitKobo: bigint;
    wholesaleNetProfitKobo: bigint;
    totalNetProfitKobo: bigint;
  };
}

export function splitExpenseByChannel(
  amountKobo: bigint,
  channel: SaleChannel,
): { retailKobo: bigint; wholesaleKobo: bigint } {
  if (channel === "RETAIL") return { retailKobo: amountKobo, wholesaleKobo: 0n };
  if (channel === "WHOLESALE") return { retailKobo: 0n, wholesaleKobo: amountKobo };
  const retailKobo = amountKobo / 2n;
  return { retailKobo, wholesaleKobo: amountKobo - retailKobo };
}

export function salesSummary(
  from: Date,
  to: Date,
  existingSales: readonly Sale[],
  existingSaleLines: readonly SaleLine[],
  existingProducts: readonly Product[],
  existingExpenses: readonly Expense[] = [],
  existingSalePayments: readonly SalePayment[] = [],
  reversedSalePayments: ReadonlySet<string> = new Set(),
): SalesSummaryResult {
  if (from.getTime() > to.getTime()) {
    throw new RangeError("From date must be on or before to date.");
  }

  const productById = new Map(existingProducts.map((p) => [p.id, p]));
  const linesBySale = new Map<string, SaleLine[]>();
  for (const line of existingSaleLines) {
    const list = linesBySale.get(line.saleId) ?? [];
    list.push(line);
    linesBySale.set(line.saleId, list);
  }

  const eligible = existingSales.filter(
    (sale) =>
      sale.status !== "VOIDED" &&
      sale.soldAt.getTime() >= from.getTime() &&
      sale.soldAt.getTime() < to.getTime(),
  );

  const days = new Map<string, SalesSummaryDay>();

  function emptyDay(date: string): SalesSummaryDay {
    return {
      date,
      retailSupposedRevenueKobo: 0n,
      wholesaleSupposedRevenueKobo: 0n,
      totalSupposedRevenueKobo: 0n,
      retailRevenueGottenKobo: 0n,
      wholesaleRevenueGottenKobo: 0n,
      totalRevenueGottenKobo: 0n,
      retailStandardRevenueKobo: 0n,
      wholesaleStandardRevenueKobo: 0n,
      totalStandardRevenueKobo: 0n,
      retailRevenueKobo: 0n,
      wholesaleRevenueKobo: 0n,
      totalRevenueKobo: 0n,
      retailCogsKobo: 0n,
      wholesaleCogsKobo: 0n,
      totalCogsKobo: 0n,
      retailGrossProfitKobo: 0n,
      wholesaleGrossProfitKobo: 0n,
      totalGrossProfitKobo: 0n,
      retailExpensesKobo: 0n,
      wholesaleExpensesKobo: 0n,
      totalExpensesKobo: 0n,
      retailNetProfitKobo: 0n,
      wholesaleNetProfitKobo: 0n,
      totalNetProfitKobo: 0n,
    };
  }

  for (const sale of eligible) {
    const date = getLagosBusinessDate(sale.soldAt);
    const day = days.get(date) ?? emptyDay(date);
    const lines = linesBySale.get(sale.id) ?? [];
    let cogs = 0n;
    let standardRevenue = 0n;
    for (const line of lines) {
      const product = productById.get(line.productId);
      const costPerUnit = product?.averageCostKobo ?? 0n;
      cogs += costPerUnit * BigInt(line.quantityUnits);
      if (sale.channel === "RETAIL") {
        standardRevenue +=
          (product?.retailPriceKobo ?? 0n) * BigInt(line.quantityUnits);
      } else {
        const wholesalePriceKobo = product?.wholesalePriceKobo ?? 0n;
        const unitsPerPack = BigInt(product?.unitsPerPack ?? 1);
        standardRevenue += roundHalfUp(
          BigInt(line.quantityUnits) * wholesalePriceKobo,
          unitsPerPack,
        );
      }
    }
    day.totalSupposedRevenueKobo += sale.totalKobo;
    day.totalStandardRevenueKobo += standardRevenue;
    day.totalCogsKobo += cogs;
    if (sale.channel === "RETAIL") {
      day.retailSupposedRevenueKobo += sale.totalKobo;
      day.retailStandardRevenueKobo += standardRevenue;
      day.retailCogsKobo += cogs;
    } else {
      day.wholesaleSupposedRevenueKobo += sale.totalKobo;
      day.wholesaleStandardRevenueKobo += standardRevenue;
      day.wholesaleCogsKobo += cogs;
    }
    days.set(date, day);
  }

  const salesById = new Map(existingSales.map((s) => [s.id, s]));
  for (const payment of existingSalePayments) {
    if (reversedSalePayments.has(payment.id)) {
      continue;
    }
    if (
      payment.paidAt.getTime() >= to.getTime()
    ) {
      continue;
    }
    const sale = salesById.get(payment.saleId);
    // Payments only count while their sale is live. A voided (or missing) sale
    // must not contribute to revenue.
    if (!sale || sale.status === "VOIDED") {
      continue;
    }
    const channel = sale.channel;
    const date = getLagosBusinessDate(payment.paidAt);
    const day = days.get(date) ?? emptyDay(date);
    day.totalRevenueGottenKobo += payment.amountKobo;
    day.totalRevenueKobo += payment.amountKobo;
    if (channel === "RETAIL") {
      day.retailRevenueGottenKobo += payment.amountKobo;
      day.retailRevenueKobo += payment.amountKobo;
    } else {
      day.wholesaleRevenueGottenKobo += payment.amountKobo;
      day.wholesaleRevenueKobo += payment.amountKobo;
    }
    days.set(date, day);
  }

  const paymentsBySale = new Map<string, SalePayment[]>();
  for (const payment of existingSalePayments) {
    const list = paymentsBySale.get(payment.saleId) ?? [];
    list.push(payment);
    paymentsBySale.set(payment.saleId, list);
  }
  for (const sale of eligible) {
    const payments = paymentsBySale.get(sale.id) ?? [];
    if (payments.length === 0 && sale.paidKobo > 0n) {
      const date = getLagosBusinessDate(sale.soldAt);
      const day = days.get(date) ?? emptyDay(date);
      day.totalRevenueGottenKobo += sale.paidKobo;
      day.totalRevenueKobo += sale.paidKobo;
      if (sale.channel === "RETAIL") {
        day.retailRevenueGottenKobo += sale.paidKobo;
        day.retailRevenueKobo += sale.paidKobo;
      } else {
        day.wholesaleRevenueGottenKobo += sale.paidKobo;
        day.wholesaleRevenueKobo += sale.paidKobo;
      }
      days.set(date, day);
    }
  }

  for (const expense of existingExpenses) {
    if (
      expense.voidedAt !== null ||
      expense.expenseDate.getTime() < from.getTime() ||
      expense.expenseDate.getTime() >= to.getTime()
    ) {
      continue;
    }
    const date = getLagosBusinessDate(expense.expenseDate);
    const day = days.get(date) ?? emptyDay(date);
    day.totalExpensesKobo += expense.amountKobo;
    const split = splitExpenseByChannel(expense.amountKobo, expense.channel);
    day.retailExpensesKobo += split.retailKobo;
    day.wholesaleExpensesKobo += split.wholesaleKobo;
    days.set(date, day);
  }

  for (const day of days.values()) {
    day.retailGrossProfitKobo = day.retailRevenueKobo - day.retailCogsKobo;
    day.wholesaleGrossProfitKobo = day.wholesaleRevenueKobo - day.wholesaleCogsKobo;
    day.totalGrossProfitKobo = day.totalRevenueKobo - day.totalCogsKobo;
    day.retailNetProfitKobo = day.retailGrossProfitKobo - day.retailExpensesKobo;
    day.wholesaleNetProfitKobo = day.wholesaleGrossProfitKobo - day.wholesaleExpensesKobo;
    day.totalNetProfitKobo = day.totalGrossProfitKobo - day.totalExpensesKobo;
  }

  const sortedDays = [...days.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totals = sortedDays.reduce(
    (acc, day) => ({
      retailSupposedRevenueKobo: acc.retailSupposedRevenueKobo + day.retailSupposedRevenueKobo,
      wholesaleSupposedRevenueKobo: acc.wholesaleSupposedRevenueKobo + day.wholesaleSupposedRevenueKobo,
      totalSupposedRevenueKobo: acc.totalSupposedRevenueKobo + day.totalSupposedRevenueKobo,
      retailRevenueGottenKobo: acc.retailRevenueGottenKobo + day.retailRevenueGottenKobo,
      wholesaleRevenueGottenKobo: acc.wholesaleRevenueGottenKobo + day.wholesaleRevenueGottenKobo,
      totalRevenueGottenKobo: acc.totalRevenueGottenKobo + day.totalRevenueGottenKobo,
      retailStandardRevenueKobo: acc.retailStandardRevenueKobo + day.retailStandardRevenueKobo,
      wholesaleStandardRevenueKobo: acc.wholesaleStandardRevenueKobo + day.wholesaleStandardRevenueKobo,
      totalStandardRevenueKobo: acc.totalStandardRevenueKobo + day.totalStandardRevenueKobo,
      retailRevenueKobo: acc.retailRevenueKobo + day.retailRevenueKobo,
      wholesaleRevenueKobo: acc.wholesaleRevenueKobo + day.wholesaleRevenueKobo,
      totalRevenueKobo: acc.totalRevenueKobo + day.totalRevenueKobo,
      retailCogsKobo: acc.retailCogsKobo + day.retailCogsKobo,
      wholesaleCogsKobo: acc.wholesaleCogsKobo + day.wholesaleCogsKobo,
      totalCogsKobo: acc.totalCogsKobo + day.totalCogsKobo,
      retailGrossProfitKobo: acc.retailGrossProfitKobo + day.retailGrossProfitKobo,
      wholesaleGrossProfitKobo: acc.wholesaleGrossProfitKobo + day.wholesaleGrossProfitKobo,
      totalGrossProfitKobo: acc.totalGrossProfitKobo + day.totalGrossProfitKobo,
      retailExpensesKobo: acc.retailExpensesKobo + day.retailExpensesKobo,
      wholesaleExpensesKobo: acc.wholesaleExpensesKobo + day.wholesaleExpensesKobo,
      totalExpensesKobo: acc.totalExpensesKobo + day.totalExpensesKobo,
      retailNetProfitKobo: acc.retailNetProfitKobo + day.retailNetProfitKobo,
      wholesaleNetProfitKobo: acc.wholesaleNetProfitKobo + day.wholesaleNetProfitKobo,
      totalNetProfitKobo: acc.totalNetProfitKobo + day.totalNetProfitKobo,
    }),
    {
      retailSupposedRevenueKobo: 0n,
      wholesaleSupposedRevenueKobo: 0n,
      totalSupposedRevenueKobo: 0n,
      retailRevenueGottenKobo: 0n,
      wholesaleRevenueGottenKobo: 0n,
      totalRevenueGottenKobo: 0n,
      retailStandardRevenueKobo: 0n,
      wholesaleStandardRevenueKobo: 0n,
      totalStandardRevenueKobo: 0n,
      retailRevenueKobo: 0n,
      wholesaleRevenueKobo: 0n,
      totalRevenueKobo: 0n,
      retailCogsKobo: 0n,
      wholesaleCogsKobo: 0n,
      totalCogsKobo: 0n,
      retailGrossProfitKobo: 0n,
      wholesaleGrossProfitKobo: 0n,
      totalGrossProfitKobo: 0n,
      retailExpensesKobo: 0n,
      wholesaleExpensesKobo: 0n,
      totalExpensesKobo: 0n,
      retailNetProfitKobo: 0n,
      wholesaleNetProfitKobo: 0n,
      totalNetProfitKobo: 0n,
    },
  );

  return { days: sortedDays, totals };
}
