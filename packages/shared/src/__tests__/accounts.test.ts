import { describe, expect, it } from "vitest";
import type {
    Account,
    AccountLedgerEntry,
    Expense,
    Sale,
} from "../domain/types.ts";
import {
    accountBalanceKobo,
    accountBalancesKobo,
    totalAccountBalanceKobo,
    assertAccountWillRemainNonnegative,
    assertAccountDeactivatable,
    assertAccountAcceptsNewEntries,
    assertNotFutureOccurredAt,
    validateAccount,
    validateAccountLedgerEntry,
    validateAccountLedgerReversals,
    validateAccountTransfer,
    validateAtMostOneLiveOpeningBalance,
    validateLoanInterestHasNoAccountEntry,
    validateExpenseVoidFields,
    buildAccountLedgerEntry,
    buildOpeningBalanceEntry,
    buildReconcileAdjustment,
    buildAccountTransfer,
    accountMoneyFlow,
    accountMoneyFlowReport,
} from "../domain/accounts.ts";
import { migrateMockStoreData } from "../mock-store-migration.ts";
import { ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID } from "../mock-store-migration.ts";
import { formatNaira } from "../money.ts";

const baseDate = new Date("2026-10-01T10:00:00.000Z");

let idCounter = 0;
const newId = () => `id-${++idCounter}`;

function makeAccount(overrides: Partial<Account> = {}): Account {
    return {
        id: "a1",
        name: "Cash on hand",
        type: "CASH",
        isActive: true,
        deactivatedAt: null,
        note: null,
        createdAt: baseDate,
        updatedAt: baseDate,
        ...overrides,
    };
}

function makeEntry(
    overrides: Partial<AccountLedgerEntry> = {},
): AccountLedgerEntry {
    return {
        id: "e1",
        accountId: "a1",
        type: "SALE_PAYMENT",
        amountKobo: 500n,
        salePaymentId: "sp1",
        customerPaymentId: null,
        supplierPaymentId: null,
        purchaseId: null,
        expenseId: null,
        otherIncomeId: null,
        accountTransferId: null,
        customerRefundId: null,
        loanId: null,
        loanRepaymentId: null,
        reversesEntryId: null,
        note: null,
        occurredAt: baseDate,
        ...overrides,
    };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
    return {
        id: "exp1",
        channel: "RETAIL",
        category: "RENT",
        description: "Shop rent",
        amountKobo: 10_000n,
        expenseDate: baseDate,
        loanRepaymentId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: baseDate,
        updatedAt: baseDate,
        ...overrides,
    };
}

describe("account balance helpers", () => {
    it("sums only the entries belonging to one account", () => {
        const entries = [
            makeEntry({ id: "e1", accountId: "a1", amountKobo: 500n }),
            makeEntry({
                id: "e2",
                accountId: "a2",
                amountKobo: 200n,
                salePaymentId: null,
                customerPaymentId: "cp1",
                type: "CUSTOMER_PAYMENT",
            }),
            makeEntry({ id: "e3", accountId: "a1", amountKobo: -100n }),
        ];

        expect(accountBalanceKobo("a1", entries)).toBe(400n);
        expect(accountBalanceKobo("a2", entries)).toBe(200n);
        expect(accountBalanceKobo("a3", entries)).toBe(0n);
    });

    it("starts every known account at zero and keeps unknown ones", () => {
        const accounts = [
            makeAccount({ id: "a1" }),
            makeAccount({ id: "a2", name: "Moniepoint", type: "BANK" }),
        ];
        const entries = [
            makeEntry({ id: "e1", accountId: "a1", amountKobo: 700n }),
            makeEntry({ id: "e2", accountId: "a9", amountKobo: 300n }),
        ];

        const balances = accountBalancesKobo(accounts, entries);
        expect(balances.get("a1")).toBe(700n);
        expect(balances.get("a2")).toBe(0n);
        expect(balances.get("a9")).toBe(300n);
    });

    it("totals money across every account", () => {
        const entries = [
            makeEntry({ id: "e1", accountId: "a1", amountKobo: 500n }),
            makeEntry({ id: "e2", accountId: "a2", amountKobo: -200n }),
        ];
        expect(totalAccountBalanceKobo(entries)).toBe(300n);
        expect(totalAccountBalanceKobo([])).toBe(0n);
    });
});

