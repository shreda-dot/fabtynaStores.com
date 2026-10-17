# Fabtyna Stores — Full System Plan

> Beer retail + wholesale stock, sales, debtors, expenses and a lightweight accounting layer.
> Two sales channels backed by three stock locations.

**Last reviewed:** 2026-10-17 · reflects the code on disk, not the original brief.

## 0. Repository layout

| Path              | Stack                                                                    | Role                                                                                          |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/web`        | Next.js 16.4 (Turbopack), React 19, Tailwind v4, Zustand, TanStack Query | The working application. Runs on the **mock API** by default.                                 |
| `packages/shared` | TypeScript, Zod v4, Vitest 3.2.7                                         | Domain types, pure domain operations, validation, DTO schemas, Lagos time.                    |
| `apps/api`        | Fastify, Prisma 7, PostgreSQL (**Neon**)                                 | The backend being built. Schema + migration baseline exist; service layer is not written yet. |
| `docs`            | —                                                                        | This plan and the Phase 5 schema draft.                                                       |

Monorepo scripts (root `package.json`):

- `pnpm dev` → web dev server · `pnpm build` → web production build · `pnpm lint` → web ESLint
- `pnpm typecheck` → `pnpm -r typecheck` (**web has no `typecheck` script yet — it is skipped**)
- `pnpm test` → currently points at `@fabtyna/api` (which has no tests) instead of `@fabtyna/shared`

## 1. Business model

| Channel   | Stock location          | Pricing              | Unit   |
| --------- | ----------------------- | -------------------- | ------ |
| Retail    | `RETAIL_SHELF` (fridge) | `retailPriceKobo`    | `UNIT` |
| Wholesale | `WAREHOUSE`             | `wholesalePriceKobo` | `PACK` |

`MARKET` is a third, valid stock location used for adjustments/transfers.

A product declares `saleChannel` (`RETAIL` \| `WHOLESALE` \| `BOTH`) and is only sellable from
the matching shelf and price list. A **sale** must be `RETAIL` or `WHOLESALE` (never `BOTH`).

End-to-end flow:

1. **Purchase** — buy stock from a supplier into the warehouse. Weighted-average cost per unit is
   recomputed into `Product.averageCostKobo`. Purchases may be bought on credit.
2. **Transfer** — move stock between locations at 1:1 via paired `IN`/`OUT` legs.
3. **Sale** — sell units from the fridge or packs from the warehouse. COGS uses `averageCostKobo`.
   Wholesale supports fractional packs (1, ½, ¾ crate) as long as `quantity × unitsPerPack` is whole.
4. **Expense** — tagged `RETAIL`, `WHOLESALE`, or `BOTH`. `BOTH` is split across channels in reports.
5. **Payment** — a credit customer pays part/all of an unpaid sale; a supplier is paid against a
   purchase. `paidKobo` increases and an immutable payment row + ledger entry are appended.
6. **Report** — per-day, per-channel revenue, COGS, gross profit, expenses and net profit.

## 2. Money handling

- All monetary values are **kobo**. DTOs and API payloads use **integer strings**; the domain layer
  uses `bigint`. Prisma columns are `BigInt`.
- `formatNaira(kobo)` renders `₦1,234.56` (handles negatives).
- `parseMoneyInputToKobo(input)` parses `1,234.50` → `"123450"`.
- `MoneyInput` clears the `0.00` placeholder on focus, accepts thousand separators, and restores the
  placeholder on blur.
- **Never store naira floats anywhere.**

## 3. Domain model (`packages/shared/src/domain/`)

Modules: `types.ts`, `invariants.ts`, `ledger.ts`, `stock.ts`, `operations.ts`, `accounting.ts`,
`loans.ts` (re-exported from `index.ts`).

### Enums

| Enum                      | Values                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ProductCategory`         | `BEER`, `SOFT_DRINK`, `OTHER`                                                                              |
| `SaleChannel`             | `RETAIL`, `WHOLESALE`, `BOTH`                                                                              |
| `Unit`                    | `UNIT`, `PACK`                                                                                             |
| `StockLocation`           | `WAREHOUSE`, `RETAIL_SHELF`, `MARKET`                                                                      |
| `StockMovementType`       | `PURCHASE`, `SALE`, `TRANSFER`, `ADJUSTMENT`, `RETURN`                                                     |
| `TransferDirection`       | `IN`, `OUT`                                                                                                |
| `PurchaseStatus`          | `DRAFT`, `RECEIVED`, `VOIDED`                                                                              |
| `SaleStatus`              | `DRAFT`, `COMPLETED`, `VOIDED`                                                                             |
| `CustomerType`            | `WHOLESALE`, `RETAIL`                                                                                      |
| `PaymentMethod`           | `CASH`, `TRANSFER`, `OTHER`                                                                                |
| `ExpenseCategory`         | `RENT`, `UTILITY`, `SALARY`, `TRANSPORT`, `MAINTENANCE`, `SUPPLIES`, `MARKETING`, `LOAN_INTEREST`, `OTHER` |
| `CustomerLedgerEntryType` | `SALE`, `PAYMENT`, `RETURN`, `CUSTOMER_REFUND`, `ADJUSTMENT`                                               |
| `SupplierLedgerEntryType` | `PURCHASE`, `PAYMENT`, `ADJUSTMENT`                                                                        |
| `LoanLedgerEntryType`     | `DISBURSEMENT`, `CHARGE`, `REPAYMENT`                                                                      |
| `LoanStatus`              | `ACTIVE`, `PAID`, `OVERDUE`                                                                                |
| `PurchasePaymentStatus`   | `UNPAID`, `PARTIAL`, `PAID`                                                                                |
| `AccountEntryType`        | account-ledger types (12 values, incl. `OWNER_CAPITAL`, `OWNER_DRAWING`, `BANK_OR_POS_CHARGE`)             |

