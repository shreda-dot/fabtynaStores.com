-- Self-service password reset: one row per "forgot password" request.
--
-- `tokenHash` stores the SHA-256 of the token we emailed (never the token
-- itself), the same treatment `admin_sessions."tokenHash"` gets. `usedAt`
-- makes a token single-use; `expiresAt` retires it after 30 minutes. A new
-- request marks every earlier live token of that admin as used, so at most one
-- link is ever valid.
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "requestedIp" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_adminUserId_idx" ON "password_reset_tokens"("adminUserId");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- Admin accounts are deactivated, never deleted; RESTRICT matches
-- `fk_admin_sessions_admin_user` and keeps a hard delete from silently
-- stripping rows that an audit trail refers to.
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "fk_password_reset_tokens_admin_user"
    FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
