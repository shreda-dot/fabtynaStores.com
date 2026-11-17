# Deploying Fabtyna Stores

Generic steps. They do not assume anything about a live setup: use section 9 to check that an
existing deployment matches. Never put a secret in this file, in git, or in a local `.env` that
points at production. Production secrets live only on the hosts.

## 1. Shape of the system

- **API** (`apps/api`): Fastify + Prisma + PostgreSQL (Neon). Runs as a Node 20 process from a bundle.
- **Web** (`apps/web`): Next.js. Built with `NEXT_PUBLIC_*` values inlined, so they are BUILD-time.
- **Database**: one Neon project; the API connects with the DIRECT (non-pooler) URL.
- Cookie is `SameSite=Lax`, so the web and API hosts must be on the same site (same registrable
  domain, e.g. `app.example.com` and `api.example.com`).

## 2. Recommended API host

A Linux x64 glibc container, e.g. `node:20-bookworm-slim` (Node 20.19.x; `.node-version` and
`engines.node` say so). `pnpm-lock.yaml` includes native Argon2 binaries for: linux x64 and arm64
(glibc and musl), linux arm-gnueabihf, darwin x64/arm64, win32 x64/ia32/arm64, freebsd x64, android.
So Alpine (musl) and arm64 hosts also work, but glibc x64 is the one that was reasoned about first.

## 3. Environment variables (NAMES only)

### API (set on the API host)

| Name | Required | When | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | run | `production` |
| `DIRECT_URL` | yes | run (and build, only as a placeholder) | direct Postgres URL; the API runtime uses it. Secret |
| `DATABASE_URL` | no | – | pooled URL; not used by the API |
| `HOST` | yes in production | run | e.g. `0.0.0.0` |
| `PORT` | no (3001) | run | |
| `WEB_ORIGIN` | yes | run | exact web origin, `https://…`, no trailing path. CSRF check compares `Origin` to it |
| `COOKIE_DOMAIN` | no | run | leave unset for a host-only `__Host-` cookie; set only if web and API are different subdomains and you accept the broader cookie |
| `TRUST_PROXY` | yes behind a proxy/load balancer | run | `true`/`false`. If wrong behind a proxy, all users share one IP and the login rate limit (100 per 15 min per IP) trips for everyone |
| `TZ` | recommended | run | must resolve to `UTC`; the API refuses to start in production otherwise |
| `DB_POOL_MAX` | no (10, range 1–10) | run | |
| `SESSION_IDLE_TIMEOUT_HOURS` | no (12) | run | |
| `SESSION_ABSOLUTE_TIMEOUT_DAYS` | no (7) | run | |
| `RESEND_API_KEY` | no | run | Resend API key that sends the password-reset email. Set it together with `MAIL_FROM` or leave both empty: with both empty the API still starts, logs a warning, and "forgot password" answers 503 (no other endpoint is affected). Secret |
| `MAIL_FROM` | no | run | verified Resend sender, `no-reply@example.com` or `Fabtyna Stores <no-reply@example.com>`. Must be a domain verified in Resend or the send is rejected |
| `API_TX_TIMEOUT_MS`, `API_TX_MAX_WAIT_MS`, `API_LOCK_TIMEOUT_MS` | no | run | transaction/lock limits |
| `API_MAX_DATE_RANGE_DAYS` | no (366) | run | report date-range cap |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | only for `db:seed:admin` | operator machine, one-off | hash from `hash-password`; never the plain password |

### Web (set on the web host BEFORE building)