### Core entities

- **Product** — `name`, `sku` (nullable, normalised to uppercase/trimmed), `category`, `packName`,
  `unitsPerPack`, `saleChannel`, `retailPriceKobo`, `wholesalePriceKobo`, `averageCostKobo`,
  `reorderLevelUnits`, `deletedAt`.
- **Supplier** / **Customer** — contact details, soft `deletedAt`. Customers carry `type`,
  `creditLimitKobo`, and a computed (never stored) balance.
- **StockMovement** — immutable. Exactly one source column is set (`purchaseLineId`, `saleLineId`,
  `transferLegId`, `adjustmentLineId`; `returnLineId` reserved). Carries `productId`, `location`,
  `type`, signed `quantityUnits`, `unitCostKobo`, `reversesEntryId`.
- **StockAdjustment** / **StockAdjustmentLine** — line-level `location` and `quantityDeltaUnits`.
- **StockTransfer** / **StockTransferLine** / **StockTransferLeg** — transfers produce paired `IN`/`OUT`
  legs so each movement has one attributable source. Optional `reference` (auto `TRF-XXXXXX` when blank).
- **Purchase** / **PurchaseLine** — line-level unit snapshot (`unitsPerPackSnapshot`, `quantityUnits`).
  Header carries `totalKobo`, **`paidKobo`**, **`dueDate`** (Lagos `YYYY-MM-DD`). Location lives on the
  resulting stock movement, not the purchase header.
- **SupplierPayment** — immutable. `supplierId`, `purchaseId`, `amountKobo`, `method`, `note`, `paidAt`.
- **Sale** / **SaleLine** — `channel`, `customerId` (nullable), `customerName` (nullable),
  `totalKobo`, **`paidKobo`**, `reference`, `status`, `soldAt`. Line-level `location` and `unitPriceKobo`.
  There is **no `discountKobo` column** — discounts are derived (see §5).
- **SalePayment** — immutable. `saleId`, `amountKobo`, `paidAt`. One row per payment (full or partial).
- **CustomerLedgerEntry** / **SupplierLedgerEntry** — immutable, signed, `reversesEntryId`.
- **Expense** — `channel`, `category`, `description`, `amountKobo`, `expenseDate`, `loanRepaymentId`.
- **Loan** / **LoanLedgerEntry** / **LoanRepayment** — see §4.
- **CashSnapshot** — `asOfDate` (Lagos `YYYY-MM-DD`), `amountKobo`, `note`.
- **AuditLog** — every mutation appends actor, action, entity and before/after snapshots.

### Immutability and reversals