describe("assertAccountWillRemainNonnegative", () => {
    it("allows a spend that lands exactly on zero", () => {
        expect(() =>
            assertAccountWillRemainNonnegative(makeAccount(), 500n, -500n),
        ).not.toThrow();
    });

    it("names the account, its balance and the amount requested", () => {
        expect(() =>
            assertAccountWillRemainNonnegative(makeAccount(), 300n, -500n),
        ).toThrowError(
            `Cannot spend ${formatNaira(500n)} from Cash on hand (balance ${formatNaira(300n)}): record income or reconcile first.`,
        );
    });

    it("gives reversal-specific guidance with the same actionable ending", () => {
        expect(() =>
            assertAccountWillRemainNonnegative(
                makeAccount(),
                300n,
                -500n,
                "reversal",
            ),
        ).toThrowError(
            `Cannot reverse ${formatNaira(500n)} on Cash on hand (balance ${formatNaira(300n)}): this cash has already been spent; record the refund from another account or record income or reconcile first.`,
        );
    });
});

describe("assertAccountDeactivatable", () => {
    it("allows deactivation when nothing is left", () => {
        // A missing account_balances row reads as zero, so a brand-new account is
        // deactivatable without ever having been used.
        expect(() => assertAccountDeactivatable(makeAccount(), 0n)).not.toThrow();
    });

    it("refuses while money is still held", () => {
        expect(() => assertAccountDeactivatable(makeAccount(), 1n)).toThrowError(
            /still holds 1 kobo and cannot be deactivated/,
        );
    });
});

describe("assertAccountAcceptsNewEntries", () => {
    it("accepts entries on an active account", () => {
        expect(() =>
            assertAccountAcceptsNewEntries(makeAccount(), false),
        ).not.toThrow();
    });

    it("refuses new entries on a deactivated account", () => {
        const account = makeAccount({ isActive: false, deactivatedAt: baseDate });
        expect(() => assertAccountAcceptsNewEntries(account, false)).toThrowError(
            /deactivated and cannot receive new entries/,
        );
    });

    it("still allows a reversal on a deactivated account", () => {
        const account = makeAccount({ isActive: false, deactivatedAt: baseDate });
        expect(() => assertAccountAcceptsNewEntries(account, true)).not.toThrow();
    });
});

describe("assertNotFutureOccurredAt", () => {
    it("accepts today and earlier", () => {
        expect(() =>
            assertNotFutureOccurredAt(baseDate, "2026-10-01"),
        ).not.toThrow();
    });

    it("refuses a future date", () => {
        expect(() => assertNotFutureOccurredAt(baseDate, "2026-09-30")).toThrowError(
            /cannot be dated in the future/,
        );
    });

    it("refuses an invalid date", () => {
        expect(() =>
            assertNotFutureOccurredAt(new Date("nope"), "2026-10-01"),
        ).toThrowError(/must be valid/);
    });
});

describe("validateAccount", () => {
    it("accepts a well-formed active account", () => {
        expect(() => validateAccount(makeAccount())).not.toThrow();
    });

    it("accepts a deactivated account carrying its date", () => {
        expect(() =>
            validateAccount(
                makeAccount({ isActive: false, deactivatedAt: baseDate }),
            ),
        ).not.toThrow();
    });

    it("requires a name", () => {
        expect(() => validateAccount(makeAccount({ name: "  " }))).toThrowError(
            /must have a name/,
        );
    });

    it("ties the deactivation date to the active flag", () => {
        expect(() =>
            validateAccount(makeAccount({ isActive: true, deactivatedAt: baseDate })),
        ).toThrowError(/active account must not carry a deactivation date/);
        expect(() =>
            validateAccount(makeAccount({ isActive: false, deactivatedAt: null })),
        ).toThrowError(/deactivated account must carry a deactivation date/);
    });
});

describe("validateAccountLedgerEntry", () => {
    it("accepts a well-formed entry", () => {
        expect(() => validateAccountLedgerEntry(makeEntry())).not.toThrow();
    });

    it("requires the source column the type owns", () => {
        expect(() =>
            validateAccountLedgerEntry(makeEntry({ salePaymentId: null })),
        ).toThrowError(/SALE_PAYMENT account entry must reference its salePaymentId/);
    });

    it("refuses a source column the type does not own", () => {
        expect(() =>
            validateAccountLedgerEntry(makeEntry({ expenseId: "exp1" })),
        ).toThrowError(/SALE_PAYMENT account entry must not reference expenseId/);
    });

    it("lets a source-less type carry no references", () => {
        expect(() =>
            validateAccountLedgerEntry(
                makeEntry({
                    type: "ADJUSTMENT",
                    amountKobo: -100n,
                    salePaymentId: null,
                    note: "Cash counted short",
                }),
            ),
        ).not.toThrow();
    });

    it("requires a note for adjustments, drawings and bank charges", () => {
        expect(() =>
            validateAccountLedgerEntry(
                makeEntry({
                    type: "OWNER_DRAWING",
                    amountKobo: -100n,
                    salePaymentId: null,
                    note: null,
                }),
            ),
        ).toThrowError(/OWNER_DRAWING account entry needs a note/);
    });

    it("rejects a zero amount through the shared ledger sign rules", () => {
        expect(() =>
            validateAccountLedgerEntry(makeEntry({ amountKobo: 0n })),
        ).toThrowError(/must not be zero/);
    });

    it("rejects a sign that contradicts the type", () => {
        expect(() =>
            validateAccountLedgerEntry(makeEntry({ amountKobo: -500n })),
        ).toThrowError(/SALE_PAYMENT ledger amounts must be positive/);
    });
});

