# Fabtyna Stores — Retail & Wholesale Operations Plan

## 1. Business model (wide review)

Fabtyna Stores runs two connected stock locations:

- **Warehouse** — where purchased crates/packs land. Sold at **wholesale price** by pack/crate.
- **Retail shelf (fridge)** — where individual bottles are kept for walk-in retail. Sold at **retail price** per unit.

### Daily flow

1. **Purchase** crates from a supplier → stock enters `WAREHOUSE`.
2. **Restock the fridge** → transfer some units (half crate, full crate, or any amount) from `WAREHOUSE` to `RETAIL_SHELF`. The retail worth rises automatically.
3. **Retail sale** → sells from `RETAIL_SHELF` at `retailPriceKobo` per unit.
4. **Wholesale sale** → sells from `WAREHOUSE` at `wholesalePriceKobo` per pack.
5. **Track** daily revenue per channel, compare today vs yesterday, and report weekly/monthly gross profit.

### P&L

- **Supposed revenue** = sum of all `sale.totalKobo` (what was billed), counted on the sale date.
- **Revenue gotten** = sum of all `SalePayment.amountKobo` (actual cash received), counted on the **payment date**, not the sale date. A partial payment counts only the amount received.
- **Standard revenue** = sum of `quantityUnits × standardPricePerUnit` (retail or wholesale price per unit), used to detect discounting.
- **COGS** = cost price of the units sold (sum of `averageCostKobo` per unit sold), counted on the sale date.
- **Gross profit** = revenue gotten − COGS.
- **Net profit** = gross profit − expenses.
- **Outstanding debt** = supposed revenue − revenue gotten.
- Expenses reduce net profit.

### Payment tracking

- Every payment (full or partial) creates an immutable `SalePayment` record with `saleId`, `amountKobo`, `paidAt`, `createdAt`.
- Revenue is recognized on `paidAt` (the day cash was received), so a sale made Monday and paid Wednesday counts revenue on Wednesday.
- Payment history (date + amount) is shown on the sale detail page.

### "Why doesn't it tally?" explanation

Since no LLM API key is configured, the reconciliation is rule-based and computed from data:
- **Debts** = supposed revenue − revenue gotten (unpaid balances).
- **Discounts** = standard revenue − supposed revenue (sold below the standard price).
- **Expenses** = sum of expenses in the period.
The dashboard and sales report show this breakdown.

## 2. What already exists

- Shared domain: `Sale`, `SaleLine`, `recordSale`, `voidSale`, customer ledgers — done and tested.
- Mock store: `customers`, `sales`, `saleLines`, `customerLedgerEntries` collections added (v2).
- API layer: `sales.api.ts`, `sales.mock.ts`, `customers.api.ts`, `customers.mock.ts`, wired in `index.ts`, query keys added.
- Stock locations: `WAREHOUSE`, `RETAIL_SHELF`, `MARKET`.
- Transfer feature exists (warehouse → retail shelf) with an optional `reference` field (auto-generated `TRF-XXXXXX` if blank).
- Stock page already shows worth by location.

## 3. Pages to build

### Inventory (split by location)
1. **`/inventory/retail`** — Fridge view. Products currently in `RETAIL_SHELF`, units available, retail worth per product, total retail worth. "Transfer to fridge" quick action on each row.
2. **`/inventory/warehouse`** — Warehouse view. Products in `WAREHOUSE`, packs + units available, wholesale worth per product, total wholesale worth.

### Sales
3. **`/sales`** — Sales list. Columns: date, reference, channel, customer, lines, total, paid, status. Filters: channel (all/retail/wholesale), status. Summary row: today's retail total, today's wholesale total, yesterday's retail total, yesterday's wholesale total.
4. **`/sales/new`** — New sale. Channel selector (retail/wholesale) that locks the location and price unit. Customer picker (optional). Line items: product, quantity, unit price (auto from channel), line total. Payment amount. Submit calls `recordSale`.
5. **`/sales/[id]`** — Sale detail. Header (channel, customer, dates, status). Lines table (product, qty, unit price, line total). Totals (total, paid, unpaid). Stock movements created. Void button (if not voided).

### Customers
6. **`/customers`** — Customers list. Name, type, credit limit, balance owed. Search, create modal, soft-delete/restore.
7. **`/customers/[id]`** — Customer detail. Contact info, credit limit, current balance. Ledger entries table. Sales history table.

