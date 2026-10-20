-- Idempotency keys for retried POST requests.
--
-- A client on a slow or flaky network repeats a request with the same
-- `Idempotency-Key` header. The first request claims (key, route) inside the
-- same database transaction that creates the sale, and stores the response it
-- is about to return; a repeat finds the row and replays the stored response
-- instead of creating a second sale.
--
-- This is an operational table, not a ledger: rows are updated once (to store
-- the response) and deleted after `expiresAt` by a batch cleanup, so it is
-- deliberately NOT covered by the immutability triggers.
--
-- Uniqueness is (key, route) for now. When login exists, an `actorId` column
-- joins the unique key so one user's key can never replay another user's
-- response (a new migration; nothing here needs to change until then).
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_route_key" ON "idempotency_keys"("key", "route");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");