- Ledgers and stock movements are **append-only**. Corrections are new rows, never edits.
- A reversal: same type and source ids, **exactly negated amount**, `reversesEntryId` pointing at the
  original. A target can be reversed **once**; a reversal cannot itself be reversed.
- `buildLedgerReversal` / `buildStockMovementReversal` construct these; `assertStoreInvariants`
  validates them across the whole store.

### Key domain operations (`operations.ts`, `accounting.ts`, `loans.ts`)

- `receivePurchase` · `voidPurchase` · `recordPurchasePayment`
- `buildTransfer` · `buildAdjustment` · `voidAdjustment`
- `recordSale` · `voidSale` · `recordSalePayment`
- `createLoan` · `addLoanCharge` · `recordLoanRepayment`
- `salesSummary` — per-channel daily aggregation
- `computeFinancialPosition` — assets vs liabilities (§4)
- Helpers: `recomputeAverageCostKobo`, `calculateWeightedAverageCostKobo`, `stockByProductAndLocation`,
  `purchaseBalanceKobo`, `purchasePaymentStatus`, `isPurchaseOverdue`, `loanOutstandingKobo`,
  `loanStatus`, `scaleByBpsFloor`

## 4. Accounting module

### Supplier credit / payables

- `Purchase.paidKobo` is denormalised from `SupplierPayment` rows for cheap list rendering.
- `recordPurchasePayment` appends an immutable `SupplierPayment` plus a negative `PAYMENT`
  `SupplierLedgerEntry`, and raises `purchase.paidKobo`.
- Derived — **never stored**: `purchasePaymentStatus`, `purchaseBalanceKobo`, `isPurchaseOverdue`.
- Editing/voiding a purchase that already has payments is **blocked**; payments must be reversed first.
- `/accounting/payables` lists suppliers sorted by amount owed (descending) with expandable
  per-purchase breakdowns and an inline "record payment" flow.

### Loans

- `createLoan` writes a `DISBURSEMENT` (and optionally a `CHARGE`) `LoanLedgerEntry`.
- `addLoanCharge` appends further `CHARGE` entries.
- `recordLoanRepayment` validates against the outstanding balance, appends a negative `REPAYMENT`
  entry, and — **only when `interestPortionKobo > 0`** — creates a linked `LOAN_INTEREST` expense
  (`Expense.loanRepaymentId` ↔ `LoanRepayment.expenseId`). Principal-only repayments create no expense.
- Outstanding = `DISBURSEMENT + CHARGE − REPAYMENT`; `loanStatus` derives `ACTIVE`/`PAID`/`OVERDUE`.

### Cash snapshots

- Manually recorded balances (`CashSnapshot`) — one row per `asOfDate` reading.
- The latest snapshot by (`asOfDate`, `createdAt`) is the cash figure used in the financial position.
- The UI shows an **amber warning when the balance is older than 7 days**.

### Financial position

`computeFinancialPosition` is a **pure function**. Assets: stock (at cost / retail / wholesale),
receivables, cash. Liabilities: supplier payables, loan outstanding. Three segmented scenarios:

| Scenario     | Valuation basis                                       |
| ------------ | ----------------------------------------------------- |
| **Expected** | Excludes loose warehouse units (realistic near-term). |
| **Best**     | Includes every unit at full retail/wholesale value.   |
| **Floor**    | Cost-based valuation of stock.                        |

User-adjustable assumptions: discount %, collectible %, include debts, include cash.

## 5. Cash-basis reporting

- `supposedRevenue` = Σ `sale.totalKobo` bucketed by **`soldAt`** (billed).
- `revenueGotten` = Σ `SalePayment.amountKobo` bucketed by **`paidAt`** (received). A Monday sale paid
  on Wednesday counts as Wednesday revenue. Payments whose sale is missing or `VOIDED` are skipped.
- **Outstanding debt = supposed − gotten.** Net profit counts only `revenueGotten`; **outstanding debt
  is excluded from gains/revenue**.
- `standardRevenue` = Σ `quantityUnits × standardPricePerUnit`; **discount = standard − supposed**.
- `grossProfit = revenueGotten − COGS`; `netProfit = grossProfit − expenses`.
- Expenses: `RETAIL` → retail bucket; `WHOLESALE` → wholesale bucket; `BOTH` → split across channels
  (integer division, remainder assigned to one side so nothing is lost).
