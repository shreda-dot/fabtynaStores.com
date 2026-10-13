# Fabtyna Stores: project rules (read before changing anything)

- Business: wholesale and retail of beer and soft drinks, single admin user (the owner).
- Order of work: frontend first on a mock API layer; the real backend comes afterward. Do not start the backend, create migrations, or touch the database unless told to.
- Stack: Next.js, Tailwind CSS only (no custom CSS), Zustand for UI state only, TanStack Query for data, Node.js (Fastify), PostgreSQL, Prisma. No Supabase.
- Money: integer kobo everywhere (API DTOs use integer strings), never floats. One money helper only: packages/shared/src/money.ts.
- Stock: never a stored number. It is the sum of immutable StockMovement rows. The base is the "unit"; a crate is N units, and N differs per product.
- Ledgers (customer, supplier, account) are signed and immutable. Corrections are made with reversing entries, never edits or deletes.
- Stock and ledger logic lives as pure functions in packages/shared/src/domain and is tested with Vitest. Never change a test just to make it pass; explain which side is wrong.
- Shared package: everything public is exported from packages/shared/src/index.ts, and apps import only from "@fabtyna/shared".
- Business dates use the Africa/Lagos time zone.
- UI: plain neutral colors, one muted accent, light by default, optional dark toggle, mobile-first, large touch targets.
- Give complete files, not diffs or snippets. Report DONE or NOT DONE honestly. If something could not be checked, say so.
- Never run destructive database commands without first showing a SELECT or audit query and waiting for approval.

## Current workspace context

The shared package is the canonical source for exported domain functions. Apps must import public helpers from `@fabtyna/shared`; app-local ledger or Lagos-time modules, if retained, may only be thin re-exports. Do not add alias exports solely to suppress TypeScript errors: update consumers when shared names have been renamed.
