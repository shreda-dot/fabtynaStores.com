import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import {
  assertAccountWillRemainNonnegative,
  formatNaira,
  receivePurchase,
  recordPurchasePayment,
  reversePurchasePayment,
  reversedSupplierPaymentIds,
  toPurchaseDto,
  toSupplierPaymentDto,
  voidPurchase,
  type Account,
  type AccountLedgerEntry,
  type Product,
  type Purchase,
  type StockLocation,
  type StockMovement,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { lockAccounts, lockProducts, lockStockBalances, stockKey, type LockedAccount } from "../../lib/locks.js";
import { createWriteRunner, type TxContext, type WriteResponse } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { assertNotInFuture, formatPurchaseReference, normaliseClientReference } from "../sales/sales.validation.js";
import { getPurchaseDetail, listPurchases } from "./purchases.queries.js";
import {
  insertLaterPurchasePayment,
  insertPurchase,
  insertPurchaseAudit,
  insertPurchaseVoid,
  insertPurchasePaymentReversal,
  loadPaymentForReversal,
  loadProductMovements,
  loadPurchaseLedgers,
  loadPurchaseParts,
  lockPurchase,
  lockSuppliers,
  nextPurchaseSequence,
  type LockedSupplier,
  type PaidAtReceipt,
  type PurchaseLedgers,
  type PurchaseParts,
} from "./purchases.repository.js";
import type {
  CreatePurchaseDto,
  ListPurchasesQuery,
  RecordPurchasePaymentBody,
  ReversePaymentBody,
} from "./purchases.schemas.js";
import { assertPurchaseWithinBounds } from "./purchases.validation.js";

export const CREATE_PURCHASE_ROUTE = "POST /purchases";
/** The purchase id is part of the idempotency route key, so one key can never cross purchases. */
export const purchasePaymentRoute = (purchaseId: string): string => `POST /purchases/${purchaseId}/payments`;
export const purchaseVoidRoute = (purchaseId: string): string => `POST /purchases/${purchaseId}/void`;
export const purchasePaymentReverseRoute = (purchaseId: string, paymentId: string): string =>
  `POST /purchases/${purchaseId}/payments/${paymentId}/reverse`;
export const purchaseAmendRoute = (purchaseId: string): string => `PUT /purchases/${purchaseId}`;

export type PurchaseResponse = WriteResponse;

export interface PurchasesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
  maxDateRangeDays?: number;
}

const STOCK_LOCATIONS: readonly StockLocation[] = ["WAREHOUSE", "RETAIL_SHELF", "MARKET"];

/* ------------------------------------------------------------------ *
 * THE LOCK ORDER (the same order sales uses; see docs/AI_CONTEXT.md)
 *
 *   1. the purchase row                    (lockPurchase, by the caller)
 *   2. product rows, sorted by id          (lockProducts)
 *   3. stock_balances, by productId, location. Average cost reads the units
 *      on hand at EVERY location, so all three locations are locked.
 *   4. account_balances, sorted by accountId (read together with accounts)
 *   5. supplier rows, FOR SHARE
 *
 * Two purchases of one product serialize through step 2, so averageCostKobo
 * is never computed from stale stock.
 * ------------------------------------------------------------------ */

interface LockPlan {
  productIds: readonly string[];
  accountIds: readonly string[];
  supplierIds: readonly string[];
}

interface Locked {
  products: Product[];
  productById: Map<string, Product>;
  stock: Map<string, number>;
  accounts: Map<string, LockedAccount>;
  suppliers: Map<string, LockedSupplier>;
}

async function acquireLocks(ctx: TxContext, plan: LockPlan): Promise<Locked> {
  const products = plan.productIds.length > 0 ? await lockProducts(ctx, plan.productIds) : [];
  const stock = await lockStockBalances(
    ctx,
    plan.productIds.flatMap((productId) => STOCK_LOCATIONS.map((location) => ({ productId, location }))),
  );
  const accounts = await lockAccounts(ctx, plan.accountIds);
  const suppliers = await lockSuppliers(ctx, plan.supplierIds);
  return { products, productById: new Map(products.map((p) => [p.id, p])), stock, accounts, suppliers };
}

