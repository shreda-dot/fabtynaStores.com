# Fabtyna Stores — AI context (read this first)

Briefing for a new AI session working on this repo with no other history.
Everything below was reviewed against the repository on 2026-10-21. Docs only:
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
  PostgreSQL on Neon, vitest, **Fastify 5** HTTP APIs for sales, purchases,
  products, customers, suppliers, debtors/payables, stock, loans, transfers,
  adjustments, expense categories, expenses, accounts, and empties (see §6).
  - Schema: `apps/api/prisma/schema.prisma`; migrations:
    `apps/api/prisma/migrations/` (**36** migrations); generated client output:
    `apps/api/generated/prisma/` (git-ignored).
  - `src/db/`: `expected-schema.ts`, `verify.ts`, `audit.ts`.
  - `src/lib/`: `env.ts`, `prisma.ts` (`createPrismaClient`), `password.ts`
    (Argon2id, `@node-rs/argon2`), `seed-admin.ts`, `ledger.ts`, `lagos-time.ts`,
    `errors.ts` (error envelope + Postgres error mapping), `retry.ts`,
    `idempotency.ts`.
  - `src/app.ts` (`buildApp`), `src/start.ts` (`startServer`), `src/server.ts`
    (entry), `src/auth/actor.ts` (session actor), `src/auth/session.ts`
    (server-side sessions), `src/auth/auth.routes.ts` (auth endpoints),
    `src/modules/sales/`
    (schemas, validation, repository, service, routes).
  - `src/modules/products/`, `src/modules/parties/`, `src/modules/stock/`,
    `src/modules/expenses/`, `src/modules/accounts/`, `src/modules/empties/`;
    `src/scripts/`: `db-verify.ts`,
    `db-audit.ts`, `seed-admin.ts`, `hash-password.ts`.
  - Tests: `apps/api/tests/*.test.ts` + `global-setup.ts` + `test-db.ts` +
    `sales-fixtures.ts`.
- `docs/` — `backend-schema.md` (full table + constraint inventory),
  `FABTYNA_PLAN.md`, `phase5-schema-draft.prisma`. Also `.trae/documents/*.md`.

## 3. Commands that actually exist

Root (`package.json`):
- `pnpm verify` = `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @fabtyna/web build:verify`
  (`build:verify` runs `next build` with PLACEHOLDER `NEXT_PUBLIC_API_MODE=real` and
  `NEXT_PUBLIC_API_BASE_URL` so the production-build guard passes; its output is never deployed)
- `pnpm typecheck` = `pnpm -r typecheck`; `pnpm test` = `pnpm -r test`
  (runs shared tests, then API tests — the API suite needs a test DB, §4)
- `pnpm dev` / `pnpm build` / `pnpm lint` target `@fabtyna/web` only.

API (`pnpm --filter @fabtyna/api …`):
- `db:verify` → `tsx src/scripts/db-verify.ts`. Defaults to `DIRECT_URL`; accepts
  `-- --url TEST_DIRECT_URL` (an env-var name, or a literal URL).
- `db:audit` → `tsx src/scripts/db-audit.ts` (same `--url` handling).
- `db:whoami`, `db:migrate:deploy` (needs `--confirm-db <name>`).
- `db:seed:admin` → `tsx src/scripts/seed-admin.ts`, needs `-- --confirm-db <name>`; flag `--additional`.
- `hash-password` → `tsx src/scripts/hash-password.ts` (interactive, no args).
- `test` (vitest run), `typecheck`, `build`, `prisma:format`, `prisma:validate`.
- `build` → `node scripts/build.mjs`: runs `prisma generate` (placeholder `DIRECT_URL`
  if unset) then bundles `src/server.ts` with esbuild into `dist/server.js` (ESM, node20;
  `@fabtyna/shared` is bundled, every other dependency stays external and must be installed).
  `start` → `node dist/server.js`. Proven from a clean copy with a frozen,
  production-only install (see `docs/DEPLOY.md`). `engines.node` is `>=20.19.0 <21`; `.node-version` is 20.19.6.
- `dev` (tsx) runs `src/server.ts`.

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
- `HOST` (default `127.0.0.1`; must be explicit in production),
  `TRUST_PROXY` (Fastify proxy trust).
- `WEB_ORIGIN` (exact browser origin required for CORS and write-request CSRF
  checks), optional `COOKIE_DOMAIN`.
- `SESSION_IDLE_TIMEOUT_HOURS` (default 12) and
  `SESSION_ABSOLUTE_TIMEOUT_DAYS` (default 7).