describe("validateAccountLedgerReversals", () => {
    const target = makeEntry({ id: "e1", amountKobo: 500n });
    const reversal = makeEntry({
        id: "e2",
        amountKobo: -500n,
        reversesEntryId: "e1",
    });

    it("accepts a matching pair", () => {
        expect(() =>
            validateAccountLedgerReversals([target, reversal]),
        ).not.toThrow();
    });

    it("refuses a reversal pointing at a missing target", () => {
        expect(() =>
            validateAccountLedgerReversals([makeEntry({ id: "e2", reversesEntryId: "gone" })]),
        ).toThrowError(/references a missing target/);
    });

    it("refuses reversing a reversal", () => {
        const second = makeEntry({
            id: "e3",
            amountKobo: 500n,
            reversesEntryId: "e2",
        });
        expect(() => validateAccountLedgerReversals([target, reversal, second])).toThrowError(
            /cannot target another reversal/,
        );
    });

    it("refuses reversing the same entry twice", () => {
        const duplicate = makeEntry({
            id: "e3",
            amountKobo: -500n,
            reversesEntryId: "e1",
        });
        expect(() =>
            validateAccountLedgerReversals([target, reversal, duplicate]),
        ).toThrowError(/was already reversed/);
    });

    it("keeps the account, type, amount and sources aligned with the target", () => {
        expect(() =>
            validateAccountLedgerReversals([
                target,
                makeEntry({ id: "e2", accountId: "a2", amountKobo: -500n, reversesEntryId: "e1" }),
            ]),
        ).toThrowError(/must keep the same account/);

        expect(() =>
            validateAccountLedgerReversals([
                target,
                makeEntry({
                    id: "e2",
                    type: "ADJUSTMENT",
                    amountKobo: -500n,
                    salePaymentId: null,
                    note: "wrong type",
                    reversesEntryId: "e1",
                }),
            ]),
        ).toThrowError(/must keep the same type/);

        expect(() =>
            validateAccountLedgerReversals([
                target,
                makeEntry({ id: "e2", amountKobo: -400n, reversesEntryId: "e1" }),
            ]),
        ).toThrowError(/must negate the target amount/);

        expect(() =>
            validateAccountLedgerReversals([
                target,
                makeEntry({
                    id: "e2",
                    amountKobo: -500n,
                    salePaymentId: "sp2",
                    reversesEntryId: "e1",
                }),
            ]),
        ).toThrowError(/must keep the same source references/);
    });
});

describe("validateAccountTransfer", () => {
    const transfer = {
        id: "t1",
        fromAccountId: "a1",
        toAccountId: "a2",
        amountKobo: 1000n,
        note: null,
        occurredAt: baseDate,
        createdAt: baseDate,
    };

    it("accepts a well-formed transfer", () => {
        expect(() => validateAccountTransfer(transfer)).not.toThrow();
    });

    it("refuses a transfer to the same account", () => {
        expect(() =>
            validateAccountTransfer({ ...transfer, toAccountId: "a1" }),
        ).toThrowError(/two different accounts/);
    });

    it("refuses a non-positive amount", () => {
        expect(() =>
            validateAccountTransfer({ ...transfer, amountKobo: 0n }),
        ).toThrowError(/must be positive/);
    });

    it("refuses an invalid date", () => {
        expect(() =>
            validateAccountTransfer({ ...transfer, occurredAt: new Date("nope") }),
        ).toThrowError(/must be valid/);
    });
});

describe("validateAtMostOneLiveOpeningBalance", () => {
    it("accepts a single live opening balance", () => {
        expect(() =>
            validateAtMostOneLiveOpeningBalance([
                makeEntry({
                    id: "ob1",
                    type: "OPENING_BALANCE",
                    amountKobo: 1000n,
                    salePaymentId: null,
                }),
            ]),
        ).not.toThrow();
    });

    it("accepts a reversed opening balance beside a fresh one", () => {
        expect(() =>
            validateAtMostOneLiveOpeningBalance([
                makeEntry({
                    id: "ob1",
                    type: "OPENING_BALANCE",
                    amountKobo: 1000n,
                    salePaymentId: null,
                }),
                makeEntry({
                    id: "ob2",
                    type: "OPENING_BALANCE",
                    amountKobo: -1000n,
                    salePaymentId: null,
                    reversesEntryId: "ob1",
                }),
                makeEntry({
                    id: "ob3",
                    type: "OPENING_BALANCE",
                    amountKobo: 1200n,
                    salePaymentId: null,
                }),
            ]),
        ).not.toThrow();
    });

    it("refuses a second live opening balance", () => {
        expect(() =>
            validateAtMostOneLiveOpeningBalance([
                makeEntry({
                    id: "ob1",
                    type: "OPENING_BALANCE",
                    amountKobo: 1000n,
                    salePaymentId: null,
                }),
                makeEntry({
                    id: "ob2",
                    type: "OPENING_BALANCE",
                    amountKobo: 500n,
                    salePaymentId: null,
                }),
            ]),
        ).toThrowError(/one live opening balance/);
    });
});