| Name | Required | When | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_MODE` | yes | BUILD | must be `real`; `next build` fails otherwise |
| `NEXT_PUBLIC_API_BASE_URL` | yes | BUILD | the API's public origin; must be a valid URL |
| `NEXT_PUBLIC_API_TIMEOUT_MS`, `NEXT_PUBLIC_API_READ_TIMEOUT_MS`, `NEXT_PUBLIC_API_TX_TIMEOUT_MS`, `NEXT_PUBLIC_API_TX_MAX_WAIT_MS`, `NEXT_PUBLIC_API_LOCK_TIMEOUT_MS` | no | BUILD | client timeouts |
| `NEXT_PUBLIC_MOCK_LATENCY_MS`, `NEXT_PUBLIC_MOCK_FAILURE_RATE` | no | BUILD | demo mode only; leave unset |

If you change any `NEXT_PUBLIC_*` value you must rebuild the web app.

### Database URL variables on an operator machine

`DIRECT_URL` is the default for `db:verify`, `db:audit`, `db:seed:admin`, `db:migrate:deploy` and
`db:whoami` when `--url` is omitted. `TEST_DIRECT_URL` is used by the tests. `DATABASE_URL` is
unused. See `docs/AI_CONTEXT.md` for the full table. Point a shell at production by exporting
`DIRECT_URL` for that session only; do not store it in a file.

## 4. Build and start the API (clean checkout, Linux)

```
pnpm install --frozen-lockfile
pnpm --filter @fabtyna/api build      # runs prisma generate (git-ignored client) and bundles to dist/server.js
pnpm install --frozen-lockfile --prod --filter "@fabtyna/api..."   # optional: slim runtime install
node apps/api/dist/server.js          # or: pnpm --filter @fabtyna/api start
```

`@fabtyna/shared` is bundled; every other dependency stays external and must be installed at runtime
(`argon2`, `@prisma/client`, `fastify`, `pg`, `zod`, …). The `prisma` CLI and `esbuild` are dev
dependencies: build on a machine with dev dependencies, then ship `dist/` plus a production install.
`prisma generate` and `prisma migrate deploy` need `DIRECT_URL` (the build supplies a placeholder when
unset, only to generate the client).

Proof so far (local Windows, not Linux): clean copy without `node_modules` → frozen install → build →
production-only install → start against a TEST-class database → `/health` 200, `/products` without a
cookie 401, wrong Origin 403, login 204 with `HttpOnly; Secure; SameSite=Lax` cookie, authenticated
`GET /products` 200, logout 204. The generated Prisma client and its query compiler work inside the bundle.
A Linux run has NOT been done: repeat it on the real host (section 8).

## 5. Order of operations

1. **Create the production database** (Neon). Note its name; it must not contain `test` or `dev`.
2. Export `DIRECT_URL` for the production database in your shell only. Run `pnpm --filter @fabtyna/api db:whoami`; it prints name and class (`prod` for any name without `test`/`dev`).
3. `pnpm --filter @fabtyna/api db:migrate:deploy -- --confirm-db <exact name>`. It refuses unless the name matches the connected database. Expect all migrations applied (the migration count equals `apps/api/prisma/migrations`).
4. `pnpm --filter @fabtyna/api db:verify` and `db:audit`. `db:verify` must PASS, `db:audit` must return zero rows.
5. Create the first admin: `pnpm --filter @fabtyna/api db:seed:admin -- --confirm-db <name>` (needs `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` for that session).
6. Set the API host variables (section 3) and start the API. Check `GET /health` is 200.
7. Set the web variables and build the web app (`next build`; it fails if the real-mode variables are missing). Deploy it.
8. Set DNS (web and API on the same site) and TLS.
9. Run the smoke test (section 10).

## 6. Deploying a new version

1. Take a backup/branch first (section 7).
2. For schema changes such as `20261103000000_empties_customer_deposits`, create a named Neon rehearsal branch from the backup and rehearse the migration and verification there first. Do not point rehearsal commands at production. Set `DIRECT_URL` to the rehearsal branch in the operator shell, then use:
   `pnpm --filter @fabtyna/api db:migrate:deploy -- --confirm-db <exact rehearsal database name> --url DIRECT_URL`
3. On the rehearsal branch, run `pnpm --filter @fabtyna/api db:verify -- --url DIRECT_URL` and `pnpm --filter @fabtyna/api db:audit -- --url DIRECT_URL`. Verification must pass and the audit must return zero fatal rows. Run the required API behavior tests against the test database as well; object-existence checks alone do not prove trigger behavior.
4. Before production migration, inspect the installed `fn_check_reversal_integrity` body and confirm that it still contains the `account_ledger_entries` rule, including the `note` exemption. `db:verify` checks function existence, not function-body behavior. The customer-empties and crate-deposit migrations must use their own new functions and must not replace this shared function. The deposit migration creates the system holding account lazily on first use, so no data step is needed. The web app hides that account from all account lists; deploy the API first so the new `isHolding` field exists before the web app reads it.
5. After rehearsal is accepted and any required affected-write pause is in
   place (see the cutover below), point `DIRECT_URL` at production and apply
   migrations only with `pnpm --filter @fabtyna/api db:migrate:deploy -- --confirm-db <exact production database name>`. The command refuses a mismatched database name. Run `db:verify` and `db:audit` with an explicit `--url` for the same target; verification must pass and the audit must return zero fatal rows.
6. Deploy the API first and wait for `/health` to pass. Then rebuild and deploy the web app that consumes the new API contract.
7. For backward-compatible migrations, keep the old API running until the new
   version is healthy. For migrations that reject old writes, including
   purchase-linked empties, pause the affected writes and drain or block old
   API instances before migrating; follow the cutover below.

### Earlier purchase-linked empties rollout (historical)

The purchase-only instructions from the earlier rollout are superseded for the
size-class cutover below. The purchase and sale-linked migrations were already
exercised on dev/test in prior work. The three size-class migrations were later
applied to dev and test with `prisma migrate deploy`; audits passed on both.
Each verifier found all expected objects but failed on 24 existing checksum
differences, each matching its file's CRLF form. The newly applied migrations
matched exactly. The reset was not run on either database.

The remote purchase-latency measurement from that earlier work was about
8.45 seconds median for a 10-line purchase with the purchase-empties feature,
versus about 4.29 seconds baseline. The supplier-debt UI pagination limitation
is still documented in [AI_CONTEXT.md](./AI_CONTEXT.md).

### Approved size-class rollout (owner-run; production not touched)

Production was not accessed for Stage 5. The size-class migration/reset/API
rehearsal was performed only on the two owner-provided Neon branches:

- Rehearsal A and B both use database name `fabtyna_prod`; their endpoint hosts
  were `ep-snowy-mountain-b95rq0fg-pooler.c-7.eu-central-1.aws.neon.tech` and
  `ep-square-brook-b93l8k90-pooler.c-7.eu-central-1.aws.neon.tech`; both differed
  from production. The current production endpoint verified from the owner's
  environment was `ep-silent-credit-b9sphcni.c-7.eu-central-1.aws.neon.tech`.
- A's reset ran before migrations; B's reset ran after migrations. Both reset
  runs inserted six adjustment movements and audit rows, the second run was a
  no-op, and both left the legacy brewery balances at zero.
- The read-only copy checks found the expected 27 active products and an active
  admin on both branches. The actual pre-reset legacy balances were Guinness
  55 bottles / 3 crates, International Breweries 78 / 9, and Nigerian
  Breweries 40 / 6; the example bottle counts 39 / 61 / 28 were not the copy's
  values.
- The four migrations deployed on each rehearsal branch were
  `20261113000000_purchase_empties`,
  `20261116010000_empties_size_classes`,
  `20261117000000_size_class_mode`, and
  `20261117000100_size_class_purchase_rules`. The parked
  `20261116000000_retail_sale_bottle_snapshots` migration was not applied and
  is not part of this rollout.
- B's API rehearsal configured seven size classes and 27 product records
  (24 bottle products mapped using the default owner/units-per-pack mapping,
  three can products with no bottle mapping). Those are rehearsal defaults,
  not owner-confirmed production mappings.
- The rehearsal preserved the existing product-owner assignments, including
  `Trophy Stout` under Guinness. Can exclusion used the product name (`can`);
  both assumptions need owner confirmation before production setup.
- The synthetic seven-line opening count was: Guinness 12 = 1 crate + 4
  bottles; Guinness 24 = 2 + 5; International Breweries 12 = 5 + 3 and 20 =
  2 + 4; Nigerian Breweries 12 = 4 + 6, 20 = 3 + 7, and 24 = 1 + 11.
- A 12-bottle Trophy retail sale moved International Breweries 12 empties from
  5 crates to 6 crates while preserving the total at 123 crates + 4 bottles.
  The recount after that sale recorded 6 empty crates + 3 loose bottles. The
  void reversed the sale. Transfers and a 12-unit pack break preserved totals;
  a half-pack wholesale sale converted six units to six empties and preserved
  totals. With 69 empties available, a six-crate purchase returned 60 bottles,
  recorded 12 bottles owed, and increased the total from 1,480 to 1,492
  bottles (one net 12-bottle crate).
- The first B `db:audit` exposed an audit-query bug: it expected the old
  unrounded return quantity. `apps/api/src/db/audit.ts` now uses whole-capacity
  rounding for sized types and retains the old rule for NULL-capacity types.
  Re-running `db:audit` on A and B after that code fix returned zero offending
  rows.
- `db:verify` on both branches found all migration/schema objects, but its
  overall result remains FAIL because 23 already-applied files have
  line-ending-only checksum differences. Each stored hash equals the CRLF
  hash, not the current LF hash; all four newly applied migrations match
  exactly. `prisma migrate deploy` on A emitted no modified-migration warning
  or error. Do not repair `_prisma_migrations` or applied migration files.
- A later owner-created pre-reset restore branch was compared with a new
  rehearsal branch created from it. Their legacy balances and product lists
  matched, the restore branch had no reset marker or feature migrations, and
  the pre-migration `main` audit returned zero offending rows. Its verifier
  found all historical objects but still failed on 23 old checksums. No
  point-in-time restore or application repoint was exercised.

The recommended production order is migrations, reset, API/web deploy, product
mapping confirmation, then the manual count. Reaching `READY` enables the
purchase shortage check; there is no separate application switch. B
validated reset after migrations; A also validated the alternate reset-before-
migrations order. Prefer B's order so the new constraints/triggers are active
for the audited adjustments. Keep the external write pause across all steps.

#### Production sequence

Only the owner/operator runs these commands against production. The assistant
must not connect to production or run the reset there.

**Prepare before the pause**

- Confirm an owner-created backup/PITR restore point and test restoring it to a
  separate branch. This restore test is still outstanding.
- Review each product's brewery and bottle size in rehearsal and prepare the
  accepted mapping list. The defaults use the current product owner and
  `unitsPerPack`; do not assume every mapping has been owner-confirmed. Can
  products have no bottle mapping. Production confirmation happens after the
  new setup screen is deployed.
- Prepare the paper count for every brewery/size: empty crates filled with
  empties plus loose empty bottles. The form converts each line to
  `crates * capacity + loose bottles`.
- Have the active admin ID ready for the reset audit rows. Do not copy a
  password or connection string into a command, log, or report.
- Schedule the host operator to block sales, sale voids, and purchases that
  could affect returnable stock. The API permits legacy-mode operations before
  the count is confirmed, so the external write pause is required.

**1. Verify the production endpoint and data, read-only**

`fabtyna_prod` is not a unique identifier: both rehearsal branches have that
database name. Compare the direct endpoint against the verified production
host, then inspect the products and active admin inside a read-only
transaction. Never print the URL:

```powershell
$expectedHost = 'ep-silent-credit-b9sphcni.c-7.eu-central-1.aws.neon.tech'
$target = [uri]$env:DIRECT_URL
$targetHost = $target.DnsSafeHost.ToLowerInvariant()
$targetDatabase = $target.AbsolutePath.TrimStart('/')
if ($targetHost -ne $expectedHost -or $targetDatabase -ne 'fabtyna_prod') {
  throw 'Wrong production endpoint or database; stop.'
}
Write-Host "Verified target host=$targetHost database=$targetDatabase"
@'
BEGIN READ ONLY;
SELECT current_database() AS database_name, inet_server_addr() AS server_address;
SELECT current_setting('TimeZone') AS postgres_session_timezone;
SELECT name, "unitsPerPack" FROM products WHERE "deletedAt" IS NULL ORDER BY name;
SELECT id, email FROM admin_users WHERE "isActive" = TRUE ORDER BY id;
ROLLBACK;
'@ | psql $env:DIRECT_URL --set=ON_ERROR_STOP=on --file -
```

Stop if the products/admin do not identify the intended production copy.
Require `postgres_session_timezone` to be `UTC` or `GMT`. On the isolated
local PostgreSQL cluster, `GMT` and `UTC` both have zero offset and no
daylight-saving time; the session-expiry test passed with `GMT`. An
`Africa/Lagos` database session made Prisma read an expired
`TIMESTAMPTZ` session expiry one hour in the future; setting only the Node
process `TZ=UTC` did not correct it. Setting the local test role's database
timezone to UTC made the session tests pass. The fresh production copies
reported `GMT`; production's database timezone has NOT been checked here.
Stop and investigate any other value.
Then run `psql $env:DIRECT_URL --command '\conninfo'` and compare the host
printed by psql with `$targetHost`. Stop if they differ.
Repeat this visual comparison immediately before both reset scripts. The
database name alone is not a target check: two Neon projects use
`fabtyna_prod`.

**2. Pause writes and deploy schema**

The host operator blocks sales and voids and drains in-flight writes. Keep
returnable purchases blocked through the manual count. Set `DIRECT_URL` from
the approved secret source without echoing it, then run only:

```powershell
pnpm --filter @fabtyna/api db:migrate:deploy -- --confirm-db fabtyna_prod
```

Expected: only pending migrations are applied; no applied migration is edited.
The four migration names above are expected. If `migrate deploy` refuses,
stop; do not use `migrate dev`, `migrate reset`, `migrate resolve`, or checksum
repair. Run `db:verify` and `db:audit` against the same target. Current
rehearsal evidence predicts the known 23 checksum-only `db:verify` failures;
all new migration checksums and schema objects passed, while `db:audit` must
return zero offending rows. This is not an overall `db:verify` PASS. If policy
requires an overall PASS before rollout, stop production deployment until the
owner resolves or explicitly accepts the known checksum-only failures. Do not
hide or repair the checksum failures in the deploy window.

**3. Run and review the read-only reset report**

Run this separate command first and visually compare its host with
`$targetHost`. Stop if they differ. Do not start the report until the
comparison is complete:

```powershell
Write-Host "Expected target host=$targetHost"
psql $env:DIRECT_URL --set=ON_ERROR_STOP=on --command '\conninfo'
```

Use the target and production hosts shown by the endpoint check:

```powershell
$productionHost = $expectedHost
Write-Host "Typed target host=$targetHost; expected database=fabtyna_prod"
psql $env:DIRECT_URL --set=ON_ERROR_STOP=on `
  --set "target_host=$targetHost" `
  --set "production_host=$productionHost" `
  --set "expected_database=fabtyna_prod" `
  --set "allow_production=OWNER_CONFIRMED" `
  --file ops/empties-reset/report.sql
```