### Reporting
8. **`/reports/sales`** — Sales & P&L report.
   - Date range picker (default: last 7 days).
   - Cards: total revenue, retail revenue, wholesale revenue, COGS, gross profit.
   - Daily table: date, retail revenue, wholesale revenue, total revenue.
   - Channel split for the period.

### Dashboard
- `/dashboard` — Today's sales only (no yesterday comparison). Two cards (Retail / Wholesale) each showing: stock worth, supposed revenue, revenue gotten, outstanding debt. Plus today's net profit and expenses, and a "Why doesn't it tally?" panel breaking down debts, discounts, and expenses.

## 4. API additions (mock only — no backend/migrations)

### Existing (done)
- `salesApi.list`, `getById`, `create`, `void`
- `customersApi.list`, `getById`, `create`, `update`, `softDelete`, `restore`

### New
- `reportsApi.salesSummary({ from, to })` → returns per-day retail/wholesale revenue, COGS, gross profit; totals.
- Inventory split reads are derived from the existing `stockApi.list()` (which returns `byLocation`), so no new API needed — just filtering on the client.

## 5. Implementation order

1. **Reports domain + API** — add `salesSummary` pure function in shared domain + mock endpoint.
2. **Nav items** — add Sales, Customers, Reports.
3. **Sales UI** — list, new, detail.
4. **Customers UI** — list, detail.
5. **Inventory split pages** — retail, warehouse.
6. **Reports page** — sales & P&L.
7. **Dashboard update** — add today's vs yesterday's sales cards.
8. **Verification** — shared + web tsc, vitest, build.

## 6. Constraints (from PROJECT_RULES.md)

- No backend, no migrations, no DB. Mock API layer only.
- Money as integer kobo strings in DTOs; bigint only in domain.
- Immutable stock movements and ledgers; corrections via reversals.
- Complete files, not diffs.
- Tailwind only, no custom CSS.

## 7. Session updates (business day, edits, payment tracking)

### 7.1 Lagos business day & automatic rollover

- `packages/shared/src/lagos-time.ts`: `getLagosBusinessDate()` (YYYY-MM-DD in `Africa/Lagos`) and `getLagosBusinessDayRange(date)` (start `T00:00:00+01:00`, 24h end).
- `apps/web/hooks/use-lagos-business-date.ts`: returns the current Lagos business date and re-checks every 30s, so "today" figures reset to zero at Lagos midnight **without a page reload** and are independent of the device timezone.
- Dashboard and Sales page use the hook for all "today / yesterday" math (replacing `new Date()`-based boundaries).
- Because accounts are reconciled the next day, the **dashboard has a business-date picker** (default = current Lagos day, `max` = today, plus a "Today" button). `viewDate = selectedDate ?? businessDate` is a derived value (no `setState` inside an effect).

### 7.2 Cash-basis revenue (fixed)

- `recordSale()` now creates the initial **`SalePayment`** row when `paidKobo > 0`, so money taken at the till is visible to `salesSummary` immediately. `apps/web/lib/api/sales.mock.ts` persists it.
- `salesSummary` recognizes revenue from `SalePayment.amountKobo` bucketed by `paidAt`; **payments for missing or `VOIDED` sales are skipped**. Legacy sales with `paidKobo > 0` and no payment rows fall back to an implicit payment on the sale date.
- `grossProfit = revenueGotten − COGS`; `netProfit = grossProfit − expenses`.

### 7.3 Immutable edits (void-and-replace)

- `PurchasesApi.update(id, input)` and `SalesApi.update(id, input)` were added (real-API stubs return `notImplemented()`).
- Each `update` voids the original (`status = "VOIDED"`), pushes the reversal stock movements + reversal ledger entries, records a corrected replacement via `receivePurchase` / `recordSale`, recomputes weighted-average cost, and appends an audit row (`PURCHASE_AMENDED` / `SALE_AMENDED`).
- New routes: `/purchases/[id]/edit` and `/sales/[id]/edit`. The **Edit** button was added to both detail pages.
- Sale edit consolidates existing payments into the single "Amount received" field. New-sale and new-purchase date fields default to `getLagosBusinessDate()`.

### 7.4 Number input & search UX

- `MoneyInput` adds **thousand separators** while typing, clears the `0.00` placeholder on focus, and restores it on blur if left empty.
- Sales page has a **search bar** filtering by customer name or reference.
- Customer detail page has explicit **Paid / Unpaid** columns so multiple concurrent debts per customer are visible.
- Debtors / Sales debtors filter by financial balance only (`totalKobo > paidKobo`), so retail **walk-ins** with no `customerId`/`customerName` are included; voided sales are excluded.
