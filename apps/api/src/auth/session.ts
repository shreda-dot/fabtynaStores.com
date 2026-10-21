import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "./actor.js";
import { AppError } from "../lib/errors.js";

export interface SessionConfig {
  nodeEnv: string;
  webOrigin: string;
  cookieDomain: string | null;
  sessionIdleTimeoutHours: number;
  sessionAbsoluteTimeoutDays: number;
}

export const SESSION_COOKIE_BASE_NAME = "fabtyna_session";

export function sessionCookieName(config: SessionConfig): string {
  return config.nodeEnv === "production" && config.cookieDomain === null
    ? `__Host-${SESSION_COOKIE_BASE_NAME}`
    : SESSION_COOKIE_BASE_NAME;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: SessionConfig,
): void {
  const options = {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.sessionAbsoluteTimeoutDays * 24 * 60 * 60,
    ...(config.cookieDomain === null ? {} : { domain: config.cookieDomain }),
  };
  reply.setCookie(sessionCookieName(config), token, options);
}

export function clearSessionCookie(reply: FastifyReply, config: SessionConfig): void {
  reply.clearCookie(sessionCookieName(config), {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    ...(config.cookieDomain === null ? {} : { domain: config.cookieDomain }),
  });
}

export async function authenticateRequest(
  prisma: PrismaClient,
  request: FastifyRequest,
  config: SessionConfig,
  now = new Date(),
): Promise<Actor | null> {
  const token = request.cookies[sessionCookieName(config)];
  if (token === undefined || token === "") return null;

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      adminUserId: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
      adminUser: { select: { id: true, email: true, isActive: true } },
    },
  });
  if (session !== null && session.revokedAt === null && !session.adminUser.isActive) {
    await prisma.adminSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  if (
    session === null ||
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.lastSeenAt.getTime() + config.sessionIdleTimeoutHours * 60 * 60 * 1000 <= now.getTime() ||
    !session.adminUser.isActive
  ) {
    request.actor = null;
    request.adminSessionId = null;
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= 60_000) {
    await prisma.adminSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        lastSeenAt: { lte: new Date(now.getTime() - 60_000) },
      },
      data: { lastSeenAt: now },
    });
  }

  request.adminSessionId = session.id;
  return { id: session.adminUser.id, email: session.adminUser.email };
}

export async function purgeExpiredSessions(
  prisma: PrismaClient,
  options: { now?: Date; idleTimeoutHours: number },
): Promise<number> {
  const now = options.now ?? new Date();
  const retentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const idleRetentionCutoff = new Date(
    retentionCutoff.getTime() - options.idleTimeoutHours * 60 * 60 * 1000,
  );
  const result = await prisma.adminSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: retentionCutoff } },
        { lastSeenAt: { lt: idleRetentionCutoff } },
        { revokedAt: { lt: retentionCutoff } },
      ],
    },
  });
  return result.count;
}

export function startSessionCleanup(
  prisma: PrismaClient,
  options: {
    idleTimeoutHours: number;
    intervalMs?: number;
    onError?: (error: unknown) => void;
    onPurged?: (count: number) => void;
  },
): () => void {
  const timer = setInterval(() => {
    purgeExpiredSessions(prisma, { idleTimeoutHours: options.idleTimeoutHours })
      .then((count) => {
        if (count > 0) options.onPurged?.(count);
      })
      .catch((error: unknown) => options.onError?.(error));
  }, options.intervalMs ?? 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export function csrfOriginError(): AppError {
  return new AppError(403, "CSRF_ORIGIN", "This request did not come from the approved web app.");
}