- Negative net profit is rendered in red.
- Dashboard "Outstanding Debt" reflects the **live unpaid balance of sales originating on the selected
  date**, so it clears to zero once the debt is paid, regardless of the payment date.
- Dashboard "Today's Sale" filters strictly by `saleDate` in Africa/Lagos and rolls over at midnight
  via `useLagosBusinessDate()` (30s poll).

## 6. Debtors & payments flow

1. **Any** sale with `totalKobo > paidKobo` is a debtor — **including retail walk-ins** with neither
   `customerId` nor `customerName`. Never filter debtors by identity; filter by financial balance.
   Voided sales are excluded.
2. The debtors page groups entries by `customer.id` for both retail and wholesale to prevent
   fragmentation from ad-hoc spellings ("Sarah" vs "Mrs Sarah").
3. Each unpaid sale expands to line items, owed amount and total.
4. A "Paid" action settles that specific debt in one tap and immediately updates the day's and overall
   totals; "Record Payment" supports partial settlement. Both require a `ConfirmDialog`.
5. On payment: raise `sale.paidKobo`, append an immutable `SalePayment`, append a negative `PAYMENT`
   customer ledger entry.
6. **Walk-in rule:** a sale with no customer is only allowed if fully paid. Any outstanding balance
   requires a valid `customerId`. `QuickAddCustomerDialog` allows inline customer creation.
7. **A customer with an outstanding balance cannot be deleted.**
8. Settled debt history is retained for 2 weeks, then cleaned up automatically.

## 7. API layer (`apps/web/lib/api/`)

Every domain has a `.api.ts` (typed interface + real-API stub) and a `.mock.ts` implementation:
`accounting`, `adjustments`, `cash`, `customers`, `expenses`, `loans`, `payables`, `products`,
`purchases`, `reports`, `sales`, `stock`, `suppliers`, `transfers`.

- `NEXT_PUBLIC_API_MODE` toggles `mock` (default) vs `real`. **All real implementations are
  `notImplemented()` stubs** — the backend swap has not started.
- `NEXT_PUBLIC_MOCK_LATENCY_MS` and `NEXT_PUBLIC_MOCK_FAILURE_RATE` (default `0`) simulate loading and
  error states. Every API is wrapped by `instrumentApi`.
- Requests go through `client.ts` with a **15s timeout** and typed, user-readable errors.

### Immutable amend (edit a purchase or sale)

`update(id, input)` never mutates the original row. It **voids and replaces**:

1. `voidPurchase` / `voidSale` emit reversal stock movements and reversal ledger entries.
2. A fresh `receivePurchase` / `recordSale` creates the corrected document.
3. Weighted-average cost is recomputed for affected products.
4. An `AuditLog` row (`PURCHASE_AMENDED` / `SALE_AMENDED`) captures before/after.

Amending is blocked when payments exist.

### Mock store (`mock-store.ts`)

- `localStorage` key `fabtyna-mock-v1` (backup key `fabtyna-mock-v1-backup`).
- `MOCK_STORE_CURRENT_VERSION = 5` (see `packages/shared/src/mock-store-migration.ts`).
- **23 collections**: products, suppliers, customers, purchases, purchaseLines, sales, saleLines,
  salePayments, stockTransfers, stockTransferLines, stockTransferLegs, stockAdjustments,
  stockAdjustmentLines, stockMovements, supplierLedgerEntries, supplierPayments,
  customerLedgerEntries, expenses, loans, loanLedgerEntries, loanRepayments, cashSnapshots, auditLogs.
- Migrations are additive: unknown keys preserved, missing collections created empty, new fields
  back-filled only when absent. v4→v5 back-filled `paidKobo`, `dueDate`, `expense.loanRepaymentId`.
- Mutations run inside `transactMockStore((draft) => …)` so invariants see live stock/ledger state.
- Seeded with 24 beer products, 3 suppliers, 2 customers.

## 8. Database (`apps/api`)

