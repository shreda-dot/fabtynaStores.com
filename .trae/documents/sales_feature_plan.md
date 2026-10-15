# Sales & Customers Feature — Implementation Plan

## Repository Research

### Current state

The codebase has the **domain types** and **ledger infrastructure** for sales but **no implementation** of the Sales or Customers feature:

- **Domain types** (`packages/shared/src/domain/types.ts`):
  - `SaleStatus` type exists (`"DRAFT" | "COMPLETED" | "VOIDED"`)
  - `Customer` interface exists (id, name, type, creditLimitKobo, phone, email, address, notes)
  - `CustomerLedgerEntry` interface exists with `saleId`, `salePaymentId`, `saleReturnId`, `customerRefundId`
  - `StockMovement` has `saleLineId` and `returnLineId` nullable fields
  - `AccountLedgerEntry` has `salePaymentId`, `customerPaymentId`, `customerRefundId`
  - **Missing**: `Sale`, `SaleLine` interfaces

- **Schemas** (`packages/shared/src/schemas/`):
  - `customer.ts` has `customerDtoSchema` (read-only, no create schema)
  - `ledger.ts` has `customerLedgerEntryDtoSchema` with SALE/PAYMENT/RETURN/CUSTOMER_REFUND types
  - **Missing**: `sale.ts` schema entirely; no `createSaleDtoSchema`, no `createCustomerDtoSchema`

- **Domain operations** (`packages/shared/src/domain/operations.ts`):
  - `receivePurchase()`, `voidPurchase()` exist as the pattern to follow
  - **Missing**: `recordSale()`, `voidSale()`

- **DTOs** (`packages/shared/src/dtos.ts`):
  - `CustomerDto`, `CustomerLedgerEntryDto` exist
  - **Missing**: `SaleDto`, `SaleLineDto`, `CreateSaleDto`, `CreateCustomerDto`

- **Mock store** (`apps/web/lib/api/mock-store.ts`):
  - Has: products, suppliers, purchases, purchaseLines, stockTransfers, stockTransferLines, stockTransferLegs, stockAdjustments, stockAdjustmentLines, stockMovements, supplierLedgerEntries, auditLogs
  - **Missing**: sales, saleLines, customers, customerLedgerEntries

- **API layer** (`apps/web/lib/api/`):
  - Has: products, suppliers, purchases, stock, transfers, adjustments
  - **Missing**: sales, customers

- **UI** (`apps/web/app/(admin)/`):
  - Has: dashboard, products, suppliers, purchases, stock, transfers, adjustments
  - **Missing**: sales, customers

- **Nav** (`apps/web/components/layout/nav-items.ts`): No Sales or Customers entries

### Patterns to follow (from Purchases, the closest analog)

1. **Domain type** → **Zod schema** (DTO) → **DTO type** → **toXxxDto/fromXxxDto conversions**
2. **Domain operation** (`recordSale`) is a pure function that returns created entities (sale, lines, movements, ledger entries)
3. **Mock API** calls the domain operation inside `transactMockStore`, persists returned rows, audits
4. **UI pages**: list page with table + "New" button → new page with form → detail page with lines + void button
5. Money: integer kobo strings in DTOs, `BigInt` only in domain arithmetic
6. Stock: immutable `StockMovement` rows; sale creates negative movements

## Design: Sale model

```
Sale
├── id, customerId (nullable), createdById
├── channel: "RETAIL" | "WHOLESALE"   (which price list was used)
├── status: "DRAFT" | "COMPLETED" | "VOIDED"
├── reference, notes
├── totalKobo, paidKobo
├── soldAt, createdAt, updatedAt

SaleLine
├── id, saleId, productId
├── unit: "UNIT" | "PACK"
├── quantity, unitsPerPackSnapshot, quantityUnits
├── unitPriceKobo (price per unit OR per pack, depending on `unit`)
└── lineTotalKobo
```

### Sale semantics

- **Channel** determines the default price and stock location:
  - `RETAIL` → price = `retailPriceKobo`/unit, stock deducted from `RETAIL_SHELF` (fridge)
  - `WHOLESALE` → price = `wholesalePriceKobo`/pack, stock deducted from `WAREHOUSE`
- A sale line can sell by `UNIT` or `PACK`. `quantityUnits = quantity × unitsPerPackSnapshot` (if PACK) or `quantity` (if UNIT).
- Stock deduction: negative `StockMovement` rows of type `SALE` at the chosen location.
- **Customer & credit**: `customerId` is optional. If set and `paidKobo < totalKobo`, the unpaid amount creates a `CustomerLedgerEntry` (type `SALE`, positive = customer owes). If fully paid, no ledger entry (cash sale).
- **Profit**: `lineTotalKobo - (quantityUnits × averageCostKobo)` per line. Computed for display, not stored.

