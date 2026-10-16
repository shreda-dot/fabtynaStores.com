import type {
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
  assertStockWillRemainNonnegative,
  buildLedgerReversal,
  buildStockMovementReversal,
  calculateWeightedAverageCostKobo,
  recomputeAverageCostKobo,
  totalUnitsForProduct,
} from "./index.ts";
import { getLagosBusinessDate } from "../lagos-time.ts";

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Denominator must be positive.");
  }
  if (numerator < 0n) {
    return -roundHalfUp(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
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

  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) {
      throw new RangeError(`Product '${line.productId}' not found.`);
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError("Purchase line quantity must be a positive safe integer.");
    }
    if (line.lineTotalKobo < 0n) {
      throw new RangeError("Purchase line total must not be negative.");
    }

    const unitsPerPackSnapshot = product.unitsPerPack;
    const quantityUnits =
      line.unit === "UNIT"
        ? line.quantity
        : line.quantity * unitsPerPackSnapshot;

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

    const existingUnits = BigInt(totalUnitsForProduct(existingMovements, line.productId));
    const newAverage = calculateWeightedAverageCostKobo(
      existingUnits,
      product.averageCostKobo,
      BigInt(quantityUnits),
      line.lineTotalKobo,
    );
    productUpdates.push({ id: line.productId, averageCostKobo: newAverage });

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

    if (amountPaidNowKobo > 0n) {
      supplierPayment = {
        id: newId(),
        supplierId: input.supplierId,
        purchaseId,
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
    }
  }

  return {
    purchase,
    purchaseLines,
    movements,
    supplierLedgerEntry,
    supplierPayment,
    supplierPaymentLedgerEntry,
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
  productUpdates: Array<{ id: string; averageCostKobo: bigint }>;
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

  // Payments are immutable and cannot be silently discarded by a void, so a
  // part-paid purchase is blocked here. (Legacy purchases defaulted to
  // "fully paid" by the v5 migration have no payment rows and stay voidable.)
  const hasPayments = existingSupplierPayments.some(
    (payment) => payment.purchaseId === purchaseId,
  );
  if (hasPayments) {
    throw new RangeError(
      "This purchase has supplier payments recorded and cannot be voided. Reverse the payments instead of voiding the purchase.",
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

  return {
    reversalMovements,
    reversalSupplierLedgerEntry,
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
  lines: RecordSaleLineInput[];
}

export interface RecordSaleResult {
  sale: Sale;
  saleLines: SaleLine[];
  movements: StockMovement[];
  customerLedgerEntry: CustomerLedgerEntry | null;
  salePayment: SalePayment | null;
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
    const quantityUnits =
      line.unit === "UNIT"
        ? line.quantity
        : line.quantity * unitsPerPackSnapshot;

    if (!Number.isSafeInteger(quantityUnits) || quantityUnits <= 0) {
      throw new RangeError(
        "Sale line quantity must result in a positive whole number of units.",
      );
    }

    const lineTotalKobo =
      line.unit === "UNIT"
        ? BigInt(line.quantity) * line.unitPriceKobo
        : BigInt(Math.round(line.quantity * Number(line.unitPriceKobo)));

    const currentAtLocation = existingMovements
      .filter(
        (m) =>
          m.productId === line.productId &&
          m.location === input.location &&
          m.reversesEntryId === null,
      )
      .reduce((sum, m) => sum + m.quantityUnits, 0);

    assertStockWillRemainNonnegative(
      BigInt(currentAtLocation),
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
  const unpaidKobo = totalKobo - input.paidKobo;
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
  if (input.paidKobo > 0n) {
    salePayment = {
      id: newId(),
      saleId,
      amountKobo: input.paidKobo,
      paidAt: input.soldAt,
      createdAt: input.soldAt,
    };
  }

  return {
    sale,
    saleLines,
    movements,
    customerLedgerEntry,
    salePayment,
  };
}

export interface VoidSaleResult {
  reversalMovements: StockMovement[];
  reversalCustomerLedgerEntry: CustomerLedgerEntry | null;
}

export function voidSale(
  saleId: string,
  voidedAt: Date,
  existingSales: readonly Sale[],
  existingSaleLines: readonly SaleLine[],
  existingMovements: readonly StockMovement[],
  existingCustomerLedger: readonly CustomerLedgerEntry[],
  newId: IdGenerator,
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

  return {
    reversalMovements,
    reversalCustomerLedgerEntry,
  };
}

export interface RecordSalePaymentInput {
  saleId: string;
  amountKobo: bigint;
  paidAt: Date;
}

export interface RecordSalePaymentResult {
  sale: Sale;
  customerLedgerEntry: CustomerLedgerEntry | null;
  salePayment: SalePayment;
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
    amountKobo: input.amountKobo,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
  };

  let customerLedgerEntry: CustomerLedgerEntry | null = null;
  if (sale.customerId !== null) {
    customerLedgerEntry = {
      id: newId(),
      customerId: sale.customerId,
      type: "PAYMENT",
      amountKobo: -input.amountKobo,
      saleId: sale.id,
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
  };
}

export interface RecordPurchasePaymentInput {
  purchaseId: string;
  amountKobo: bigint;
  paidAt: Date;
  method: PaymentMethod;
  note: string | null;
}

export interface RecordPurchasePaymentResult {
  purchase: Purchase;
  supplierPayment: SupplierPayment;
  supplierLedgerEntry: SupplierLedgerEntry;
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

  return { purchase: updatedPurchase, supplierPayment, supplierLedgerEntry };
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

export function salesSummary(
  from: Date,
  to: Date,
  existingSales: readonly Sale[],
  existingSaleLines: readonly SaleLine[],
  existingProducts: readonly Product[],
  existingExpenses: readonly Expense[] = [],
  existingSalePayments: readonly SalePayment[] = [],
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
    if (
      payment.paidAt.getTime() < from.getTime() ||
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
      expense.expenseDate.getTime() < from.getTime() ||
      expense.expenseDate.getTime() >= to.getTime()
    ) {
      continue;
    }
    const date = getLagosBusinessDate(expense.expenseDate);
    const day = days.get(date) ?? emptyDay(date);
    day.totalExpensesKobo += expense.amountKobo;
    if (expense.channel === "RETAIL") {
      day.retailExpensesKobo += expense.amountKobo;
    } else if (expense.channel === "WHOLESALE") {
      day.wholesaleExpensesKobo += expense.amountKobo;
    } else {
      const half = expense.amountKobo / 2n;
      const otherHalf = expense.amountKobo - half;
      day.retailExpensesKobo += half;
      day.wholesaleExpensesKobo += otherHalf;
    }
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
