# Accounts and expenses design

**Status:** implemented API and database design, reviewed against the repository
on 2026-10-20. This document records current behavior, not a future UI contract.

## Source of truth

`accounts` identifies CASH, BANK, and POS holding places. Current money is the
sum of immutable `account_ledger_entries`; `account_balances` is a
trigger-maintained cache of that sum. Its non-negative check is the final
protection against concurrent spending. New installations receive **Cash on
hand** (`CASH`) and **Moniepoint** (`BANK`) from the default-accounts migration.
Accounts can be renamed or deactivated, never deleted; deactivation requires a
zero balance.

Opening balances are positive `OPENING_BALANCE` entries, with at most one live
opening entry per account. Reconciliation compares a counted amount with the
ledger balance and posts the signed difference as a reasoned `ADJUSTMENT`.
Reconciliation does not rewrite history. Cash snapshots remain immutable
historical counts and do not determine current cash or financial position.

Transfers are immutable `account_transfers` documents with paired
`TRANSFER_OUT` and `TRANSFER_IN` entries. Corrections append exact reversal
entries; a reversal must name a non-empty reason and an entry can be reversed
only once. A reversal of money already spent is refused if it would make the
account negative.

## Entry types and money rules

Money is integer kobo (`BIGINT` in PostgreSQL, integer strings at API
boundaries, `bigint` for arithmetic). Inflows are positive and outflows
negative. The current database source trigger treats these as source-less
manual entries: `OPENING_BALANCE`, `ADJUSTMENT`, `OWNER_CAPITAL`,
`OWNER_DRAWING`, `OTHER_INCOME`, and `BANK_OR_POS_CHARGE`. Sale/purchase
payments, expenses, loans and transfers carry their source IDs.

`OTHER_INCOME` is source-less by the approved decision. The new migration
changes only that type's source rule; `otherIncomeId` remains a reserved column.
**Mismatch to resolve:** the approved design also describes `CUSTOMER_REFUND` as
source-less, but the current shared domain and database trigger still require
`customerRefundId`. It was not changed here. Do not expose manual customer
refunds until the owner chooses which rule is authoritative.

Loan repayment posts its full amount (principal plus interest) once as the
`LOAN_REPAYMENT` account outflow. A linked `LOAN_INTEREST` expense is for profit
reporting only and cannot create another account outflow.

## Expense categories and expenses

`expense_categories` replaces the PostgreSQL `ExpenseCategory` enum. The
migration seeds protected system categories and backfills existing expenses to
`categoryId`. System categories cannot be renamed or deactivated; user-created
categories can be renamed and deactivated/reactivated, but never deleted.
Inactive categories cannot be selected for a new expense. `LOAN_INTEREST` is
reserved for loan repayment interest and cannot be selected manually.

Creating an ordinary expense writes the expense and its negative account entry
in one transaction. Expense details are immutable after creation. Voiding
requires a reason, posts an exact account-ledger reversal, and marks the expense
voided in the same transaction. Amendment is void plus recreate, never an
in-place edit. Voided expenses are excluded from lists and summaries by
default. `BOTH` expenses are allocated with integer arithmetic: retail receives
floor(amount / 2), wholesale gets the remainder.

## API surface

- Categories: `GET/POST /expense-categories`,
  `PATCH /expense-categories/:id`, and category deactivate/reactivate routes.
- Expenses: `GET /expenses`, `GET /expenses/summary`, `POST /expenses`,
  `POST /expenses/:id/void`, and `PUT /expenses/:id` (void + recreate).
- Accounts: `GET/POST /accounts`, `PATCH /accounts/:id`, deactivate/reactivate,
  opening balance, reconcile, manual movements, and paginated statements.
- Transfers: create and reverse `POST /account-transfers` documents; manual
  account-ledger entries can be reversed through `/account-entries/:id/reverse`.

Writes use the API's transaction runner, idempotency keys, actor audit rows,
and standard error envelope. Date filters use Lagos business dates. Expenses
and account statements default to today when no range is supplied. Sales and
purchases also default to today for an unfiltered list, but suppress that
default when search/debt filters are used (`unpaid`, `overdue`, `q`,
`customerId`, `supplierId`) so those views cover all periods. The inclusive
range cap is configurable with `API_MAX_DATE_RANGE_DAYS` (default 366).

## Locks and database guarantees

Sales and purchases retain their document → sorted products → sorted stock
balances → sorted account balances → party lock order. Account writes lock
`account_balances` in sorted account-ID order. Expense create locks category
then account balance; void locks the expense then its account balance; amend
locks the expense, category, then sorted account balances. Transfers lock both
account balances in sorted order.

The database enforces non-negative account balances, source/type exclusivity,
single live opening balance, transfer pairing, ledger immutability, exact
reversals, category protections, and expense detail/void immutability. The
services own friendly account-specific insufficient-funds messages and
transaction orchestration. `db:verify` checks that these objects exist;
`db:audit` checks cached balances, payment totals and source reconciliation.

## Known gaps

- The web app still uses its typed mock API. Its shared/mock expense category
  type remains a fixed enum and is not wired to the dynamic category API.
- `CUSTOMER_REFUND` source semantics need an owner decision (see above).
- There are no loan-management API routes; repayment/account behavior is
  enforced in the existing shared domain and database constraints.
