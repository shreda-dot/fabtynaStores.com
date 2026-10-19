# Fabtyna Stores — AI context (read this first)

Briefing for a new AI session working on this repo with no other history.
Everything below was reviewed against the repository on 2026-10-19. Docs only:
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
  PostgreSQL on Neon, vitest. **No HTTP server exists yet** (see §6).
  - Schema: `apps/api/prisma/schema.prisma`; migrations:
    `apps/api/prisma/migrations/` (**21** migrations); generated client output:
    `apps/api/generated/prisma/` (git-ignored).
  - `src/db/`: `expected-schema.ts`, `verify.ts`, `audit.ts`.
  - `src/lib/`: `env.ts`, `prisma.ts` (`createPrismaClient`), `password.ts`
    (Argon2id, `@node-rs/argon2`), `seed-admin.ts`, `ledger.ts`, `lagos-time.ts`.
  - `src/modules/stock/stock.service.ts`; `src/scripts/`: `db-verify.ts`,
    `db-audit.ts`, `seed-admin.ts`, `hash-password.ts`.
  - Tests: `apps/api/tests/*.test.ts` + `global-setup.ts` + `test-db.ts`.
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
- `dev`/`start` scripts point at `src/server.ts` / `dist/server.js`, which do
  not exist yet — do not assume an HTTP server is runnable.

Shared: `pnpm --filter @fabtyna/shared test` (vitest run) and `typecheck`.
(`pnpm --filter @fabtyna/shared exec vitest run` also works, but the script is
`test`.)

## 4. Databases, env variables (names only), secrets

Neon Postgres. The committed `apps/api/.env.example` uses two databases named
`fabtyna_dev` and `fabtyna_test`; real values live in git-ignored `.env`.

Variable NAMES (never values):
- `DATABASE_URL` — pooled Neon endpoint, used by the runtime client.
- `DIRECT_URL` — direct (unpooled) endpoint, used by schema/migration commands
  via `apps/api/prisma.config.ts`.
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

## 5. Non-negotiable rules

- **Money** is integer **kobo**: `BIGINT` in the DB, integer **strings** in DTOs,
  `bigint` only for arithmetic. Never floats. Percentages are integer **basis
  points** (`scaleByBpsFloor`, `basisPointsSchema`, max 10000).
- **Business dates** are Lagos `YYYY-MM-DD` strings via `getLagosBusinessDate()`
  (`Africa/Lagos`), stored as `String` so they cannot shift by timezone.
- **Immutable** tables (append-only): all ledgers (`customer_ledger_entries`,
  `supplier_ledger_entries`, `account_ledger_entries`, `loan_ledger_entries`),
  `stock_movements`, `sale_payments`, `supplier_payments`,
  `loan_repayments`, `cash_snapshots`, and `audit_logs`. Expenses are not
  blanket-immutable in the database: loan-repayment interest expenses cannot
  be edited/deleted, and category plus `loanRepaymentId` cannot change on any
  expense. Ordinary expenses use the app's void-with-reason workflow; the DB
  enforces the void fields as a pair, but does not itself make every ordinary
  expense field immutable.
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
- A sale with an on-account payment cannot be voided (`trg_sale_void_guard`).
  An unpaid sale requires a customer; an unpaid purchase requires a supplier.

## 6. Current status (verified)

- Migrations: **22** (listed in `expected-schema.ts` → `EXPECTED_MIGRATIONS`).
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
- Known purchase limitation: a purchase with a supplier payment remains
  non-voidable/non-amendable. Reversing supplier payments (and later sale
  payments) is a separate feature. The current sale-void database guard also
  blocks a sale with on-account customer ledger payments.
- Tests: `apps/api/tests` = 8 files (84 passed in the latest `pnpm verify`,
  need the test DB); `packages/shared/src/__tests__` = 9 files (223 passed,
  no DB).
- `apps/api` implements no operations/HTTP routes yet: only the Prisma schema,
  the DB tooling (`db:verify`/`db:audit`), admin seeding, password hashing, and
  `modules/stock/stock.service.ts`. Fastify, `@fastify/cookie`, `@fastify/cors`,
  `@fastify/jwt`, `@fastify/rate-limit` and `pg` are installed but not referenced
  by any source file.
- Auth: **no sign-in endpoint exists.** `AdminUser` + Argon2id hashing + the seed
  script exist; `AdminRole` is explicitly "NOT ENFORCED ANYWHERE YET" — nothing
  reads it. The web app has a client-side demo login only
  (`lib/auth/demo-auth.ts`, `components/auth/auth-guard.tsx`).
- Web still runs on the **typed MOCK API** by default:
  `lib/api/index.ts` selects `*MockApi` unless `NEXT_PUBLIC_API_MODE=real`;
  every `*RealApi` stub throws `"not implemented"`. The mock store persists to
  localStorage key `fabtyna-mock-v1`; `resetDemoData` resets it.
- `pnpm verify` passed on 2026-10-19. `db:verify` passed on `fabtyna_dev` and
  `fabtyna_test`; `db:audit` returned zero rows on both databases on two
  consecutive runs. The account-balance concurrency regression passes 20
  competing-spend races on the test database; it exposed and verified the
  corrective trigger migration before this status was refreshed.

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
