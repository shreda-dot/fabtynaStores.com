# Fabtyna Stores — AI context (read this first)

Briefing for a new AI session working on this repo with no other history.
Everything below was reviewed against the repository on 2026-10-20. Docs only:
this file does not change code, migrations or `.env`.

Repository root: `c:\Users\Shreda\fabtyna-stores` (Windows, PowerShell).
pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`), `packageManager: pnpm@10.15.1`.

## 1. What the project is

Beer and soft-drinks business in Lagos, Nigeria. Two sales channels —
**RETAIL** (units from the fridge/shelf) and **WHOLESALE** (packs from the
warehouse) — plus a third stock location **MARKET**. A product may be sellable
`RETAIL`, `WHOLESALE` or `BOTH`; a *sale* is `RETAIL` or `WHOLESALE` only.
Single owner today, more admin users later (see `AdminRole` in §6). Used on a
phone on slow networks, so the web app is mobile-first with a network status bar.

## 2. Repo layout

- `packages/shared` (`@fabtyna/shared`) — pure domain logic, no I/O, no DB.
  - `src/domain/`: `operations.ts` (`recordSale`, `recordSalePayment`,
    `voidSale`, `receivePurchase`, `recordPurchasePayment`, `voidPurchase`,
    `buildTransfer`, `buildAdjustment`, `voidAdjustment`, `salesSummary`),
    `accounts.ts` (account ledgers, balances, reconcile and money flow),
    `loans.ts` (`createLoan`, charges/repayments), `ledger.ts`, `stock.ts`,
    `invariants.ts`, `accounting.ts` (`scaleByBpsFloor`), `types.ts`.
  - `src/schemas/` — Zod DTO schemas; `src/dtos.ts` + `src/dto-conversions.ts`.
  - `src/money.ts` (`formatNaira`, `parseMoneyInputToKobo`), `src/lagos-time.ts`
    (`getLagosBusinessDate`), `src/mock-store-migration.ts`.
  - Tests: `src/__tests__/*.test.ts` (vitest).
- `apps/web` (`@fabtyna/web`) — Next.js **16.4** App Router, React **19.3**,
  Tailwind v4, TanStack Query, Zustand, next-themes, recharts, react-hook-form.
  - API layer: `lib/api/*.api.ts` (types) + `lib/api/index.ts` (mode switch) +
    `lib/api/*.mock.ts` backed by `lib/api/mock-store.ts` (localStorage).
  - Pages: `app/(admin)/**`, login at `app/(auth)/login`.
- `apps/api` (`@fabtyna/api`) — Prisma **7** + `@prisma/adapter-pg` (node-postgres),
  PostgreSQL on Neon, vitest, **Fastify 5** HTTP server for sales, purchases,
  expense categories, expenses, and accounts (see §6).
  - Schema: `apps/api/prisma/schema.prisma`; migrations:
    `apps/api/prisma/migrations/` (**30** migrations); generated client output:
    `apps/api/generated/prisma/` (git-ignored).
  - `src/db/`: `expected-schema.ts`, `verify.ts`, `audit.ts`.
  - `src/lib/`: `env.ts`, `prisma.ts` (`createPrismaClient`), `password.ts`
    (Argon2id, `@node-rs/argon2`), `seed-admin.ts`, `ledger.ts`, `lagos-time.ts`,
    `errors.ts` (error envelope + Postgres error mapping), `retry.ts`,
    `idempotency.ts`.
  - `src/app.ts` (`buildApp`), `src/start.ts` (`startServer`), `src/server.ts`
    (entry), `src/auth/actor.ts` (temporary guard), `src/modules/sales/`
    (schemas, validation, repository, service, routes).
  - `src/modules/stock/stock.service.ts`, `src/modules/expenses/`,
    `src/modules/accounts/`; `src/scripts/`: `db-verify.ts`,
    `db-audit.ts`, `seed-admin.ts`, `hash-password.ts`.
  - Tests: `apps/api/tests/*.test.ts` + `global-setup.ts` + `test-db.ts` +
    `sales-fixtures.ts`.
- `docs/` — `backend-schema.md` (full table + constraint inventory),
  `FABTYNA_PLAN.md`, `phase5-schema-draft.prisma`. Also `.trae/documents/*.md`.

## 3. Commands that actually exist

Root (`package.json`):
- `pnpm verify` = `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- `pnpm typecheck` = `pnpm -r typecheck`; `pnpm test` = `pnpm -r test`
  (runs shared tests, then API tests — the API suite needs a test DB, §4)
- `pnpm dev` / `pnpm build` / `pnpm lint` target `@fabtyna/web` only.

API (`pnpm --filter @fabtyna/api …`):
- `db:verify` → `tsx src/scripts/db-verify.ts`. Accepts
  `-- --url TEST_DATABASE_URL` (an env-var name, or a literal URL).
- `db:audit` → `tsx src/scripts/db-audit.ts` (same `--url` handling).
- `db:seed:admin` → `tsx src/scripts/seed-admin.ts`, flag `-- --additional`.
- `hash-password` → `tsx src/scripts/hash-password.ts` (interactive, no args).
- `test` (vitest run), `typecheck`, `build`, `prisma:format`, `prisma:validate`.
- `dev`/`start` run `src/server.ts` / `dist/server.js`. `dev` (tsx) is verified;
  `start` runs the compiled output, which imports the shared package as
  TypeScript source, so use `dev` until a deployment build exists.

Shared: `pnpm --filter @fabtyna/shared test` (vitest run) and `typecheck`.
(`pnpm --filter @fabtyna/shared exec vitest run` also works, but the script is
`test`.)

## 4. Databases, env variables (names only), secrets

Neon Postgres. The committed `apps/api/.env.example` uses two databases named
`fabtyna_dev` and `fabtyna_test`; real values live in git-ignored `.env`.

Variable NAMES (never values):
- `DATABASE_URL` — pooled Neon endpoint. Optional; the API does not use it yet.
- `DIRECT_URL` — direct (unpooled) endpoint, used by schema/migration commands
  via `apps/api/prisma.config.ts` AND by the running API (below).
- `DB_POOL_MAX` (API pool size, 1–10, default 10).
- `ALLOW_UNAUTHENTICATED_DEV`, `DEV_ACTOR_EMAIL` — the temporary no-login guard
  (below). `NODE_ENV=production` refuses to start.
- `TEST_DATABASE_URL` / `TEST_DIRECT_URL` — the test suite only.
- `PORT` (API, default 3001); `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (admin seed).
- Web (`apps/web`, names only): `NEXT_PUBLIC_API_MODE` (default `"mock"`),
  `NEXT_PUBLIC_API_TIMEOUT_MS`, `NEXT_PUBLIC_MOCK_LATENCY_MS`,
  `NEXT_PUBLIC_MOCK_FAILURE_RATE`.

Rules: NEVER read out, print or commit `.env` values (not even connection
strings). API scripts load `apps/api/.env` themselves via `dotenv`; Prisma 7 and
tsx do not.

Test-DB guard (`apps/api/tests/test-db.ts`, `resolveTestConnectionString`):
refuses to run unless `TEST_DATABASE_URL` is set, differs from `DATABASE_URL`,
and its database name contains `test`; prefers `TEST_DIRECT_URL` when present.
`tests/global-setup.ts` runs `db:verify` against the test DB before any test and
aborts the whole run on drift.
It also refuses any URL whose host contains `-pooler`: tests must use the Neon
**direct** (non-pooled) endpoint, because the pooler drops long-lived,
transactional and concurrent connections ("Connection terminated unexpectedly").

Why the API process uses `DIRECT_URL` with a small pool (max 10): the pooled
endpoint dropped connections during long, transactional, row-locking work (the
test failures that led to the `-pooler` guard), and a sale is one interactive
transaction that takes `FOR UPDATE` row locks and runs ~12 statements. Revisit
at deployment (a pooler in session mode, or a bigger pool, may be right there).

Standing schema-drift check (do NOT run `prisma migrate dev --create-only`, it
hangs): `pnpm --filter @fabtyna/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code --config prisma.config.ts`
must print "-- This is an empty migration." and exit 0.

## 5. Non-negotiable rules

- **Money** is integer **kobo**: `BIGINT` in the DB, integer **strings** in DTOs,
  `bigint` only for arithmetic. Never floats. Percentages are integer **basis
  points** (`scaleByBpsFloor`, `basisPointsSchema`, max 10000).
- **Business dates** are Lagos `YYYY-MM-DD` strings via `getLagosBusinessDate()`
  (`Africa/Lagos`), stored as `String` so they cannot shift by timezone.
- **Immutable** tables (append-only): all ledgers (`customer_ledger_entries`,
  `supplier_ledger_entries`, `account_ledger_entries`, `loan_ledger_entries`),
  `stock_movements`, `sale_payments`, `supplier_payments`,
  `loan_repayments`, `cash_snapshots`, and `audit_logs`. Ordinary expenses are
  not deleted or edited in place: database triggers permit a one-time
  void-with-reason transition, and the API reverses the account entry first.
  Repayment-generated `LOAN_INTEREST` expenses remain immutable.
  Corrections are **reversal rows**: keep `type` and source columns, negate the
  amount exactly, set `reversesEntryId`. Enforced by triggers.
- **NEVER edit an applied migration.** Every DB change is a new migration. Every
  new CHECK/trigger/partial index/FK must also be added to
  `apps/api/src/db/expected-schema.ts` (that file is a mirror of the migration
  SQL, and `db:verify` fails loudly if a listed object is missing).
- **Prisma maps table names only** (`@@map` → snake_case); column names are
  camelCase and MUST be double-quoted in raw SQL (e.g. `"paidKobo"`).
- **`db:verify` proves objects EXIST, not that they behave.** Real tests against
  the test DB are the proof, including POSITIVE paths (legal actions must
  succeed) — see `tests/reversal-positive.test.ts`, not only rule-breaking tests.
- **`db:audit`** drifts: `totalKobo` = Σ line totals, `paidKobo` = Σ payments,
  ledger balances vs documents, `stock_balances` vs `stock_movements`. On clean
  data every `fatal` check returns zero rows. `known` checks describe documented
  deliberate gaps, print `INFO`, and never fail the run.
- **Documents are never edited in place.** Amendment = void + recreate. On a
  document the only mutation allowed after creation is `paidKobo`, `status`
  (→ `VOIDED`) and `updatedAt` (document-lock triggers). Sales are created
  directly as `COMPLETED` and purchases as `RECEIVED`; there is **no DRAFT flow**
  in the app. Transfers/adjustment/line rows are immutable.
- **Ledger signs**: customer `SALE` entry = unpaid portion only (none if fully
  paid); customer `PAYMENT` = negative; supplier `PURCHASE` = full total;
  supplier `PAYMENT` = negative. A payment ledger row must NOT set `saleId`
  (one live entry per sale, `ux_customer_ledger_sale_active`); it is attributed
  through `salePaymentId`/`supplierPaymentId`.
- **Stock** is stored in base **units** at every location; `stock_balances` is
  maintained only by a trigger (`trg_stock_movement_apply`), must never go
  negative (`ck_stock_balances_nonnegative`), and must never be written by
  hand (`trg_stock_balances_guard`). Wholesale PACK lines may be fractional
  (`NUMERIC(12,4)`) but must resolve to a whole number of units.
- A sale with a LIVE on-account payment (customer PAYMENT entry with no reversal)
  cannot be voided (`trg_sale_void_guard`); a purchase with a LIVE supplier payment
  cannot be voided (`trg_purchase_void_guard`). Reverse the payment first.
  An unpaid sale requires a customer; an unpaid purchase requires a supplier.

## 6. Current status (verified)

- Migrations: **31** (listed in `expected-schema.ts` → `EXPECTED_MIGRATIONS`).
  The newest four add dynamic expense categories, make `OTHER_INCOME`
  source-less, correct the category-index names, and make ordinary expense
  details immutable with a single void transition.
  The 2026-10-19 account migrations add account entry enum values, account
  ledger sources/balances/transfers/guards, default accounts, and a corrective
  account-balance guard/cache migration. The dev and test databases contain the
  default Cash on hand and Moniepoint accounts unless an operator has since
  changed them.
- Accounts are the source of truth for current cash/bank/POS balances. The
  append-only account ledger maintains `account_balances`; the Accounting
  overview financial position and Money Flow report use ledger-derived
  balances. Cash snapshots remain historical rows and do not affect current
  balances or financial position.
- The web mock API includes account management, account statements, opening
  balances, reconciliation, transfers, and account-aware money entry forms.
  The Accounting page includes date-filtered, per-account Money Flow with
  transaction categories and sales billed/received/outstanding context.
- Manual cash snapshots remain historical only. The Money Flow report and
  financial-position cash use account ledger balances. Customer refunds have
  domain support but no UI; refunding must also update the customer ledger.
- A sale can be voided/amended after all later on-account payments are reversed;
  a purchase can be voided/amended after all supplier payments are reversed.
  Up-front sale payments are reversed as part of sale void/amend.
- Tests: see the Sales API second-batch bullet below for the current counts
  (earlier: 122 API tests in 11 files, 224 shared).
  `db:verify` also checks `sale_reference_seq`, `purchase_reference_seq`,
  `transfer_reference_seq`, and the `idempotency_keys`
  indexes (`EXPECTED_SEQUENCES`, `EXPECTED_INDEXES`).
- **Sales API (first real operation).** `POST /sales` records a sale as ONE
  interactive transaction (timeout 20 s, maxWait 10 s, `SET LOCAL lock_timeout
  = '15s'`, retry up to 3× on 40P01/40001, then 503): idempotency claim →
  lock products (by id) → lock `stock_balances` (by productId, location) →
  validate customer/product/account/channel/location → shared `recordSale`
  (one pass) → friendly stock check against the locked balances → reference
  from `sale_reference_seq` (`S-YYYYMMDD-000123`, Lagos date of `soldAt`;
  client references that look like it are rejected 400) → batched inserts
  (sale, lines, movements sorted, customer ledger if unpaid, payments, account
  entries, audit row) → store the idempotent response. `GET /sales/:id`
  returns the sale DTO. Errors use `{ error: { code, message, details } }`.
  Money received is a LIST of payments inside the service/repository (0 or 1
  today) while the public DTO takes a single `paidKobo` + `accountId`.
  The service adds what `recordSale` does not check: customer/product/account
  exist and are active, `product.saleChannel` allows the channel, location fits
  the channel (RETAIL → RETAIL_SHELF/MARKET, WHOLESALE → WAREHOUSE), `soldAt`
  not > 5 min in the future, size bounds. The service also fixed a shared bug
  (below). `creditLimitKobo` is NOT enforced anywhere (stored/displayed only),
  so no customer lock exists.
- **Idempotency**: optional `Idempotency-Key` header (8–128 chars). The key is
  claimed inside the sale transaction with `INSERT … ON CONFLICT DO NOTHING` on
  unique `(key, route)`, so a second simultaneous request waits for the first,
  then replays its stored response (`Idempotent-Replayed: true`, original
  status). Same key + different body → 422 `IDEMPOTENCY_MISMATCH`. Rows expire
  after **24 h**; an unref'd hourly job (`startIdempotencyCleanup`) deletes
  expired rows in batches. When login exists, add `actorId` to the uniqueness
  (key stays `(key, route)` for now).
- **Temporary auth guard (fail-closed)**: `NODE_ENV=production` refuses to
  start; otherwise `ALLOW_UNAUTHENTICATED_DEV=true` is required, the server
  listens on **127.0.0.1 only**, and `createdById` is the active admin named by
  `DEV_ACTOR_EMAIL`. The ONE place real auth replaces: the `ActorResolver` in
  `apps/api/src/auth/actor.ts` (delete `assertUnauthenticatedModeAllowed` and
  `loadDevActor` with it).
- Test isolation: nothing committed to immutable tables can be deleted, so each
  test creates its OWN product/customer/account/reference prefix and asserts
  row counts scoped to those. `seed-admin.test.ts` runs against an isolated
  schema (`seed_admin_test`) because `public.admin_users` can no longer be
  emptied. Measured on the test DB over the remote Neon link (via `inject`):
  1-line sale ≈ 3.0–3.7 s, 5-line sale ≈ 3.0–9 s; time is dominated by ~12
  sequential round trips, not by the line count.
- **Sales API, second batch (payments, void, amend, list, detail).** Same
  transaction/retry/idempotency/audit pattern as `POST /sales`:
  - `POST /sales/:id/payments` body `{ amountKobo, accountId, paidAt }` (field is
    `amountKobo`, an integer-kobo string, following the DTO convention) → 201
    `{ sale, payment }`. Writes `sale_payments`, a negative customer `PAYMENT`
    ledger entry (`saleId` NULL, because of the one-live-entry-per-sale index),
    a positive `SALE_PAYMENT` account entry, and updates `paidKobo`/`updatedAt`.
    Amount > 0 and ≤ amount due (400 with `amountDueKobo`); fully paid or voided
    → friendly 409; `paidAt` not > 5 min in the future; account active.
  - `POST /sales/:id/void` → 200 `{ sale, reversals }`. 409 if already voided;
    409 "reverse the payments first (feature not built yet)" if a later
    (on-account) payment exists (`trg_sale_void_guard` is the backstop). Reverses
    every stock movement, the customer SALE entry and every up-front payment's
    account entry. `paidKobo` is unchanged (document lock); reports must exclude
    voided sales. An overdrawing reversal is refused with the friendly message
    (account, balance, amount, "record income or reconcile first"), checked
    against the LOCKED `account_balances`; `ck_account_balances_nonnegative` is
    the backstop (mapped to 409).
  - `PUT /sales/:id` (amend) → 200 `{ sale, voidedSaleId }`: void + new sale in
    ONE transaction with a newly generated reference (a reference in the body is
    ignored). Link: the original's `sale.void` audit row has
    `amendedBySaleId`; the new `sale.create` row has `amendedFromSaleId`.
  - `GET /sales`: filters `from`/`to` (Lagos dates), `status`, `channel`,
    `customerId`, `unpaid`, `q` (reference or customer name, ILIKE); keyset
    cursor on `(soldAt desc, id desc)`, default 50, max 200, `nextCursor`.
    Ordering and date range use `sales(soldAt)`; `status`/`channel`/`unpaid`/`q`
    are post-filters (an `ILIKE '%x%'` cannot use a btree). No index migration:
    at this shop's volume a scan is cheap; a partial or trigram index is the
    future option.
  - `GET /sales/:id`: sale DTO + `balanceDueKobo`, `customer`, `lines` (product
    name, unit, location; internal cost is not exposed) and `payments` (account
    name, amount, paidAt, `reversed` derived from the account ledger).
  - Every write supports `Idempotency-Key`; the route key includes the sale id
    (`POST /sales/{id}/payments`, `/void`, `PUT /sales/{id}`).
  - Timeouts come from env (`API_TX_TIMEOUT_MS`=20000, `API_TX_MAX_WAIT_MS`=10000,
    `API_LOCK_TIMEOUT_MS`=15000; lock timeout must be below the tx timeout).
- **ONE lock order for the whole sales module** (`acquireLocks` in
  `sales.service.ts`): **sale row → product rows (sorted by id) →
  `stock_balances` (sorted by productId, location) → `account_balances` (sorted
  by accountId, one statement) → customer row.** Locks are taken before any
  check that depends on them, so simultaneous requests cannot overpay a sale,
  void twice or overspend an account. `account_balances` is locked through a
  materialised `FOR UPDATE` CTE; an account with no balance row yet has nothing
  to lock and counts as zero.
- **Statement counts** (application statements inside the transaction, excluding
  BEGIN/COMMIT and without an Idempotency-Key; a key adds 3), measured on the
  test DB: payment **9**, void (paid cash sale, with customer) **16**, amend
  **21**. Not optimised for latency on purpose.
- **Purchases API** (`apps/api/src/modules/purchases`, same pattern and shared
  helpers `lib/tx.ts`, `lib/locks.ts`, `lib/list-helpers.ts`):
  - `POST /purchases` → 201: purchase (RECEIVED, reference `P-YYYYMMDD-nnnnnn`
    from `purchase_reference_seq`; a client reference that looks generated is
    rejected 400), lines, stock movements into the purchase's ONE `location`,
    supplier PURCHASE ledger entry (supplier given), and money paid at receipt:
    supplier → `supplier_payments` + supplier PAYMENT entry + account
    `SUPPLIER_PAYMENT`; no supplier → account `PURCHASE_PAYMENT` keyed on
    `purchaseId`. `averageCostKobo` comes from the shared domain. Credit
    purchases move no money. An account that cannot afford the payment gets the
    friendly 409 (account, balance, amount, "record income or reconcile first").
  - `POST /purchases/:id/payments` → 201 `{ purchase, payment }`: RECEIVED, has a
    supplier, balance due; overpay → 400 with `amountDueKobo`.
  - `POST /purchases/:id/void` → 200 `{ purchase, reversals }`: 409 if already
    voided; 409 while any supplier payment is still live (including one paid at
    receipt);
    friendly 409 "already been sold or moved" (product, on hand, needed) when
    the stock is gone; reverses movements, supplier PURCHASE entry, the
    `PURCHASE_PAYMENT` account entry, and recomputes average cost. A void only
    puts money BACK, so it cannot overdraw an account; a deactivated account
    gets a friendly 409 instead.
  - `PUT /purchases/:id` (amend) → 200 `{ purchase, voidedPurchaseId }`: void +
    new purchase in ONE transaction, audit metadata `amendedFromPurchaseId` /
    `amendedByPurchaseId`.
  - `GET /purchases` (from, to, supplierId, status, unpaid, overdue, q; keyset
    cursor on `(purchasedAt desc, id desc)`) and `GET /purchases/:id` (lines with
    product name, payments with account name and `reversed`, supplier,
    `moneyEntries`). Existing indexes suffice; no index migration.
  - Idempotency route keys: `POST /purchases`, `POST /purchases/{id}/payments`,
    `POST /purchases/{id}/void`, `PUT /purchases/{id}`.
- **Purchase lock order** (`acquireLocks` in `purchases.service.ts`): **purchase
  row → product rows (sorted by id) → `stock_balances` for each product across
  ALL locations (average cost uses total units; sorted by productId, location)
  → `account_balances` (sorted by accountId) → supplier row `FOR SHARE`.**
  Two purchases of one product serialise through the product row, so the
  average cost is never computed from stale stock. Sales order is unchanged
  (sale → products → stock → accounts → customer).
- **Purchase statement counts** (measured, test DB, no Idempotency-Key):
  create credit 1 line **11**, create part-paid 1 line **15**, later payment
  **8**, void **11**, amend **22**.
- **Reverse payment (done).** `POST /sales/{id}/payments/{paymentId}/reverse` and
  `POST /purchases/{id}/payments/{paymentId}/reverse` (body `reason` 1-500 chars,
  optional `reversedAt`; idempotent; one transaction each). A payment is LIVE until
  its original account entry has a reversal row; there is no reversed flag.
  Sale: only later (on-account) payments, on a sale with a customer (walk-in sales
  and up-front payments are corrected by void/amend); writes customer ledger
  reversal, account reversal (money out, friendly overdraw check) and decrements
  `paidKobo`. Purchase: any supplier payment incl. one paid at receipt; supplier
  ledger reversal, account reversal (money back in) and `paidKobo` decrement.
  The reason is stored on the account reversal note (exempted in
  `fn_check_reversal_integrity`) and in the audit log. Void and amend of a
  document work once no live payment remains. Detail endpoints return
  `livePaymentsKobo`. Shared: `reverseSalePayment`, `reversePurchasePayment`,
  `reversedSalePaymentIds`, `reversedSupplierPaymentIds`; `salesSummary` takes an
  optional 8th `reversedSalePayments` set (callers must pass it).
- **Reversal lock orders:** sale reverse = sale → `account_balances` → customer;
  purchase reverse = purchase → `account_balances`. Statement counts: sale
  reverse **11**, purchase reverse **10**.
- **Expense categories and Expenses API.** `expense_categories` is seeded with
  protected system categories and supports user category create, rename,
  deactivate/reactivate and list. `POST /expenses` writes the expense and its
  account outflow together; `POST /expenses/:id/void` appends an exact account
  reversal and requires a reason; `PUT /expenses/:id` voids and recreates in a
  single transaction. `GET /expenses` and `/expenses/summary` exclude voided
  rows by default, split `BOTH` amounts in integer kobo, and default to the
  current Lagos business date.
- **Expense/account API statement counts** (measured in the focused test DB run,
  excluding BEGIN/COMMIT): category create **6** (duplicate **3**), rename
  **4**, deactivate/reactivate **4** each; account create **6** (duplicate **3**),
  opening balance **5**, reconcile **4**, movement **4**, transfer **5**,
  transfer reversal **7**, deactivate/reactivate **5** each; expense create
  **6**, void **9**, amend **19**. These are route counts, not a performance
  guarantee; database/network contention affects wall time.
- **Accounts API.** Routes support create, rename, deactivate/reactivate,
  opening balance, reconcile, manual movement, transfer/reversal, entry
  reversal, and paginated statements. Account balances are the ledger sum with
  a trigger-maintained non-negative cache. Defaults remain Cash on hand and
  Moniepoint. List/statement date bounds are Lagos dates and accept at most
  `API_MAX_DATE_RANGE_DAYS` inclusive days (default 366).
- **Loans API.** `POST /loans`, `POST /loans/:id/charges`,
  `POST /loans/:id/repayments`, `GET /loans`, and `GET /loans/:id` are
  implemented with the shared loans domain (`createLoan`, `addLoanCharge`,
  `recordLoanRepayment`). Loan disbursement writes a positive
  `LOAN_DISBURSEMENT` account entry keyed on `loanId`. Repayment writes one
  negative `LOAN_REPAYMENT` account entry keyed on `loanRepaymentId`; if an
  interest portion exists, one linked `LOAN_INTEREST` expense is created by
  resolving `expense_categories.code = 'LOAN_INTEREST'` (no second account
  entry). `GET /loans` has no "today default"; its default filter is non-paid
  statuses (ACTIVE + OVERDUE), with `status`, `q` and `dueBefore` filters.
- **Stock Transfers API.** `POST /transfers`, `GET /transfers` and
  `GET /transfers/:id` are implemented. Transfer references are generated as
  `T-YYYYMMDD-000123` from `transfer_reference_seq`
  (`20261020000900_transfer_reference_sequence`). There is no void endpoint:
  correction is a new opposite transfer.
- **Stock Adjustments API.** `POST /adjustments`, `POST /adjustments/:id/void`,
  `GET /adjustments`, and `GET /adjustments/:id` are implemented using
  `buildAdjustment`/`voidAdjustment`. Positive adjustments update
  `products.averageCostKobo` from the shared domain result; voiding replays
  reversal movements and recomputes average cost through the same domain.
- **Stock/loan lock order extensions.** Loans lock **loan row → account balances
  (sorted accountId)**. Transfers and adjustments lock **product rows (sorted
  id) → stock balances (sorted productId/location)** before checking balances.
- **Shared list date policy.** `GET /sales` and `GET /purchases` still default
  to today when no filters are supplied, but suppress that default for search
  and debt filters (`unpaid`, `overdue`, `q`, `customerId`, `supplierId`).
  `GET /expenses`, `GET /expenses/summary`, account statements, transfer list,
  and adjustment list stay on today by default unless an explicit range is
  supplied. The max inclusive range remains configurable by
  `API_MAX_DATE_RANGE_DAYS`.
- **Measured statement counts (new endpoints):** loan create **6**, loan charge
  **4**, loan repayment **10**, transfer create **9**, adjustment create **8**,
  adjustment void **10** (test DB, no Idempotency-Key replay path).
- Tests: `apps/api/tests` = 20 files (**186** tests, need the test DB);
  `packages/shared/src/__tests__` = 9 files (**226** tests, no DB). New purchase
  files: `purchases-receive`, `purchases-lifecycle`, `purchases-list`,
  `purchases-concurrency` (10 iterations each: two purchases of one product,
  two payments from an account that can afford one, two voids). The
  "audit-clean" tests in `sales-concurrency.test.ts` ignore `severity: known`
  checks (paid supplier-less purchases are an intended exception).
  Test files run in parallel against Neon; a network drop can still surface as
  a spurious "Can't reach database server" failure, rerun the single test.
- `apps/api` has no sign-in endpoint.
  Loan repayment reversal is intentionally not implemented yet (design ready,
  awaiting owner approval because it loosens expense immutability rules).
  `@fastify/cookie`, `@fastify/cors`, `@fastify/jwt` and
  `@fastify/rate-limit` are installed but not used.
- Auth: **no sign-in endpoint exists.** `AdminUser` + Argon2id hashing + the seed
  script exist; `AdminRole` is explicitly "NOT ENFORCED ANYWHERE YET" — nothing
  reads it. The web app has a client-side demo login only
  (`lib/auth/demo-auth.ts`, `components/auth/auth-guard.tsx`).
- Web still runs on the **typed MOCK API** by default:
  `lib/api/index.ts` selects `*MockApi` unless `NEXT_PUBLIC_API_MODE=real`;
  every `*RealApi` stub throws `"not implemented"`. The mock store persists to
  localStorage key `fabtyna-mock-v1`; `resetDemoData` resets it.
- Latest focused checks in this session: `accounts-gate.test.ts`,
  `loans-api.test.ts`, `stock-operations.test.ts`, and the sales pagination
  case all pass on the test DB; pagination now passes under the default 30 s
  timeout without a timeout override by reducing lock contention in seeding.

## 6b. Known limitations

- **Quantity is a JSON number in the sale DTO** (`quantity: z.number()`), so a
  client could send a value with float noise. The domain rejects more than 4
  decimals or exponents, but a decimal STRING in the DTO would be safer.
  Follow-up in `packages/shared`.
- **Customer type vs sale channel is a UI-only rule** (`sales/new` filters
  customers by `type === channel`). The domain and database do not enforce it,
  and `POST /sales` does not either; decide whether to enforce it.
- **`creditLimitKobo` is not enforced** anywhere.
- Shared fix made with the Sales API: `recordSale` ignored earlier lines of the
  same sale in its stock check (two lines for one product could oversell). It
  now counts them (`takenByEarlierLines`), with a test.
- A sale transaction costs ~12 sequential round trips; over remote Neon that is
  ~3 s. Reducing statements (e.g. one read for customer + account) is a later
  optimisation.
- The API models categories by `expense_categories.id`; the shared mock/domain
  model still uses the fixed `ExpenseCategory` enum. The real web API remains
  stubbed, and mock category management is not yet wired to these routes.
- Shared fix made with the Purchases API: `receivePurchase` ignored earlier lines
  of the same product when computing average cost and returned duplicate
  `productUpdates`. It now keeps running units/averages per product and emits one
  update per product, with a test.
- A purchase has ONE `location` (not per line). `paidAt` of money paid at receipt
  equals `purchasedAt`. Purchase `quantity` is a JSON number (same limitation as
  sales).
- Test hygiene: a test must never leave an account that has entries deactivated
  (db:audit flags it, permanently, because test rows are never deleted).

- A voided document keeps its historical `paidKobo`; reports and money views
  must exclude voided documents. Reversing a payment on a still-live document
  decrements `paidKobo`. Customer/supplier ledger reversals cannot carry the
  reason (same-note rule); the reason lives on the account reversal and audit log.
- db:audit supplier-less rule uses ORIGINAL PURCHASE_PAYMENT entries (not live
  ones) because a void reverses the money but leaves `paidKobo` alone.
- Neon network drops can fail single tests (503/ENOTFOUND); rerun the test.
- `GET /sales` post-filters (`status`, `channel`, `unpaid`, `q`) scan the
  `soldAt` range; add a partial/trigram index if the table grows large.
- The void overdraw pre-check uses the locked `account_balances`; if cash was
  spent after the sale, the sale cannot be voided until income is recorded or
  the account is reconciled (by design).
- `CUSTOMER_REFUND` is still source-backed by `customerRefundId` in the domain
  and DB trigger, while the approved accounts design treats it as source-less.
  Only `OTHER_INCOME` was changed to source-less in this pass; manual customer
  refunds remain unavailable until the owner resolves that mismatch.

## 7. How to work with the owner

- Audit first: explain problems BEFORE fixing them, with file:line references.
- Flag issues you notice in adjacent files, even if out of scope.
- Provide COMPLETE corrected files, not diffs or snippets.
- For any destructive DB action: verification-first (SELECT before UPDATE),
  show the exact command, and ask before running it.
- Never commit and never run `git add` — the owner commits manually. Do not run
  `git clean`/`git reset`.
- Report which files changed; if a file looks unchanged or was overwritten by a
  tool, say so explicitly.

## 8. Corrections made to the draft

1. **Fastify is not in use.** The draft listed `apps/api` as "Fastify"; no
   source file references Fastify and there is no `src/server.ts`/`app.ts`. The
   `dev`/`start` scripts point at files that do not exist. Reworded as "no HTTP
   server yet" and noted the unused dependencies.
2. **"React 19 + Compiler" → React 19 only.** `next.config.ts` sets no
   `reactCompiler` option; the claim is unverifiable, so it was removed. Also
   dropped the "Turbopack" claim (no explicit config) and stated the concrete
   version (Next 16.4).
3. **"real-API stubs exist" corrected.** They exist but every method throws
   `"not implemented"` — made that explicit, plus the `NEXT_PUBLIC_API_MODE`
   switch (default `"mock"`).
4. **`docs/backend-schema.md` claim kept and sharpened** — it documents tables
   (§3) and constraints in plain English (§4), drift audit (§7).
5. **Shared test command corrected** to the real script
   `pnpm --filter @fabtyna/shared test` (the `exec vitest run` form also works).
6. The migration count was **18** when this file was first written on
   2026-10-17; it is now 22 after the 2026-10-19 account migrations and
   account-balance guard correction.
7. Test counts are refreshed in §6 from the latest successful verification
   run (8 API files / 84 tests; 9 shared files / 223 tests).
8. **"which operations exist in apps/api" answered: none** — plus which
   dependencies are installed but unused.
9. **Auth status answered:** no sign-in endpoint; demo-only client login;
   `AdminRole` unenforced.
10. **Web mock API confirmed** and made specific (mode env var, localStorage key
    `fabtyna-mock-v1`, `resetDemoData`).
11. **`db:audit` nuance added:** only `fatal` checks fail the run; `known` checks
    are documented gaps that print INFO (the draft implied any row = failure).
12. **Env var names completed:** draft omitted `TEST_DIRECT_URL`, `PORT`,
    `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and the web `NEXT_PUBLIC_*` names.
    Values are never included.
13. **Test-DB guard made specific** (`resolveTestConnectionString` in
    `apps/api/tests/test-db.ts`, plus the `global-setup.ts` verify step).
14. **"Percentages as integer basis points" confirmed** (was plausible; now
    backed by `scaleByBpsFloor` / `basisPointsSchema`).
15. **Removed the `docs/backend-schema.md`-only framing of migrations** — the
    schema file itself states the migration history is the single source of
    truth, and that there is no `sql-drafts/` folder; reflected that.
16. **Helper/file names pinned:** `createPrismaClient`, `getLagosBusinessDate`,
    `formatNaira`/`parseMoneyInputToKobo`, `stock.service.ts`, exact script
    filenames, and the `apps/api/tests/` (not `src/tests/`) location.
