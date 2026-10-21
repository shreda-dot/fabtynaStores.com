-- Preserve existing rows as unowned legacy claims. They remain unique within
-- the legacy scope and are treated as conflicts until they expire.
ALTER TABLE "idempotency_keys"
    ADD COLUMN "actorId" TEXT;

ALTER TABLE "idempotency_keys"
    ADD CONSTRAINT "fk_idempotency_keys_admin_user"
    FOREIGN KEY ("actorId") REFERENCES "admin_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "idempotency_keys_legacy_key_route_key"
    ON "idempotency_keys"("key", "route")
    WHERE "actorId" IS NULL;

CREATE UNIQUE INDEX "idempotency_keys_key_route_actorId_key"
    ON "idempotency_keys"("key", "route", "actorId")
    WHERE "actorId" IS NOT NULL;

DROP INDEX "idempotency_keys_key_route_key";