Also compare the host in the report's `\conninfo` to `$targetHost`;
stop if they differ. `allow_production=OWNER_CONFIRMED` is typed
in the `--set` line above. The report starts `BEGIN READ ONLY`, prints
`\conninfo`, the configured and connected server addresses, database name and
fingerprint, and lists each nonzero empties balance with its movement-ledger
sum and resulting balance. Save the complete row list and fingerprint. If a
balance/ledger mismatch appears or the fingerprint is unexpected, stop; do
not run the apply script.

**4. Apply the audited reset once**

Run this separate command first and visually compare its host with
`$targetHost`. Stop if they differ. Do not start the apply script until the
comparison is complete:

```powershell
Write-Host "Expected target host=$targetHost"
psql $env:DIRECT_URL --set=ON_ERROR_STOP=on --command '\conninfo'
```

Copy the report's fingerprint exactly and supply an active admin ID:

```powershell
$reviewedFingerprint = '<32-character fingerprint from the report>'
$adminId = '<active admin_users.id>'
Write-Host "Typed target host=$targetHost; expected database=fabtyna_prod"
psql $env:DIRECT_URL --set=ON_ERROR_STOP=on `
  --set "target_host=$targetHost" `
  --set "production_host=$productionHost" `
  --set "expected_database=fabtyna_prod" `
  --set "expected_fingerprint=$reviewedFingerprint" `
  --set "actor_id=$adminId" `
  --set "allow_production=OWNER_CONFIRMED" `
  --file ops/empties-reset/apply.sql