| Artifact          | Path                                    | State                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma schema     | `apps/api/prisma/schema.prisma`         | **26 models, 18 enums.** Aligned with `packages/shared`. Passes `prisma validate`.                                                                                                                                            |
| Migrations        | `apps/api/prisma/migrations/`           | **6 folders**: `init`, `ledger_sign_checks`, `stock_movement_checks`, `partial_unique_indexes`, `immutability_triggers`, `accounting_constraints`. **None applied** (`prisma migrate status` → "have not yet been applied").  |
| Constraint drafts | `apps/api/prisma/sql-drafts/01…06*.sql` | Hand-written SQL. **Fold status:** `01`, `02`, `03`, `04`, `06` are folded into migrations. **`05 value checks.sql` is NOT folded** — there is no `…000500_*` migration and none of its `ck_*` names appear in `migrations/`. |
| Prisma config     | `apps/api/prisma.config.ts`             | `schema`, `migrations.path`, `datasource.url = env("DATABASE_URL")`. **`DIRECT_URL` is not wired**, so migrate runs through the pooled URL.                                                                                   |
| Generated client  | `apps/api/generated/prisma`             | Output of the `prisma-client` generator. **Generated 2026-10-17** (Prisma 7.10.0); gitignored.                                                                                                                                |
| Service layer     | `apps/api/src`                          | Barely scaffolded (`lib/ledger.ts`, `lib/lagos-time.ts`, `modules/stock/stock.service.ts`). No tests yet.                                                                                                                     |

**Provider: Neon (PostgreSQL).** `apps/api/.env` is now wired to Neon and holds no duplicates:

- `DATABASE_URL` — pooled, database **`fabtyna_dev`** (runtime + currently also migrations).
- `DIRECT_URL` — direct (unpooled), database **`fabtyna_dev`**.
- `TEST_DATABASE_URL` — pooled, database **`fabtyna_test`** (nothing has been applied to it yet).

`DIRECT_URL` is present in `.env` but **not referenced by the datasource block or `prisma.config.ts`**,
so `prisma migrate` currently runs through the pooler. Wiring it is part of the database step.

If `DIRECT_URL` is added to the datasource block, it must also exist in `.env` or `prisma validate`
will fail.

Schema conventions:

- Table names are snake_case via `@@map`; **column names stay camelCase** (they must be quoted in SQL).
- Money is `BigInt`; timestamps are `DateTime`; Lagos business dates are `String` `YYYY-MM-DD` so they
  cannot be shifted by timezone conversion.
- Ledger/payment/cash-snapshot tables are append-only (enforced by triggers in the SQL drafts).

## 9. UI pages

34 App Router pages under `apps/web/app`.

| Route                                                                                   | Purpose                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                                                            | Business-day cards (Retail/Wholesale: worth, supposed, gotten, debt), net profit + "Why doesn't it tally?", business-date picker for next-day accounting.                                                                          |
| `/sales`                                                                                | Per-channel revenue cards, recent expenses and debtors side panels, searchable list, edit button.                                                                                                                                  |
| `/sales/new`, `/sales/[id]`, `/sales/[id]/edit`                                         | Create / detail (lines, payment history, record payment, edit, void) / amend.                                                                                                                                                      |
| `/expenses`, `/expenses/new`                                                            | Expense list and creation.                                                                                                                                                                                                         |
| `/debtors`                                                                              | Unpaid sales grouped by customer with an inline Paid action.                                                                                                                                                                       |
| `/reports/sales`                                                                        | Per-channel daily table + totals cards.                                                                                                                                                                                            |
| `/inventory/warehouse`, `/inventory/retail`                                             | Stock levels and valuation. Warehouse shows wholesale worth-if-sold, worth-when-bought, and the margin.                                                                                                                            |
| `/purchases`, `/purchases/new`, `/purchases/[id]`, `/purchases/[id]/edit`               | Purchases with Paid/Balance/status columns, detail view, amend.                                                                                                                                                                    |
| `/transfers`, `/transfers/new`, `/transfers/[id]`                                       | Transfers with a detail view.                                                                                                                                                                                                      |
| `/adjustments`, `/adjustments/new`, `/adjustments/[id]`                                 | Stock adjustments.                                                                                                                                                                                                                 |
| `/products`, `/customers`, `/customers/[id]`, `/suppliers`, `/suppliers/[id]`, `/stock` | CRUD and views. Customer detail shows Paid/Unpaid columns.                                                                                                                                                                         |
| `/accounting`                                                                           | Financial position: verdict headline, Expected/Best/Floor segmented control, assumptions controls, assets vs liabilities columns, coverage bar, scenario table, cash card with the 7-day staleness warning, due-soon/overdue list. |
| `/accounting/payables`                                                                  | Outstanding supplier balances, expandable per-purchase breakdown, inline record-payment.                                                                                                                                           |
| `/accounting/loans`, `/accounting/loans/new`, `/accounting/loans/[id]`                  | Loan list, creation, detail with repayment + charge history.                                                                                                                                                                       |
| `/login`, `/`                                                                           | Auth entry and root redirect.                                                                                                                                                                                                      |