describe("validateLoanInterestHasNoAccountEntry", () => {
    it("refuses an account entry owned by a loan-interest expense", () => {
        const expense = makeExpense({ id: "exp9", category: "LOAN_INTEREST" });
        const entry = makeEntry({
            id: "e1",
            type: "EXPENSE",
            amountKobo: -100n,
            salePaymentId: null,
            expenseId: "exp9",
        });
        expect(() =>
            validateLoanInterestHasNoAccountEntry([expense], [entry]),
        ).toThrowError(/must not post its own account entry/);
    });

    it("ignores account entries owned by ordinary expenses", () => {
        const expense = makeExpense({ id: "exp9", category: "RENT" });
        const entry = makeEntry({
            id: "e1",
            type: "EXPENSE",
            amountKobo: -100n,
            salePaymentId: null,
            expenseId: "exp9",
        });
        expect(() =>
            validateLoanInterestHasNoAccountEntry([expense], [entry]),
        ).not.toThrow();
    });
});

describe("validateExpenseVoidFields", () => {
    it("accepts a live expense with no reason", () => {
        expect(() => validateExpenseVoidFields(makeExpense())).not.toThrow();
    });

    it("refuses a reason without a void date", () => {
        expect(() =>
            validateExpenseVoidFields(makeExpense({ voidReason: "mistake" })),
        ).toThrowError(/void reason without a void date/);
    });

    it("refuses a void date without a reason", () => {
        expect(() =>
            validateExpenseVoidFields(makeExpense({ voidedAt: baseDate })),
        ).toThrowError(/Voiding an expense requires a reason/);
    });

    it("accepts a voided expense carrying both", () => {
        expect(() =>
            validateExpenseVoidFields(
                makeExpense({ voidedAt: baseDate, voidReason: "duplicate entry" }),
            ),
        ).not.toThrow();
    });
});

describe("buildAccountLedgerEntry", () => {
    it("nulls every source column the caller did not set", () => {
        const entry = buildAccountLedgerEntry(
            {
                accountId: "a1",
                type: "OWNER_CAPITAL",
                amountKobo: 2000n,
                occurredAt: baseDate,
            },
            newId,
        );

        expect(entry.amountKobo).toBe(2000n);
        expect(entry.reversesEntryId).toBeNull();
        expect(entry.note).toBeNull();
        expect(entry.salePaymentId).toBeNull();
        expect(entry.expenseId).toBeNull();
        expect(entry.customerRefundId).toBeNull();
        expect(entry.loanRepaymentId).toBeNull();
    });
});

describe("buildOpeningBalanceEntry", () => {
    it("builds an opening balance", () => {
        const entry = buildOpeningBalanceEntry(
            { accountId: "a1", amountKobo: 5000n, occurredAt: baseDate },
            [],
            newId,
        );
        expect(entry.type).toBe("OPENING_BALANCE");
        expect(entry.amountKobo).toBe(5000n);
        expect(entry.salePaymentId).toBeNull();
    });

    it("refuses a non-positive opening balance", () => {
        expect(() =>
            buildOpeningBalanceEntry(
                { accountId: "a1", amountKobo: 0n, occurredAt: baseDate },
                [],
                newId,
            ),
        ).toThrowError(/must be positive/);
    });

    it("refuses a second live opening balance for the same account", () => {
        const existing = buildOpeningBalanceEntry(
            { accountId: "a1", amountKobo: 5000n, occurredAt: baseDate },
            [],
            newId,
        );
        expect(() =>
            buildOpeningBalanceEntry(
                { accountId: "a1", amountKobo: 100n, occurredAt: baseDate },
                [existing],
                newId,
            ),
        ).toThrowError(/one live opening balance/);
    });
});

