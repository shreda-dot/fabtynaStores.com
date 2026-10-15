# Fabtyna Stores — Full System Plan

> Beer retail + wholesale stock and sales tracker. Two stock locations, per-channel P&L, debtors, and expenses.

## 1. Business model

Fabtyna operates two sales channels backed by two physical stock locations:

| Channel | Stock location | Pricing | Unit |
|---------|----------------|---------|------|
| Retail | `RETAIL_SHELF` (fridge) | `retailPriceKobo` | `UNIT` |
| Wholesale | `WAREHOUSE` | `wholesalePriceKobo` | `PACK` |

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
- **Sale** — `id`, `channel`, `location`, `customerId`, `lines[]`, `totalKobo`, `paidKobo`, `status` (`DRAFT` | `COMPLETED` | `VOIDED`), `soldAt`, `reference`, `notes`.
- **SaleLine** — `productId`, `unit`, `quantity`, `unitPriceKobo`.
- **Expense** — `id`, `channel` (`RETAIL` | `WHOLESALE` | `BOTH`), `category`, `description`, `amountKobo`, `expenseDate`, `createdAt`.
- **ExpenseCategory** — `RENT`, `UTILITY`, `SALARY`, `TRANSPORT`, `MAINTENANCE`, `SUPPLIES`, `MARKETING`, `OTHER`.
- **Purchase** — supplier, lines, total, status, `receivedAt`.
- **StockTransfer** — from `WAREHOUSE` to `RETAIL_SHELF`, product, quantity packs.

### Key domain operations

- `completeSale()` — validates stock, creates `SALE_OUT` movement, computes COGS via `averageCostKobo`, creates customer `SALE` ledger entry if customer, sets status `COMPLETED`.
- `voidSale()` — reverses stock and ledger; status `VOIDED`. Records preserved.
- `recordSalePayment(saleId, amountKobo, paidAt)` — validates `amount > 0` and `amount ≤ totalKobo - paidKobo`. Increments `sale.paidKobo`, adds negative `PAYMENT` ledger entry. Never deletes the sale.
- `salesSummary(dateRange)` — per-channel daily aggregation:
  - `retailRevenueKobo`, `retailCogsKobo`, `retailGrossProfitKobo`, `retailExpensesKobo`, `retailNetProfitKobo`
  - `wholesaleRevenueKobo`, `wholesaleCogsKobo`, `wholesaleGrossProfitKobo`, `wholesaleExpensesKobo`, `wholesaleNetProfitKobo`
  - `totalRevenueKobo`, `totalCogsKobo`, `totalGrossProfitKobo`, `totalExpensesKobo`, `totalNetProfitKobo`
  - Expenses: `RETAIL` → retail bucket; `WHOLESALE` → wholesale bucket; `BOTH` → split half/half (integer division, remainder to one side to avoid loss).

## 4. API layer (`apps/web/lib/api/`)

All APIs are **mock-backed** (localStorage) with a typed interface and a real-API stub for future backend swap.

### Interfaces
- `SalesApi` — `list`, `getById`, `create`, `update`, `void`, `recordPayment(id, amountKobo, paidAt)`.
- `ExpensesApi` — `list({ channel, category, from, to })`, `getById`, `create`, `update`, `remove`.
- `ReportsApi` — `salesSummary({ from, to })`, `productSales`, `stockValuation`, `lowStock`.
- `CustomersApi`, `ProductsApi`, `PurchasesApi`, `TransfersApi`, `SuppliersApi`, `AdjustmentsApi`, `StockApi`.

### Mock store (`mock-store.ts`)
- `CURRENT_VERSION = 3` — adding `expenses` collection invalidates old localStorage and re-seeds.
- Collections: products, stockMovements, customers, customerLedger, sales, purchases, transfers, suppliers, expenses, adjustments, auditLog.
- All mutations are logged to `auditLog` with actor, action, entity, diff.

## 5. UI pages