Navigation: the sidebar and mobile nav include an **Accounting** group (Overview, Payables, Loans).

## 10. Conventions & constraints

- **Africa/Lagos everywhere.** All business dates go through `getLagosBusinessDate()` /
  `getLagosBusinessDayRange()` in `packages/shared/src/lagos-time.ts`. Timestamps on new records are
  built from the selected business date plus the current Lagos clock time.
- **Void-and-replace** for amendments; ledgers and uploads are immutable.
- **Double-submit protection is mandatory** on every mutation: disable the button while in flight and
  guard with a React ref.
- **`ConfirmDialog`** is required for voiding sales, deleting expenses, recording payments, completing
  sales, and stock adjustments/transfers.
- **No native `alert()` / `confirm()`** — use the integrated UI messaging components.
- Every page handles four explicit states: loading (route-level skeleton), error (`ErrorState`),
  empty (`EmptyState`), success. Skeletons are region-scoped so static chrome stays visible.
- Tables default to **newest first**; numeric columns use `tabular-nums`.
- Shared components: `date-filter.tsx`, `info-hint.tsx` (tooltips), `QuickAddCustomerDialog`.
- TanStack Query cache invalidation: debt payments invalidate `sales`, `customers`, `reports`;
  supplier payments invalidate `purchases`, `payables`, `suppliers`, `accounting`.
- **Plain neutral UI** — Tailwind v4 with design tokens in `@theme`, dark mode via
  `@custom-variant dark` + `attribute="class"`, `defaultTheme="light"`, `enableSystem={false}`.
- **React 19 + Compiler** — avoid `form.watch()`; derive values instead of `setState` in effects.
- `ResponsiveTable` props are `rows` / `columns` / `getKey`; card-style rows with large touch targets
  on small screens. Breakpoints validated at 320 / 375 / 768 / 1024+.
- A persistent network status bar communicates offline/slow states.
- Hydration: never nest block-level elements inside `<p>`.

## 11. Verification checklist

```powershell
pnpm --filter @fabtyna/shared exec vitest run      # 148/148 pass (8 files)
pnpm --filter @fabtyna/shared exec tsc --noEmit    # clean
pnpm --filter @fabtyna/web exec tsc --noEmit       # clean
pnpm --filter @fabtyna/api exec tsc --noEmit       # clean
pnpm --filter @fabtyna/web exec eslint . --max-warnings=0   # clean
pnpm build                                          # 28 routes generated
pnpm --filter @fabtyna/web exec next --version      # 16.4.0
pnpm --filter @fabtyna/api exec prisma migrate status
```

Last full run: **2026-10-17**, all green on a clean `pnpm install --frozen-lockfile`.

Manual smoke test: reset demo data → create a retail sale → confirm revenue lands on the payment date,
stock decreases, debtors show the unpaid balance, the dashboard date picker switches days, a part-paid
purchase appears under Payables, and a loan repayment with interest creates a `LOAN_INTEREST` expense.

Dev-server smoke test (same date): `pnpm --filter @fabtyna/web dev` → Ready on `:3000`; `/` → `307`
(→ `/dashboard`), `/dashboard` → `200`, `/login` → `200`.

## 12. Roadmap

**Done**

- Web app on the mock API (sales, purchases, transfers, adjustments, expenses, debtors, reports,
  inventory, products, customers, suppliers, stock).
- Accounting module: payables, loans, cash snapshots, financial position, UI + domain + tests.
- Prisma schema aligned to the app, migration baseline generated, constraint drafts written.
- Dependency install repaired (see §13); Prisma client generated; web build + dev server verified.

**Next — database** (nothing below is applied yet)

1. Fold `sql-drafts/05 value checks.sql` into its own migration (`…000500_value_checks`) — it is the
   only draft not present in `migrations/`.