## Files and Modules

### Shared package (`packages/shared/src/`)

1. **`domain/types.ts`** — Add `Sale` and `SaleLine` interfaces
2. **`schemas/sale.ts`** (new) — `saleStatusSchema`, `saleChannelSchema`, `saleLineDtoSchema`, `saleDtoSchema`, `createSaleLineDtoSchema`, `createSaleDtoSchema`
3. **`schemas/customer.ts`** — Add `createCustomerDtoSchema` (name, type, creditLimitKobo, phone, email, address, notes)
4. **`schemas/index.ts`** — Export sale and createCustomer schemas
5. **`dtos.ts`** — Add `SaleDto`, `SaleLineDto`, `CreateSaleDto`, `CreateSaleLineDto`, `CreateCustomerDto`
6. **`dto-conversions.ts`** — Add `toSaleDto`, `fromSaleDto`, `toSaleLineDto`, `fromSaleLineDto`, `toCustomerDto`, `fromCustomerDto`
7. **`domain/operations.ts`** — Add `recordSale()` and `voidSale()` pure functions
8. **`domain/stock.ts`** — Add `saleProfitKobo(movements, sale, saleLines, products)` helper (optional, for display)

### Web app (`apps/web/`)

9. **`lib/api/mock-store.ts`** — Add `sales`, `saleLines`, `customers`, `customerLedgerEntries` to `MockStore` + `PersistedMockStore` + seed demo data + DTO conversions
10. **`lib/api/sales.api.ts`** (new) — `SalesApi` interface + DTO types (`SaleListItemDto`, `SaleLineWithProductDto`, `SaleDetailDto`)
11. **`lib/api/sales.mock.ts`** (new) — `salesMockApi` (list, getById, create, void)
12. **`lib/api/customers.api.ts`** (new) — `CustomersApi` interface
13. **`lib/api/customers.mock.ts`** (new) — `customersMockApi` (list, getById, create, update, softDelete, restore)
14. **`lib/api/index.ts`** — Wire up `salesApi` and `customersApi`
15. **`lib/query-keys.ts`** — Add `sales` and `customers` query keys
16. **`components/layout/nav-items.ts`** — Add Sales (ShoppingBag icon) and Customers (Users icon) nav items
17. **`app/(admin)/sales/page.tsx`** (new) — Sales list (date, customer, channel, total, paid, status, actions)
18. **`app/(admin)/sales/new/page.tsx`** (new) — New sale form (channel, customer optional, product picker with qty + unit, auto price, payment amount)
19. **`app/(admin)/sales/[id]/page.tsx`** (new) — Sale detail (lines with product names, total, paid, balance, movements, void button)
20. **`app/(admin)/customers/page.tsx`** (new) — Customers list (name, type, credit limit, balance)
21. **`app/(admin)/customers/new/page.tsx`** (new) — New customer form (modal-based, like products)
22. **`app/(admin)/customers/[id]/page.tsx`** (new) — Customer detail (info, ledger, sales history)
23. **`app/(admin)/dashboard/page.tsx`** — Add sales metrics (today's sales, total sales, gross profit)
24. **`lib/api/mock-store.ts`** — Update `assertStoreInvariants` call to include new collections

## Implementation Steps (dependency order)

### Phase 1: Shared domain layer

1. **Add `Sale` and `SaleLine` interfaces** to `types.ts`
2. **Create `schemas/sale.ts`** with all sale schemas; add `createCustomerDtoSchema` to `customer.ts`; export from `schemas/index.ts`
3. **Add DTO types** to `dtos.ts`
4. **Add DTO conversions** to `dto-conversions.ts`
5. **Implement `recordSale()`** in `operations.ts`:
   - Input: `{ customerId, channel, lines: [{ productId, unit, quantity, unitPriceKobo }], paidKobo, soldAt, notes, reference, location }`
   - Validate: all products exist, stock available at location, prices positive
   - Compute `quantityUnits`, `lineTotalKobo`, `totalKobo`
   - Create `Sale` (status: COMPLETED if paidKobo === totalKobo, else COMPLETED with customer balance)
   - Create `SaleLine[]`
   - Create `StockMovement[]` (type SALE, negative quantityUnits, at location)
   - If `customerId` set and `paidKobo < totalKobo`: create `CustomerLedgerEntry` (type SALE, amount = totalKobo - paidKobo)
   - Return all created entities
6. **Implement `voidSale()`** in `operations.ts`:
   - Set sale status VOIDED
   - Create reversal StockMovements (positive, reverses the SALE movements)
   - Create reversal CustomerLedgerEntry if one was created
7. **Run shared `tsc` + `vitest`** to verify (add minimal tests for recordSale/voidSale)

### Phase 2: Mock store + API layer

8. **Extend `mock-store.ts`**:
   - Add `sales`, `saleLines`, `customers`, `customerLedgerEntries` to `MockStore` and `PersistedMockStore`
   - Add seed demo customers (2-3: one wholesale, one retail) and 2-3 demo sales
   - Update `persistMockStore`/`readMockStore` to serialize/deserialize new collections
   - Update `assertStoreInvariants` call
9. **Create `sales.api.ts`** and `sales.mock.ts` (follow purchases pattern)
10. **Create `customers.api.ts`** and `customers.mock.ts` (follow suppliers pattern)
11. **Wire up `index.ts`** with `salesApi` and `customersApi`
12. **Add query keys** to `query-keys.ts`
13. **Run web `tsc`** to verify types

### Phase 3: UI pages

14. **Add nav items** for Sales and Customers
15. **Build Sales list page** (`/sales`) — table with date, customer, channel, total, paid, status; "New sale" button
16. **Build New sale page** (`/sales/new`):
    - Channel selector (Retail / Wholesale) — sets default location
    - Customer selector (optional, for credit)
    - Product line items: pick product, enter quantity (auto-fills price from product based on channel + unit), line total
    - Payment amount field (defaults to total)
    - Submit → `salesApi.create()`
17. **Build Sale detail page** (`/sales/[id]`) — lines with product names, total/paid/balance, stock movements, void button
18. **Build Customers list page** (`/customers`) — table with name, type, credit limit, balance; "New customer" button
19. **Build Customer form** (modal) — name, type (retail/wholesale), credit limit, phone, email, address, notes
20. **Build Customer detail page** (`/customers/[id]`) — info card, ledger entries, sales history
21. **Update Dashboard** — add Today's sales, Total sales, Gross profit cards

### Phase 4: Verification

22. Run `tsc --noEmit` in shared and web
23. Run `vitest run` in shared
24. Run `lint` in web
25. Run `build` in web
26. Manual: reset demo data, create a retail sale, verify stock decreases, check dashboard

## Dependencies and Considerations

- **`recordSale` must be pure**: takes existing products + movements + ledger, returns new entities. Mock layer persists them.
- **Stock availability check**: `recordSale` should throw if a product has insufficient units at the chosen location.
- **Channel vs Unit**: A RETAIL channel sale typically sells by UNIT at retailPrice; a WHOLESALE channel sale sells by PACK at wholesalePrice. But allow mixing (a retail customer could buy a pack). The form picks sensible defaults but lets the user override.
- **Customer ledger**: Only create a ledger entry when there's an unpaid balance. Fully paid cash sales don't touch the customer ledger.
- **Profit display**: `grossProfit = sum(lineTotalKobo - quantityUnits × averageCostKobo)`. Compute in the mock layer or UI from available data.
- **No backend**: Stay in mock layer. No Prisma, no migrations, no API route handlers.
- **Money formatting**: Use `formatNaira` from `@fabtyna/shared` for all money display.
- **Existing tests**: Must not break. If invariants need updating for new collections, explain why.

## Validation

- `packages/shared`: `pnpm exec tsc --noEmit` + `pnpm vitest run`
- `apps/web`: `pnpm exec tsc --noEmit` + `pnpm lint` + `pnpm build`
- Manual: reset demo data → navigate to Sales → create a retail sale (1 unit of LEGEND at ₦1,500) → verify stock in RETAIL_SHELF decreases by 1 → check dashboard shows the sale

## Risks

- **Stock negative check**: If `recordSale` validates against existing movements but the mock store passes stale data, could allow overselling. Mitigation: pass `draft.stockMovements` directly from within `transactMockStore`.
- **`averageCostKobo` snapshot**: Profit calculation uses current `averageCostKobo`, not the cost at time of sale. For a first version this is acceptable; future could snapshot cost on SaleLine.
- **Credit limit**: Not enforcing `creditLimitKobo` in v1 (just displaying it). Could add in `recordSale` if needed.
- **Large scope**: This is a big feature. If it gets too long, can split into "Sales core" (steps 1-17, 22-26) and "Customers + Dashboard" (18-21).

## Revenue recognition & payment tracking (added)

### Problem
A sale made on credit should not count as revenue until the customer actually pays. If a customer owes ₦100,000 and pays ₦50,000, only ₦50,000 is revenue until the rest is paid. The system must also explain why "supposed revenue" (what was billed) differs from "revenue gotten" (cash received).

### Solution
- **`SalePayment` entity** (`types.ts`): `{ id, saleId, amountKobo, paidAt, createdAt }`. Created by `recordSalePayment` for every payment (full or partial).
- **Revenue recognized on payment date**: `salesSummary` now accepts `existingSalePayments`. `revenueGottenKobo` = sum of payment amounts, bucketed by `paidAt` (not `soldAt`). So a Monday sale paid Wednesday counts Wednesday's revenue.
- **Three revenue figures**:
  - `supposedRevenue` = sum of `sale.totalKobo` (billed amount, by sale date)
  - `revenueGotten` = sum of `SalePayment.amountKobo` (cash received, by payment date)
  - `standardRevenue` = sum of `quantityUnits × standardPricePerUnit` (expected at standard prices)
- **Gross profit** = revenue gotten − COGS. **Net profit** = gross profit − expenses.
- **Outstanding debt** = supposed revenue − revenue gotten.
- **"Why doesn't it tally?" panel** (rule-based, no LLM): debts, discounts (standard − supposed), and expenses.

### Files
- `packages/shared/src/domain/types.ts` — `SalePayment` interface
- `packages/shared/src/domain/operations.ts` — `recordSalePayment` returns `{ sale, customerLedgerEntry, salePayment }`; `salesSummary` accepts `existingSalePayments` and computes the three revenue figures
- `packages/shared/src/schemas/sale.ts` — `salePaymentDtoSchema`
- `packages/shared/src/dtos.ts` — `SalePaymentDto`
- `packages/shared/src/dto-conversions.ts` — `toSalePaymentDto` / `fromSalePaymentDto`
- `apps/web/lib/api/mock-store.ts` — `salePayments` collection (v4)
- `apps/web/lib/api/sales.mock.ts` — persist `salePayment`; include in `SaleDetailDto`
- `apps/web/lib/api/reports.api.ts` / `reports.mock.ts` — new fields in summary DTO
- `apps/web/app/(admin)/sales/[id]/page.tsx` — payment history table
- `apps/web/app/(admin)/reports/sales/page.tsx` — supposed vs gotten cards + explanation
- `apps/web/app/(admin)/dashboard/page.tsx` — today's retail/wholesale cards (worth, supposed, gotten, debt) + explanation panel

### Transfer reference
- `StockTransfer` has an optional `reference` field. If left blank on creation, the mock auto-generates `TRF-XXXXXX`.
- Shown in the transfers list (as a link to the detail page) and on the transfer detail header.

## Follow-up: cash-basis fixes, business day, edits & UX (implemented)

### Revenue recognition bugs fixed
- **Money taken at the till wasn't counted**: `recordSale` set `sale.paidKobo` but created no `SalePayment`, so `salesSummary` (which sums `SalePayment.amountKobo`) reported ₦0 revenue. Fixed by creating the initial `SalePayment` inside `recordSale` and persisting it in `sales.mock.ts`, plus a fallback in `salesSummary` for legacy sales with `paidKobo > 0` and no payment rows.
- **Voided sales leaked revenue**: `salesSummary` now builds a `salesById` map over all sales and skips payments whose sale is missing or `VOIDED`.
- **Gross profit stuck at 0** after the two-loop split: gross profit is now computed from `revenueGotten − COGS` in the final loop.
- **Debtors hidden for walk-ins**: both Sales and Debtors pages now filter only by "not voided" and `totalKobo > paidKobo`, so walk-in sales (no `customerId`/`customerName`) with a balance appear.

### Lagos business day
- `useLagosBusinessDate()` (30s interval) + `getLagosBusinessDayRange()` drive all "today/yesterday" math on the Dashboard and Sales pages, so figures reset at Lagos midnight regardless of device timezone.
- The Dashboard gained a business-date picker (default today, `max` today, "Today" button) for next-day accounting.

### Editable documents (immutable amend)
- `SalesApi.update(id, input)` and `PurchasesApi.update(id, input)` void the original and record a corrected replacement (reversal movements/ledger + fresh document + audit row).
- New routes `/sales/[id]/edit` and `/purchases/[id]/edit`; Edit buttons on both detail pages.

### UX
- `MoneyInput` adds thousand separators, clears `0.00` on focus, restores on blur if empty.
- Sales page has a customer/reference search bar.
- Customer detail page shows Paid / Unpaid per sale for multiple concurrent debts.
