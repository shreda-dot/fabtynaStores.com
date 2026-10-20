import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import {
  assertAccountWillRemainNonnegative,
  formatNaira,
  recordSale,
  recordSalePayment,
  toSaleDto,
  toSalePaymentDto,
  voidSale,
  type Account,
  type AccountLedgerEntry,
  type Product,
  type Sale,
  type StockMovement,
} from "@fabtyna/shared";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { createWriteRunner } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import {
  insertLaterPayment,
  insertSale,
  insertSaleAudit,
  insertVoid,
  loadSaleHistory,
  loadSaleParts,
  lockAccounts,
  lockCustomers,
  lockProducts,
  lockSale,
  lockStockBalances,
  nextSaleSequence,
  setLocalTimeouts,
  stockKey,
  type LockedAccount,
  type LockedCustomer,
  type ReceivedPayment,
  type SaleHistory,
  type SaleParts,
  type StockKey,
  type TxContext,
} from "./sales.repository.js";
import { getSaleDetail, listSales } from "./sales.queries.js";
import type { CreateSaleDto, ListSalesQuery, RecordPaymentDto } from "./sales.schemas.js";
import {
  assertLocationMatchesChannel,
  assertNotInFuture,
  assertWithinBounds,
  formatSaleReference,
  MAX_SALE_TOTAL_KOBO,
  normaliseClientReference,
} from "./sales.validation.js";

export const CREATE_SALE_ROUTE = "POST /sales";
/** The sale id is part of the idempotency route key, so one key can never cross sales. */
export const paymentRoute = (saleId: string): string => `POST /sales/${saleId}/payments`;
export const voidRoute = (saleId: string): string => `POST /sales/${saleId}/void`;
export const amendRoute = (saleId: string): string => `PUT /sales/${saleId}`;

export interface SaleResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

export interface SalesServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}

/** A stock level so large that the domain's per-line stock check cannot fire (pass 1). */
const UNLIMITED_UNITS = 2_000_000_000;

function syntheticMovement(product: Product, location: CreateSaleDto["location"], units: number): StockMovement {
  return {
    id: `synthetic-${product.id}`,
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
  };
}

/* ------------------------------------------------------------------ *
 * THE LOCK ORDER (one order, used by every write in this module)
 *
 *   1. the sale row                       (lockSale, by the caller)
 *   2. product rows, sorted by id         (lockProducts)
 *   3. stock_balances, by productId, location
 *   4. account_balances, sorted by accountId (read together with accounts)
 *   5. customer rows, sorted by id
 *
 * `acquireLocks` below takes 2-5 in that order, one statement per table; the
 * caller takes 1 first. Anything that depends on a lock is checked only after
 * it is held.
 * ------------------------------------------------------------------ */

interface LockPlan {
  productIds: readonly string[];
  stockKeys: readonly StockKey[];
  accountIds: readonly string[];
  customerIds: readonly string[];
}

interface Locked {
  products: Product[];
  productById: Map<string, Product>;
  stock: Map<string, number>;
  accounts: Map<string, LockedAccount>;
  customers: Map<string, LockedCustomer>;
}

async function acquireLocks(ctx: TxContext, plan: LockPlan): Promise<Locked> {
  const products = plan.productIds.length > 0 ? await lockProducts(ctx, plan.productIds) : [];
  const stock = await lockStockBalances(ctx, plan.stockKeys);
  const accounts = await lockAccounts(ctx, plan.accountIds);
  const customers = await lockCustomers(ctx, plan.customerIds);
  return { products, productById: new Map(products.map((p) => [p.id, p])), stock, accounts, customers };
}

function salePlan(dto: CreateSaleDto): LockPlan {
  const paid = BigInt(dto.paidKobo) > 0n;
  return {
    productIds: dto.lines.map((line) => line.productId),
    stockKeys: dto.lines.map((line) => ({ productId: line.productId, location: dto.location })),
    accountIds: paid && dto.accountId ? [dto.accountId] : [],
    customerIds: dto.customerId ? [dto.customerId] : [],
  };
}

