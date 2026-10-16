import type {
    CashSnapshot,
    Expense,
    LoanLedgerEntry,
    Product,
    Purchase,
    StockAdjustmentLine,
    StockLocation,
    StockMovement,
    StockTransferLeg,
    SupplierLedgerEntry,
    SupplierPayment,
} from "./types.ts";
import { validateSupplierLedgerAmount } from "./ledger.ts";
import {
    validateCashSnapshot,
    validateLoanLedgerEntry,
    validateLoanLedgerReversals,
    validatePurchasePaymentFields,
} from "./accounting.ts";

const NON_REVERSAL_MOVEMENT_SIGNS: Record<
    StockMovement["type"],
    "positive" | "negative" | "nonzero"
> = {
    PURCHASE: "positive",
    SALE: "negative",
    RETURN: "positive",
    ADJUSTMENT: "nonzero",
    TRANSFER: "nonzero",
};

function assertSignedQuantity(
    type: StockMovement["type"],
    quantityUnits: number,
): void {
    const rule = NON_REVERSAL_MOVEMENT_SIGNS[type];
    if (rule === "positive" && quantityUnits <= 0) {
        throw new RangeError(`A ${type} stock movement must increase stock.`);
    }
    if (rule === "negative" && quantityUnits >= 0) {
        throw new RangeError(`A ${type} stock movement must decrease stock.`);
    }
    if (rule === "nonzero" && quantityUnits === 0) {
        throw new RangeError(`A ${type} stock movement must change stock by a nonzero quantity.`);
    }
}

const MOVEMENT_SOURCE_FIELDS = [
    "purchaseLineId",
    "saleLineId",
    "transferLegId",
    "adjustmentLineId",
    "returnLineId",
] as const;

type MovementSourceField = (typeof MOVEMENT_SOURCE_FIELDS)[number];

const EXPECTED_SOURCE_FOR_TYPE: Record<StockMovement["type"], MovementSourceField> = {
    PURCHASE: "purchaseLineId",
    SALE: "saleLineId",
    TRANSFER: "transferLegId",
    ADJUSTMENT: "adjustmentLineId",
    RETURN: "returnLineId",
};

function assertMovementSourceFk(movement: StockMovement): void {
    const expected = EXPECTED_SOURCE_FOR_TYPE[movement.type];
    for (const field of MOVEMENT_SOURCE_FIELDS) {
        const value = movement[field];
        if (field === expected) {
            if (value === null) {
                throw new RangeError(
                    `A ${movement.type} stock movement must reference its ${expected}.`,
                );
            }
        } else if (value !== null) {
            throw new RangeError(
                `A ${movement.type} stock movement must not reference ${field}.`,
            );
        }
    }
}

export function validateMovementSignAndSource(movement: StockMovement): void {
    assertMovementSourceFk(movement);
    if (movement.reversesEntryId === null) {
        assertSignedQuantity(movement.type, movement.quantityUnits);
    }
    if (movement.unitCostKobo < 0n) {
        throw new RangeError("Stock movement unit cost must not be negative.");
    }
}

export function validateAtMostOneNonReversalMovementPerSource(
    movements: readonly StockMovement[],
): void {
    const seen = new Set<string>();
    for (const movement of movements) {
        if (movement.reversesEntryId !== null) continue;
        const source =
            movement.purchaseLineId ??
            movement.saleLineId ??
            movement.transferLegId ??
            movement.adjustmentLineId ??
            movement.returnLineId;
        if (source === null) {
            throw new RangeError("Every stock movement must reference a source row.");
        }
        if (seen.has(source)) {
            throw new RangeError(
                `Only one non-reversal stock movement is allowed per source row '${source}'.`,
            );
        }
        seen.add(source);
    }
}

export function validateMovementReversals(
    movements: readonly StockMovement[],
): void {
    const byId = new Map(movements.map((movement) => [movement.id, movement]));
    const reversalTargets = new Map<string, StockMovement>();

    for (const movement of movements) {
        if (movement.reversesEntryId === null) continue;

        const target = byId.get(movement.reversesEntryId);
        if (!target) {
            throw new RangeError(
                `Stock movement reversal '${movement.id}' references a missing target.`,
            );
        }
        if (target.reversesEntryId !== null) {
            throw new RangeError(
                "A stock movement reversal cannot target another reversal.",
            );
        }
        if (reversalTargets.has(target.id)) {
            throw new RangeError(
                `Stock movement '${target.id}' has already been reversed.`,
            );
        }
        reversalTargets.set(target.id, movement);

        if (movement.productId !== target.productId) {
            throw new RangeError(
                "A stock movement reversal must keep the same product as its target.",
            );
        }
        if (movement.location !== target.location) {
            throw new RangeError(
                "A stock movement reversal must keep the same location as its target.",
            );
        }
        if (movement.type !== target.type) {
            throw new RangeError(
                "A stock movement reversal must keep the same type as its target.",
            );
        }
        if (movement.unitCostKobo !== target.unitCostKobo) {
            throw new RangeError(
                "A stock movement reversal must keep the same unit cost as its target.",
            );
        }
        if (movement.quantityUnits !== -target.quantityUnits) {
            throw new RangeError(
                "A stock movement reversal must negate the target quantity exactly.",
            );
        }
        if (movement.purchaseLineId !== target.purchaseLineId ||
            movement.saleLineId !== target.saleLineId ||
            movement.transferLegId !== target.transferLegId ||
            movement.adjustmentLineId !== target.adjustmentLineId ||
            movement.returnLineId !== target.returnLineId) {
            throw new RangeError(
                "A stock movement reversal must keep the same source references as its target.",
            );
        }
    }
}