```

The apply script prints `\conninfo` again, but the required visual comparison
must happen **before** launching it: its SQL trusts the supplied `target_host`
and cannot independently check that it names the connected endpoint.
`expected_fingerprint`, `actor_id`, and
`allow_production=OWNER_CONFIRMED` are typed in the assignments and `--set`
lines above. Expected first-run output is a `NOTICE` stating that the reset
completed with the adjustment count, followed by `COMMIT`. It inserts one
adjustment per nonzero legacy empties type plus one audit marker; no `DELETE`
or direct balance-row mutation is issued. Re-run the exact apply command with
the same fingerprint only to verify idempotency; expected output is
`NOTICE: Reset already applied for this fingerprint; no rows changed.` and
`COMMIT`. A changed fingerprint is a hard refusal and requires a new report
and owner review.

Afterward run `db:verify` and `db:audit` again. Confirm the legacy
`empties_balances` still equal `SUM(empties_movements.quantity)` and all legacy
brewery balances are zero. The known checksum-only verifier result remains
separate; `db:audit` must have zero fatal rows.

**5. Deploy application, confirm mappings, then count**

Keep the write pause active. Deploy the API build containing the migration
support, recount screen/API, and purchase gate; wait for `/health`. Deploy the
matching web build. In **Empties → owners/types**, create only the active
bottle sizes present for each brewery (Guinness 12/24, International Breweries
12/20, Nigerian Breweries 12/20/24). In **Empties → product setup**, confirm
or correct each product's size mapping before resuming sales or purchases.

On the Inventory/empties recount screen, begin the recount, enter all seven
physical counts with a required reason, and submit once. The endpoint applies
all size-class adjustments atomically. During `RECOUNT_PENDING`, Inventory
shows “Empties recount pending”; sales and sale voids are blocked, and
returnable purchases are blocked. Before the count begins, the Recount page
shows “Initial recount required”; the external pause remains necessary because
the API is still in legacy mode and bypasses the shortage check. After
confirmation, the phase is `READY` and the purchase shortage check is
automatically enforced for confirmed returnable products.

After mappings are confirmed and the count returns `READY`, verify a
returnable purchase is subject to the shortage check, then resume writes.
During setup/count,
legacy empties balances are zero. Once size classes and product mappings exist
but before the count, the empty balance for each class is zero and its total
reflects mapped on-hand stock only; the count then adds the owner's physical
empties. Do not assume the size-class total is complete before setup and count.

### Other balances and history not changed by reset

The reset changes only legacy `empties_balances` by inserting
`ADJUSTMENT` movements and audit rows. It does not clear or backfill:

- Supplier empties obligations, events, or obligation balances. They remain
  live. Settling an old obligation checks the on-hand balance for its original
  empties type; a new size-class count does not replenish that legacy type.
  An old supplier debt can therefore be un-settleable after reset. Review and
  resolve these obligations before cutover or keep the affected settlement
  workflow paused and blocked until there is an owner-approved resolution.
- Purchase empties requirements, checks, snapshots, returns, and supplier-debt
  history. Those historical rows remain unchanged; the reset does not declare
  them fulfilled or recreate a shortage.
- Sale-linked empties movements. A void of a pre-cutover sale attempts to
  reverse against the legacy type. Since the reset leaves that legacy balance
  at zero and the new opening count is recorded in separate size-class types,
  such a void may be refused for insufficient empties. Resolve eligible
  pre-cutover voids before reset where possible; otherwise keep the old-sale
  void flow paused and do not bypass the guard.
- Customer empties balances/movements and customer crate-deposit balances and
  movements. They are separate ledgers and are not changed by this reset.
- Product stock balances. They remain unchanged. After size-class mappings are
  confirmed but before the count, each class has zero counted empties and its
  displayed total is derived from mapped stock only. Unmapped stock is not a
  confirmed size-class total.

The API remains in legacy mode until a recount completes. Before
`RECOUNT_PENDING`, the application does not block all legacy sales, voids, or
returnable purchases, and the new shortage check is not enabled. The external
pause must cover those writes from before the reset through mapping
confirmation and the count. During `RECOUNT_PENDING`, the API blocks sales,
sale voids, and returnable purchases. The Inventory banner reports the pending
recount; between reset and count, old balances show zero and the new
size-class empty quantities remain zero.

**6. Rollback**

- Before apply: stop if the report is unexpected; there is nothing to undo.
- After reset but before count/business writes: keep writes paused and restore
  the pre-cutover backup/PITR point to a separate Neon branch. Verify that
  branch's host, `db:verify`, and `db:audit`, then repoint the application only
  after review. Do not delete adjustments or reset movements.
- If the count is wrong, perform a new audited recount with the correct
  physical count and reason. Do not reapply the pre-launch reset.
- If deployment fails after migrations, keep affected writes paused. Prefer a
  compatible API redeploy; database migrations are forward-only. Restore the
  pre-cutover branch only if the schema/application cannot be recovered, and
  account for all writes since the restore point before switching.

On the later fresh rehearsal branch, measured command times were: migration
93.5 seconds; post-migration verify 9.6 seconds; successful post-migration
audit 15.6 seconds; report 2.2 seconds; reset 5.9 seconds; repeat reset
3.8 seconds; post-reset verify 12.0 seconds; post-reset audit 15.7 seconds;
automated API setup, count and scenarios 230.8 seconds; and post-scenario
audit 16.0 seconds. A first post-migration audit exited before reporting
checks after 30.6 seconds; its cause is not known, and its retry passed.
These command times do not include human review, a real API/web deployment,
the owner's mapping confirmation or manual count, and are not an end-to-end
pause estimate. Those durations and the total production pause remain NOT
KNOWN. The API scenarios use a test harness, not a deployed browser session.

## 7. Backup, restore test and rollback

- **Backup**: use Neon point-in-time restore and create a named branch before risky changes. Preserve the entire database, including schema, migration history, business data, ledgers, balances, configuration and audit logs.
- **Restore test** (do this before you need it): restore to a NEW Neon branch (never over production), export that branch's direct URL for your shell only, then run `db:whoami`, `db:verify` and `db:audit` using the code version matching the restored schema. `db:audit` must return zero offending rows; `db:verify` must show no unexpected missing objects, though old line-ending-only checksums may still prevent an overall PASS.
- **Rollback**: (a) application only: redeploy the previous API/web build only if it is compatible with the migrated schema; otherwise keep affected writes paused. (b) Database: migrations are forward-only and applied migrations are never edited. If a migration is bad, restore a branch from before it and repoint `DIRECT_URL` to the restored branch after verifying it (restore test steps), then ship a NEW corrective migration. Restoring to an earlier point can omit writes made since that point: assess and recover them before switching. Financial rows are immutable; corrections are reversal rows, not deletes.

#### Exact reset-restore checks (owner-run on a separate restore branch)

Use the pre-reset report saved before applying the reset as the expected
balance list. Actual production balances are NOT KNOWN until that report is
run. Set `DIRECT_URL` from the secret manager without echoing it, type the
restored branch host separately, and verify `\conninfo` against that typed
host before querying:

```powershell
$restoreHost = '<restored Neon branch direct host>'
$restoreDb = 'fabtyna_prod'
Write-Host "Expected restore host=$restoreHost database=$restoreDb"
psql $env:DIRECT_URL --command '\conninfo'
```

Stop unless the host printed by `\conninfo` equals `$restoreHost` and the
database name is `$restoreDb`. In `expected`, add every nonzero balance row
listed by the pre-reset report. Replace the marked values with the exact
brewery, kind, label, and current balance. Unlisted rows were zero in the
report; the query treats those as expected zero. The query must return only
`MATCH` rows, and `actual_type_count` must equal the report's `type_count`:

```sql
WITH expected(owner_name, kind, label, quantity) AS (
  VALUES
    ('<brewery from report>', '<kind from report>', '<label from report>', <balance from report>::bigint)
),
actual AS (
  SELECT o.name AS owner_name,
         t.kind::text AS kind,
         t.label,
         COALESCE(b.quantity, 0)::bigint AS quantity
    FROM empties_types t
    JOIN empties_owners o ON o.id = t."ownerId"
    LEFT JOIN empties_balances b ON b."typeId" = t.id
)
SELECT COALESCE(e.owner_name, a.owner_name) AS brewery,
       COALESCE(e.kind, a.kind) AS kind,
       COALESCE(e.label, a.label) AS label,
       e.quantity AS expected_quantity,
       a.quantity AS actual_quantity,
       CASE WHEN COALESCE(e.quantity, 0) = COALESCE(a.quantity, 0) THEN 'MATCH' ELSE 'MISMATCH' END AS result
  FROM expected e
  FULL JOIN actual a USING (owner_name, kind, label)
 ORDER BY brewery, kind, label;