- `TEST_DATABASE_URL` / `TEST_DIRECT_URL` — the test suite only.
- `PORT` (API, default 3001); `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (admin seed).
- Web (`apps/web`, names only): `NEXT_PUBLIC_API_MODE` (default `"mock"`),
  `NEXT_PUBLIC_API_BASE_URL` (real API origin),
  `NEXT_PUBLIC_API_READ_TIMEOUT_MS`, `NEXT_PUBLIC_API_TX_TIMEOUT_MS`,
  `NEXT_PUBLIC_API_TX_MAX_WAIT_MS`, `NEXT_PUBLIC_API_LOCK_TIMEOUT_MS`,
  `NEXT_PUBLIC_API_TIMEOUT_MS` (legacy mock-wrapper timeout),
  `NEXT_PUBLIC_MOCK_LATENCY_MS`, `NEXT_PUBLIC_MOCK_FAILURE_RATE`.
- Set the API process timezone to `TZ=UTC` in production for consistent
  handling of timestamp-without-time-zone database columns. Business dates
  remain explicit Lagos `YYYY-MM-DD` values.

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
- **Empties** (phase 1: counts only) are owned by an `empties_owner` (a
  user-managed list seeded with International Breweries, Nigerian Breweries and
  Guinness Nigeria; deactivate, never delete) and typed by an `empties_type`
  (BOTTLE|CRATE, unique per owner+kind+label, optional display-only
  `unitValueKobo`). A **count is a plain integer**, not money. `empties_movements`
  is immutable and append-only (OPENING / RECEIVED / RETURNED_TO_OWNER /
  ADJUSTMENT; quantity signed and never zero; an ADJUSTMENT needs a note), and
  `empties_balances` is DERIVED — an AFTER INSERT trigger is its only writer and
  `trg_empties_balances_guard` rejects anything else. Corrections are reversal
  rows (`reversesEntryId`, exact negation, one reversal per entry, a reversal
  cannot itself be reversed). `ux_empties_movement_opening_active` allows at most
  one OPENING per type **for the life of the type**: the original row is
  immutable, so reversing it never frees the slot — later corrections go through
  an ADJUSTMENT, exactly like `ux_account_ledger_opening_balance_active`.
  Out of scope for phase 1: empties customers owe, empties on sale/purchase
  screens, and deposits in cash reports.

## 6. Current status (verified)

- Migrations: **37** (listed in `expected-schema.ts` → `EXPECTED_MIGRATIONS`).
  The newest four are empties tracking (phase 1, counts only):
  `20261024000000_empties` adds `empties_owners`, `empties_types`, the
  append-only `empties_movements`, the derived `empties_balances`, three couples
  of immutability/guard triggers and two partial indexes; and
  `20261024000100_empties_index_names` is a renames-only repair of five
  index/constraint names the first migration wrote unquoted (PostgreSQL folds an
  unquoted identifier to lower case, so the database kept
  `empties_owners_normalizedkey_key` where Prisma records
  `empties_owners_normalizedKey_key`). An applied migration is never edited, so
  the correction is a rename migration — the same repair
  `20261020000700_expense_category_index_names` made for
  `expense_categories`/`expenses`.
  `20261024000200_reversal_integrity_note_fix` is a function-only repair: the
  empties migration rewrote the shared `fn_check_reversal_integrity` to add the
  empties magnitude column but, quoting the wrong revision as its source, it
  silently dropped the `account_ledger_entries` `note` exemption
  `20261020000400_reverse_payment_guards` had added — so every payment reversal
  failed with `P0001` / `409`. The fix restores the branch and changes no
  object.
  The four before them add dynamic expense categories, make `OTHER_INCOME`
  source-less, correct the category-index names, and make ordinary expense
  details immutable with a single void transition.
  The 2026-10-19 account migrations add account entry enum values, account
  ledger sources/balances/transfers/guards, default accounts, and a corrective
  account-balance guard/cache migration. The dev and test databases contain the
  default Cash on hand and Moniepoint accounts unless an operator has since
  changed them. Migration `20261020001000_admin_sessions` adds the
  `admin_sessions` table; both databases have this migration after successful
  final verification. Migration `20261020001100_idempotency_actor_scope` is
  also applied to dev and test; it preserves prior NULL-actor claims and scopes
  new claims to the authenticated admin.
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
- **Read-only reports API (5B initial slice).** The API exposes
  `GET /reports/sales-summary`, `/dashboard`, `/product-sales`, `/money-flow`,
  and `/financial-position`. Supposed revenue is the total on non-voided sales
  by `soldAt`; gotten revenue is live `sale_payments` by `paidAt`, with
  reversed payments excluded rather than reassigned to the reversal date.
  Money Flow is ledger-dated, so a payment reversal appears as an outflow on
  its own date. Current position uses account balances and ledger-derived
  receivables/payables/loans plus current stock; cash snapshots are not read.
  MARKET stock is included with retail/shelf units, and loose warehouse units
  are valued pro rata. The dashboard compares today with yesterday and reports
  stock worth as of now.
- Report reads are covered by `apps/api/tests/reports.test.ts`. Measured
  statement counts with non-empty test data: sales summary **6**, dashboard
  **7**, product sales **1**, Money Flow **5** (or **6** when expense-category
  details are fetched), and financial position **6**. In the latest focused
  shared-test-DB run, representative returned-row totals were **58**, **2,934**,
  **14**, **10**, and **3,607**; these include accumulated test data and are
  not per-customer guarantees. The same run's request elapsed times were about
  **1.1 s**, **2.5 s**, **0.3 s**, **1.8 s**, and **2.3 s**. EXPLAIN ANALYZE
  scanned/aggregated **2,845** current products; product-sales, current-stock,
  financial-position stock, and ledger-receivables query times were respectively
  **0.59 ms**, **5.87 ms**, **3.31 ms**, and **0.48 ms**
  (database plan time, not HTTP latency). No index was added.
- Tests: the current API/shared test counts are listed in the second-batch
  bullet below; the older 122 API / 224 shared counts are historical.
  `db:verify` also checks `sale_reference_seq`, `purchase_reference_seq`,
  `transfer_reference_seq`, and the `idempotency_keys`
  indexes (`EXPECTED_SEQUENCES`, `EXPECTED_INDEXES`).
- Latest `pnpm verify` attempt: workspace typecheck passed; web lint completed
  with 0 errors and 5 warnings; shared tests passed **231/231** and web tests
  passed **10/10**. The API suite did not pass (**54 passed, 5 failed, 176
  skipped** across 27 files); the run encountered test-database DNS and
  connection errors, and the legal sale-amend test returned 500 instead of
  200 during that run. The command stopped at API tests before its build step;
  a separate `pnpm --filter @fabtyna/web build` completed successfully.
  Do not treat this as a verified full-suite pass.
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
- **Idempotency**: optional `Idempotency-Key` header (8–128 chars), claimed in
  the write transaction. New claims are unique by `(key, route, actorId)`, so
  separate admins can independently use the same key and route; same-admin
  retries replay only that admin's response (`Idempotent-Replayed: true`).
  Same actor/key/route with a different body returns 422
  `IDEMPOTENCY_MISMATCH`. Pre-migration rows remain NULL-actor legacy claims:
  a request using that key/route gets a 409 without replaying the stored
  response until the row expires. Rows expire after **24 h**; an unref'd hourly
  cleanup deletes expired rows in batches. Drain old API instances that still
  create NULL-actor claims before deploying this version.
- **Authentication and route protection.** API authentication uses
  server-side `admin_sessions`, not JWT. A 32-byte random token is sent only in
  an HttpOnly cookie; the database stores its SHA-256 hash. Sessions have a
  sliding 12-hour idle expiry and 7-day absolute expiry, are checked against
  `adminUsers.isActive` on every request, and are cleaned hourly after 30 days
  past expiry. Writes require an exact `Origin === WEB_ORIGIN`; CORS allows
  credentials and exposes `Idempotent-Replayed` and `Retry-After`. Only
  `GET /health` and `POST /auth/login` are public. Login, logout, current-user,
  and password-change routes are implemented; password changes revoke other
  sessions and rotate the current session. `createdById` and audit actors come
  from the authenticated session. `AdminRole` intentionally remains
  unenforced.
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
- **5A catalogue and stock APIs.** `GET/POST /products`, `GET/PATCH
  /products/:id`, and product deactivate/reactivate routes are implemented.
  Active SKU uniqueness is enforced by the database partial unique index and
  checked before writes; pack size is immutable after a stock movement.
  `GET /customers` and `/suppliers` support text, active/inactive, balance and
  cursor filters; create, patch, deactivate/reactivate, detail, and ledger
  statement endpoints are available for both parties. `GET /debtors` reports
  ledger-derived balances with unpaid-sale aging; `GET /payables` reports
  supplier-ledger balances and overdue purchases. `GET /stock` and
  `/stock/low` read current balances, pack splits and stock values. No schema
  or migration change was needed.
- **5A read statement counts** (one request, fixed statements; no N+1):
  products list **1**, product detail **3**, stock list with totals **2**,
  low-stock **1**, customer list **1**, supplier list **1**, customer detail
  **4**, supplier detail **4**, customer statement **2**, supplier statement
  **2**, debtors **1**, payables **1**. Product/party lists use keyset cursors;
  stock and debt lists aggregate in SQL. Dates in customer aging are computed
  using Lagos business dates.
- **5A focused tests:** `apps/api/tests/parties-inventory.test.ts` covers
  active SKU uniqueness/reactivation, pack-size immutability, product stock and
  location-specific low-stock reads, loose-unit wholesale valuation,
  customer/supplier ledger-backed statements, debtor/payable list balances
  (including overdue purchase balances), and customer/supplier profile reads.
  API tests run with Vitest `fileParallelism: false` against the direct test
  database.
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
- **Idempotency statement counts:** when a key is supplied, a new claim adds
  **3** SQL statements; a successful same-actor replay adds **4**. Requests
  without an idempotency key are unchanged.
- **Measured statement counts (new endpoints):** loan create **6**, loan charge
  **4**, loan repayment **10**, transfer create **9**, adjustment create **8**,
  adjustment void **10**, sale payment reversal **11**, purchase payment
  reversal **10** (test DB, no Idempotency-Key replay path).
- Tests: `apps/api/tests` = 27 files (**235** tests); shared tests =
  9 files (**231** tests). New purchase files:
  `purchases-receive`, `purchases-lifecycle`, `purchases-list`,
  `purchases-concurrency` (10 iterations each: two purchases of one product,
  two payments from an account that can afford one, two voids). The
  "audit-clean" tests in `sales-concurrency.test.ts` ignore `severity: known`
  checks (paid supplier-less purchases are an intended exception). API tests
  run with `fileParallelism: false` against the direct Neon test endpoint.
- **Most recent full verification (before actor-scoped idempotency):**
  `pnpm verify` ran once. Typecheck and lint passed; shared tests passed
  (231/231). The API suite ran 26 files: 227 passed and 5 failed out of 232.
  Three tests exceeded the existing 30-second timeout
  (`loans-api.test.ts`, `parties-inventory.test.ts`, `stock-operations.test.ts`);
  two purchase concurrency tests received 500/503 instead of the expected
  success/conflict pair. The earliest API failure logged `Connection
  terminated unexpectedly`, followed by PostgreSQL lock timeout `55P03`; a
  purchase void transaction also exceeded its existing 20-second transaction
  timeout. API suite duration was about **51m 32s**. `pnpm verify` stopped at
  tests, so its build stage did not run. No timeouts were raised. The focused
  actor-scoped idempotency tests subsequently passed **3/3**; the full suite
  was not rerun.
- The final focused auth run passed **9/9** tests. The combined sales/purchase
  run passed **88**, skipped **1** and failed setup for `purchases-list` when
  DNS could not resolve the Neon host (`ENOTFOUND`); the later full run passed
  that list test.
- After migration 33 and the focused idempotency test run, `db:verify` passed
  all **33** migrations and expected objects on both `fabtyna_dev` and
  `fabtyna_test`; both object lists matched. `db:audit` returned **0 rows** on
  each database. The standing Prisma drift check printed
  `-- This is an empty migration.` and passed.
- After the empties migrations (37 total), `db:verify --url DIRECT_URL` and
  `--url TEST_DIRECT_URL` each passed: **37** migrations and **37** file
  checksums, 11/11 tables, 61/61 CHECK constraints, 76/76 triggers, 34/34
  partial indexes, 10/10 foreign keys, 3/3 sequences, **13/13 indexes**.
  `db:audit` returned **PASS — no drift detected** on both databases, including
  the three new empties checks (`empties_balances = Σ empties_movements.quantity`,
  `empties movement: original + reversal = 0`, `at most one live OPENING per
  empties type`), each at **0 rows**.
- Loan repayment reversal remains unimplemented: a mistaken repayment cannot
  yet be corrected through the UI. Until a reversal operation is built, payment
  forms should require a clear confirmation of the repayment amount, account,
  and date. Any future correction must append reversal ledger rows and adjust
  the repayment/document state atomically; never edit an applied repayment or
  its LOAN_INTEREST reporting expense in place.
- `@fastify/cookie`, `@fastify/cors`, and `@fastify/rate-limit` are used;
  `@fastify/jwt` remains installed but unused.
- The web API mode defaults to the typed MOCK API and preserves the demo flow.
  In `NEXT_PUBLIC_API_MODE=real`, products, customers, suppliers, stock
  inventory/low-stock, debtors, payables, and authentication use the real API.
  The shared HTTP client uses credentials, typed API errors and idempotency
  keys; remaining real business API modules still report that they are not
  connected and do not fall back to mocks. The mock store persists to
  localStorage key `fabtyna-mock-v1`; `resetDemoData` resets it.
- The real stock page explicitly reports that movement history is unavailable
  in the current API; mock mode retains its existing movement history. Product
  detail uses the API's recent product-movement data.
- The real HTTP client uses a 10-second default read timeout and a
  121,240-millisecond default write timeout: four API attempt budgets
  (transaction max-wait plus transaction/lock duration), three maximum retry
  backoffs, and a 1-second margin. Writes are not auto-retried; an uncertain
  write retains its idempotency key for a deliberate retry. GETs retry once on
  a network error.
- Authentication pages and boundaries are connected: real login, logout,
  current-session checks, and change-password are available. The admin
  `AuthGuard` checks `GET /auth/me`; there is no web middleware. The API is the
  security boundary. Unauthorized API responses clear the query cache and send
  the browser to login.
- The 5B report endpoints are API-only so far. The real web report client has
  not been connected; the mock client currently implements sales summary only.
- Auth sessions are covered in `auth-sessions.test.ts`; the verified outcomes
  are recorded above.

## 6a. Web integration status (7A to 7C)

Switch: `NEXT_PUBLIC_API_MODE` (`mock` default, or `real`) and
`NEXT_PUBLIC_API_BASE_URL`. In real mode a module without a real adapter shows
"Not connected to the real API yet" and never falls back to mock. Query keys
include the mode.

| Module | Real mode |
|---|---|
| Auth, products, customers, suppliers, stock, debtors, payables (7A) | Connected |
| Sales: list, detail, new, add/reverse payment, void, amend (7B) | Connected |
| Purchases: list, detail, new, supplier payment/reverse, void, amend (7B) | Connected |
| Accounts, paginated statements, expenses/categories, stock transfers, stock adjustments (7C Parts 1–4) | Connected |
| Loans: list, detail, create, charge, repayment (7C Part 5) | Connected (web checks run; no browser click-through yet) |
| Reports: sales summary, dashboard, product sales, money flow, financial position (7D) | Connected (web checks run; no browser click-through yet) |
| Reports, money flow, dashboard (7D) | Not connected |

Mapping notes (7A and 7B):
- `lib/api/client.ts` is the only HTTP module. Read timeout 10 s; write timeout
  121,240 ms (longer than the API transaction timeout plus lock waits and
  retries). GETs retry once on network error; writes are never auto-retried.
  A timed-out or network-failed write is UNKNOWN, not failed. 401 emits
  `fabtyna:unauthorized`; 429 surfaces Retry-After; 5xx text is never shown.
- Writes use `lib/write-flow.ts` and `hooks/use-write-flow.ts`
  (idle -> pending -> success | failed | unknown) on top of
  `idempotency-intent.ts`. The same key is kept after unknown ("Retry safely");
  a new key follows success or a form edit. Used by sales, purchases and the
  payables payment.
- Create bodies carry a single paid amount plus `accountId`
  (sales `paidKobo`, purchases `amountPaidNowKobo`). Client references that look
  generated (`^[SP]-\d{8}-\d{6,}$`) are rejected; the amend body ignores a
  reference and the server issues a new one (result has `voidedSaleId` /
  voided purchase id; the web redirects with `?replaced=`).
- Quantity is a JSON number with at most 4 decimals; PACK lines must resolve to
  whole base units. The web keeps the user's text and converts after exact
  validation.
- Previews use shared exports `parseQuantityText`, `computeSaleLineTotalKobo`,
  and `quantityToWholeUnits` (scaled-bigint half-up). Sale totals match the
  server domain; purchase totals are computed by the web but the purchase API
  stores the submitted total without independently recomputing it (see 0b).
- Overdraw arrives as 409 BUSINESS_RULE with details
  `{accountId, accountName, balanceKobo, amountKobo}`. Void of a purchase is
  blocked while any supplier payment is live (including one paid at receipt).
  Any purchase payment can be reversed; sale payment reversal applies only to
  later on-account payments on a sale with a customer.
- `GET /accounts` returns `balanceKobo`, which the shared `AccountDto` type
  lacks. The real adapter exposes it through `AccountRecordDto`; mock-only
  account note/update fields are mapped only for compatibility.
- Query keys: an `useInfiniteQuery` must never share a key with a `useQuery`
  (data shapes differ; TypeScript cannot detect it). Infinite lists for
  products, customers and suppliers use `queryKeys.X.pages(...)`.

### 7C contract mapping (Parts 1–4)

All routes require the authenticated admin session. Validation failures use
`400 VALIDATION` with `details` containing Zod issues or a `{field, ...}`
object; missing rows are `404 NOT_FOUND`; business-rule rejections are
`409 BUSINESS_RULE` with safe details; duplicate category keys are
`409 CONFLICT` with the constraint name. Writes accept an `Idempotency-Key`.
`MAPPABLE` means the web preserves the API response/request semantics while
adapting an existing shared/mock DTO shape; no row below is blocked.

| API route | Request | Response | Errors/details used by web | Web type / status |
|---|---|---|---|---|
| `GET /accounts?includeInactive` | query boolean | account rows include `balanceKobo` | `400 VALIDATION` issues | `AccountRecordDto[]` / MAPPABLE (API omits mock-only `note` and `updatedAt`, mapped to null and `createdAt`) |
| `POST /accounts` | `{name,type}` | account row | `400 VALIDATION` issues | `CreateAccountDto` → `AccountRecordDto` / MAPPABLE (mock-only note hidden in real mode) |
| `PATCH /accounts/:id` | `{name}` | account row | `400 VALIDATION`; `404 NOT_FOUND` `{accountId}` | `UpdateAccountDto` → `AccountRecordDto` / MAPPABLE (note hidden in real mode) |
| `POST /accounts/:id/deactivate` / `reactivate` | empty body | account row | `404 NOT_FOUND`; `409 BUSINESS_RULE` for non-zero balance | `AccountRecordDto` / MAPPABLE (no reason body; UI shows API error) |
| `POST /accounts/:id/opening-balance` | `{amountKobo,occurredAt?,note?}` | ledger entry | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` if already opened | `CreateOpeningBalanceDto` → `AccountLedgerEntryDto` / MAPPABLE |
| `POST /accounts/:id/reconcile` | `{countedAmountKobo,reason,occurredAt?}` | ledger entry | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` for no-op/invalid count | Shared `deltaKobo` DTO mapped once to a fixed counted-amount body / MAPPABLE |
| `POST /accounts/:id/movements` | `{type,amountKobo,note?,occurredAt?}` | ledger entry | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` with `{accountId}` and an account/balance/amount-specific message on overdraw | `AccountLedgerEntryDto` / MAPPABLE |
| `GET /accounts/:id/statement` | `{from?,to?,limit?,cursor?}` | account, dates, opening/closing balances, entries with running balances, next cursor | `400 VALIDATION` (including date range); `404 NOT_FOUND` | `AccountStatementPageDto` / MATCH |
| `POST /account-transfers` | `{fromAccountId,toAccountId,amountKobo,note?,occurredAt?}` | `{id}` | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` on overdraw | `CreateAccountTransferDto` → `{id}` / MATCH |
| `POST /account-transfers/:id/reverse` | `{reason}` (1–500 chars) | reversal result | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` if already reversed or reversal would overdraw | `reverseTransfer(id,reason,key)` / MATCH |
| `POST /account-entries/:id/reverse` | `{reason}` (1–500 chars) | reversal ledger entry | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` unless a reversible manual movement | `AccountLedgerEntryDto` / MATCH |
| `GET /expense-categories?includeInactive` | query boolean | category rows | `400 VALIDATION` issues | `ExpenseCategoryDto[]` / MATCH |
| `POST /expense-categories` | `{name}` | category row | `400 VALIDATION`; duplicate normalized name is `409 CONFLICT` with `expense_categories_normalizedKey_key` | `ExpenseCategoryDto` / MATCH |
| `PATCH /expense-categories/:id` | `{name}` | category row | `400 VALIDATION` for invalid/missing category; `409 BUSINESS_RULE` for protected system categories; duplicate name conflict | `ExpenseCategoryDto` / MATCH |
| `POST /expense-categories/:id/deactivate` / `reactivate` | empty body | category row | `400 VALIDATION` if missing; `409 BUSINESS_RULE` for protected/system or already-active-state rules | `ExpenseCategoryDto` / MATCH |
| `GET /expenses` | Lagos date/category/channel/account/search/void filters + cursor/limit | `{items,nextCursor,from,to}` | `400 VALIDATION` issues and date cap | `ExpenseListPageDto` (array helper fetches all cursors) / MAPPABLE |
| `GET /expenses/summary` | Lagos date/category/channel/account filters | summary with string kobo totals | `400 VALIDATION` issues and date cap | `ExpenseSummaryDto` / MATCH |
| `POST /expenses` | `{categoryId,channel,description,amountKobo,expenseDate,accountId}` | expense row | `400 VALIDATION`; `409 BUSINESS_RULE` with `{accountId}` and an account/balance/amount-specific message on overdraw or inactive category | `CreateExpenseInput` → `ExpenseRecordDto` / MATCH |
| `POST /expenses/:id/void` | `{reason}` | voided expense row | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` if already voided or system-managed loan interest | `ExpenseRecordDto` / MATCH |
| `PUT /expenses/:id` | same create body | `{expense,voidedExpenseId}` | create/void errors plus `404 NOT_FOUND` | `ExpenseAmendResultDto` / MATCH |
| `GET /transfers` | date/location/search/cursor/limit | `{items,nextCursor}` | `400 VALIDATION` issues and date cap | `StockTransferDto[]` (adapter fetches all cursors) / MAPPABLE |
| `GET /transfers/:id` | id | transfer, lines, legs, movements | `400 VALIDATION`; `404 NOT_FOUND` | `TransferDetailDto` / MATCH |
| `POST /transfers` | `{from,to,reason?,transferredAt?,lines:[{productId,quantityUnits}]}`; no `reference` | `{id}` | `400 VALIDATION` (including unknown product); `409 BUSINESS_RULE` for inactive product; `409 INSUFFICIENT_STOCK` `{productId,productName,location,availableUnits,requestedUnits}` | `CreateTransferDto` mapped without mock-only `reference`, then detail fetch / MAPPABLE |
| `GET /adjustments` | date/location/status/search/cursor/limit | `{items,nextCursor}` | `400 VALIDATION` issues and date cap | `StockAdjustmentDto[]` (adapter fetches all cursors) / MAPPABLE |
| `GET /adjustments/:id` | id | adjustment, lines, movements | `400 VALIDATION`; `404 NOT_FOUND` | `AdjustmentDetailDto` / MATCH |
| `POST /adjustments` | `{reason,adjustedAt?,lines:[{productId,location,quantityDeltaUnits,unitCostKobo?,reason?}]}` | `{id}` | `400 VALIDATION` (including unknown product); `409 BUSINESS_RULE` for inactive product; `409 INSUFFICIENT_STOCK` for a negative adjustment beyond stock | `CreateAdjustmentDto` then detail fetch / MAPPABLE |
| `POST /adjustments/:id/void` | empty body | void result | `404 NOT_FOUND`; `409 BUSINESS_RULE` if already voided or reversal is no longer possible | `void(id,key)` then detail fetch / MAPPABLE |
| `GET /empties/owners?includeInactive` | query boolean | owner rows with `typeCount`/`activeTypeCount` | `400 VALIDATION` issues | `EmptiesOwnerDto[]` / MATCH |
| `POST /empties/owners` | `{name}` | owner row | `400 VALIDATION`; duplicate normalized name is `409 CONFLICT` with `empties_owners_normalizedKey_key` | `CreateEmptiesOwnerInput` → `EmptiesOwnerDto` / MATCH |
| `PATCH /empties/owners/:id` | `{name}` | owner row | `400 VALIDATION`; `404 NOT_FOUND`; duplicate-name conflict | `EmptiesOwnerDto` / MATCH |
| `POST /empties/owners/:id/deactivate` / `reactivate` | empty body | owner row | `404 NOT_FOUND`; `409 BUSINESS_RULE` if already in that state or the owner still has active types | `EmptiesOwnerDto` / MATCH |
| `GET /empties/types?includeInactive&ownerId` | query | type rows with owner name | `400 VALIDATION` issues | `EmptiesTypeDto[]` / MATCH |
| `POST /empties/types` | `{ownerId,kind,label,unitValueKobo?}` | type row | `400 VALIDATION`; `404 NOT_FOUND` owner; duplicate owner+kind+label is `409 CONFLICT` with `empties_types_owner_kind_label_key` | `CreateEmptiesTypeInput` → `EmptiesTypeDto` / MATCH |
| `PATCH /empties/types/:id` | `{label?,unitValueKobo?}` (at least one) | type row | `400 VALIDATION`; `404 NOT_FOUND`; duplicate-label conflict | `PatchEmptiesTypeInput` → `EmptiesTypeDto` / MATCH |
| `POST /empties/types/:id/deactivate` / `reactivate` | empty body | type row | `404 NOT_FOUND`; `409 BUSINESS_RULE` if already in that state or the type has a non-zero on-hand count | `EmptiesTypeDto` / MATCH |
| `GET /empties/balances?includeInactive` | query boolean | `{items,totalsByOwner,totalsByKind}` with integer counts and string kobo values | `400 VALIDATION` issues | `EmptiesBalancesDto` / MATCH |
| `POST /empties/movements` | `{typeId,movementType,quantity,note?,occurredAt?}`; the count is POSITIVE and the server applies the sign for a return; an ADJUSTMENT carries its own non-zero sign and needs a note | movement row | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` `Only N … on hand`; `409 CONFLICT` on `ux_empties_movement_opening_active` for a second opening | `CreateEmptiesMovementInput` → `EmptiesMovementDto` / MATCH |
| `GET /empties/movements?from&to&typeId&ownerId&limit&cursor` | Lagos dates + keyset cursor | `{items,nextCursor,from,to}` | `400 VALIDATION` issues, date cap, `from > to` | `EmptiesMovementListPage` / MATCH |
| `POST /empties/movements/:id/reverse` | `{reason}` (1–500 chars) | reversal movement row | `400 VALIDATION`; `404 NOT_FOUND`; `409 BUSINESS_RULE` if already reversed or the target is itself a reversal | `EmptiesMovementDto` / MATCH |

Additional 7C notes:
- The web uses `useInfiniteQuery` for account statements and displays the API
  running balances; `GET /accounts` supplies authoritative balances. Statement
  range-cap validation remains server-enforced.
- `AccountDto` has mock-only note/update fields not returned by the account API;
  real-mode note inputs are hidden. The account API does **not** enforce unique
  account names, so the web prevents duplicates in its account form but cannot
  guarantee this against simultaneous requests.
- Expense category IDs are dynamic API IDs in real mode. `LOAN_INTEREST` is
  excluded from manual choices. Expense amendment uses `PUT` and reports the
  voided original ID; it never edits the original expense.
- The transfer create endpoint is strict and does not accept a caller-supplied
  reference. The real form hides the mock-only field; the API-generated
  reference is shown in detail.
- Stock transfers have no void route. Detail explicitly instructs owners to
  make an opposite transfer to correct one.
- Reports, dashboard, position, money flow and manual cash-snapshot UI remain
  unconnected (7D).

### 7C Part 5 loan contract mapping

| Route | Request | Response | Web mapping | Status |
|---|---|---|---|---|
| `POST /loans` | lenderName, principalKobo, agreedInterestKobo, disbursedAt, dueDate, note (key required), accountId (service requires it) | `{id, lenderName, principalKobo, agreedInterestKobo, disbursedAt, dueDate, note}` | Adapter refetches `GET /loans/:id` to build `LoanDetailDto`; `createdAt` filled from `disbursedAt` | MAPPABLE |
| `POST /loans/:id/charges` | amountKobo, reason, occurredAt | `{id, loanId, type, amountKobo, note, occurredAt}` | Refetch detail | MAPPABLE |
| `POST /loans/:id/repayments` | amountKobo, interestPortionKobo, paidAt, note?, accountId | `{id, loanId, amountKobo, interestPortionKobo, paidAt, note, accountId}` | Refetch detail; the saved row is returned as `savedRepayment` and shown | MAPPABLE |
| `GET /loans` | status (ACTIVE/PAID/OVERDUE), q, dueBefore, limit, cursor | `{items, nextCursor}`; items have `totalToRepayKobo`, no note/agreedInterest/createdAt | `totalToRepayKobo` -> `totalRepayableKobo`; list DTO makes the three missing fields optional | MAPPABLE |
| `GET /loans/:id` | - | `{summary, ledgerEntries, charges, repayments}` | `loanId` filled on ledger/repayments; repayments carry accountName and reversed | MAPPABLE |

Loan rules for the web:
- The interest portion is sent by the client (`interestPortionKobo`); the
  shared `recordLoanRepayment` only validates `0 <= interest <= amount`. The
  browser does not calculate it: the form posts what the owner typed and shows
  the API's saved amount and interest after saving.
- One account outflow of the full amount; the LOAN_INTEREST expense is created
  by the domain with no account entry of its own.
- The API has no repayment reversal. The form and confirmation say so plainly.
- Default list (no status) is ACTIVE + OVERDUE; PAID needs the filter.
- The linked LOAN_INTEREST expense comes from the API: `GET /loans/:id`
  returns `repayments[].linkedExpense` (`{id, amountKobo, categoryCode}` or
  null), and `GET /expenses` / `/expenses/summary` now LEFT JOIN account
  entries, so interest rows are listed with `systemManaged: true`,
  `accountId`/`accountName` null, `categoryCode`, `loanRepaymentId`. The web
  labels them "Automatic" with no void or amend. (Fixed in the LOAN_INTEREST
  visibility task; the earlier "derived in the UI" workaround is removed.)
- Friendly messages added for "exceeds the outstanding balance" (naira) and
  "already fully repaid".

Report definitions: LOAN_INTEREST is an EXPENSE (counts in expense totals,
category breakdowns and net profit) and NEVER cash. The full repayment is the
only account outflow, so account balances, Money Flow and financial-position
cash do not count interest a second time. Sales summary/dashboard read
`expenses` directly (no join to account entries) and already included it; Money
Flow reads expenses only through account entries, so it correctly excludes it.

7C Part 5 web checks: typecheck PASS; lint 0 errors / 3 warnings (old files);
web Vitest 33/33; production build PASS. API and shared tests not run (no
changes there).

Gate 0 evidence for 7C:
- 0a: `parseQuantityText`, `quantityToWholeUnits`, and
  `computeSaleLineTotalKobo` were the owner's approved shared exports;
  `recordSale` calls the shared line-total function. The new test compares
  12,000 deterministic generated quantity/price cases (including 3,000 exact
  half cases) against a test-only copy of the prior formula, plus the
  `592.05 × 50,769,390` hand-check. Shared tests passed 243/243.
- 0a API focused tests: the first serial run failed (5 failed, 35 passed,
  18 skipped); after the owner's request to rerun, the five requested files
  passed 58/58: `sales-post`, `sales-lifecycle`, `sales-http`,
  `purchases-receive`, `purchases-lifecycle`. This is not a full API suite.
- 0b: `592.05 × 50,769,390 = 30,058,017,349.5` kobo, rounded half-up to
  `30,058,017,350`. The purchase API does not recompute that total: it accepts
  and stores `lineTotalKobo` supplied by the client (after validation). The
  web uses the shared function, but the server's rounding cannot be compared
  because it has no independent calculation; this remains a server trust-boundary
  limitation, not a claim of API/domain parity.
- 0d: `lib/query-keys.test.ts` guards representative list, infinite-pages and
  detail key shapes; 1/1 passed in its focused run.
- 0e: no `Number()` conversion of kobo remains in sales detail. Sales new/edit
  use `Number()` only to convert validated stock-unit quantities. Accounting
  overview bars convert an already-bounded bigint percentage (0–100) to a UI
  number, not a kobo amount; no exact kobo conversion was needed.

7C web checks: typecheck PASS; lint PASS with 0 errors / 3 warnings (all in
untouched files: products detail, stock mock, stock real); web Vitest PASS
31/31; production build PASS. The separate test-runner discovery call found no
tests, so the actual result is from `pnpm --filter @fabtyna/web test`.

### 7D reports (web)

Hand-checkable DEV scenario (ZZTEST names; records are immutable, so use
clearly named data and only the DEV database). Amounts in naira. Account
"ZZTEST Bank" opened with 100,000.
1. Product ZZTEST Cola, cost 600/unit, retail 1,000/unit, stock 100.
2. Retail sale A, 10 units = 10,000, paid in full into ZZTEST Bank.
3. Retail sale B, 5 units = 5,000, part payment 2,000 (debt 3,000); a later
   payment of 1,000 (debt 2,000).
4. Retail sale C, 2 units = 2,000, paid, then voided (excluded everywhere).
5. Retail sale D, 4 units = 4,000, paid 4,000, then the payment is reversed.
6. Expense 1,001 split BOTH (odd amount; the channel split rule is the API's).
7. Credit purchase 20,000 from ZZTEST Supplier (moves no money).
8. Loan 90,000 with agreed interest 10,000; a repayment of 25,000 with 4,000
   interest.
Expected for the sale day (cash basis): gotten = 10,000 + 2,000 + 1,000 = 13,000
(sale D's reversed payment is excluded by the sales summary); COGS follows cash
received. The loan interest 4,000 is an expense for profit and never cash.
Bank closing = 100,000 + 10,000 + 2,000 + 1,000 + 4,000 - 4,000 (reversal)
- 1,001 expense - 25,000 repayment = 86,999 (interest is NOT a second outflow).

Where reports must agree: dashboard vs sales summary (same day: revenue gotten,
expenses, net profit); money-flow closing vs the account balance; financial
position cash vs the sum of account balances; receivables vs the debtors total;
payables vs the payables list total.
Where they legitimately differ: sales summary gotten 13,000 vs money-flow
cash received from sales 13,000 only when no reversal falls in the range; with
sale D reversed on a later day, money flow shows +4,000 on day one and -4,000
on the reversal day.

Click-through (DEV only): create account and opening balance; enter the
scenario above; open Reports > Sales summary, Product sales, Money flow;
Dashboard (pick the date); Accounting (position, assumptions 87.5 and 100.01
which must be rejected). Press Refresh after writes (reports cache 60 s). Then
run `pnpm --filter @fabtyna/api db:audit` on dev: expect zero rows.

### Expenses upgrade (web only; API and shared untouched)

- `/expenses`: Lagos date range (presets Today, Yesterday, This week from
  Monday, This month, Last 30 days; 366 inclusive days; no future dates),
  filters (category incl. inactive, channel, debounced text search, Show
  voided, default on), all kept in the URL (`from`, `to`, `categoryId`,
  `channel`, `q`, `voided=0`, `view`). Summary block from
  `GET /expenses/summary`; by-category table sorted by amount; click a row to
  filter the list. Loan interest is labelled "Automatic" by looking up the
  category code in the categories list (the summary has no `code`).
- List uses `useInfiniteQuery` on `expensesApi.listPage` (50 per page, "Load
  more"); pages merge without duplicate ids. Keys: `queryKeys.expenses.list`,
  `pages`, `summary`, `categories(includeInactive)`.
- `/expenses/categories`: search, active/inactive filter, "Show 20 more"
  (client side), create, inline rename, deactivate, reactivate; system
  categories read-only with a badge; single-line Input. After a category write
  expenses, categories and report keys are invalidated.
- `/expenses/new`: active, non-LOAN_INTEREST categories sorted by name with a
  search box once there are more than 8. Amend prefill date fixed: the list
  now passes `getLagosBusinessDate(new Date(e.expenseDate))` (it used to pass
  `formatLagosDate`, i.e. `dd/mm/yyyy`); the form also ignores a prefill that
  is not `YYYY-MM-DD`.
- Logic lives in `lib/expense-filters.ts` (tests in `expense-filters.test.ts`);
  exact query strings are `listQuery` / `summaryQuery` in `expenses.real.ts`
  (tests in `expenses.real.test.ts`).
- Dev/build isolation: `pnpm --filter @fabtyna/web build:verify` now builds
  into `apps/web/.next-verify` (env `NEXT_DIST_DIR`, git-ignored) so it can no
  longer corrupt a running `next dev` that uses `.next`. Run builds that
  could clash with dev only through `build:verify`.
- Local URLs: use `http://localhost:3000` (web) and `http://localhost:3001`
  (API) consistently; `WEB_ORIGIN` and `NEXT_PUBLIC_API_BASE_URL` must use the
  same host name as the browser address or cookies and CORS fail.

