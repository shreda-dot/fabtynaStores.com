# Fabtyna Stores — Full System Plan

> Beer retail + wholesale stock and sales tracker. Two stock locations, per-channel P&L, debtors, and expenses.

## 1. Business model

Fabtyna operates two sales channels backed by two physical stock locations:

| Channel   | Stock location          | Pricing              | Unit   |
| --------- | ----------------------- | -------------------- | ------ |
| Retail    | `RETAIL_SHELF` (fridge) | `retailPriceKobo`    | `UNIT` |
| Wholesale | `WAREHOUSE`             | `wholesalePriceKobo` | `PACK` |

End-to-end flow:

1. **Purchase** — buy stock from a supplier into the warehouse at `purchasePriceKobo` per pack. Average cost per pack is recomputed (weighted).
2. **Transfer** — move packs from warehouse to fridge at 1:1 (or a configured ratio). Cost basis follows the stock.
3. **Sale** — sell units from fridge (retail) or packs from warehouse (wholesale). COGS = `averageCostKobo × quantity`.
4. **Expense** — record a cost tagged to `RETAIL`, `WHOLESALE`, or `BOTH`. `BOTH` is split 50/50 across channels in reports.
5. **Payment** — a credit customer pays part/all of an unpaid sale. `paidKobo` increases; a negative `PAYMENT` ledger entry is added. Sale record is never deleted.
6. **Report** — per-day, per-channel breakdown: revenue, COGS, gross profit, expenses, net profit. Negative net profit is shown when expenses exceed sales.

## 2. Money handling

- All monetary values are stored as **kobo (integer strings)** in DTOs and API payloads.
- Arithmetic uses `bigint` in the domain layer only.
- `formatNaira(kobo)` renders as `₦1,234.56` (handles negatives correctly).
- `parseMoneyInputToKobo(input)` parses user input (`1,234.50` → `"123450"`).
- Never store naira floats anywhere.

## 3. Domain model (`packages/shared/src/domain/`)

### Core entities

- **Product** — `id`, `name`, `packSizeUnits`, `retailPriceKobo`, `wholesalePriceKobo`, `averageCostKobo` (per pack), `active`.
- **StockMovement** — immutable. Types: `PURCHASE_IN`, `TRANSFER_OUT`, `TRANSFER_IN`, `SALE_OUT`, `ADJUSTMENT`. Tracks `location`, `productId`, `quantityUnits`, `costBasisKobo`.
- **Customer** — `id`, `name`, `type` (`RETAIL` | `WHOLESALE`), `phone`, `email`, `address`, `balanceKobo` (computed ledger sum), `active`.
- **CustomerLedgerEntry** — immutable. Types: `SALE`, `PAYMENT`. `amountKobo` positive for sales, negative for payments.
- **Sale** — `id`, `channel`, `location`, `customerId`, `customerName` (nullable, for retail walk-ins), `lines[]`, `totalKobo`, `paidKobo`, `status` (`DRAFT` | `COMPLETED` | `VOIDED`), `soldAt`, `reference`, `notes`.
- **SaleLine** — `productId`, `unit`, `quantity`, `unitPriceKobo`.
- **SalePayment** — immutable. `id`, `saleId`, `amountKobo`, `paidAt`, `createdAt`. One row per payment (full or partial). Revenue is recognized on `paidAt`, not `soldAt`, so a Monday sale paid Wednesday counts as Wednesday revenue.
- **Expense** — `id`, `channel` (`RETAIL` | `WHOLESALE` | `BOTH`), `category`, `description`, `amountKobo`, `expenseDate`, `createdAt`.
- **ExpenseCategory** — `RENT`, `UTILITY`, `SALARY`, `TRANSPORT`, `MAINTENANCE`, `SUPPLIES`, `MARKETING`, `OTHER`.
- **Purchase** — supplier, lines, total, status, `receivedAt`.
- **StockTransfer** — from `WAREHOUSE` to `RETAIL_SHELF`, product, quantity packs.

### Key domain operations

