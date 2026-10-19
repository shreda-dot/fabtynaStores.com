import type {
    Account,
    AccountEntryType,
    AccountLedgerEntry,
    AccountTransfer,
    Expense,
    Sale,
} from "./types.ts";
import { formatNaira } from "../money.ts";
import type { IdGenerator } from "./operations.ts";
import { validateAccountLedgerAmount } from "./ledger.ts";
import { getLagosBusinessDate } from "../lagos-time.ts";

/**
 * Accounts are the single source of truth for money the business actually
 * has. Every movement of money is one append-only `AccountLedgerEntry`; an
 * account's balance is always the sum of its entries, never a typed figure.
 *
 * This module holds the pure domain rules: how a balance is computed, when a
 * spend must be refused, what each entry type is allowed to reference, and the
 * builders that stamp out new entries and transfers.
 */

/* ------------------------------------------------------------------ *
 * Source exclusivity
 * ------------------------------------------------------------------ */

export const ACCOUNT_LEDGER_SOURCE_FIELDS = [
    "salePaymentId",
    "customerPaymentId",
    "supplierPaymentId",
    "purchaseId",
    "expenseId",
    "otherIncomeId",
    "accountTransferId",
    "customerRefundId",
    "loanId",
    "loanRepaymentId",
] as const;

export type AccountLedgerSourceField =
    (typeof ACCOUNT_LEDGER_SOURCE_FIELDS)[number];

/**
 * The one source column each entry type must fill. Types absent from this map
 * (opening balance, owner capital/drawings, other income, bank/POS charge and
 * adjustments) are deliberately source-less: they belong to no other document.
 */
const REQUIRED_SOURCE_FIELD: Partial<Record<AccountEntryType, AccountLedgerSourceField>> = {
    SALE_PAYMENT: "salePaymentId",
    CUSTOMER_PAYMENT: "customerPaymentId",
    SUPPLIER_PAYMENT: "supplierPaymentId",
    PURCHASE_PAYMENT: "purchaseId",
    EXPENSE: "expenseId",
    OTHER_INCOME: "otherIncomeId",
    CUSTOMER_REFUND: "customerRefundId",
    TRANSFER_IN: "accountTransferId",
    TRANSFER_OUT: "accountTransferId",
    LOAN_DISBURSEMENT: "loanId",
    LOAN_REPAYMENT: "loanRepaymentId",
};

/** Types whose `note` must be non-empty so a human can explain the movement. */
const NOTE_REQUIRED_TYPES: ReadonlySet<AccountEntryType> = new Set([
    "ADJUSTMENT",
    "OWNER_DRAWING",
    "BANK_OR_POS_CHARGE",
]);

/* ------------------------------------------------------------------ *
 * Balances, overdraft and deactivation
 * ------------------------------------------------------------------ */

export function accountBalanceKobo(
    accountId: string,
    entries: readonly AccountLedgerEntry[],
): bigint {
    let balance = 0n;
    for (const entry of entries) {
        if (entry.accountId === accountId) balance += entry.amountKobo;
    }
    return balance;
}

export function accountBalancesKobo(
    accounts: readonly Account[],
    entries: readonly AccountLedgerEntry[],
): Map<string, bigint> {
    const balances = new Map<string, bigint>();
    for (const account of accounts) balances.set(account.id, 0n);
    for (const entry of entries) {
        balances.set(entry.accountId, (balances.get(entry.accountId) ?? 0n) + entry.amountKobo);
    }
    return balances;
}

/** Total money the business holds across every account. */
export function totalAccountBalanceKobo(
    entries: readonly AccountLedgerEntry[],
): bigint {
    return entries.reduce((total, entry) => total + entry.amountKobo, 0n);
}

function overspendMessage(
    account: Pick<Account, "name">,
    balanceKobo: bigint,
    requestedKobo: bigint,
    reason: "spend" | "reversal",
): string {
    const amount = formatNaira(requestedKobo);
    const balance = formatNaira(balanceKobo);
    if (reason === "reversal") {
        return (
            `Cannot reverse ${amount} on ${account.name} (balance ${balance}): ` +
            "this cash has already been spent; record the refund from another account " +
            "or record income or reconcile first."
        );
    }
    return (
        `Cannot spend ${amount} from ${account.name} (balance ${balance}): ` +
        "record income or reconcile first."
    );
}