### Empties (phase 1; counts only; real mode only)

- Nav entry "Empties" → `/empties`; owner/type management at `/empties/types`.
- `/empties` (mobile first): one `StatCard` per owner plus one per kind
  ("X on hand"), a "Balances by type" table with the count and the optional
  display value from `unitValueKobo`, four write buttons per row
  (Opening count, Received from customers, Returned to brewery, Adjustment),
  a "Reverse" action on each history row, and a history list with the shared
  `DateRangeFilter` (default list range), `useInfiniteQuery` (`PAGE_SIZE` 50,
  "Load more") and a per-row Reverse panel.
- Whole numbers only: the quantity field is parsed by
  `parseEmptiesQuantityText` (`lib/empties-quantity.ts`, tested in
  `empties-quantity.test.ts`). A rejected write shows the API message as-is, so
  an over-return surfaces the server's `Only N … on hand`.
- `/empties/types`: create/rename/deactivate/reactivate owners, and
  create/patch/deactivate/reactivate types. The API rejects deactivating an
  owner that still has active types, or a type with a non-zero count.
- Mock mode (`isMockApiMode`) renders "Not available with demo data" instead of
  the panels.
- Query keys live under `queryKeys.empties` (`lib/query-keys.ts`):
  `owners(includeInactive)`, `types(includeInactive, ownerId)`,
  `balances(includeInactive)`, `movements(filters)` (plain `useQuery`) and
  `pages(filters)` (infinite) are deliberately separate — an infinite key must
  never be shared with a `useQuery` key.