- `recordSale()` — validates stock, creates `SALE_OUT` movement, computes COGS via `averageCostKobo`, creates customer `SALE` ledger entry when unpaid, sets status `COMPLETED`. **Also records the initial payment as a `SalePayment` row (when `paidKobo > 0`)**, so money taken at the till shows up in cash-basis revenue immediately.
- `voidSale()` — reverses stock and ledger; status `VOIDED`. Records preserved.
- `recordSalePayment(saleId, amountKobo, paidAt)` — validates `amount > 0` and `amount ≤ totalKobo - paidKobo`. Increments `sale.paidKobo`, adds negative `PAYMENT` ledger entry, appends a `SalePayment`. Never deletes the sale.
- `voidPurchase()` / `voidSale()` drive the **immutable amend** flow (see §4) — an edit voids the original and records a corrected replacement rather than mutating history.
- `salesSummary(dateRange, ..., salePayments)` — per-channel daily aggregation:
  - **Revenue recognition**: `revenueGotten` = sum of `SalePayment.amountKobo` bucketed by `paidAt`. Payments are counted **only while their sale is live** — a missing or `VOIDED` sale's payments are skipped. Legacy sales with `paidKobo > 0` but no payment rows fall back to an implicit payment on the sale date.
  - `supposedRevenue` = Σ `sale.totalKobo` (billed, by `soldAt`); `standardRevenue` = Σ `quantityUnits × standardPricePerUnit`; outstanding debt = supposed − gotten.
  - `grossProfit` = revenue gotten − COGS; `netProfit` = gross profit − expenses.
  - `retailRevenueKobo`, `retailCogsKobo`, `retailGrossProfitKobo`, `retailExpensesKobo`, `retailNetProfitKobo`
  - `wholesaleRevenueKobo`, `wholesaleCogsKobo`, `wholesaleGrossProfitKobo`, `wholesaleExpensesKobo`, `wholesaleNetProfitKobo`
  - `totalRevenueKobo`, `totalCogsKobo`, `totalGrossProfitKobo`, `totalExpensesKobo`, `totalNetProfitKobo`
  - Expenses: `RETAIL` → retail bucket; `WHOLESALE` → wholesale bucket; `BOTH` → split half/half (integer division, remainder to one side to avoid loss).

## 4. API layer (`apps/web/lib/api/`)

All APIs are **mock-backed** (localStorage) with a typed interface and a real-API stub for future backend swap.

### Interfaces

- `SalesApi` — `list`, `getById`, `create`, `update`, `void`, `recordPayment(id, amountKobo, paidAt)`.
- `PurchasesApi` — `list`, `getById`, `create`, `update`, `void`.
- `ExpensesApi` — `list({ channel, category, from, to })`, `getById`, `create`, `update`, `remove`.
- `ReportsApi` — `salesSummary({ from, to })`, `productSales`, `stockValuation`, `lowStock`.
- `CustomersApi`, `ProductsApi`, `TransfersApi`, `SuppliersApi`, `AdjustmentsApi`, `StockApi`.

### Immutable amend (edit a purchase or sale)

- `update(id, input)` does **not** mutate the original row. It voids the original (status `VOIDED`) and records a corrected replacement, keeping the audit trail intact:
  1. `voidPurchase` / `voidSale` produce reversal stock movements + reversal ledger entries.
  2. A fresh `receivePurchase` / `recordSale` creates the corrected document.
  3. Weighted-average cost is recomputed for affected products.
  4. An `AuditLog` row is appended (`PURCHASE_AMENDED` / `SALE_AMENDED`) with before/after snapshots.
- The real-API stubs return `notImplemented()`.

### Mock store (`mock-store.ts`)

- `CURRENT_VERSION = 4` — adding the `salePayments` collection invalidates old localStorage and re-seeds.
- Collections: products, stockMovements, customers, customerLedgerEntries, sales, saleLines, salePayments, purchases, purchaseLines, transfers, suppliers, expenses, adjustments, auditLogs.
- All mutations are logged to `auditLog` with actor, action, entity, diff.
- Domain operations run inside `transactMockStore((draft) => …)` so checks see live stock/ledger state.

## 5. UI pages

