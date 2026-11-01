# Fabtyna Stores

Back-office app for Fabtyna Stores: sales, purchases, stock, customers and suppliers, expenses, loans, accounts (cash, bank, POS), empties (crates and bottles) and reports.

## Structure

pnpm monorepo:

| Path | What it is |
|------|------------|
| `apps/web` | Next.js admin app |
| `apps/api` | Fastify + Prisma API (PostgreSQL) |
| `packages/shared` | Shared types, schemas and domain rules |
| `docs/` | Project docs (start with `AI_CONTEXT.md`, `backend-schema.md`, `DEPLOY.md`) |

## Rules that matter

- Money is integer kobo (`BIGINT`, strings in API payloads). Never floats.
- Business dates are Lagos `YYYY-MM-DD` strings.
- Ledgers, stock movements, payments and audit logs are immutable. Corrections are reversal rows.
- Never edit an applied migration. Add a new one and update `apps/api/src/db/expected-schema.ts`.

## Setup

Requirements: Node 20, pnpm 10.

```powershell
pnpm install
```

Copy `apps/api/.env.example` to `apps/api/.env` and fill in your own values. Never commit `.env` files.

Web, in `apps/web/.env.local`:

```
NEXT_PUBLIC_API_MODE=real        # or mock for demo data
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

## Run

```powershell
pnpm --filter @fabtyna/api dev     # API on :3001
pnpm dev                           # web
```

## Database

```powershell
pnpm --filter @fabtyna/api db:migrate:deploy   # apply migrations (needs --confirm-db)
pnpm --filter @fabtyna/api db:verify           # schema objects exist
pnpm --filter @fabtyna/api db:audit            # must return zero rows
pnpm --filter @fabtyna/api db:seed:admin       # create the first admin
```

## Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @fabtyna/web build:verify
```

API tests run against a separate test database (name must contain `test`). See `docs/DEPLOY.md` for deployment.