export function validateTransferLegDirection(
    movements: readonly StockMovement[],
    legs: readonly StockTransferLeg[],
): void {
    const legById = new Map(legs.map((leg) => [leg.id, leg]));
    for (const movement of movements) {
        if (movement.type !== "TRANSFER" || movement.reversesEntryId !== null) continue;
        const leg = legById.get(movement.transferLegId ?? "");
        if (!leg) {
            throw new RangeError(
                `A TRANSFER stock movement must reference an existing transfer leg.`,
            );
        }
        if (leg.direction === "OUT" && movement.quantityUnits >= 0) {
            throw new RangeError("An OUT transfer leg movement must decrease stock.");
        }
        if (leg.direction === "IN" && movement.quantityUnits <= 0) {
            throw new RangeError("An IN transfer leg movement must increase stock.");
        }
    }
}

export function validateStockNeverNegative(
    movements: readonly StockMovement[],
): void {
    const balances = new Map<string, number>();
    for (const movement of movements) {
        const key = `${movement.productId}:${movement.location}`;
        balances.set(key, (balances.get(key) ?? 0) + movement.quantityUnits);
    }
    for (const [key, balance] of balances) {
        if (balance < 0) {
            const [productId, location] = key.split(":");
            throw new RangeError(
                `Stock for product '${productId}' at ${location} cannot be negative (${balance}).`,
            );
        }
    }
}

const SUPPLIER_LEDGER_SOURCE_FIELDS = ["purchaseId", "supplierPaymentId"] as const;

function assertSupplierLedgerSource(entry: SupplierLedgerEntry): void {
    const setFields = SUPPLIER_LEDGER_SOURCE_FIELDS.filter(
        (field) => entry[field] !== null,
    );
    if (entry.type === "PURCHASE") {
        if (entry.purchaseId === null || entry.supplierPaymentId !== null) {
            throw new RangeError("A PURCHASE supplier ledger entry must reference a purchase only.");
        }
    } else if (entry.type === "PAYMENT") {
        if (entry.supplierPaymentId === null || entry.purchaseId !== null) {
            throw new RangeError("A PAYMENT supplier ledger entry must reference a supplier payment only.");
        }
    } else if (entry.type === "ADJUSTMENT") {
        if (setFields.length !== 0) {
            throw new RangeError("An ADJUSTMENT supplier ledger entry must not reference a purchase or payment.");
        }
    }
    if (setFields.length > 1) {
        throw new RangeError("A supplier ledger entry may reference at most one source row.");
    }
}

export function validateSupplierLedgerEntry(entry: SupplierLedgerEntry): void {
    validateSupplierLedgerAmount(entry.type, entry.amountKobo);
    assertSupplierLedgerSource(entry);
}

export function validateSupplierLedgerReversals(
    entries: readonly SupplierLedgerEntry[],
): void {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const reversalTargets = new Set<string>();

    for (const entry of entries) {
        if (entry.reversesEntryId === null) continue;

        const target = byId.get(entry.reversesEntryId);
        if (!target) {
            throw new RangeError(
                `Supplier ledger reversal '${entry.id}' references a missing target.`,
            );
        }
        if (target.reversesEntryId !== null) {
            throw new RangeError(
                "A supplier ledger reversal cannot target another reversal.",
            );
        }
        if (reversalTargets.has(target.id)) {
            throw new RangeError(
                `Supplier ledger entry '${target.id}' has already been reversed.`,
            );
        }
        reversalTargets.add(target.id);

        if (entry.supplierId !== target.supplierId) {
            throw new RangeError(
                "A supplier ledger reversal must keep the same supplier as its target.",
            );
        }
        if (entry.type !== target.type) {
            throw new RangeError(
                "A supplier ledger reversal must keep the same type as its target.",
            );
        }
        if (entry.amountKobo !== -target.amountKobo) {
            throw new RangeError(
                "A supplier ledger reversal must negate the target amount exactly.",
            );
        }
        if (entry.purchaseId !== target.purchaseId ||
            entry.supplierPaymentId !== target.supplierPaymentId) {
            throw new RangeError(
                "A supplier ledger reversal must keep the same source references as its target.",
            );
        }
    }
}