| Route                                                             | Purpose                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`                                                      | Business-day cards (Retail/Wholesale: worth, supposed, gotten, debt), net profit + "Why doesn't it tally?" panel. Includes a **business-date picker** (defaults to the current Lagos day, max = today, "Today" button) for next-day accounting. |
| `/sales`                                                          | Today/yesterday per-channel revenue cards + **Recent expenses** and **Debtors** side panels + sales list with a **customer/reference search bar** (filter by channel/status).                                                                   |
| `/sales/new`                                                      | New sale: channel selector (auto-sets location, unit, price tier, and filters customers by type), lines, payment, notes. Date defaults to the Lagos business date.                                                                              |
| `/sales/[id]`                                                     | Sale detail: lines, totals, paid/balance, payment history, ledger, record payment, **Edit** and void.                                                                                                                                           |
| `/sales/[id]/edit`                                                | Amend a forgotten/mistaken sale (void-and-replace). Payments are consolidated into the "Amount received" field.                                                                                                                                 |
| `/expenses`                                                       | Expenses list with total, channel/category columns, delete.                                                                                                                                                                                     |
| `/expenses/new`                                                   | New expense: channel (Retail/Wholesale/Both), category, description, amount, date.                                                                                                                                                              |
| `/debtors`                                                        | Unpaid sales (incl. retail walk-ins) grouped by customer: name, total owed, per-sale breakdown (items + total), **Paid** button that settles the debt inline.                                                                                   |
| `/reports/sales`                                                  | Per-channel daily table: retail sold/expenses/net, wholesale sold/expenses/net, total net. 6 totals cards.                                                                                                                                      |
| `/inventory/warehouse`, `/inventory/retail`                       | Stock levels per location with valuation.                                                                                                                                                                                                       |
| `/purchases`, `/purchases/new`                                    | Record supplier purchases. Date defaults to the Lagos business date.                                                                                                                                                                            |
| `/purchases/[id]/edit`                                            | Amend a mistaken purchase (void-and-replace).                                                                                                                                                                                                   |
| `/transfers`, `/transfers/new`                                    | Transfer packs warehouse → fridge.                                                                                                                                                                                                              |
| `/products`, `/customers`, `/suppliers`, `/adjustments`, `/stock` | CRUD + views. Customer detail shows **Paid / Unpaid** columns so multiple concurrent debts per customer are visible.                                                                                                                            |

### Sales page side panels

- **Recent expenses** — last 5 expenses with total; "Add" → `/expenses/new`, "View all" → `/expenses`.
- **Debtors** — up to 5 unpaid sales with customer, channel, date, owed/total; "View all" → `/debtors`.

### New sale page customer handling

- Customer dropdown is **filtered by channel type**: retail channel shows only `RETAIL` customers; wholesale shows only `WHOLESALE` customers.
- Switching channel resets the selected customer.
- If no customers of that type exist, an "add one" link appears.

## 6. Debtors & payments flow

1. **Any** sale with an outstanding balance (`totalKobo > paidKobo`) is a debtor — including retail **walk-ins** that have neither `customerId` nor `customerName`. Never filter debtors by customer identity; filter by financial balance. Voided sales are excluded.
2. Debtors page groups entries by customer for wholesale and by ad-hoc name / sale id for retail, so a customer with several debts shows each one.
3. Each unpaid sale shows: channel, date, line items (product × qty), owed amount, total.
4. A "Paid" action settles the specific debt in one tap and immediately updates the day's totals and overall totals; "Record Payment" supports partial settlement.
5. On payment, `salesApi.recordPayment(saleId, amountKobo, paidAt)`:
   - Increments `sale.paidKobo`.
   - Appends an immutable `SalePayment` row (so cash-basis revenue picks it up).
   - Adds a negative `PAYMENT` customer ledger entry.
   - Updates `customer.balanceKobo`.
6. The sale record is **never deleted** — it stays in history with updated `paidKobo`. Settled debt history is retained for 2 weeks, then cleaned up automatically.

## 7. Reports & negative balances

- The sales report shows net profit per channel: `netProfit = grossProfit - expenses`.
- If a channel has expenses but no sales (or expenses > sales), the net profit is **negative** and shown in red.
- Expenses tagged `BOTH` are split 50/50 so both channels carry half the cost.
- Dashboard "Today's gross profit" card uses `totalNetProfitKobo` (after expenses).

## 8. Conventions & constraints

- **No backend / no migrations / no DB** — mock API only for now.
- **Money = kobo strings** in DTOs; `bigint` only for arithmetic.
- **Immutable stock movements and ledgers** — never edit or delete; add reversing entries.
- **Africa/Lagos dates** — all business dates go through `getLagosBusinessDate()` (day boundary `T00:00:00+01:00`) and `getLagosBusinessDayRange(date)` (24h window). The client hook `useLagosBusinessDate()` re-checks every 30s so "today" resets at Lagos midnight even if the page stays open, independent of the device timezone.
- **Plain neutral UI** — Tailwind v4, no design system dependency.
- **React 19 + Compiler** — avoid `form.watch()`, keep memo deps simple. Derive values (e.g. `viewDate = selectedDate ?? businessDate`) instead of `setState` inside an effect.
- **`ResponsiveTable`** — props are `rows`, `columns`, `getKey` (not `data`/`rowKey`).
- **`MoneyInput`** — props `{ id, label, defaultValueKobo, onKoboChange }`. Adds thousand separators while typing, clears the `0.00` placeholder on focus, and restores it on blur if left empty.
- **Nav** — `Debtors` (HandCoins) and `Expenses` (Receipt) added to sidebar.

## 9. Verification checklist

- `pnpm --filter @fabtyna/shared exec vitest run` → 110/110 pass.
- `pnpm --filter @fabtyna/shared exec tsc --noEmit` → clean.
- `pnpm --filter @fabtyna/web exec tsc --noEmit` → clean.
- `pnpm --filter @fabtyna/web run lint` → clean.
- `pnpm build` → all routes generated, including `/purchases/[id]/edit` and `/sales/[id]/edit`.
- Manual: reset demo data → create a retail sale → confirm revenue appears on the payment date, stock decreases, debtors show unpaid balances, and the dashboard business-date picker switches days.