2. Wire `DIRECT_URL` into the datasource/`prisma.config.ts` so migrations bypass the pooler.
3. Apply all migrations to an **empty** dev database, re-run to prove a no-op, then `prisma migrate status`.
4. Apply to `TEST_DATABASE_URL` behind a guard that refuses to run unless the name contains `test`.
5. Write `apps/api/src/__tests__/constraints.test.ts` and prove each constraint fires. Seed ONLY the
   single admin user (email + password hash from env).

**Next — backend**

6. Implement Fastify services in `apps/api/src/modules/**` one aggregate at a time, reusing the pure
   domain functions from `@fabtyna/shared` (they are the same rules the mock enforces).
7. Add tests per module (`apps/api` currently has none) and fix the root `test` script.
8. Flip `NEXT_PUBLIC_API_MODE=real` resource by resource, keeping the mock for anything not migrated.

**Deferred / known gaps**

- Retail debt entry should route through the customer page (or `QuickAddCustomerDialog`) so misspelled
  ad-hoc names cannot create duplicates.
- `Account` / `AccountLedgerEntry` / `AccountType` and the `accountId` column on payments exist in the
  schema but are not used by the app yet.
- Reserved-but-unused source columns: `customerPaymentId`, `saleReturnId`, `customerRefundId`,
  `otherIncomeId`, `accountTransferId`, `StockMovement.returnLineId`.
- Phase 5 (`docs/phase5-schema-draft.prisma`): stocktakes, container types, container transfers.
- `paidKobo` denormalisation consistency is owned by the service layer; `sql-drafts/05` contains a
  read-only drift-audit query.
- **Tooling gaps (open):** `apps/web/package.json` has no `typecheck` script, so `pnpm -r typecheck`
  never checks the web app; the root `test` script points at `@fabtyna/api` (which has no tests)
  instead of `@fabtyna/shared`; there is no root `verify` script.
- **Fractional sale quantity vs DB column (open):** the app allows fractional crate quantities
  (½ / ¾ crate — `SaleLine.quantity` uses `z.number().positive()`), but `SaleLine.quantity` is `Int`
  in `schema.prisma`. `quantityUnits` is the integer of record. Either the column must become
  `Decimal`, or the service must reject non-integer `quantity`. Not yet resolved.

## 13. Progress log

**2026-10-17 — dependency install repaired**

Symptom: `npm run dev` failed with `Cannot find module …\apps\web\node_modules\next\dist\bin\next`.

Root cause: an earlier `pnpm install --force` run with the package store placed **inside the repo**
(`--store-dir .pnpm-store`) was **interrupted before extraction finished**, leaving a half-populated
`node_modules/.pnpm`. The junctions and `.bin` shims existed, but package contents were incomplete —
`next\dist\bin` was missing entirely.

Repair:

- Deleted `npx --yes rimraf`-style: root `node_modules` (1794 MB), `.pnpm-store` (2070.3 MB),
  `.pnpm-cache` (5.4 MB), `.pnpm-state` (0 MB) and the three workspace `node_modules` (~0 MB) — ≈3.87 GB.
- No pnpm config change was needed: `store-dir`/`cache-dir`/`state-dir` were all `undefined`, and the
  default store (`C:\Users\Shreda\AppData\Local\pnpm\store\v11`) is outside the repo on the same drive.
  There is no `.npmrc` (repo or user). The repo is **not** in OneDrive.
- `pnpm install --frozen-lockfile` → 613 packages, 13m 41s, exit 0.
- Killed a stale Next dev server (PID 2208 → 6628 → 7412/8640) left over from the broken install.
- `prisma generate` → client written to `apps/api/generated/prisma` (gitignored).

Result: `next --version` → 16.4.0; vitest 148/148; shared/web/api `tsc --noEmit` clean; ESLint clean;
`pnpm build` 28 routes; dev server Ready with `/` → 307 → `/dashboard` (200) and `/login` → 200.

Note: pnpm 10 blocks postinstall scripts by default (`@prisma/engines`, `argon2`, `esbuild`, `prisma`,
`unrs-resolver`). This is harmless here — `esbuild`'s platform binary
(`@esbuild/win32-x64/esbuild.exe`) ships as an optional dependency and Prisma's engines are fetched on
demand.