- Exact query strings are built by `ownersQuery` / `typesQuery` /
  `balancesQuery` / `movementsQuery` in `lib/api/empties.real.ts` (tests in
  `empties.real.test.ts`).

### Form draft protection (web only)

- Purpose: an accidental refresh must not wipe a long form. Files:
  `lib/form-draft.ts` (pure storage helpers, tested), `hooks/use-form-draft.ts`,
  `components/draft-banner.tsx`.
- Storage is `sessionStorage` (survives refresh, dies with the tab). Key
  `fabtyna:draft:<userId>:<form>`; `AuthGuard` sets the user id after
  `authApi.me()`. Envelope has a version stamp (`DRAFT_VERSION`; mismatch or
  corrupt JSON is deleted) and `savedAt`. TTL is 2 hours (`DRAFT_TTL_MS`);
  expired drafts are deleted on load.
- Autosave is debounced 500 ms, only while the form is dirty, never while a
  restore choice is pending. A returning user sees a Restore / Discard banner;
  nothing is auto-filled. A `beforeunload` warning shows while dirty.
- Cleared on successful save, on Cancel (expense), on Discard, and for every
  user on logout (`top-bar.tsx`). A 401 expiry keeps drafts so the same user
  gets them back after signing in.
- Forms covered: purchase new (`purchase-new`), purchase edit
  (`purchase-edit:<id>`), sale new (`sale-new`), sale edit (`sale-edit:<id>`),
  expense new (`expense-new`, not when amending, not in mock mode), loan new
  (`loan-new`, not in mock mode). Edit forms count as dirty only when they
  differ from the server values. Not covered: transfers, adjustments, other
  small dialogs.