/**
 * Refuses any change that would push an account below zero. The message names
 * the account, its balance and the amount requested so the UI can show it
 * verbatim instead of leaking a raw `23514` constraint violation.
 */
export function assertAccountWillRemainNonnegative(
    account: Pick<Account, "id" | "name">,
    currentBalanceKobo: bigint,
    deltaKobo: bigint,
    reason: "spend" | "reversal" = "spend",
): void {
    if (currentBalanceKobo + deltaKobo < 0n) {
        throw new RangeError(
            overspendMessage(
                account,
                currentBalanceKobo,
                deltaKobo < 0n ? -deltaKobo : deltaKobo,
                reason,
            ),
        );
    }
}

/**
 * An account may only be deactivated once nothing is left in it. A missing
 * balance row counts as zero, so a never-used account is deactivatable.
 */
export function assertAccountDeactivatable(
    account: Pick<Account, "id" | "name">,
    balanceKobo: bigint,
): void {
    if (balanceKobo !== 0n) {
        throw new RangeError(
            `Account '${account.name}' still holds ${balanceKobo.toString()} kobo and cannot be deactivated. Move the balance out first.`,
        );
    }
}

export function assertAccountAcceptsNewEntries(
    account: Account,
    isReversal: boolean,
): void {
    if (isReversal) return;
    if (!account.isActive) {
        throw new RangeError(
            `Account '${account.name}' is deactivated and cannot receive new entries.`,
        );
    }
}