describe("buildReconcileAdjustment", () => {
    it("builds a signed adjustment", () => {
        const entry = buildReconcileAdjustment(
            { accountId: "a1", deltaKobo: -300n, note: "Cash counted short", occurredAt: baseDate },
            makeAccount(),
            5000n,
            newId,
        );
        expect(entry.type).toBe("ADJUSTMENT");
        expect(entry.amountKobo).toBe(-300n);
        expect(entry.note).toBe("Cash counted short");
    });

    it("refuses a no-op adjustment", () => {
        expect(() =>
            buildReconcileAdjustment(
                { accountId: "a1", deltaKobo: 0n, note: "nothing", occurredAt: baseDate },
                makeAccount(),
                5000n,
                newId,
            ),
        ).toThrowError(/must change the balance/);
    });

    it("refuses an adjustment that would overdraw the account", () => {
        expect(() =>
            buildReconcileAdjustment(
                { accountId: "a1", deltaKobo: -6000n, note: "too much", occurredAt: baseDate },
                makeAccount(),
                5000n,
                newId,
            ),
        ).toThrowError(/Cannot spend/);
    });
});

describe("buildAccountTransfer", () => {
    const accounts = [
        makeAccount({ id: "a1" }),
        makeAccount({ id: "a2", name: "Moniepoint", type: "BANK" }),
    ];

    it("builds the transfer and its two legs", () => {
        const { transfer, entries } = buildAccountTransfer(
            {
                fromAccountId: "a1",
                toAccountId: "a2",
                amountKobo: 1000n,
                note: null,
                occurredAt: baseDate,
            },
            accounts,
            5000n,
            newId,
        );

        expect(transfer.fromAccountId).toBe("a1");
        expect(transfer.toAccountId).toBe("a2");
        expect(transfer.amountKobo).toBe(1000n);
        expect(entries).toHaveLength(2);

        const out = entries.find((entry) => entry.type === "TRANSFER_OUT")!;
        const into = entries.find((entry) => entry.type === "TRANSFER_IN")!;
        expect(out.accountId).toBe("a1");
        expect(out.amountKobo).toBe(-1000n);
        expect(into.accountId).toBe("a2");
        expect(into.amountKobo).toBe(1000n);
        expect(out.accountTransferId).toBe(transfer.id);
        expect(into.accountTransferId).toBe(transfer.id);
    });

    it("refuses an unknown account", () => {
        expect(() =>
            buildAccountTransfer(
                { fromAccountId: "nope", toAccountId: "a2", amountKobo: 1n, note: null, occurredAt: baseDate },
                accounts,
                0n,
                newId,
            ),
        ).toThrowError(/not found/);
    });

    it("refuses a transfer onto the same account", () => {
        expect(() =>
            buildAccountTransfer(
                { fromAccountId: "a1", toAccountId: "a1", amountKobo: 1n, note: null, occurredAt: baseDate },
                accounts,
                0n,
                newId,
            ),
        ).toThrowError(/two different accounts/);
    });

    it("refuses a transfer out of a deactivated account", () => {
        const deactivated = [
            makeAccount({ id: "a1", isActive: false, deactivatedAt: baseDate }),
            accounts[1],
        ];
        expect(() =>
            buildAccountTransfer(
                { fromAccountId: "a1", toAccountId: "a2", amountKobo: 1n, note: null, occurredAt: baseDate },
                deactivated,
                5000n,
                newId,
            ),
        ).toThrowError(/deactivated and cannot receive new entries/);
    });

    it("refuses to overdraw the source account", () => {
        expect(() =>
            buildAccountTransfer(
                { fromAccountId: "a1", toAccountId: "a2", amountKobo: 6000n, note: null, occurredAt: baseDate },
                accounts,
                5000n,
                newId,
            ),
        ).toThrowError(/Cannot spend/);
    });
});