| Route | Purpose |
|-------|---------|
| `/dashboard` | Today vs yesterday revenue cards, net profit, top products, low stock. |
| `/sales` | Today/yesterday per-channel revenue cards + **Recent expenses** and **Debtors** side panels + sales list (filter by channel/status). |
| `/sales/new` | New sale: channel selector (auto-sets location, unit, price tier, and filters customers by type), lines, payment, notes. |
| `/sales/[id]` | Sale detail: lines, totals, paid/balance, ledger, record payment, void. |
| `/expenses` | Expenses list with total, channel/category columns, delete. |
| `/expenses/new` | New expense: channel (Retail/Wholesale/Both), category, description, amount, date. |
| `/debtors` | Customers grouped by unpaid sales: name, total owed, per-sale breakdown (items + total), record payment inline. |
| `/reports/sales` | Per-channel daily table: retail sold/expenses/net, wholesale sold/expenses/net, total net. 6 totals cards. |
| `/inventory/warehouse`, `/inventory/retail` | Stock levels per location with valuation. |
| `/purchases`, `/purchases/new` | Record supplier purchases. |
| `/transfers`, `/transfers/new` | Transfer packs warehouse → fridge. |
| `/products`, `/customers`, `/suppliers`, `/adjustments`, `/stock` | CRUD + views. |

### Sales page side panels
- **Recent expenses** — last 5 expenses with total; "Add" → `/expenses/new`, "View all" → `/expenses`.
- **Debtors** — up to 5 unpaid sales with customer, channel, date, owed/total; "View all" → `/debtors`.

### New sale page customer handling
- Customer dropdown is **filtered by channel type**: retail channel shows only `RETAIL` customers; wholesale shows only `WHOLESALE` customers.
- Switching channel resets the selected customer.
- If no customers of that type exist, an "add one" link appears.

## 6. Debtors & payments flow

1. A sale with a customer and `paidKobo < totalKobo` becomes a debtor.
2. Debtors page lists customers with outstanding balances, grouped by customer.
3. Each unpaid sale shows: channel, date, line items (product × qty), owed amount, total.
4. "Record Payment" opens an inline amount input (pre-filled with the owed amount).
5. On confirm, `salesApi.recordPayment(saleId, amountKobo, paidAt)`:
   - Increments `sale.paidKobo`.
   - Adds a negative `PAYMENT` customer ledger entry.
   - Updates `customer.balanceKobo`.
6. The sale record is **never deleted** — it stays in history with updated `paidKobo`.

## 7. Reports & negative balances

- The sales report shows net profit per channel: `netProfit = grossProfit - expenses`.
- If a channel has expenses but no sales (or expenses > sales), the net profit is **negative** and shown in red.
- Expenses tagged `BOTH` are split 50/50 so both channels carry half the cost.
- Dashboard "Today's gross profit" card uses `totalNetProfitKobo` (after expenses).

## 8. Conventions & constraints

- **No backend / no migrations / no DB** — mock API only for now.
- **Money = kobo strings** in DTOs; `bigint` only for arithmetic.
- **Immutable stock movements and ledgers** — never edit or delete; add reversing entries.
- **Africa/Lagos dates** — `getLagosBusinessDate()` for day boundaries.
- **Plain neutral UI** — Tailwind v4, no design system dependency.
- **React 19 + Compiler** — avoid `form.watch()`, keep memo deps simple.
- **`ResponsiveTable`** — props are `rows`, `columns`, `getKey` (not `data`/`rowKey`).
- **`MoneyInput`** — props `{ id, label, defaultValueKobo, onKoboChange }`.
- **Nav** — `Debtors` (HandCoins) and `Expenses` (Receipt) added to sidebar.

## 9. Verification checklist

- `pnpm --filter @fabtyna/shared exec vitest run` → 110/110 pass.
- `pnpm --filter @fabtyna/shared exec tsc --noEmit` → clean.
- `pnpm --filter @fabtyna/web exec tsc --noEmit` → clean.
- `pnpm --filter @fabtyna/web exec eslint . --max-warnings=0` → clean.
- `pnpm build` → all routes generated.
