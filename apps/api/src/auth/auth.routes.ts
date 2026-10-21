import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../lib/password.js";
import { requireActor } from "./actor.js";
import {
  hashSessionToken,
  issueSessionToken,
  clearSessionCookie,
  setSessionCookie,
  type SessionConfig,
} from "./session.js";

const loginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

// Verify unknown and inactive accounts at the same Argon2id cost as active users.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$188PEE8LZNBB4YvofmsTmg$8zCf/B+FGM2aue1hz+pvPDOlOikFFwskoqJ99bGJrhI";

interface FailureWindow {
  count: number;
  resetsAt: number;
}

class LoginFailureLimiter {
  private readonly emailWindows = new Map<string, FailureWindow>();
  private readonly ipWindows = new Map<string, FailureWindow>();
  private readonly windowMs = 15 * 60 * 1000;

  check(email: string, ip: string, now: number): number | null {
    const emailWindow = this.emailWindows.get(`${ip}\u0000${email}`);
    const ipWindow = this.ipWindows.get(ip);
    const emailCount = emailWindow !== undefined && emailWindow.resetsAt > now ? emailWindow.count : 0;
    const ipCount = ipWindow !== undefined && ipWindow.resetsAt > now ? ipWindow.count : 0;
    const reset = Math.max(
      emailCount > 0 ? (emailWindow?.resetsAt ?? now) : now,
      ipCount > 0 ? (ipWindow?.resetsAt ?? now) : now,
    );
    if (emailCount > 5 || ipCount > 100) {
      return Math.max(1, Math.ceil((reset - now) / 1000));
    }
    return null;
  }

  failed(email: string, ip: string, now: number): void {
    this.increment(this.emailWindows, `${ip}\u0000${email}`, now);
    this.increment(this.ipWindows, ip, now);
  }

  succeeded(email: string, ip: string): void {
    this.emailWindows.delete(`${ip}\u0000${email}`);
  }

  private increment(map: Map<string, FailureWindow>, key: string, now: number): void {
    const current = map.get(key);
    if (current === undefined || current.resetsAt <= now) {
      map.set(key, { count: 1, resetsAt: now + this.windowMs });
    } else {
      current.count += 1;
    }
    for (const [candidate, window] of map) {
      if (window.resetsAt <= now) map.delete(candidate);
    }
  }
}

function invalidCredentials(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION", "The request could not be read as valid JSON.", parsed.error.issues);
  }
  return parsed.data;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    prisma: PrismaClient;
    config: SessionConfig;
    now?: () => Date;
  },
): void {
  const now = deps.now ?? (() => new Date());
  const failures = new LoginFailureLimiter();

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: 100,
          timeWindow: 15 * 60 * 1000,
          keyGenerator: (request) => request.ip,
          skipSuccessfulRequests: true,
        },
      },
    },
    async (request, reply) => {
      const body = parseBody(loginBodySchema, request.body);
      const email = body.email.trim().toLowerCase();
      const requestTime = now();
      const retryAfter = failures.check(email, request.ip, requestTime.getTime());
      if (retryAfter !== null) {
        return reply
          .header("retry-after", String(retryAfter))
          .code(429)
          .send({
            error: {
              code: "RATE_LIMITED",
              message: "Too many sign-in attempts. Try again later.",
              details: null,
            },
          });
      }
      const user = await deps.prisma.adminUser.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true, isActive: true },
      });
      const candidateHash =
        user?.isActive === true
          ? user.passwordHash
          : DUMMY_PASSWORD_HASH;
      const passwordMatches = await verifyPassword(candidateHash, body.password);
      if (user === null || !user.isActive || !passwordMatches) {
        failures.failed(email, request.ip, requestTime.getTime());
        request.log.warn({ email, ip: request.ip }, "authentication failed");
        const retryAfter = failures.check(email, request.ip, requestTime.getTime());
        if (retryAfter !== null) {
          return reply
            .header("retry-after", String(retryAfter))
            .code(429)
            .send({
              error: {
                code: "RATE_LIMITED",
                message: "Too many sign-in attempts. Try again later.",
                details: null,
              },
            });
        }
        throw invalidCredentials();
      }

      failures.succeeded(email, request.ip);
      const issuedAt = now();
      const sessionId = randomUUID();
      const token = issueSessionToken();
      const expiresAt = new Date(
        issuedAt.getTime() + deps.config.sessionAbsoluteTimeoutDays * 24 * 60 * 60 * 1000,
      );
      const userAgent = request.headers["user-agent"] ?? null;
      await deps.prisma.$transaction(async (tx) => {
        await tx.adminUser.update({
          where: { id: user.id },
          data: { lastLoginAt: issuedAt },
        });
        await tx.adminSession.create({
          data: {
            id: sessionId,
            adminUserId: user.id,
            tokenHash: hashSessionToken(token),
            createdAt: issuedAt,
            lastSeenAt: issuedAt,
            expiresAt,
            ip: request.ip,
            userAgent: Array.isArray(userAgent) ? userAgent.join(",") : userAgent,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "AUTH_LOGIN",
            entityType: "admin_session",
            entityId: sessionId,
            metadata: { ip: request.ip },
            occurredAt: issuedAt,
          },
        });
      });
      setSessionCookie(reply, token, deps.config);
      return reply.code(204).send();
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const actor = requireActor(request);
    const sessionId = request.adminSessionId;
    if (sessionId === null) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const revokedAt = now();
    await deps.prisma.$transaction([
      deps.prisma.adminSession.update({
        where: { id: sessionId },
        data: { revokedAt },
      }),
      deps.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: "AUTH_LOGOUT",
          entityType: "admin_session",
          entityId: sessionId,
          metadata: { ip: request.ip },
          occurredAt: revokedAt,
        },
      }),
    ]);
    clearSessionCookie(reply, deps.config);
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request) => {
    return requireActor(request);
  });

  app.post("/auth/change-password", async (request, reply) => {
    const actor = requireActor(request);
    const sessionId = request.adminSessionId;
    if (sessionId === null) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const body = parseBody(changePasswordBodySchema, request.body);
    const admin = await deps.prisma.adminUser.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true },
    });
    if (admin === null || !(await verifyPassword(admin.passwordHash, body.currentPassword))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }
    const passwordHash = await hashPassword(body.newPassword);
    const token = issueSessionToken();
    const changedAt = now();
    const expiresAt = new Date(
      changedAt.getTime() + deps.config.sessionAbsoluteTimeoutDays * 24 * 60 * 60 * 1000,
    );
    await deps.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: actor.id },
        data: { passwordHash },
      });
      await tx.adminSession.updateMany({
        where: { adminUserId: actor.id, id: { not: sessionId }, revokedAt: null },
        data: { revokedAt: changedAt },
      });
      await tx.adminSession.update({
        where: { id: sessionId },
        data: {
          tokenHash: hashSessionToken(token),
          lastSeenAt: changedAt,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "AUTH_PASSWORD_CHANGED",
          entityType: "admin_user",
          entityId: actor.id,
          metadata: { ip: request.ip },
          occurredAt: changedAt,
        },
      });
    });
    setSessionCookie(reply, token, deps.config);
    return reply.code(204).send();
  });
}