describe("accountMoneyFlow", () => {
    const accounts = [
        makeAccount({ id: "a1" }),
        makeAccount({ id: "a2", name: "Moniepoint", type: "BANK" }),
    ];
    const entries = [
        makeEntry({
            id: "e1",
            accountId: "a1",
            amountKobo: 1000n,
            salePaymentId: null,
            type: "OPENING_BALANCE",
            occurredAt: new Date("2026-09-01T00:00:00.000Z"),
        }),
        makeEntry({
            id: "e2",
            accountId: "a1",
            amountKobo: 200n,
            occurredAt: new Date("2026-10-01T00:00:00.000Z"),
        }),
        makeEntry({
            id: "e3",
            accountId: "a1",
            amountKobo: -50n,
            occurredAt: new Date("2026-10-02T00:00:00.000Z"),
        }),
        makeEntry({
            id: "e4",
            accountId: "a1",
            amountKobo: 999n,
            occurredAt: new Date("2026-11-01T00:00:00.000Z"),
        }),
    ];

    it("splits opening, money in and money out over the half-open window", () => {
        const flow = accountMoneyFlow(
            accounts,
            entries,
            new Date("2026-10-01T00:00:00.000Z"),
            new Date("2026-11-01T00:00:00.000Z"),
        );

        const cash = flow.rows.find((row) => row.accountId === "a1")!;
        expect(cash.openingBalanceKobo).toBe(1000n);
        expect(cash.moneyInKobo).toBe(200n);
        expect(cash.moneyOutKobo).toBe(50n);
        expect(cash.netKobo).toBe(150n);
        expect(cash.closingBalanceKobo).toBe(1150n);

        const bank = flow.rows.find((row) => row.accountId === "a2")!;
        expect(bank.openingBalanceKobo).toBe(0n);
        expect(bank.closingBalanceKobo).toBe(0n);

        expect(flow.totalOpeningBalanceKobo).toBe(1000n);
        expect(flow.totalMoneyInKobo).toBe(200n);
        expect(flow.totalMoneyOutKobo).toBe(50n);
        expect(flow.totalNetKobo).toBe(150n);
        expect(flow.totalClosingBalanceKobo).toBe(1150n);

        // An entry dated exactly on `to` belongs to the next window, and one dated
        // exactly on `from` belongs to this one.
        expect(cash.closingBalanceKobo).toBe(1150n);
    });

    describe("accountMoneyFlowReport", () => {
        const reportAccounts = [
            makeAccount({ id: "a1" }),
            makeAccount({ id: "a2", name: "Moniepoint", type: "BANK" }),
        ];
        const reportSales: Sale[] = [
            {
                id: "sale-current",
                customerId: null,
                customerName: null,
                createdById: "admin",
                channel: "RETAIL",
                status: "COMPLETED",
                reference: null,
                notes: null,
                totalKobo: 1000n,
                paidKobo: 700n,
                soldAt: new Date("2026-10-01T09:00:00.000Z"),
                createdAt: baseDate,
                updatedAt: baseDate,
            },
            {
                id: "sale-voided",
                customerId: null,
                customerName: null,
                createdById: "admin",
                channel: "RETAIL",
                status: "VOIDED",
                reference: null,
                notes: null,
                totalKobo: 500n,
                paidKobo: 500n,
                soldAt: new Date("2026-10-01T10:00:00.000Z"),
                createdAt: baseDate,
                updatedAt: baseDate,
            },
        ];

        it("breaks down selected-account flow and compares billed, received, and outstanding sales", () => {
            const entries = [
                makeEntry({
                    id: "open",
                    amountKobo: 1000n,
                    salePaymentId: null,
                    type: "OPENING_BALANCE",
                    occurredAt: new Date("2026-09-01T00:00:00.000Z"),
                }),
                makeEntry({
                    id: "sale-payment",
                    salePaymentId: "sp-current",
                    amountKobo: 400n,
                    occurredAt: new Date("2026-10-01T11:00:00.000Z"),
                }),
                makeEntry({
                    id: "rent",
                    type: "EXPENSE",
                    expenseId: "expense-rent",
                    salePaymentId: null,
                    amountKobo: -200n,
                    occurredAt: new Date("2026-10-01T12:00:00.000Z"),
                }),
                makeEntry({
                    id: "bank-receipt",
                    accountId: "a2",
                    customerPaymentId: "cp1",
                    salePaymentId: null,
                    type: "CUSTOMER_PAYMENT",
                    amountKobo: 250n,
                    occurredAt: new Date("2026-10-01T13:00:00.000Z"),
                }),
            ];
            const report = accountMoneyFlowReport(
                reportAccounts,
                entries,
                [makeExpense({ id: "expense-rent", category: "RENT" })],
                reportSales,
                new Date("2026-10-01T00:00:00.000Z"),
                new Date("2026-10-02T00:00:00.000Z"),
                "a1",
            );

            expect(report.rows).toHaveLength(1);
            expect(report.rows[0]).toMatchObject({
                accountId: "a1",
                openingBalanceKobo: 1000n,
                moneyInKobo: 400n,
                moneyOutKobo: 200n,
                closingBalanceKobo: 1200n,
            });
            expect(report.rows[0].categories).toEqual([
                { key: "SALE_PAYMENT", moneyInKobo: 400n, moneyOutKobo: 0n },
                { key: "EXPENSE:RENT", moneyInKobo: 0n, moneyOutKobo: 200n },
            ]);
            expect(report.salesBilledKobo).toBe(1000n);
            expect(report.customerMoneyReceivedKobo).toBe(400n);
            expect(report.salesDebtOutstandingKobo).toBe(300n);
        });

        it("reports all accounts when no account filter is selected", () => {
            const report = accountMoneyFlowReport(
                reportAccounts,
                [
                    makeEntry({ id: "cash", amountKobo: 100n }),
                    makeEntry({
                        id: "bank",
                        accountId: "a2",
                        amountKobo: 200n,
                        customerPaymentId: "cp1",
                        salePaymentId: null,
                        type: "CUSTOMER_PAYMENT",
                    }),
                ],
                [],
                [],
                new Date("2026-10-01T00:00:00.000Z"),
                new Date("2026-10-02T00:00:00.000Z"),
            );
            expect(report.rows).toHaveLength(2);
            expect(report.totalMoneyInKobo).toBe(300n);
            expect(report.customerMoneyReceivedKobo).toBe(300n);
        });
    });

    it("refuses a reversed window", () => {
        expect(() =>
            accountMoneyFlow(
                accounts,
                [],
                new Date("2026-10-02T00:00:00.000Z"),
                new Date("2026-10-01T00:00:00.000Z"),
            ),
        ).toThrowError(/must be on or before/);
    });
});