function mergePlans(...plans: LockPlan[]): LockPlan {
  return {
    productIds: plans.flatMap((p) => [...p.productIds]),
    stockKeys: plans.flatMap((p) => [...p.stockKeys]),
    accountIds: plans.flatMap((p) => [...p.accountIds]),
    customerIds: plans.flatMap((p) => [...p.customerIds]),
  };
}

function assertAccountReceivesMoney(locked: Locked, accountId: string): LockedAccount {
  const account = locked.accounts.get(accountId);
  if (account === undefined) {
    throw validationError("That account does not exist.", { field: "accountId" });
  }
  if (!account.isActive) {
    throw businessRuleError(`Account '${account.name}' is deactivated and cannot receive money.`, {
      accountId: account.id,
    });
  }
  return account;
}

const alreadyVoided = (saleId: string): AppError =>
  businessRuleError("This sale has already been voided.", { saleId });

export function createSalesService(options: SalesServiceOptions) {
  const { prisma } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const { runWrite, withIdempotency } = createWriteRunner({
    prisma,
    now,
    log,
    txTimeouts: options.txTimeouts,
  });

  /* ---------------------------------------------------------------- *
   * Record a sale (shared by POST /sales and PUT /sales/:id)
   * ---------------------------------------------------------------- */

  async function recordNewSale(
    ctx: TxContext,
    input: {
      dto: CreateSaleDto;
      actor: Actor;
      soldAt: Date;
      clientReference: string | null;
      locked: Locked;
      /** Stock the sale may take, by product:location (the locked balances, plus anything a void just put back). */
      availableStock: ReadonlyMap<string, number>;
      auditMetadata: Record<string, unknown>;
    },
  ) {
    const { dto, actor, soldAt, locked } = input;
    const productIds = dto.lines.map((line) => line.productId);

    for (const productId of new Set(productIds)) {
      const product = locked.productById.get(productId);
      if (product === undefined) {
        throw validationError(`Product '${productId}' does not exist.`, { field: "lines.productId", productId });
      }
      if (product.deletedAt !== null) {
        throw businessRuleError(`Product '${product.name}' is deactivated and cannot be sold.`, {
          productId,
          productName: product.name,
        });
      }
      if (product.saleChannel !== "BOTH" && product.saleChannel !== dto.channel) {
        throw validationError(
          `Product '${product.name}' is only sold ${product.saleChannel.toLowerCase()}, not ${dto.channel.toLowerCase()}.`,
          { productId, productName: product.name, saleChannel: product.saleChannel, channel: dto.channel },
        );
      }
    }

    if (dto.customerId !== null) {
      const customer = locked.customers.get(dto.customerId);
      if (customer === undefined) {
        throw validationError("That customer does not exist.", { field: "customerId" });
      }
      if (customer.deletedAt !== null) {
        throw businessRuleError(`Customer '${customer.name}' is deactivated and cannot be sold to.`, {
          customerId: customer.id,
        });
      }
    }

    const paidKobo = BigInt(dto.paidKobo);
    // An account only matters when money is actually received.
    const accountId = paidKobo > 0n ? (dto.accountId ?? null) : null;
    if (accountId !== null) {
      assertAccountReceivesMoney(locked, accountId);
    }

    // One domain pass. Stock is proven below against the locked balances, so the
    // domain's own per-line check is given unlimited stock here and only the
    // remaining validation (quantities, fractions, paid vs total, customer) fires.
    const costByProductId = new Map(locked.products.map((p) => [p.id, p.averageCostKobo]));
    const result = recordSale(
      {
        customerId: dto.customerId,
        customerName: dto.customerName,
        createdById: actor.id,
        channel: dto.channel,
        location: dto.location,
        soldAt,
        notes: dto.notes,
        reference: null,
        paidKobo,
        accountId,
        lines: dto.lines.map((line) => ({
          productId: line.productId,
          unit: line.unit,
          quantity: line.quantity,
          unitPriceKobo: BigInt(line.unitPriceKobo),
        })),
      },
      locked.products,
      locked.products.map((p) => syntheticMovement(p, dto.location, UNLIMITED_UNITS)),
      randomUUID,
    );

    if (result.sale.totalKobo > MAX_SALE_TOTAL_KOBO) {
      throw validationError("The sale total is too large.", { field: "lines" });
    }

    const requestedByProduct = new Map<string, number>();
    for (const movement of result.movements) {
      requestedByProduct.set(
        movement.productId,
        (requestedByProduct.get(movement.productId) ?? 0) - movement.quantityUnits,
      );
    }
    for (const [productId, requested] of [...requestedByProduct].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const available = input.availableStock.get(stockKey(productId, dto.location)) ?? 0;
      if (requested > available) {
        const name = locked.productById.get(productId)?.name ?? productId;
        throw new AppError(
          409,
          "INSUFFICIENT_STOCK",
          `Not enough stock for '${name}' at ${dto.location}: ${available} available, ${requested} requested.`,
          { productId, productName: name, location: dto.location, availableUnits: available, requestedUnits: requested },
        );
      }
    }

    const reference =
      input.clientReference ?? formatSaleReference(soldAt, await nextSaleSequence(ctx));
    const sale = { ...result.sale, reference };

    const payments: ReceivedPayment[] =
      result.salePayment !== null && result.accountLedgerEntry !== null
        ? [{ payment: result.salePayment, accountEntry: result.accountLedgerEntry }]
        : [];

    const afterData = {
      sale: {
        id: sale.id,
        reference,
        customerId: sale.customerId,
        channel: sale.channel,
        location: dto.location,
        totalKobo: sale.totalKobo.toString(),
        paidKobo: sale.paidKobo.toString(),
        soldAt: sale.soldAt.toISOString(),
      },
      lines: result.saleLines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        quantityUnits: line.quantityUnits,
        unitPriceKobo: line.unitPriceKobo.toString(),
        costPerUnitKobo: (costByProductId.get(line.productId) ?? 0n).toString(),
      })),
      payments: payments.map(({ payment }) => ({
        id: payment.id,
        accountId: payment.accountId,
        amountKobo: payment.amountKobo.toString(),
      })),
    };

    return insertSale(ctx, {
      sale,
      lines: result.saleLines,
      location: dto.location,
      movements: result.movements,
      customerLedgerEntry: result.customerLedgerEntry,
      payments,
      costByProductId,
      actorId: actor.id,
      audit: {
        afterData,
        metadata: { actorEmail: actor.email, ...input.auditMetadata } as Prisma.InputJsonValue,
      },
    });
  }

  /* ---------------------------------------------------------------- *
   * Void (shared by POST /sales/:id/void and PUT /sales/:id)
   * ---------------------------------------------------------------- */

  /** Rules that only need the sale row (locked) and its committed history. */
  function assertVoidable(sale: Sale, parts: SaleParts, history: SaleHistory): void {
    if (sale.status === "VOIDED") {
      throw alreadyVoided(sale.id);
    }
    if (sale.status !== "COMPLETED") {
      throw businessRuleError("Only a completed sale can be voided.", { saleId: sale.id, status: sale.status });
    }
    // Mirrors trg_sale_void_guard, which stays as the backstop: a later (on-account)
    // payment is a customer PAYMENT ledger entry that points at one of the sale's payments.
    const paymentIds = new Set(parts.payments.map((payment) => payment.id));
    const hasOnAccountPayment = history.customerLedger.some(
      (entry) => entry.type === "PAYMENT" && entry.salePaymentId !== null && paymentIds.has(entry.salePaymentId),
    );
    if (hasOnAccountPayment) {
      throw businessRuleError(
        "This sale has a payment received after the sale. Reverse the payments first (feature not built yet).",
        { saleId: sale.id },
      );
    }
  }

  /** Reads the sale's rows and applies the voidable rules. Runs right after the sale lock. */
  async function loadVoidable(ctx: TxContext, sale: Sale) {
    if (sale.status === "VOIDED") {
      throw alreadyVoided(sale.id);
    }
    const parts = await loadSaleParts(ctx, sale.id);
    const history = await loadSaleHistory(ctx, parts, sale.id);
    assertVoidable(sale, parts, history);
    return { parts, history };
  }

  function voidPlan(parts: SaleParts, sale: Sale): LockPlan {
    return {
      productIds: parts.lines.map((line) => line.productId),
      stockKeys: parts.lines.map((line) => ({ productId: line.productId, location: line.location })),
      accountIds: parts.payments.map((payment) => payment.accountId),
      customerIds: sale.customerId ? [sale.customerId] : [],
    };
  }

  /** Runs after `acquireLocks`: checks every affected account can give the money back, then reverses everything. */
  async function executeVoid(
    ctx: TxContext,
    input: { sale: Sale; parts: SaleParts; history: SaleHistory; locked: Locked; voidedAt: Date },
  ) {
    const { sale, parts, history, locked, voidedAt } = input;

    // Money taken up front goes back out of the account. If it was already spent, say so by name
    // (the domain's own check would only see this one sale's entries, so the real balance is checked here).
    const reversedIds = new Set(
      history.accountLedger.filter((entry) => entry.reversesEntryId !== null).map((entry) => entry.reversesEntryId),
    );
    const outgoingByAccount = new Map<string, bigint>();
    for (const entry of history.accountLedger) {
      if (entry.type === "SALE_PAYMENT" && entry.reversesEntryId === null && !reversedIds.has(entry.id)) {
        outgoingByAccount.set(entry.accountId, (outgoingByAccount.get(entry.accountId) ?? 0n) - entry.amountKobo);
      }
    }
    for (const [accountId, delta] of [...outgoingByAccount].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const account = locked.accounts.get(accountId);
      if (account === undefined) {
        continue;
      }
      try {
        assertAccountWillRemainNonnegative(account, account.balanceKobo, delta, "reversal");
      } catch (error) {
        if (error instanceof RangeError) {
          throw businessRuleError(error.message, {
            accountId,
            accountName: account.name,
            balanceKobo: account.balanceKobo.toString(),
            amountKobo: (-delta).toString(),
          });
        }
        throw error;
      }
    }

    const epoch = new Date(0);
    const domainAccounts: Account[] = [...locked.accounts.values()].map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      isActive: account.isActive,
      deactivatedAt: null,
      note: null,
      createdAt: epoch,
      updatedAt: epoch,
    }));

    const reversal = voidSale(
      sale.id,
      voidedAt,
      [sale],
      parts.lines,
      history.movements,
      history.customerLedger,
      randomUUID,
      parts.payments,
      history.accountLedger,
      domainAccounts,
    );

    const stored = await insertVoid(ctx, { saleId: sale.id, ...reversal });
    return { stored, reversal };
  }

  function voidAuditData(sale: Sale, reversal: Awaited<ReturnType<typeof executeVoid>>["reversal"]) {
    return {
      before: {
        status: sale.status,
        reference: sale.reference,
        totalKobo: sale.totalKobo.toString(),
        paidKobo: sale.paidKobo.toString(),
      },
      after: {
        status: "VOIDED",
        stockMovementReversalIds: reversal.reversalMovements.map((m) => m.id),
        customerLedgerReversalId: reversal.reversalCustomerLedgerEntry?.id ?? null,
        accountEntryReversals: reversal.reversalAccountLedgerEntries.map((entry) => ({
          id: entry.id,
          accountId: entry.accountId,
          amountKobo: entry.amountKobo.toString(),
        })),
      },
    };
  }

  /* ---------------------------------------------------------------- *
   * Operations
   * ---------------------------------------------------------------- */

  async function createSale(dto: CreateSaleDto, actor: Actor, idempotencyKey: string | null): Promise<SaleResponse> {
    // Checks that need no database run first, so a bad request costs nothing.
    const soldAt = new Date(dto.soldAt);
    assertNotInFuture(soldAt, now(), "soldAt", "The sale date");
    assertLocationMatchesChannel(dto.channel, dto.location);
    assertWithinBounds(dto);
    const clientReference = normaliseClientReference(dto.reference);
    const requestHash = hashRequestBody(dto);

    return runWrite(CREATE_SALE_ROUTE, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { route: CREATE_SALE_ROUTE, key: idempotencyKey, requestHash }, async () => {
        const locked = await acquireLocks(ctx, salePlan(dto));
        const stored = await recordNewSale(ctx, {
          dto,
          actor,
          soldAt,
          clientReference,
          locked,
          availableStock: locked.stock,
          auditMetadata: { idempotencyKey },
        });
        return { status: 201, body: toSaleDto(stored) };
      }),
    );
  }

  async function recordPayment(
    saleId: string,
    dto: RecordPaymentDto,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<SaleResponse> {
    const paidAt = new Date(dto.paidAt);
    assertNotInFuture(paidAt, now(), "paidAt", "The payment date");
    const amountKobo = BigInt(dto.amountKobo);
    const route = paymentRoute(saleId);

    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const sale = await lockSale(ctx, saleId);
        if (sale === null) {
          throw new AppError(404, "NOT_FOUND", "Sale not found.", { id: saleId });
        }
        const locked = await acquireLocks(ctx, {
          productIds: [],
          stockKeys: [],
          accountIds: [dto.accountId],
          customerIds: sale.customerId ? [sale.customerId] : [],
        });

        if (sale.status === "VOIDED") {
          throw businessRuleError("This sale has been voided and cannot take payments.", { saleId });
        }
        if (sale.status !== "COMPLETED") {
          throw businessRuleError("Only a completed sale can take payments.", { saleId, status: sale.status });
        }
        const amountDue = sale.totalKobo - sale.paidKobo;
        if (amountDue <= 0n) {
          throw businessRuleError("This sale is already fully paid; nothing is owed.", { saleId });
        }
        if (amountKobo > amountDue) {
          throw validationError(
            `The payment of ${formatNaira(amountKobo)} is more than the ${formatNaira(amountDue)} still owed on this sale.`,
            { field: "amountKobo", amountDueKobo: amountDue.toString(), amountKobo: amountKobo.toString() },
          );
        }
        assertAccountReceivesMoney(locked, dto.accountId);

        const result = recordSalePayment(
          { saleId, amountKobo, paidAt, accountId: dto.accountId },
          [sale],
          randomUUID,
        );
        const updated = await insertLaterPayment(ctx, {
          saleId,
          payment: result.salePayment,
          customerLedgerEntry: result.customerLedgerEntry,
          accountEntry: result.accountLedgerEntry,
          newPaidKobo: result.sale.paidKobo,
        });
        await insertSaleAudit(ctx, {
          actorId: actor.id,
          action: "sale.payment",
          entityId: saleId,
          beforeData: { paidKobo: sale.paidKobo.toString(), balanceDueKobo: amountDue.toString() },
          afterData: {
            paidKobo: result.sale.paidKobo.toString(),
            balanceDueKobo: (amountDue - amountKobo).toString(),
            payment: {
              id: result.salePayment.id,
              accountId: dto.accountId,
              amountKobo: amountKobo.toString(),
              paidAt: paidAt.toISOString(),
            },
          },
          metadata: { idempotencyKey, actorEmail: actor.email },
        });

        return {
          status: 201,
          body: { sale: toSaleDto(updated), payment: toSalePaymentDto(result.salePayment) },
        };
      }),
    );
  }

  async function voidExistingSale(
    saleId: string,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<SaleResponse> {
    const route = voidRoute(saleId);
    return runWrite(route, {}, (ctx) =>
      withIdempotency(ctx, { route, key: idempotencyKey, requestHash: hashRequestBody({}) }, async () => {
        const sale = await lockSale(ctx, saleId);
        if (sale === null) {
          throw new AppError(404, "NOT_FOUND", "Sale not found.", { id: saleId });
        }
        const { parts, history } = await loadVoidable(ctx, sale);
        const locked = await acquireLocks(ctx, voidPlan(parts, sale));
        const { stored, reversal } = await executeVoid(ctx, { sale, parts, history, locked, voidedAt: now() });

        const audit = voidAuditData(sale, reversal);
        await insertSaleAudit(ctx, {
          actorId: actor.id,
          action: "sale.void",
          entityId: saleId,
          beforeData: audit.before,
          afterData: audit.after,
          metadata: { idempotencyKey, actorEmail: actor.email },
        });

        return {
          status: 200,
          body: {
            sale: toSaleDto(stored),
            reversals: {
              stockMovements: reversal.reversalMovements.length,
              customerLedgerEntries: reversal.reversalCustomerLedgerEntry === null ? 0 : 1,
              accountEntries: reversal.reversalAccountLedgerEntries.length,
            },
          },
        };
      }),
    );
  }

  /**
   * Amend = void the original and record the replacement in ONE transaction.
   * The replacement always gets a newly generated reference (a reference in the
   * body is ignored): the original keeps its own, so the two never collide.
   */
  async function amendSale(
    saleId: string,
    dto: CreateSaleDto,
    actor: Actor,
    idempotencyKey: string | null,
  ): Promise<SaleResponse> {
    const soldAt = new Date(dto.soldAt);
    assertNotInFuture(soldAt, now(), "soldAt", "The sale date");
    assertLocationMatchesChannel(dto.channel, dto.location);
    assertWithinBounds(dto);
    const route = amendRoute(saleId);

    return runWrite(route, { lines: dto.lines.length }, (ctx) =>
      withIdempotency(ctx, { route, key: idempotencyKey, requestHash: hashRequestBody(dto) }, async () => {
        const original = await lockSale(ctx, saleId);
        if (original === null) {
          throw new AppError(404, "NOT_FOUND", "Sale not found.", { id: saleId });
        }
        const { parts, history } = await loadVoidable(ctx, original);
        const locked = await acquireLocks(ctx, mergePlans(voidPlan(parts, original), salePlan(dto)));

        const voided = await executeVoid(ctx, { sale: original, parts, history, locked, voidedAt: now() });

        // The void has just put its stock back; the replacement may use it.
        const availableStock = new Map(locked.stock);
        for (const movement of voided.reversal.reversalMovements) {
          const key = stockKey(movement.productId, movement.location);
          availableStock.set(key, (availableStock.get(key) ?? 0) + movement.quantityUnits);
        }

        const created = await recordNewSale(ctx, {
          dto,
          actor,
          soldAt,
          clientReference: null,
          locked,
          availableStock,
          auditMetadata: { idempotencyKey, amendedFromSaleId: saleId },
        });

        const audit = voidAuditData(original, voided.reversal);
        await insertSaleAudit(ctx, {
          actorId: actor.id,
          action: "sale.void",
          entityId: saleId,
          beforeData: audit.before,
          afterData: audit.after,
          metadata: { idempotencyKey, actorEmail: actor.email, amendedBySaleId: created.id },
        });

        return { status: 200, body: { sale: toSaleDto(created), voidedSaleId: saleId } };
      }),
    );
  }

  async function getSale(id: string): Promise<unknown> {
    return getSaleDetail(prisma, id);
  }

  async function list(query: ListSalesQuery) {
    return listSales(prisma, query);
  }

  return { createSale, recordPayment, voidSale: voidExistingSale, amendSale, getSale, listSales: list };
}

export type SalesService = ReturnType<typeof createSalesService>;