- Restored line ids are regenerated (`<uid>-r<i>`) because `useId` repeats
  after reload. A restored supplier/product/customer that no longer exists is
  caught by the normal submit validation, not at restore time.
- Money in drafts stays kobo strings; no bigint is stored.

## 6b. Known limitations

- Form drafts are per browser tab (sessionStorage) and best-effort: a closed
  tab, private-mode storage failure or a draft older than 2 hours is lost.
  Drafts are not validated against server data at restore time.
- Expenses summary has no per-channel totals. Without a channel filter a BOTH
  expense counts in full; the "Retail share" / "Wholesale share" views re-call
  the summary with `channel`, which makes the server split BOTH. Filtering the
  summary by account drops LOAN_INTEREST rows (no ledger entry); the page does
  not offer that filter. The summary ignores the category, search and voided
  filters (range only).
- Expense category search and "Show 20 more" are client side because
  `GET /expense-categories` returns an unpaged array. The older
  `expensesApi.list` still loops all pages (unbounded) and is no longer used
  by the expenses page.
- Mock mode: text search and the categories page are "Not available with demo
  data"; the demo list and summary (including the share views) keep working.
- Web sales/purchases: no kobo amount is converted through `Number()`.
  Remaining numeric conversions are validated stock-unit quantities and
  bounded 0–100 accounting percentage-bar values.