export function validateProductFields(products: readonly Product[]): void {
    for (const product of products) {
        if (!Number.isSafeInteger(product.unitsPerPack) || product.unitsPerPack <= 0) {
            throw new RangeError(`Product '${product.id}' must have a positive unitsPerPack.`);
        }
        if (product.retailPriceKobo < 0n) {
            throw new RangeError(`Product '${product.id}' retail price must not be negative.`);
        }
        if (product.wholesalePriceKobo < 0n) {
            throw new RangeError(`Product '${product.id}' wholesale price must not be negative.`);
        }
        if (product.averageCostKobo < 0n) {
            throw new RangeError(`Product '${product.id}' average cost must not be negative.`);
        }
    }
}

export function validatePurchaseLineUnitConsistency(
    line: {
        unit: "UNIT" | "PACK";
        quantity: number;
        unitsPerPackSnapshot: number;
        quantityUnits: number;
    },
): void {
    if (line.unit === "UNIT") {
        if (line.quantityUnits !== line.quantity) {
            throw new RangeError(
                "A UNIT purchase line quantityUnits must equal quantity.",
            );
        }
    } else {
        const expected = line.quantity * line.unitsPerPackSnapshot;
        if (line.quantityUnits !== expected) {
            throw new RangeError(
                "A PACK purchase line quantityUnits must equal quantity * unitsPerPackSnapshot.",
            );
        }
    }
}

export function validateAdjustmentLineFields(
    line: StockAdjustmentLine,
): void {
    if (!Number.isSafeInteger(line.quantityDeltaUnits) || line.quantityDeltaUnits === 0) {
        throw new RangeError(
            "Stock adjustment quantity delta must be a nonzero safe integer.",
        );
    }
    if (line.unitCostKobo < 0n) {
        throw new RangeError("Stock adjustment line unit cost must not be negative.");
    }
}

export interface InvariantStoreState {
    products: readonly Product[];
    stockMovements: readonly StockMovement[];
    stockTransferLegs: readonly StockTransferLeg[];
    supplierLedgerEntries: readonly SupplierLedgerEntry[];
    purchaseLines?: readonly {
        unit: "UNIT" | "PACK";
        quantity: number;
        unitsPerPackSnapshot: number;
        quantityUnits: number;
        lineTotalKobo: bigint;
        unitCostKobo: bigint;
    }[];
    stockAdjustmentLines?: readonly StockAdjustmentLine[];
    /** Accounting additions — validated only when supplied. */
    purchases?: readonly Purchase[];
    supplierPayments?: readonly SupplierPayment[];
    loanLedgerEntries?: readonly LoanLedgerEntry[];
    cashSnapshots?: readonly CashSnapshot[];
    expenses?: readonly Expense[];
}

export function assertStoreInvariants(state: InvariantStoreState): void {
    validateProductFields(state.products);

    for (const movement of state.stockMovements) {
        validateMovementSignAndSource(movement);
    }
    validateAtMostOneNonReversalMovementPerSource(state.stockMovements);
    validateMovementReversals(state.stockMovements);
    validateTransferLegDirection(state.stockMovements, state.stockTransferLegs);
    validateStockNeverNegative(state.stockMovements);

    for (const entry of state.supplierLedgerEntries) {
        validateSupplierLedgerEntry(entry);
    }
    validateSupplierLedgerReversals(state.supplierLedgerEntries);

    for (const line of state.purchaseLines ?? []) {
        validatePurchaseLineUnitConsistency(line);
        if (line.lineTotalKobo < 0n) {
            throw new RangeError("Purchase line total must not be negative.");
        }
        if (line.unitCostKobo < 0n) {
            throw new RangeError("Purchase line unit cost must not be negative.");
        }
    }

    for (const line of state.stockAdjustmentLines ?? []) {
        validateAdjustmentLineFields(line);
    }

    for (const purchase of state.purchases ?? []) {
        validatePurchasePaymentFields(purchase);
    }
    for (const payment of state.supplierPayments ?? []) {
        if (payment.amountKobo <= 0n) {
            throw new RangeError("A supplier payment amount must be positive.");
        }
    }
    for (const entry of state.loanLedgerEntries ?? []) {
        validateLoanLedgerEntry(entry);
    }
    if (state.loanLedgerEntries) {
        validateLoanLedgerReversals(state.loanLedgerEntries);
    }
    for (const snapshot of state.cashSnapshots ?? []) {
        validateCashSnapshot(snapshot);
    }
    for (const expense of state.expenses ?? []) {
        if (expense.amountKobo < 0n) {
            throw new RangeError("An expense amount must not be negative.");
        }
        if (expense.loanRepaymentId !== null && expense.category !== "LOAN_INTEREST") {
            throw new RangeError(
                "An expense linked to a loan repayment must use the LOAN_INTEREST category.",
            );
        }
    }
}

export function locationKey(productId: string, location: StockLocation): string {
    return `${productId}:${location}`;
}