function receivePlan(dto: CreatePurchaseDto): LockPlan {
  const paid = BigInt(dto.amountPaidNowKobo) > 0n;
  return {
    productIds: dto.lines.map((line) => line.productId),
    accountIds: paid && dto.accountId ? [dto.accountId] : [],
    supplierIds: dto.supplierId ? [dto.supplierId] : [],
  };
}

function mergePlans(...plans: LockPlan[]): LockPlan {
  return {
    productIds: plans.flatMap((p) => [...p.productIds]),
    accountIds: plans.flatMap((p) => [...p.accountIds]),
    supplierIds: plans.flatMap((p) => [...p.supplierIds]),
  };
}

/** The domain averages cost from units on hand, so feed it the locked balances as one movement per product and location. */
function syntheticMovements(locked: Locked): StockMovement[] {
  const movements: StockMovement[] = [];
  for (const product of locked.products) {
    for (const location of STOCK_LOCATIONS) {
      const units = locked.stock.get(stockKey(product.id, location)) ?? 0;
      if (units === 0) {
        continue;
      }
      movements.push({
        id: `synthetic-${product.id}-${location}`,
        productId: product.id,
        location,
        type: "PURCHASE",
        quantityUnits: units,
        unitCostKobo: product.averageCostKobo,
        purchaseLineId: null,
        saleLineId: null,
        transferLegId: null,
        adjustmentLineId: null,
        returnLineId: null,
        reversesEntryId: null,
        occurredAt: new Date(0),
        createdAt: new Date(0),
      });
    }
  }
  return movements;
}

function assertAccountPays(locked: Locked, accountId: string): LockedAccount {
  const account = locked.accounts.get(accountId);
  if (account === undefined) {
    throw validationError("That account does not exist.", { field: "accountId" });
  }
  if (!account.isActive) {
    throw businessRuleError(`Account '${account.name}' is deactivated and cannot pay out money.`, {
      accountId: account.id,
    });
  }
  return account;
}

/** Refuses a spend the account cannot afford, naming the account, its balance and the amount. */
function assertCanSpend(account: LockedAccount, amountKobo: bigint): void {
  try {
    assertAccountWillRemainNonnegative(account, account.balanceKobo, -amountKobo, "spend");
  } catch (error) {
    if (error instanceof RangeError) {
      throw businessRuleError(error.message, {
        accountId: account.id,
        accountName: account.name,
        balanceKobo: account.balanceKobo.toString(),
        amountKobo: amountKobo.toString(),
      });
    }
    throw error;
  }
}

const alreadyVoided = (purchaseId: string): AppError =>
  businessRuleError("This purchase has already been voided.", { purchaseId });