describe("migrateMockStoreData (v6 -> v7 accounts backfill)", () => {
    it("posts a sale payment and its mirror reversal for a voided sale", () => {
        const v6 = {
            sales: [{ id: "sale1", status: "VOIDED" }],
            salePayments: [
                {
                    id: "sp1",
                    saleId: "sale1",
                    amountKobo: "500",
                    paidAt: "2026-10-01T10:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;

        expect(ledger).toHaveLength(2);
        const entry = ledger.find((row) => row.reversesEntryId === null)!;
        const reversal = ledger.find((row) => row.reversesEntryId !== null)!;
        expect(entry).toMatchObject({
            accountId: "acct-cash-on-hand",
            type: "SALE_PAYMENT",
            amountKobo: "500",
            salePaymentId: "sp1",
        });
        expect(reversal).toMatchObject({
            amountKobo: "-500",
            reversesEntryId: entry.id,
            salePaymentId: "sp1",
        });

        // The pair nets to zero, so no phantom opening balance is inferred.
        expect(ledger.reduce((sum, row) => sum + BigInt(String(row.amountKobo)), 0n)).toBe(0n);
    });

    it("posts a purchase payment and its reversal for a voided supplier-less purchase", () => {
        const v6 = {
            purchases: [
                {
                    id: "pur1",
                    supplierId: null,
                    status: "VOIDED",
                    totalKobo: "3000",
                    paidKobo: "3000",
                    purchasedAt: "2026-10-01T10:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;

        expect(ledger).toHaveLength(2);
        expect(ledger[0]).toMatchObject({
            type: "PURCHASE_PAYMENT",
            amountKobo: "-3000",
            purchaseId: "pur1",
        });
        expect(ledger[1]).toMatchObject({
            amountKobo: "3000",
            reversesEntryId: ledger[0].id,
        });
        expect(ledger.reduce((sum, row) => sum + BigInt(String(row.amountKobo)), 0n)).toBe(0n);
    });

    it("backfills a paid supplier-less purchase that has no payment row", () => {
        const v6 = {
            purchases: [
                {
                    id: "pur1",
                    supplierId: null,
                    status: "RECEIVED",
                    totalKobo: "3000",
                    paidKobo: "3000",
                    purchasedAt: "2026-10-01T10:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;

        const payment = ledger.find((row) => row.type === "PURCHASE_PAYMENT")!;
        expect(payment).toMatchObject({
            accountId: "acct-cash-on-hand",
            type: "PURCHASE_PAYMENT",
            amountKobo: "-3000",
            purchaseId: "pur1",
        });

        // Taking 3000 out of an empty drawer dips below zero, so an opening
        // balance dated before the earliest row lifts the low-water mark to zero.
        const opening = ledger.find((row) => row.type === "OPENING_BALANCE")!;
        expect(opening.amountKobo).toBe("3000");
        expect(opening.note).toBe(
            "Opening balance carried from records before accounts existed",
        );
        expect(new Date(String(opening.occurredAt)).getTime()).toBeLessThan(
            new Date("2026-10-01T10:00:00.000Z").getTime(),
        );
    });

    it("adds no opening balance when the running balance never dips below zero", () => {
        const v6 = {
            sales: [{ id: "sale1", status: "COMPLETED" }],
            salePayments: [
                {
                    id: "sp1",
                    saleId: "sale1",
                    amountKobo: "500",
                    paidAt: "2026-10-01T10:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;
        expect(ledger).toHaveLength(1);
        expect(ledger[0].type).toBe("SALE_PAYMENT");
    });

    it("routes transfers to Moniepoint and everything else to cash", () => {
        const v6 = {
            purchases: [
                { id: "pur1", supplierId: "sup1", status: "RECEIVED" },
                { id: "pur2", supplierId: "sup1", status: "RECEIVED" },
            ],
            supplierPayments: [
                {
                    id: "pay1",
                    purchaseId: "pur1",
                    method: "TRANSFER",
                    amountKobo: "1000",
                    paidAt: "2026-10-01T10:00:00.000Z",
                },
                {
                    id: "pay2",
                    purchaseId: "pur2",
                    method: "CASH",
                    amountKobo: "500",
                    paidAt: "2026-10-02T10:00:00.000Z",
                },
            ],
            sales: [{ id: "sale1", status: "COMPLETED" }],
            salePayments: [
                {
                    id: "sp1",
                    saleId: "sale1",
                    amountKobo: "2000",
                    paidAt: "2026-10-01T09:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;

        const transferOut = ledger.find((row) => row.supplierPaymentId === "pay1")!;
        const cashOut = ledger.find((row) => row.supplierPaymentId === "pay2")!;
        const saleIn = ledger.find((row) => row.type === "SALE_PAYMENT")!;

        expect(transferOut.accountId).toBe("acct-moniepoint");
        expect(cashOut.accountId).toBe("acct-cash-on-hand");
        expect(saleIn.accountId).toBe("acct-cash-on-hand");

        const payments = result.data.supplierPayments as Array<Record<string, unknown>>;
        expect(payments.find((row) => row.id === "pay1")!.accountId).toBe("acct-moniepoint");
        expect(payments.find((row) => row.id === "pay2")!.accountId).toBe("acct-cash-on-hand");
    });

    it("backfills expenses and full loan cash movements, excludes loan-interest expenses, and records the one-time notice", () => {
        const v6 = {
            expenses: [
                {
                    id: "expense1",
                    category: "RENT",
                    amountKobo: "200",
                    expenseDate: "2026-10-01T11:00:00.000Z",
                    voidedAt: null,
                },
                {
                    id: "interest1",
                    category: "LOAN_INTEREST",
                    amountKobo: "100",
                    expenseDate: "2026-10-02T11:00:00.000Z",
                    loanRepaymentId: "repayment1",
                    voidedAt: null,
                },
                {
                    id: "expense2",
                    category: "SUPPLIES",
                    amountKobo: "50",
                    expenseDate: "2026-10-03T11:00:00.000Z",
                    voidedAt: "2026-10-04T11:00:00.000Z",
                },
            ],
            loans: [
                {
                    id: "loan1",
                    principalKobo: "1000",
                    disbursedAt: "2026-10-01T10:00:00.000Z",
                },
            ],
            loanRepayments: [
                {
                    id: "repayment1",
                    amountKobo: "300",
                    paidAt: "2026-10-02T10:00:00.000Z",
                },
            ],
        };

        const result = migrateMockStoreData(6, v6)!;
        const ledger = result.data.accountLedgerEntries as Array<
            Record<string, unknown>
        >;
        expect(ledger.filter((row) => row.expenseId === "expense1")).toHaveLength(1);
        expect(ledger.find((row) => row.expenseId === "expense1")).toMatchObject({
            type: "EXPENSE",
            amountKobo: "-200",
            accountId: "acct-cash-on-hand",
        });
        expect(ledger.filter((row) => row.expenseId === "interest1")).toHaveLength(0);
        const voidedExpense = ledger.filter((row) => row.expenseId === "expense2");
        expect(voidedExpense).toHaveLength(2);
        expect(voidedExpense.reduce(
            (sum, row) => sum + BigInt(String(row.amountKobo)),
            0n,
        )).toBe(0n);
        expect(ledger.find((row) => row.loanId === "loan1")).toMatchObject({
            type: "LOAN_DISBURSEMENT",
            amountKobo: "1000",
        });
        expect(ledger.find((row) => row.loanRepaymentId === "repayment1")).toMatchObject({
            type: "LOAN_REPAYMENT",
            amountKobo: "-300",
        });
        expect(
            (result.data.auditLogs as Array<Record<string, unknown>>).filter(
                (row) => row.id === ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID,
            ),
        ).toHaveLength(1);
    });

    it("creates the two default accounts only when none exist", () => {
        const empty = migrateMockStoreData(6, {})!;
        const created = empty.data.accounts as Array<Record<string, unknown>>;
        expect(created.map((account) => account.id)).toEqual([
            "acct-cash-on-hand",
            "acct-moniepoint",
        ]);

        const existing = migrateMockStoreData(6, {
            accounts: [{ id: "custom", name: "My account", type: "CASH" }],
        })!;
        expect(existing.data.accounts).toEqual([
            { id: "custom", name: "My account", type: "CASH" },
        ]);
    });

    it("never re-backfills a payload that already carries the accounts feature", () => {
        const result = migrateMockStoreData(7, {
            sales: [{ id: "sale1", status: "COMPLETED" }],
            salePayments: [
                {
                    id: "sp1",
                    saleId: "sale1",
                    amountKobo: "500",
                    paidAt: "2026-10-01T10:00:00.000Z",
                },
            ],
        })!;

        expect(result.version).toBe(7);
        expect(result.data.accountLedgerEntries).toEqual([]);
        expect(result.data.accounts).toEqual([]);
    });
});
