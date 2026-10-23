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
2. Apply new migrations (`db:migrate:deploy -- --confirm-db <name>`), then `db:verify` and `db:audit`. Migrations must be backward compatible with the running API version until it is replaced.
3. Start new API instances, wait for `/health`, then **drain** the old ones (stop routing new requests, let in-flight requests finish, then stop) so two versions do not run against a changing schema longer than needed.
4. Rebuild and deploy the web app if the API contract changed.

## 7. Backup, restore test and rollback

- **Backup**: rely on Neon point-in-time restore, and create a named branch before risky changes.
- **Restore test** (do this before you need it): restore to a NEW Neon branch (never over production), export that branch's direct URL for your shell only, then run `db:whoami`, `db:verify` and `db:audit` on it. All must pass.
- **Rollback**: (a) application only: redeploy the previous API/web build; (b) database: migrations are forward-only and applied migrations are never edited. If a migration is bad, restore a branch from before it and repoint `DIRECT_URL` to the restored branch after verifying it (restore test steps), then ship a NEW corrective migration. Financial rows are immutable; corrections are reversal rows, not deletes.

## 8. Not verified without a host

- Linux build and start (only Windows was exercised).
- **`prisma migrate deploy` on an EMPTY database was NOT verified.** The check against a fresh local database was skipped. Against the existing test database it reported "No pending migrations". Verify it once on the first fresh database (step 3 above), then run `db:verify` and `db:audit`; expect 0 audit rows.
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