function toDomainAccount(account: LockedAccount): Account {
  const epoch = new Date(0);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    isActive: account.isActive,
    deactivatedAt: null,
    note: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

const notFound = (purchaseId: string): AppError =>
  new AppError(404, "NOT_FOUND", "Purchase not found.", { id: purchaseId });

export function createPurchasesService(options: PurchasesServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const maxDateRangeDays = options.maxDateRangeDays ?? 366;
  const { runWrite, withIdempotency } = createWriteRunner({
    prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  /* ---------------------------------------------------------------- *
   * Receive a purchase (shared by POST /purchases and PUT /purchases/:id)
   * ---------------------------------------------------------------- */

  async function recordNewPurchase(
    ctx: TxContext,
    input: {
      dto: CreatePurchaseDto;
      actor: Actor;
      purchasedAt: Date;
      clientReference: string | null;
      locked: Locked;
      auditMetadata: Record<string, unknown>;
    },
  ) {
    const { dto, actor, purchasedAt, locked } = input;

    if (dto.supplierId !== null) {
      const supplier = locked.suppliers.get(dto.supplierId);
      if (supplier === undefined) {
        throw validationError("That supplier does not exist.", { field: "supplierId" });
      }
      if (supplier.deletedAt !== null) {
        throw businessRuleError(`Supplier '${supplier.name}' is deactivated and cannot receive new purchases.`, {
          supplierId: supplier.id,
        });
      }
    }
    dto.lines.forEach((line, index) => {
      const product = locked.productById.get(line.productId);
      if (product === undefined) {
        throw validationError(`Line ${index + 1}: that product does not exist.`, {
          field: `lines.${index}.productId`,
        });
      }
      if (product.deletedAt !== null) {
        throw businessRuleError(`Line ${index + 1}: product '${product.name}' is deactivated.`, {
          productId: product.id,
        });
      }
    });

    const paidNow = BigInt(dto.amountPaidNowKobo);
    let account: LockedAccount | null = null;
    if (paidNow > 0n) {
      if (!dto.accountId) {
        throw validationError("Choose the account the money was paid from.", { field: "accountId" });
      }
      account = assertAccountPays(locked, dto.accountId);
    }

    const result = receivePurchase(
      {
        supplierId: dto.supplierId,
        createdById: actor.id,
        location: dto.location,
        purchasedAt,
        notes: dto.notes && dto.notes !== "" ? dto.notes : null,
        reference: null,
        dueDate: dto.dueDate,
        amountPaidNowKobo: paidNow,
        paymentMethod: dto.paymentMethod ?? "CASH",
        accountId: dto.accountId ?? null,
        lines: dto.lines.map((line) => ({
          productId: line.productId,
          unit: line.unit,
          quantity: line.quantity,
          lineTotalKobo: BigInt(line.lineTotalKobo),
        })),
      },
      locked.products,
      syntheticMovements(locked),
      randomUUID,
    );

    if (account !== null) {
      assertCanSpend(account, paidNow);
    }

    const reference =
      input.clientReference ?? formatPurchaseReference(purchasedAt, await nextPurchaseSequence(ctx));
    const purchase: Purchase = { ...result.purchase, reference };

    const payments: PaidAtReceipt[] =
      result.accountLedgerEntry === null
        ? []
        : [
            {
              supplierPayment: result.supplierPayment,
              supplierLedgerEntry: result.supplierPaymentLedgerEntry,
              accountEntry: result.accountLedgerEntry,
            },
          ];

    const stored = await insertPurchase(ctx, {
      purchase,
      lines: result.purchaseLines,
      movements: result.movements,
      supplierLedgerEntry: result.supplierLedgerEntry,
      payments,
      productUpdates: result.productUpdates,
      actorId: actor.id,
    });

    await insertPurchaseAudit(ctx, {
      actorId: actor.id,
      action: "purchase.create",
      entityId: purchase.id,
      afterData: {
        reference,
        supplierId: purchase.supplierId,
        totalKobo: purchase.totalKobo.toString(),
        paidKobo: purchase.paidKobo.toString(),
        dueDate: purchase.dueDate,
        location: dto.location,
        lineCount: result.purchaseLines.length,
        accountId: result.accountLedgerEntry?.accountId ?? null,
        averageCostKobo: Object.fromEntries(
          result.productUpdates.map((update) => [update.id, update.averageCostKobo.toString()]),
        ),
      },
      metadata: { ...input.auditMetadata, actorEmail: actor.email },
    });

    return stored;
  }

  /* ---------------------------------------------------------------- *
   * Void (shared by POST /purchases/:id/void and PUT /purchases/:id)
   * ---------------------------------------------------------------- */

  /** Checks that need only the purchase lock, so a refused void costs few statements. */
  async function loadVoidable(
    ctx: TxContext,
    purchase: Purchase,
  ): Promise<{ parts: PurchaseParts; ledgers: PurchaseLedgers }> {
    if (purchase.status === "VOIDED") {
      throw alreadyVoided(purchase.id);
    }
    if (purchase.status !== "RECEIVED") {
      throw businessRuleError("Only a received purchase can be voided.", {
        purchaseId: purchase.id,
        status: purchase.status,
      });
    }
    const parts = await loadPurchaseParts(ctx, purchase.id);
    const ledgers = await loadPurchaseLedgers(ctx, purchase.id, parts.supplierPayments.map((p) => p.id));
    // Mirrors trg_purchase_void_guard: only a LIVE (not yet reversed) supplier payment blocks a void.
    const reversed = reversedSupplierPaymentIds(ledgers.accountLedger);
    const livePayments = parts.supplierPayments.filter((payment) => !reversed.has(payment.id));
    if (livePayments.length > 0) {
      throw businessRuleError(
        "This purchase has supplier payments that have not been reversed. Reverse the payments first, then void or amend it.",
        { purchaseId: purchase.id, livePaymentCount: livePayments.length },
      );
    }
    return { parts, ledgers };
  }

  function voidPlan(purchase: Purchase, parts: PurchaseParts, ledgers: PurchaseLedgers): LockPlan {
    return {
      productIds: parts.lines.map((line) => line.productId),
      accountIds: ledgers.accountLedger.filter((entry) => entry.type === "PURCHASE_PAYMENT").map((entry) => entry.accountId),
      supplierIds: purchase.supplierId ? [purchase.supplierId] : [],
    };
  }

  async function executeVoid(
    ctx: TxContext,
    input: {
      purchase: Purchase;
      parts: PurchaseParts;
      ledgers: PurchaseLedgers;
      locked: Locked;
      voidedAt: Date;
    },
  ) {
    const { purchase, parts, ledgers, locked, voidedAt } = input;
    const movements = await loadProductMovements(ctx, parts.lines.map((line) => line.productId));

    // The domain would refuse a negative balance too, but only naming the product id.
    const lineIds = new Set(parts.lines.map((line) => line.id));
    const reversedIds = new Set(
      movements.filter((m) => m.reversesEntryId !== null).map((m) => m.reversesEntryId as string),
    );
    const needed = new Map<string, number>();
    for (const movement of movements) {
      if (
        movement.type === "PURCHASE" &&
        movement.purchaseLineId !== null &&
        lineIds.has(movement.purchaseLineId) &&
        movement.reversesEntryId === null &&
        !reversedIds.has(movement.id)
      ) {
        const key = stockKey(movement.productId, movement.location);
        needed.set(key, (needed.get(key) ?? 0) + movement.quantityUnits);
      }
    }
    for (const [key, quantity] of [...needed].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const onHand = locked.stock.get(key) ?? 0;
      if (onHand < quantity) {
        const [productId, location] = key.split(":") as [string, StockLocation];
        const name = locked.productById.get(productId)?.name ?? productId;
        throw businessRuleError(
          `Cannot void this purchase: '${name}' has ${onHand} on hand at ${location} but this purchase brought in ${quantity}. This stock has already been sold or moved.`,
          { productId, productName: name, location, onHandUnits: onHand, neededUnits: quantity },
        );
      }
    }

    const reversedLedgerIds = new Set(
      ledgers.accountLedger.filter((e) => e.reversesEntryId !== null).map((e) => e.reversesEntryId as string),
    );
    for (const entry of ledgers.accountLedger) {
      if (entry.type === "PURCHASE_PAYMENT" && entry.reversesEntryId === null && !reversedLedgerIds.has(entry.id)) {
        const account = locked.accounts.get(entry.accountId);
        if (account !== undefined && !account.isActive) {
          throw businessRuleError(
            `Account '${account.name}' is deactivated, so the money cannot be put back. Reactivate it first.`,
            { accountId: account.id },
          );
        }
      }
    }

    const domainAccounts: Account[] = [...locked.accounts.values()].map(toDomainAccount);

    const reversal = voidPurchase(
      purchase.id,
      voidedAt,
      [purchase],
      parts.lines,
      movements,
      ledgers.supplierLedger,
      randomUUID,
      parts.supplierPayments,
      ledgers.accountLedger,
      domainAccounts,
    );

    const stored = await insertPurchaseVoid(ctx, { purchaseId: purchase.id, ...reversal });
    return { stored, reversal };
  }

  type Reversal = Awaited<ReturnType<typeof executeVoid>>["reversal"];

  /** Carries a void's effects into the in-memory locked state, so an amend's replacement sees them. */
  function applyVoidToLocked(locked: Locked, reversal: Reversal): Locked {
    const costById = new Map(reversal.productUpdates.map((u) => [u.id, u.averageCostKobo]));
    const products = locked.products.map((p) =>
      costById.has(p.id) ? { ...p, averageCostKobo: costById.get(p.id)! } : p,
    );
    const stock = new Map(locked.stock);
    for (const movement of reversal.reversalMovements) {
      const key = stockKey(movement.productId, movement.location);
      stock.set(key, (stock.get(key) ?? 0) + movement.quantityUnits);
    }
    const accounts = new Map(locked.accounts);
    for (const entry of reversal.reversalAccountLedgerEntries as AccountLedgerEntry[]) {
      const account = accounts.get(entry.accountId);
      if (account !== undefined) {
        accounts.set(entry.accountId, { ...account, balanceKobo: account.balanceKobo + entry.amountKobo });
      }
    }
    return { ...locked, products, productById: new Map(products.map((p) => [p.id, p])), stock, accounts };
  }

  function voidAuditData(purchase: Purchase, reversal: Reversal) {
    return {
      before: {
        status: purchase.status,
        reference: purchase.reference,
        totalKobo: purchase.totalKobo.toString(),
        paidKobo: purchase.paidKobo.toString(),
      },
      after: {
        status: "VOIDED",
        stockMovementReversalIds: reversal.reversalMovements.map((m) => m.id),
        supplierLedgerReversalId: reversal.reversalSupplierLedgerEntry?.id ?? null,
        accountEntryReversals: reversal.reversalAccountLedgerEntries.map((entry) => ({
          id: entry.id,
          accountId: entry.accountId,
          amountKobo: entry.amountKobo.toString(),
        })),
        averageCostKobo: Object.fromEntries(
          reversal.productUpdates.map((update) => [update.id, update.averageCostKobo.toString()]),
        ),
      },
    };
  }

  const reversalSummary = (reversal: Reversal) => ({
    stockMovements: reversal.reversalMovements.length,
    supplierLedgerEntries: reversal.reversalSupplierLedgerEntry === null ? 0 : 1,
    accountEntries: reversal.reversalAccountLedgerEntries.length,
  });

  /* ---------------------------------------------------------------- *
   * Operations
   * ---------------------------------------------------------------- */

  async function createPurchase(
    dto: CreatePurchaseDto,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<PurchaseResponse> {
    // Checks that need no database run first. dueDate may be in the future.
    const purchasedAt = new Date(dto.purchasedAt);
    assertNotInFuture(purchasedAt, now(), "purchasedAt", "The purchase date");
    assertPurchaseWithinBounds(dto);
    const clientReference = normaliseClientReference(dto.reference);
    const requestHash = hashRequestBody(dto);

    return runWrite(CREATE_PURCHASE_ROUTE, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route: CREATE_PURCHASE_ROUTE, key: idempotencyKey, requestHash }, async () => {
        const locked = await acquireLocks(ctx, receivePlan(dto));
        const stored = await recordNewPurchase(ctx, {
          dto,
          actor,
          purchasedAt,
          clientReference,
          locked,
          auditMetadata: { idempotencyKey },
        });
        return { status: 201, body: toPurchaseDto(stored) };
      }),
    );
  }

  async function recordPayment(
    purchaseId: string,
    dto: RecordPurchasePaymentBody,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<PurchaseResponse> {
    const paidAt = new Date(dto.paidAt);
    assertNotInFuture(paidAt, now(), "paidAt", "The payment date");
    const amountKobo = BigInt(dto.amountKobo);
    const route = purchasePaymentRoute(purchaseId);

    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const purchase = await lockPurchase(ctx, purchaseId);
        if (purchase === null) {
          throw notFound(purchaseId);
        }
        if (purchase.status === "VOIDED") {
          throw businessRuleError("This purchase has been voided and cannot take payments.", { purchaseId });
        }
        if (purchase.status !== "RECEIVED") {
          throw businessRuleError("Only a received purchase can take payments.", {
            purchaseId,
            status: purchase.status,
          });
        }
        if (purchase.supplierId === null) {
          throw businessRuleError("This purchase has no supplier; it was paid in full when it was received.", {
            purchaseId,
          });
        }
        const amountDue = purchase.totalKobo - purchase.paidKobo;
        if (amountDue <= 0n) {
          throw businessRuleError("This purchase is already fully paid; nothing is owed.", { purchaseId });
        }
        if (amountKobo > amountDue) {
          throw validationError(
            `The payment of ${formatNaira(amountKobo)} is more than the ${formatNaira(amountDue)} still owed on this purchase.`,
            { field: "amountKobo", amountDueKobo: amountDue.toString(), amountKobo: amountKobo.toString() },
          );
        }

        const locked = await acquireLocks(ctx, { productIds: [], accountIds: [dto.accountId], supplierIds: [] });
        assertCanSpend(assertAccountPays(locked, dto.accountId), amountKobo);

        const result = recordPurchasePayment(
          {
            purchaseId,
            amountKobo,
            paidAt,
            method: dto.method,
            note: dto.note ?? null,
            accountId: dto.accountId,
          },
          [purchase],
          randomUUID,
        );
        const updated = await insertLaterPurchasePayment(ctx, {
          purchaseId,
          payment: result.supplierPayment,
          supplierLedgerEntry: result.supplierLedgerEntry,
          accountEntry: result.accountLedgerEntry,
          newPaidKobo: result.purchase.paidKobo,
        });
        await insertPurchaseAudit(ctx, {
          actorId: actor.id,
          action: "purchase.payment",
          entityId: purchaseId,
          beforeData: { paidKobo: purchase.paidKobo.toString(), balanceDueKobo: amountDue.toString() },
          afterData: {
            paidKobo: result.purchase.paidKobo.toString(),
            balanceDueKobo: (amountDue - amountKobo).toString(),
            payment: {
              id: result.supplierPayment.id,
              accountId: dto.accountId,
              amountKobo: amountKobo.toString(),
              method: dto.method,
              paidAt: paidAt.toISOString(),
            },
          },
          metadata: { idempotencyKey, actorEmail: actor.email },
        });

        return {
          status: 201,
          body: { purchase: toPurchaseDto(updated), payment: toSupplierPaymentDto(result.supplierPayment) },
        };
      }),
    );
  }

  async function reversePayment(
    purchaseId: string,
    paymentId: string,
    dto: ReversePaymentBody,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<PurchaseResponse> {
    const reversedAt = dto.reversedAt ? new Date(dto.reversedAt) : now();
    assertNotInFuture(reversedAt, now(), "reversedAt", "The reversal date");
    const route = purchasePaymentReverseRoute(purchaseId, paymentId);

    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const purchase = await lockPurchase(ctx, purchaseId);
        if (purchase === null) {
          throw notFound(purchaseId);
        }
        if (purchase.status === "VOIDED") {
          throw alreadyVoided(purchaseId);
        }
        const rows = await loadPaymentForReversal(ctx, purchaseId, paymentId);
        if (rows === null) {
          throw new AppError(404, "NOT_FOUND", "That payment does not belong to this purchase.", {
            purchaseId,
            paymentId,
          });
        }
        if (rows.accountLedger.some((entry) => entry.reversesEntryId !== null)) {
          throw businessRuleError("This payment has already been reversed.", { purchaseId, paymentId });
        }

        // The money goes back into the account, so it can never overdraw; still locked to serialize with spenders.
        const locked = await acquireLocks(ctx, { productIds: [], accountIds: [rows.payment.accountId], supplierIds: [] });
        const result = reversePurchasePayment(
          purchaseId,
          paymentId,
          dto.reason,
          reversedAt,
          [purchase],
          [rows.payment],
          rows.supplierLedger,
          rows.accountLedger,
          [...locked.accounts.values()].map(toDomainAccount),
          randomUUID,
        );
        const updated = await insertPurchasePaymentReversal(ctx, {
          purchaseId,
          supplierReversal: result.supplierReversal,
          accountReversal: result.accountReversal,
          newPaidKobo: result.purchase.paidKobo,
        });
        await insertPurchaseAudit(ctx, {
          actorId: actor.id,
          action: "purchase.payment.reverse",
          entityId: purchaseId,
          beforeData: { paidKobo: purchase.paidKobo.toString() },
          afterData: {
            paidKobo: result.purchase.paidKobo.toString(),
            paymentId,
            amountKobo: rows.payment.amountKobo.toString(),
            accountId: rows.payment.accountId,
            reason: dto.reason,
            reversedAt: reversedAt.toISOString(),
            supplierLedgerReversalId: result.supplierReversal.id,
            accountEntryReversalId: result.accountReversal.id,
          },
          metadata: { idempotencyKey, actorEmail: actor.email },
        });
        return { status: 201, body: { purchase: toPurchaseDto(updated), reversedPaymentId: paymentId } };
      }),
    );
  }

  async function voidExistingPurchase(
    purchaseId: string,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<PurchaseResponse> {
    const route = purchaseVoidRoute(purchaseId);
    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody({}) }, async () => {
        const purchase = await lockPurchase(ctx, purchaseId);
        if (purchase === null) {
          throw notFound(purchaseId);
        }
        const { parts, ledgers } = await loadVoidable(ctx, purchase);
        const locked = await acquireLocks(ctx, voidPlan(purchase, parts, ledgers));
        const { stored, reversal } = await executeVoid(ctx, { purchase, parts, ledgers, locked, voidedAt: now() });

        const audit = voidAuditData(purchase, reversal);
        await insertPurchaseAudit(ctx, {
          actorId: actor.id,
          action: "purchase.void",
          entityId: purchaseId,
          beforeData: audit.before,
          afterData: audit.after,
          metadata: { idempotencyKey, actorEmail: actor.email },
        });

        return { status: 200, body: { purchase: toPurchaseDto(stored), reversals: reversalSummary(reversal) } };
      }),
    );
  }

  async function amendPurchase(
    purchaseId: string,
    dto: CreatePurchaseDto,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<PurchaseResponse> {
    const purchasedAt = new Date(dto.purchasedAt);
    assertNotInFuture(purchasedAt, now(), "purchasedAt", "The purchase date");
    assertPurchaseWithinBounds(dto);
    // The replacement always gets a newly generated reference; a client one is ignored.
    const route = purchaseAmendRoute(purchaseId);

    return runWrite(route, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { actorId: actor.id, route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const purchase = await lockPurchase(ctx, purchaseId);
        if (purchase === null) {
          throw notFound(purchaseId);
        }
        const { parts, ledgers } = await loadVoidable(ctx, purchase);
        const locked = await acquireLocks(ctx, mergePlans(voidPlan(purchase, parts, ledgers), receivePlan(dto)));

        const { reversal } = await executeVoid(ctx, { purchase, parts, ledgers, locked, voidedAt: now() });
        const stored = await recordNewPurchase(ctx, {
          dto,
          actor,
          purchasedAt,
          clientReference: null,
          locked: applyVoidToLocked(locked, reversal),
          auditMetadata: { idempotencyKey, amendedFromPurchaseId: purchaseId },
        });

        const audit = voidAuditData(purchase, reversal);
        await insertPurchaseAudit(ctx, {
          actorId: actor.id,
          action: "purchase.void",
          entityId: purchaseId,
          beforeData: audit.before,
          afterData: audit.after,
          metadata: { idempotencyKey, actorEmail: actor.email, amendedByPurchaseId: stored.id },
        });

        return {
          status: 200,
          body: { purchase: toPurchaseDto(stored), voidedPurchaseId: purchaseId },
        };
      }),
    );
  }

  return {
    createPurchase,
    recordPayment,
    reversePayment,
    voidPurchase: voidExistingPurchase,
    amendPurchase,
    listPurchases: (query: ListPurchasesQuery) =>
      listPurchases(prisma, query, now(), maxDateRangeDays),
    getPurchase: (id: string) => getPurchaseDetail(prisma, id),
  };
}

export type PurchasesService = ReturnType<typeof createPurchasesService>;
