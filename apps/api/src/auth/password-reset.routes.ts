import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import type { Mailer } from "../lib/mailer.js";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../lib/password.js";
import { parseBody } from "./auth.routes.js";
import { hashSessionToken, issueSessionToken, type SessionConfig } from "./session.js";

/**
 * Self-service password reset — the one flow that has to work for someone who
 * cannot sign in.
 *
 * Rules, all enforced here and in `reset-password` (see `docs/DEPLOY.md`):
 *   - "forgot password" answers identically whether or not the address exists,
 *     so the endpoint cannot be used to discover admin accounts;
 *   - the emailed token is 32 random bytes; only its SHA-256 is stored;
 *   - it lives 30 minutes, works once, and asking again retires the previous
 *     one, so at most one link is ever live per admin;
 *   - a successful reset revokes every session of that admin.
 */

export const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

/** How long a spent or expired row is kept, for support questions. */
const RESET_TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;

const forgotPasswordBodySchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordBodySchema = z.object({
  token: z.string().trim().min(16).max(512),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

interface Counter {
  count: number;
  resetsAt: number;
}

/**
 * Counts every request against a key and reports when the key is over its cap.
 *
 * Unlike the sign-in limiter this counts *requests*, not failures: a request
 * for a password reset has no observable "failure" (the answer is always the
 * same), so there is nothing else to count.
 */
class RequestLimiter {
  private readonly windows = new Map<string, Counter>();

  constructor(
    private readonly maxPerKey: number,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** Records one request and returns seconds to wait, or `null` when allowed. */
  hit(key: string, now: number): number | null {
    const current = this.windows.get(key);
    const live = current !== undefined && current.resetsAt > now ? current : null;
    const count = live === null ? 1 : live.count + 1;
    const resetsAt = live === null ? now + this.windowMs : live.resetsAt;
    this.windows.set(key, { count, resetsAt });
    for (const [candidate, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(candidate);
    }
    return count > this.maxPerKey ? Math.max(1, Math.ceil((resetsAt - now) / 1000)) : null;
  }
}

function invalidResetToken(): AppError {
  return new AppError(
    400,
    "INVALID_RESET_TOKEN",
    "This reset link is invalid or has expired. Please request a new one.",
  );
}

function resetUrlFor(webOrigin: string, token: string): string {
  const url = new URL("/reset-password", webOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function registerPasswordResetRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    config: SessionConfig;
    mailer: Mailer | null;
    now?: () => Date;
  },
): void {
  const now = deps.now ?? (() => new Date());
  // Generous per IP (a whole shop can share one address) but strict per address,
  // which is what stops someone using the endpoint to flood one inbox.
  const perEmail = new RequestLimiter(5);
  const perIp = new RequestLimiter(30);

  app.post("/auth/forgot-password", async (request, reply) => {
    const body = parseBody(forgotPasswordBodySchema, request.body);
    const email = body.email.trim().toLowerCase();

    const requestedAt = now();
    const retryAfter = Math.max(
      perEmail.hit(email, requestedAt.getTime()) ?? 0,
      perIp.hit(request.ip, requestedAt.getTime()) ?? 0,
    );
    if (retryAfter > 0) {
      return reply
        .header("retry-after", String(retryAfter))
        .code(429)
        .send({
          error: {
            code: "RATE_LIMITED",
            message: "Too many reset requests. Please wait and try again.",
            details: null,
          },
        });
    }

    // A missing mail configuration is a property of the deployment, not of the
    // address, so answering it differently leaks nothing.
    if (deps.mailer === null) {
      throw new AppError(
        503,
        "UNAVAILABLE",
        "Password reset by email is not available. Please ask the store owner to reset it for you.",
      );
    }

    const user = await deps.prisma.adminUser.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true },
    });

    if (user !== null && user.isActive) {
      const token = issueSessionToken();
      const expiresAt = new Date(requestedAt.getTime() + RESET_TOKEN_TTL_MS);
      await deps.prisma.$transaction(async (tx) => {
        // One live link per admin: asking again invalidates the previous one.
        await tx.passwordResetToken.updateMany({
          where: { adminUserId: user.id, usedAt: null },
          data: { usedAt: requestedAt },
        });
        await tx.passwordResetToken.create({
          data: {
            adminUserId: user.id,
            tokenHash: hashSessionToken(token),
            createdAt: requestedAt,
            expiresAt,
            requestedIp: request.ip,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "AUTH_PASSWORD_RESET_REQUESTED",
            entityType: "admin_user",
            entityId: user.id,
            metadata: { ip: request.ip },
            occurredAt: requestedAt,
          },
        });
      });

      try {
        await deps.mailer.sendPasswordReset({
          to: user.email,
          resetUrl: resetUrlFor(deps.config.webOrigin, token),
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
        });
      } catch (error) {
        // Swallowed on purpose: a failed send must not turn into a different
        // answer that reveals whether the address exists. It is loud in the log.
        request.log.error({ err: error, adminUserId: user.id }, "password reset email failed");
      }
    }

    return reply.code(204).send();
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const body = parseBody(resetPasswordBodySchema, request.body);
    const resetAt = now();
    const tokenHash = hashSessionToken(body.token);

    const record = await deps.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        adminUserId: true,
        usedAt: true,
        expiresAt: true,
        adminUser: { select: { isActive: true } },
      },
    });
    if (
      record === null ||
      record.usedAt !== null ||
      record.expiresAt <= resetAt ||
      !record.adminUser.isActive
    ) {
      throw invalidResetToken();
    }

    const passwordHash = await hashPassword(body.newPassword);

    await deps.prisma.$transaction(async (tx) => {
      // Claiming the token first is what makes it single-use: two requests
      // carrying the same link race here and only one updates a row.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: resetAt } },
        data: { usedAt: resetAt },
      });
      if (claimed.count !== 1) throw invalidResetToken();

      await tx.adminUser.update({
        where: { id: record.adminUserId },
        data: { passwordHash },
      });
      await tx.adminSession.updateMany({
        where: { adminUserId: record.adminUserId, revokedAt: null },
        data: { revokedAt: resetAt },
      });
      await tx.passwordResetToken.updateMany({
        where: { adminUserId: record.adminUserId, usedAt: null },
        data: { usedAt: resetAt },
      });
      await tx.auditLog.create({
        data: {
          actorId: record.adminUserId,
          action: "AUTH_PASSWORD_RESET",
          entityType: "admin_user",
          entityId: record.adminUserId,
          metadata: { ip: request.ip },
          occurredAt: resetAt,
        },
      });
    });

    return reply.code(204).send();
  });
}

/**
 * Drops spent and expired reset tokens, the way `purgeExpiredSessions` drops
 * expired sessions. Called on a timer by `startSessionCleanup`'s sibling in
 * `start.ts`.
 */
export async function purgeStalePasswordResetTokens(
  prisma: PrismaClient,
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RESET_TOKEN_RETENTION_MS);
  const result = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

/** Runs `purgeStalePasswordResetTokens` hourly; the timer does not hold the process open. */
export function startPasswordResetCleanup(
  prisma: PrismaClient,
  options: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
    onPurged?: (count: number) => void;
  } = {},
): () => void {
  const timer = setInterval(() => {
    purgeStalePasswordResetTokens(prisma)
      .then((count) => {
        if (count > 0) options.onPurged?.(count);
      })
      .catch((error: unknown) => options.onError?.(error));
  }, options.intervalMs ?? 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