SELECT COUNT(*) AS actual_type_count FROM empties_types;
```

Confirm that the one-time marker is absent, then run the audit:

```sql
SELECT COUNT(*) AS reset_marker_count
  FROM audit_logs
 WHERE action = 'EMPTIES_PRELAUNCH_RESET_APPLIED'
   AND "entityType" = 'EmptiesReset'
   AND "entityId" = 'size-class-prelaunch-v1';
```

With `DIRECT_URL` set from the restore branch's secret source, use a checkout
of the application version deployed at the restore point, then run:

```powershell
pnpm --filter @fabtyna/api db:verify
pnpm --filter @fabtyna/api db:audit
```

Expected: `reset_marker_count = 0`, every saved pre-reset balance matches,
`db:audit` returns zero offending rows, and `db:verify` reports no unexpected
missing objects for that version. Its overall result may still be blocked by
old line-ending-only checksums; do not repair them during restore. The new
feature checkout cannot audit a pre-migration restore: its checks expect
size-class and purchase-empties tables that do not yet exist.
To point the app at this restored branch, change the API host's `DIRECT_URL`
secret to the restored branch's direct URL, restart/redeploy the API, verify
`\conninfo` from the operator shell against `$restoreHost`, and check
`GET /health`. Keep writes paused until the restored database and API have
passed those checks. Do not change or print a production URL during this step.

### Post-deploy only: migration line-ending checksum follow-up

Do not include checksum repair in the deploy window. On rehearsal A, the stored
checksums for 23 already-applied migrations matched the exact CRLF form of the
current files; none matched the current LF form. `prisma migrate deploy` did
not warn or fail on those applied migrations. Do not edit any applied migration
and do not update `_prisma_migrations`.

After the rollout and smoke checks, make a separate verifier-only change:

1. Add tests proving that `db:verify` accepts a stored SHA-256 matching either
   the current bytes or the same SQL bytes with LF converted to CRLF.
2. Keep a hard failure when neither hash matches; do not waive mismatches by
   migration name and do not normalize SQL semantics or database history.
3. Run the verifier tests and `db:verify` against an isolated rehearsal copy.
   The existing 23 line-ending-only rows should pass as such; all other
   migrations, including the new feature migrations, must match exactly.
4. Deploy this verifier-only change separately, outside the size-class cutover.
   Do not run `migrate resolve`, `migrate reset`, `migrate dev`, or any checksum
   repair against `_prisma_migrations`.

## 8. Remaining environment-specific verification

- Linux build and start (only Windows was exercised).
- A fresh local PostgreSQL 17 database was created and all 48 repository
  migrations were applied from files. The first local connection attempt failed
  because it omitted `sslmode=disable`; rerunning with that localhost-only
  option applied all 48. `db:verify` passed all schema/checksum categories and
  `db:audit` returned zero offending rows. This does not replace the required
  timed rehearsal on a fresh Neon production copy.
- The latest local `pnpm verify` passed typecheck, lint and tests but failed
  during the web build when Next.js issued a security-upgrade warning. A
  separate retry of `pnpm --filter @fabtyna/web build:verify` passed. The full
  `pnpm verify` command has not passed end to end in this continuation.
- Real proxy behaviour of `TRUST_PROXY`, cookie flags over real HTTPS, DNS and TLS.

## 9. Check that an existing setup matches this document

Without connecting to production from a development `.env`:
- API host: `NODE_ENV=production`, `HOST`, `WEB_ORIGIN` (exact https origin of the web app), `TRUST_PROXY` correct for your proxy, `TZ=UTC`, `DIRECT_URL` is a direct (non-`-pooler`) URL. The process starts (it refuses on a bad `TZ`, missing `HOST`, or non-https `WEB_ORIGIN`).
- Web host: it was built with `NEXT_PUBLIC_API_MODE=real` and the right `NEXT_PUBLIC_API_BASE_URL`. The login page must NOT accept an arbitrary email and password (the mock demo login does).
- Database: from an operator shell, `db:whoami` shows the expected name with class `prod`; `db:verify` PASS; `db:audit` zero rows.
- Cookie is `__Host-fabtyna_session` with `HttpOnly; Secure; SameSite=Lax` and no `Domain` unless `COOKIE_DOMAIN` is set.

## 10. Launch smoke-test checklist

Use clearly named test data; ledgers, payments, stock movements and the audit log are immutable, so
test rows stay forever.

- [ ] `GET /health` returns 200.
- [ ] `GET /products` without a cookie returns 401.
- [ ] A POST with a wrong `Origin` header is rejected (403 CSRF_ORIGIN).
- [ ] Login succeeds; the cookie has `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix.
- [ ] Password reset (needs `RESEND_API_KEY` + `MAIL_FROM`): "Forgot password?" accepts the address, the email arrives, its link opens `/reset-password`, the new password signs in exactly once, and the old password is rejected.
- [ ] The reset link is single-use: opening it a second time reports the link is invalid or expired, and sessions that were already signed in are no longer accepted.
- [ ] With `RESEND_API_KEY`/`MAIL_FROM` unset, `POST /auth/forgot-password` answers 503 and the API still starts (the log warns once).
- [ ] Create a product.
- [ ] Record a purchase (stock goes up; supplier balance as expected).
- [ ] Record a sale (stock goes down; the chosen account balance rises by the amount received).
- [ ] Record a payment on a sale or debtor.
- [ ] Void a sale (stock restored; money reversed).
- [ ] Reverse a payment (account balance and debtor balance corrected).
- [ ] Reports (dashboard, sales summary, money flow) match the entries above.
- [ ] Logout; a protected page redirects to login.
- [ ] Operator shell: `db:audit` returns zero rows.