- Real mode reports (7D) are connected: sales summary, dashboard, product
  sales, money flow and financial position. Mock mode implements the sales
  summary only; dashboard keeps its local computation, product sales shows
  "not available with demo data".
- Mock/shared money-flow totals INCLUDE transfers; the API's totals EXCLUDE
  them (transfers are returned separately). The web labels both
  ("Totals exclude transfers" / "Demo totals include transfers"); packages/shared
  was not changed.
- Money flow dates a payment reversal on its own day, while the sales summary
  excludes a reversed payment entirely, so cash received can differ between
  the two reports for a period containing a reversal (the web shows a note).
- Money flow and the other reports are marked stale after every successful write
  (see above); only plain tab switching uses the 60 s staleTime. Writes made from
  another device/tab are not seen until the Refresh button or the staleTime expires.
- Old mock data with a paid balance but no payment rows shows no cash received.
- Report real-mode fixtures from a live API were NOT recorded (dev API not
  reachable during the 7D build); tests use hand-built API-shaped fixtures.
- Loan repayment reversal does not exist: a mistaken repayment cannot be
  corrected, and its linked LOAN_INTEREST expense cannot be voided or amended.
  Both guard messages say so ("...created automatically by a repayment and
  cannot be voided/amended. Loan repayment reversal is not available yet.").
- Average cost on purchase void or amend recomputes from the already-rounded
  unit cost, so it can differ by 1 kobo from the receive result. A later fix
  should recompute from the stored `lineTotalKobo`, with a differential test.
- Loan list totals in the web cards cover only the loaded rows (keyset pages);
  the cards now say so.
- Connection-level database errors (ENOTFOUND, EAI_AGAIN, ECONNRESET, ECONNREFUSED,
  ETIMEDOUT, "Connection terminated unexpectedly", "timeout expired", plus Prisma/PG
  codes P2028, P1001, P1017, 55P03, 40P01, 40001) map to 503 UNAVAILABLE with
  `Retry-After: 2` (`lib/errors.ts` `isConnectionError`). A write that fails this way
  rolls back together with its idempotency key, so retrying with the same key is safe
  (proved in `tests/connection-errors-http.test.ts`).
- Logs redact cookie/authorization request headers, `set-cookie` response headers and
  body fields `password`, `currentPassword`, `newPassword`, `passwordHash`
  (`lib/logging.ts`, `tests/log-redaction.test.ts`). `TRUST_PROXY` is configurable.
- Production requires an effective timezone of UTC (`lib/timezone.ts`, checked in
  `server.ts`; the process refuses to start otherwise). Measured on the test DB:
  idempotency `expiresAt` is stored in UTC whatever `TZ` is and cleanup fires correctly,
  so this is a consistency rule, not a bug fix.
- The web `next build` FAILS unless `NEXT_PUBLIC_API_MODE=real` and a valid
  `NEXT_PUBLIC_API_BASE_URL` are set (`next.config.ts`); `lib/api/index.ts` also throws
  at runtime in a production build that is not real mode. `next dev` is unaffected, mock mode still works.
- Every successful write marks report and account-balance queries stale
  (`lib/invalidate-after-write.ts`, `lib/create-query-client.ts` mutation safety net;
  explicit calls on direct-call write flows). The 60 s report staleTime still applies to tab switches.
- Empty-database `prisma migrate deploy` has NOT been verified (the local test server
  login failed and the owner chose to skip it). `db:migrate:deploy` against the existing
  test database reported "No pending migrations". To verify once: run it on the first fresh database.
- Dev records are immutable and cannot be deleted; use clearly named test data.
- Database SSL: one helper, `apps/api/src/lib/ssl.ts` (`resolveSslConfig`), is
  used by `db/verify.ts`, `db/audit.ts` and `lib/prisma.ts`; `tests/test-db.ts`
  calls it to fail early. Default is SSL ON; `sslmode` in the URL is applied by
  node-postgres on top (so `verify-full` stays strict). `sslmode=disable` is
  honoured ONLY for localhost, 127.0.0.1 or ::1; any other host throws an error
  that never contains the URL or host. Many test files still pass their own
  `ssl: { rejectUnauthorized: false }` (they only connect to the Neon direct test URL).
- Test database targets: `TEST_DIRECT_URL` (hosted, direct) is what the tests,
  `global-setup.ts` (drift check before every run) and `db:verify`/`db:audit`
  must use: `pnpm db:verify -- --url TEST_DIRECT_URL`. `TEST_DATABASE_URL` is a
  local server without SSL; to target it add `?sslmode=disable` to that URL.
  Last results (dev and test, direct URLs): db:verify PASS, db:audit PASS.
- `db:verify` / `db:audit` print only the database NAME and a class label
  (`dev`, `test` or `prod`, decided by the name: contains "test" is test,
  contains "dev" is dev, anything else is prod). They never print the host.
- Database URL variables (never commit values):
  | Variable | What it is | Read by |
  |---|---|---|
  | `DATABASE_URL` | pooled URL; the API does NOT use it; no script defaults to it any more | only when named explicitly: `--url DATABASE_URL` |
  | `DIRECT_URL` | direct URL; the API runtime and migrations use it | API (`env.ts`, `prisma.ts`), `prisma.config.ts`; DEFAULT for `db:verify`, `db:audit`, `db:seed:admin`, `db:migrate:deploy`, `db:whoami` when `--url` is omitted |
  | `TEST_DIRECT_URL` | direct URL of the hosted test database | tests, `global-setup.ts` drift check |
  | `TEST_DATABASE_URL` | local server URL; the tests do not use it when `TEST_DIRECT_URL` is set | `assertNotATestDatabase` in `db:seed:admin`; `--url TEST_DATABASE_URL` |
  `--url` takes a variable NAME or a literal URL. Use `--url DIRECT_URL` to be explicit.
- `db:whoami` (read-only) prints only the database name and class.
  `db:seed:admin` and `db:migrate:deploy` REFUSE unless `--confirm-db <name>`
  equals the name the server reports (`current_database()`); shared helper:
  `apps/api/src/lib/db-target.ts` (unit-tested without a database).
- The void message for LOAN_INTEREST expenses and the amend message now use the
  same wording (see Known limitations).
- Account names are NOT unique on the server: `POST /accounts` and
  `PATCH /accounts/:id` do not check names and `accounts` has no unique name
  constraint. The web form checks existing names only, so two simultaneous
  requests (or another client) can create duplicates. Later fix: a transactional
  name check (or a normalised-name unique index) in a new API migration.
- Purchase average cost has a 1-kobo rounding divergence: on receive the
  weighted average uses the invoice `lineTotalKobo`
  (`operations.ts` `receivePurchase`), but a void/amend recompute replays stock
  movements with `quantityUnits × unitCostKobo` (`stock.ts`
  `recomputeAverageCostKobo`), where `unitCostKobo = roundHalfUp(lineTotalKobo,
  quantityUnits)` is already rounded. Example (units 1 @ 50, then 3 units for a
  100-kobo line): receive gives 38, recompute gives 37. Reported to the owner;
  not changed.
- The purchase API stores the client-supplied `lineTotalKobo` and derives
  `unitCostKobo` itself; it never recomputes a line total from quantity ×
  price, so "server rounding parity" with the web preview is not a server rule.

### 4A / 4B backend coverage snapshot

| Area | Implemented API surface | Focused integration coverage |
|---|---|---|
| 4A sales and customer debt | Sales create, later payments, void/amend, list/detail | `sales-post.test.ts`, `sales-lifecycle.test.ts`, `sales-http.test.ts`, `sales-concurrency.test.ts`, `sales-concurrency-writes.test.ts`, `payment-reversal.test.ts` |
| 4A purchases and supplier payables | Purchase receive, later payments, void/amend, list/detail | `purchases-receive.test.ts`, `purchases-lifecycle.test.ts`, `purchases-list.test.ts`, `purchases-concurrency.test.ts`, `payment-reversal.test.ts` |
| 4A accounts and expenses | Account management, statements, opening balance, reconciliation, transfers, expense create/void/amend | `accounts-gate.test.ts`, `accounts-expenses-api.test.ts`, `account-balances.test.ts`, `account-ledger-source-types.test.ts` |
| 4B loans | Loan, charge, repayment, list/detail; interest is reporting-only and does not add another account outflow | `loans-api.test.ts`, `reversal-positive.test.ts` |
| 4B transfers and adjustments | Transfer create/read; adjustment create/read/void with stock and average-cost reversal | `stock-operations.test.ts`, `stock-balances.test.ts` |

This is test-file coverage, not a claim that every business-facing web API is
connected: only the web modules listed in §6 are wired to real endpoints.
Real stock movement history is not available yet. Loan repayment reversal is
the known operation gap above. Login throttling is in-memory and
process-local; use a shared rate-limit store before scaling the API horizontally.
Actor-scoped idempotency is deployed to dev and test. Pre-migration NULL-actor
claims intentionally conflict (without response replay) until they expire.
The old global unique index has been replaced by legacy-scope and actor-scope
partial unique indexes; old API instances must be drained before this version
is deployed so they cannot create new NULL-actor claims.

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
- `salesSummary` intentionally does not infer cash receipt dates from a
  document's current `paidKobo`; it needs the immutable payment history. This
  avoids assigning a later payment or a payment from outside the selected
  period to the original sale date. Legacy mock records with a paid balance but
  no `salePayments` history therefore contribute no dated cash receipt.

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