export function assertNotFutureOccurredAt(
    occurredAt: Date,
    todayLagosDate: string,
): void {
    if (!Number.isFinite(occurredAt.getTime())) {
        throw new RangeError("Account entry date must be valid.");
    }
    if (getLagosBusinessDate(occurredAt) > todayLagosDate) {
        throw new RangeError("An account entry cannot be dated in the future.");
    }
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validateAccount(account: Account): void {
    if (account.name.trim() === "") {
        throw new RangeError("An account must have a name.");
    }
    if (account.isActive && account.deactivatedAt !== null) {
        throw new RangeError("An active account must not carry a deactivation date.");
    }
    if (!account.isActive && account.deactivatedAt === null) {
        throw new RangeError("A deactivated account must carry a deactivation date.");
    }
}

export function validateAccountLedgerEntry(entry: AccountLedgerEntry): void {
    validateAccountLedgerAmount(entry.type, entry.amountKobo);
    if (!Number.isFinite(entry.occurredAt.getTime())) {
        throw new RangeError("An account ledger entry must have a valid date.");
    }

    const expected = REQUIRED_SOURCE_FIELD[entry.type] ?? null;
    for (const field of ACCOUNT_LEDGER_SOURCE_FIELDS) {
        const value = entry[field];
        if (field === expected) {
            if (value === null) {
                throw new RangeError(
                    `A ${entry.type} account entry must reference its ${expected}.`,
                );
            }
        } else if (value !== null) {
            throw new RangeError(
                `A ${entry.type} account entry must not reference ${field}.`,
            );
        }
    }

    if (NOTE_REQUIRED_TYPES.has(entry.type) && (entry.note ?? "").trim() === "") {
        throw new RangeError(`A ${entry.type} account entry needs a note.`);
    }
}

export function validateAccountLedgerReversals(
    entries: readonly AccountLedgerEntry[],
): void {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const reversed = new Set<string>();

    for (const entry of entries) {
        if (entry.reversesEntryId === null) continue;

        const target = byId.get(entry.reversesEntryId);
        if (!target) {
            throw new RangeError(
                `Account ledger reversal '${entry.id}' references a missing target.`,
            );
        }
        if (target.reversesEntryId !== null) {
            throw new RangeError("An account ledger reversal cannot target another reversal.");
        }
        if (reversed.has(target.id)) {
            throw new RangeError(`Account ledger entry '${target.id}' was already reversed.`);
        }
        reversed.add(target.id);

        if (entry.accountId !== target.accountId) {
            throw new RangeError(
                "An account ledger reversal must keep the same account as its target.",
            );
        }
        if (entry.type !== target.type) {
            throw new RangeError(
                "An account ledger reversal must keep the same type as its target.",
            );
        }
        if (entry.amountKobo !== -target.amountKobo) {
            throw new RangeError("An account ledger reversal must negate the target amount.");
        }
        for (const field of ACCOUNT_LEDGER_SOURCE_FIELDS) {
            if (entry[field] !== target[field]) {
                throw new RangeError(
                    "An account ledger reversal must keep the same source references as its target.",
                );
            }
        }
    }
}

export function validateAccountTransfer(transfer: AccountTransfer): void {
    if (transfer.fromAccountId === transfer.toAccountId) {
        throw new RangeError("An account transfer must move money between two different accounts.");
    }
    if (transfer.amountKobo <= 0n) {
        throw new RangeError("An account transfer amount must be positive.");
    }
    if (!Number.isFinite(transfer.occurredAt.getTime())) {
        throw new RangeError("An account transfer date must be valid.");
    }
}

/**
 * At most one live OPENING_BALANCE per account. Corrections afterwards go
 * through a reconcile adjustment, never a second opening balance.
 */
export function validateAtMostOneLiveOpeningBalance(
    entries: readonly AccountLedgerEntry[],
): void {
    const reversed = new Set(
        entries
            .filter((entry) => entry.reversesEntryId !== null)
            .map((entry) => entry.reversesEntryId as string),
    );
    const seen = new Set<string>();
    for (const entry of entries) {
        if (entry.type !== "OPENING_BALANCE" || entry.reversesEntryId !== null) continue;
        if (reversed.has(entry.id)) continue;
        if (seen.has(entry.accountId)) {
            throw new RangeError(
                "An account may only have one live opening balance; reconcile instead.",
            );
        }
        seen.add(entry.accountId);
    }
}

/**
 * Money that left an account for a loan repayment's interest portion is part
 * of the single LOAN_REPAYMENT entry, so the linked LOAN_INTEREST expense must
 * never own an account entry of its own (it would double-count the outflow).
 */
export function validateLoanInterestHasNoAccountEntry(
    expenses: readonly Expense[],
    entries: readonly AccountLedgerEntry[],
): void {
    const interestExpenseIds = new Set(
        expenses
            .filter((expense) => expense.category === "LOAN_INTEREST")
            .map((expense) => expense.id),
    );
    for (const entry of entries) {
        if (entry.expenseId !== null && interestExpenseIds.has(entry.expenseId)) {
            throw new RangeError(
                "A loan-interest expense must not post its own account entry; the repayment covers it.",
            );
        }
    }
}

export function validateExpenseVoidFields(expense: Expense): void {
    if (expense.voidedAt === null) {
        if (expense.voidReason !== null) {
            throw new RangeError("An expense must not carry a void reason without a void date.");
        }
        return;
    }
    if (!Number.isFinite(expense.voidedAt.getTime())) {
        throw new RangeError("An expense void date must be valid.");
    }
    if ((expense.voidReason ?? "").trim() === "") {
        throw new RangeError("Voiding an expense requires a reason.");
    }
}

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

export interface BuildAccountEntryInput {
    accountId: string;
    type: AccountEntryType;
    amountKobo: bigint;
    occurredAt: Date;
    note?: string | null;
    salePaymentId?: string | null;
    customerPaymentId?: string | null;
    supplierPaymentId?: string | null;
    purchaseId?: string | null;
    expenseId?: string | null;
    otherIncomeId?: string | null;
    accountTransferId?: string | null;
    customerRefundId?: string | null;
    loanId?: string | null;
    loanRepaymentId?: string | null;
}

export function buildAccountLedgerEntry(
    input: BuildAccountEntryInput,
    newId: IdGenerator,
): AccountLedgerEntry {
    const entry: AccountLedgerEntry = {
        id: newId(),
        accountId: input.accountId,
        type: input.type,
        amountKobo: input.amountKobo,
        salePaymentId: input.salePaymentId ?? null,
        customerPaymentId: input.customerPaymentId ?? null,
        supplierPaymentId: input.supplierPaymentId ?? null,
        purchaseId: input.purchaseId ?? null,
        expenseId: input.expenseId ?? null,
        otherIncomeId: input.otherIncomeId ?? null,
        accountTransferId: input.accountTransferId ?? null,
        customerRefundId: input.customerRefundId ?? null,
        loanId: input.loanId ?? null,
        loanRepaymentId: input.loanRepaymentId ?? null,
        reversesEntryId: null,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
    };
    validateAccountLedgerEntry(entry);
    return entry;
}

export interface BuildOpeningBalanceInput {
    accountId: string;
    amountKobo: bigint;
    note?: string | null;
    occurredAt: Date;
}

export function buildOpeningBalanceEntry(
    input: BuildOpeningBalanceInput,
    existingEntries: readonly AccountLedgerEntry[],
    newId: IdGenerator,
): AccountLedgerEntry {
    if (input.amountKobo <= 0n) {
        throw new RangeError("An opening balance must be positive.");
    }
    const entry = buildAccountLedgerEntry(
        {
            accountId: input.accountId,
            type: "OPENING_BALANCE",
            amountKobo: input.amountKobo,
            note: input.note ?? null,
            occurredAt: input.occurredAt,
        },
        newId,
    );
    validateAtMostOneLiveOpeningBalance([...existingEntries, entry]);
    return entry;
}

export interface BuildReconcileAdjustmentInput {
    accountId: string;
    /** Signed correction: positive to add, negative to remove. */
    deltaKobo: bigint;
    note: string;
    occurredAt: Date;
}

export function buildReconcileAdjustment(
    input: BuildReconcileAdjustmentInput,
    account: Pick<Account, "id" | "name">,
    currentBalanceKobo: bigint,
    newId: IdGenerator,
): AccountLedgerEntry {
    if (input.deltaKobo === 0n) {
        throw new RangeError("A reconcile adjustment must change the balance.");
    }
    assertAccountWillRemainNonnegative(account, currentBalanceKobo, input.deltaKobo);
    return buildAccountLedgerEntry(
        {
            accountId: input.accountId,
            type: "ADJUSTMENT",
            amountKobo: input.deltaKobo,
            note: input.note,
            occurredAt: input.occurredAt,
        },
        newId,
    );
}

export interface BuildAccountTransferInput {
    fromAccountId: string;
    toAccountId: string;
    amountKobo: bigint;
    note: string | null;
    occurredAt: Date;
}

export interface BuildAccountTransferResult {
    transfer: AccountTransfer;
    entries: AccountLedgerEntry[];
}

export function buildAccountTransfer(
    input: BuildAccountTransferInput,
    accounts: readonly Account[],
    fromBalanceKobo: bigint,
    newId: IdGenerator,
): BuildAccountTransferResult {
    const from = accounts.find((account) => account.id === input.fromAccountId);
    const to = accounts.find((account) => account.id === input.toAccountId);
    if (!from) throw new RangeError(`Account '${input.fromAccountId}' not found.`);
    if (!to) throw new RangeError(`Account '${input.toAccountId}' not found.`);
    if (from.id === to.id) {
        throw new RangeError("An account transfer must move money between two different accounts.");
    }
    assertAccountAcceptsNewEntries(from, false);
    assertAccountAcceptsNewEntries(to, false);
    assertAccountWillRemainNonnegative(from, fromBalanceKobo, -input.amountKobo);

    const transferId = newId();
    const transfer: AccountTransfer = {
        id: transferId,
        fromAccountId: from.id,
        toAccountId: to.id,
        amountKobo: input.amountKobo,
        note: input.note,
        occurredAt: input.occurredAt,
        createdAt: input.occurredAt,
    };
    validateAccountTransfer(transfer);

    const entries = [
        buildAccountLedgerEntry(
            {
                accountId: from.id,
                type: "TRANSFER_OUT",
                amountKobo: -input.amountKobo,
                accountTransferId: transferId,
                note: input.note,
                occurredAt: input.occurredAt,
            },
            newId,
        ),
        buildAccountLedgerEntry(
            {
                accountId: to.id,
                type: "TRANSFER_IN",
                amountKobo: input.amountKobo,
                accountTransferId: transferId,
                note: input.note,
                occurredAt: input.occurredAt,
            },
            newId,
        ),
    ];

    return { transfer, entries };
}

/* ------------------------------------------------------------------ *
 * Money-flow report
 * ------------------------------------------------------------------ */

export interface AccountMoneyFlowRow {
    accountId: string;
    accountName: string;
    accountType: Account["type"];
    openingBalanceKobo: bigint;
    moneyInKobo: bigint;
    moneyOutKobo: bigint;
    netKobo: bigint;
    closingBalanceKobo: bigint;
}

export interface AccountMoneyFlowResult {
    rows: AccountMoneyFlowRow[];
    totalOpeningBalanceKobo: bigint;
    totalMoneyInKobo: bigint;
    totalMoneyOutKobo: bigint;
    totalNetKobo: bigint;
    totalClosingBalanceKobo: bigint;
}

export type AccountMoneyFlowCategoryKey =
    | AccountEntryType
    | `EXPENSE:${Expense["category"]}`;

export interface AccountMoneyFlowCategory {
    key: AccountMoneyFlowCategoryKey;
    moneyInKobo: bigint;
    moneyOutKobo: bigint;
}

export interface AccountMoneyFlowReportRow extends AccountMoneyFlowRow {
    categories: AccountMoneyFlowCategory[];
}

export interface AccountMoneyFlowReport {
    rows: AccountMoneyFlowReportRow[];
    totalOpeningBalanceKobo: bigint;
    totalMoneyInKobo: bigint;
    totalMoneyOutKobo: bigint;
    totalNetKobo: bigint;
    totalClosingBalanceKobo: bigint;
    salesBilledKobo: bigint;
    customerMoneyReceivedKobo: bigint;
    salesDebtOutstandingKobo: bigint;
}

/**
 * Where money came in and went out, per account, over a half-open window
 * `[from, to)`. Opening balances are everything before `from`; closing is the
 * account's balance at `to`.
 */
export function accountMoneyFlow(
    accounts: readonly Account[],
    entries: readonly AccountLedgerEntry[],
    from: Date,
    to: Date,
): AccountMoneyFlowResult {
    if (from.getTime() > to.getTime()) {
        throw new RangeError("From date must be on or before to date.");
    }

    const rows: AccountMoneyFlowRow[] = [];
    let totalOpening = 0n;
    let totalIn = 0n;
    let totalOut = 0n;
    let totalNet = 0n;
    let totalClosing = 0n;

    for (const account of accounts) {
        let opening = 0n;
        let moneyIn = 0n;
        let moneyOut = 0n;

        for (const entry of entries) {
            if (entry.accountId !== account.id) continue;
            if (entry.occurredAt.getTime() < from.getTime()) {
                opening += entry.amountKobo;
                continue;
            }
            if (entry.occurredAt.getTime() >= to.getTime()) continue;
            if (entry.amountKobo >= 0n) moneyIn += entry.amountKobo;
            else moneyOut += -entry.amountKobo;
        }

        const net = moneyIn - moneyOut;
        const row: AccountMoneyFlowRow = {
            accountId: account.id,
            accountName: account.name,
            accountType: account.type,
            openingBalanceKobo: opening,
            moneyInKobo: moneyIn,
            moneyOutKobo: moneyOut,
            netKobo: net,
            closingBalanceKobo: opening + net,
        };
        rows.push(row);

        totalOpening += row.openingBalanceKobo;
        totalIn += row.moneyInKobo;
        totalOut += row.moneyOutKobo;
        totalNet += row.netKobo;
        totalClosing += row.closingBalanceKobo;
    }

    return {
        rows,
        totalOpeningBalanceKobo: totalOpening,
        totalMoneyInKobo: totalIn,
        totalMoneyOutKobo: totalOut,
        totalNetKobo: totalNet,
        totalClosingBalanceKobo: totalClosing,
    };
}

/**
 * Adds entry-type/expense-category breakdown and sales collection context to
 * the account balances for a half-open interval `[from, to)`.
 */
export function accountMoneyFlowReport(
    accounts: readonly Account[],
    entries: readonly AccountLedgerEntry[],
    expenses: readonly Expense[],
    sales: readonly Sale[],
    from: Date,
    to: Date,
    accountId?: string,
): AccountMoneyFlowReport {
    if (from.getTime() > to.getTime()) {
        throw new RangeError("From date must be on or before to date.");
    }

    const includedAccounts = accountId
        ? accounts.filter((account) => account.id === accountId)
        : accounts;
    if (accountId && includedAccounts.length === 0) {
        throw new RangeError("Account not found.");
    }

    const flow = accountMoneyFlow(includedAccounts, entries, from, to);
    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const rowByAccount = new Map(
        flow.rows.map((row) => [
            row.accountId,
            { ...row, categories: [] as AccountMoneyFlowCategory[] },
        ]),
    );

    for (const entry of entries) {
        if (
            entry.occurredAt.getTime() < from.getTime() ||
            entry.occurredAt.getTime() >= to.getTime()
        ) {
            continue;
        }
        const row = rowByAccount.get(entry.accountId);
        if (!row) continue;

        const expense =
            entry.type === "EXPENSE" && entry.expenseId !== null
                ? expenseById.get(entry.expenseId)
                : undefined;
        const key: AccountMoneyFlowCategoryKey =
            expense === undefined ? entry.type : `EXPENSE:${expense.category}`;
        let category = row.categories.find((candidate) => candidate.key === key);
        if (!category) {
            category = { key, moneyInKobo: 0n, moneyOutKobo: 0n };
            row.categories.push(category);
        }
        if (entry.amountKobo >= 0n) {
            category.moneyInKobo += entry.amountKobo;
        } else {
            category.moneyOutKobo += -entry.amountKobo;
        }
    }

    const rows = Array.from(rowByAccount.values());
    const salesInPeriod = sales.filter(
        (sale) =>
            sale.status !== "VOIDED" &&
            sale.soldAt.getTime() >= from.getTime() &&
            sale.soldAt.getTime() < to.getTime(),
    );
    const salesBilledKobo = salesInPeriod.reduce(
        (sum, sale) => sum + sale.totalKobo,
        0n,
    );
    const salesDebtOutstandingKobo = salesInPeriod.reduce((sum, sale) => {
        const outstanding = sale.totalKobo - sale.paidKobo;
        return sum + (outstanding > 0n ? outstanding : 0n);
    }, 0n);
    const selectedAccountIds = new Set(includedAccounts.map((account) => account.id));
    const customerMoneyReceivedKobo = entries.reduce((sum, entry) => {
        if (
            !selectedAccountIds.has(entry.accountId) ||
            (entry.type !== "SALE_PAYMENT" && entry.type !== "CUSTOMER_PAYMENT") ||
            entry.occurredAt.getTime() < from.getTime() ||
            entry.occurredAt.getTime() >= to.getTime()
        ) {
            return sum;
        }
        return sum + entry.amountKobo;
    }, 0n);

    return {
        rows,
        totalOpeningBalanceKobo: flow.totalOpeningBalanceKobo,
        totalMoneyInKobo: flow.totalMoneyInKobo,
        totalMoneyOutKobo: flow.totalMoneyOutKobo,
        totalNetKobo: flow.totalNetKobo,
        totalClosingBalanceKobo: flow.totalClosingBalanceKobo,
        salesBilledKobo,
        customerMoneyReceivedKobo,
        salesDebtOutstandingKobo,
    };
}
