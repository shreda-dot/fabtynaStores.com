import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { hashSessionToken, SESSION_COOKIE_BASE_NAME } from "../src/auth/session.js";
import { hashPassword } from "../src/lib/password.js";
import {
  createHarness,
  newId,
  saleBody,
  seedAccount,
  seedProduct,
  type Harness,
} from "./sales-fixtures.js";

const WEB_ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
  await h.prisma.adminUser.update({
    where: { id: h.actor.id },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
});

afterAll(async () => {
  await h.close();
});

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers["set-cookie"];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (cookie === undefined) throw new Error("Login response did not set a session cookie.");
  return cookie.split(";", 1)[0] ?? "";
}

function request(
  method: string,
  url: string,
  options: { body?: unknown; cookie?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  return h.injectAnonymous({
    method,
    url,
    ...(options.body === undefined ? {} : { payload: options.body as object }),
    headers,
  });
}

async function login(email = h.actor.email, password = PASSWORD): Promise<string> {
  const response = await request("POST", "/auth/login", {
    body: { email, password },
    origin: WEB_ORIGIN,
  });
  if (response.statusCode !== 204) {
    throw new Error(`Login helper failed with status ${response.statusCode}.`);
  }
  return cookieFrom(response);
}

describe("server-side admin sessions", () => {
  it("protects every registered route except GET /health and POST /auth/login", async () => {
    expect(h.routes.length).toBeGreaterThan(0);
    for (const route of h.routes) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method === "OPTIONS") continue;
        const response = await request(method, route.url, { origin: WEB_ORIGIN });
        if (method === "GET" && route.url === "/health") {
          expect(response.statusCode).toBe(200);
        } else if (method === "POST" && route.url === "/auth/login") {
          expect(response.statusCode).not.toBe(401);
        } else {
          expect(response.statusCode, `${method} ${route.url}`).toBe(401);
        }
      }
    }
  });

  it("logs in, reads /auth/me, and attributes a created sale to the session admin", async () => {
    const cookie = await login(` ${h.actor.email.toUpperCase()} `);
    const me = await request("GET", "/auth/me", { cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ id: h.actor.id, email: h.actor.email });
    const loginAudit = await h.prisma.auditLog.findFirst({
      where: { actorId: h.actor.id, action: "AUTH_LOGIN" },
      orderBy: { occurredAt: "desc" },
    });
    expect(loginAudit).not.toBeNull();
    const loggedInAdmin = await h.prisma.adminUser.findUnique({
      where: { id: h.actor.id },
      select: { lastLoginAt: true },
    });
    expect(loggedInAdmin?.lastLoginAt).not.toBeNull();

    const product = await seedProduct(h.pg, { stock: 3 });
    const account = await seedAccount(h.pg);
    const sale = await request("POST", "/sales", {
      cookie,
      origin: WEB_ORIGIN,
      body: saleBody({
        productId: product.id,
        paidKobo: "10000",
        accountId: account.id,
        reference: newId("auth-sale"),
      }),
    });
    expect(sale.statusCode).toBe(201);
    const stored = await h.prisma.sale.findUnique({
      where: { id: sale.json<{ id: string }>().id },
      select: { createdById: true },
    });
    expect(stored?.createdById).toBe(h.actor.id);
  });

  it("logs out and leaves the old cookie unusable", async () => {
    const cookie = await login();
    const logout = await request("POST", "/auth/logout", {
      cookie,
      origin: WEB_ORIGIN,
    });
    expect(logout.statusCode).toBe(204);
    expect((await request("GET", "/auth/me", { cookie })).statusCode).toBe(401);
    const audit = await h.prisma.auditLog.findFirst({
      where: { actorId: h.actor.id, action: "AUTH_LOGOUT" },
    });
    expect(audit).not.toBeNull();
  });

  it("returns the same login body for wrong password, unknown email, and inactive users", async () => {
    const inactiveId = newId("inactive_admin");
    await h.pg.query(
      `INSERT INTO admin_users (id, email, "passwordHash", "isActive", "updatedAt")
       VALUES ($1, $2, $3, false, now())`,
      [inactiveId, `${inactiveId}@example.test`, await hashPassword(PASSWORD)],
    );
    const cases = [
      { email: h.actor.email, password: "incorrect-password-value" },
      { email: `${newId("unknown")}@example.test`, password: PASSWORD },
      { email: `${inactiveId}@example.test`, password: PASSWORD },
    ];
    const bodies: unknown[] = [];
    for (const body of cases) {
      const response = await request("POST", "/auth/login", { body, origin: WEB_ORIGIN });
      expect(response.statusCode).toBe(401);
      bodies.push(response.json());
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("rejects idle-expired and absolute-expired sessions", async () => {
    const idleCookie = await login();
    const idleToken = idleCookie.slice(idleCookie.indexOf("=") + 1);
    await h.pg.query(
      `UPDATE admin_sessions SET "lastSeenAt" = $2 WHERE "tokenHash" = $1`,
      [hashSessionToken(idleToken), new Date(Date.now() - 13 * 60 * 60 * 1000)],
    );
    expect((await request("GET", "/auth/me", { cookie: idleCookie })).statusCode).toBe(401);

    const absoluteCookie = await login();
    const absoluteToken = absoluteCookie.slice(absoluteCookie.indexOf("=") + 1);
    await h.pg.query(
      `UPDATE admin_sessions SET "expiresAt" = $2 WHERE "tokenHash" = $1`,
      [hashSessionToken(absoluteToken), new Date(Date.now() - 1000)],
    );
    expect((await request("GET", "/auth/me", { cookie: absoluteCookie })).statusCode).toBe(401);
  });

  it("changes password, rotates the current token, and revokes other sessions", async () => {
    const currentCookie = await login();
    const otherCookie = await login();
    const wrongCurrentPassword = await request("POST", "/auth/change-password", {
      cookie: currentCookie,
      origin: WEB_ORIGIN,
      body: { currentPassword: "incorrect-current-password", newPassword: "a-new-correct-password" },
    });
    expect(wrongCurrentPassword.statusCode).toBe(401);
    const shortNewPassword = await request("POST", "/auth/change-password", {
      cookie: currentCookie,
      origin: WEB_ORIGIN,
      body: { currentPassword: PASSWORD, newPassword: "too-short" },
    });
    expect(shortNewPassword.statusCode).toBe(400);
    const changed = await request("POST", "/auth/change-password", {
      cookie: currentCookie,
      origin: WEB_ORIGIN,
      body: { currentPassword: PASSWORD, newPassword: "a-new-correct-password" },
    });
    expect(changed.statusCode).toBe(204);
    const rotatedCookie = cookieFrom(changed);
    expect(rotatedCookie).not.toBe(currentCookie);
    expect((await request("GET", "/auth/me", { cookie: rotatedCookie })).statusCode).toBe(200);
    expect((await request("GET", "/auth/me", { cookie: currentCookie })).statusCode).toBe(401);
    expect((await request("GET", "/auth/me", { cookie: otherCookie })).statusCode).toBe(401);
    const passwordAudit = await h.prisma.auditLog.findFirst({
      where: { actorId: h.actor.id, action: "AUTH_PASSWORD_CHANGED" },
    });
    expect(passwordAudit).not.toBeNull();

    const oldPassword = await request("POST", "/auth/login", {
      body: { email: h.actor.email, password: PASSWORD },
      origin: WEB_ORIGIN,
    });
    expect(oldPassword.statusCode).toBe(401);
    const newPasswordCookie = await login(h.actor.email, "a-new-correct-password");
    expect((await request("GET", "/auth/me", { cookie: newPasswordCookie })).statusCode).toBe(200);
  });

  it("checks the Origin on every write and rate-limits repeated login failures", async () => {
    const missingOrigin = await request("POST", "/auth/login", {
      body: { email: h.actor.email, password: PASSWORD },
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json().error.code).toBe("CSRF_ORIGIN");

    const wrongOrigin = await request("POST", "/auth/logout", {
      cookie: await login(h.actor.email, "a-new-correct-password"),
      origin: "https://other.example.test",
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json().error.code).toBe("CSRF_ORIGIN");

    const preflight = await h.injectAnonymous({
      method: "OPTIONS",
      url: "/sales",
      headers: {
        origin: WEB_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "idempotency-key",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(preflight.headers["access-control-allow-headers"]).toContain("idempotency-key");

    const email = `${newId("rate-limit")}@example.test`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request("POST", "/auth/login", {
        body: { email, password: "wrong-password" },
        origin: WEB_ORIGIN,
      });
      expect(failed.statusCode).toBe(401);
    }
    const limited = await request("POST", "/auth/login", {
      body: { email, password: "wrong-password" },
      origin: WEB_ORIGIN,
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("sets secure __Host cookie attributes in production", async () => {
    const app = buildApp({
      prisma: h.prisma as PrismaClient,
      auth: {
        nodeEnv: "production",
        webOrigin: "https://admin.example.test",
        cookieDomain: null,
        sessionIdleTimeoutHours: 12,
        sessionAbsoluteTimeoutDays: 7,
      },
      trustProxy: false,
    });
    try {
      await app.ready();
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: h.actor.email, password: "a-new-correct-password" },
        headers: { origin: "https://admin.example.test" },
      });
      expect(response.statusCode).toBe(204);
      const cookie = response.headers["set-cookie"] as string;
      expect(cookie).toContain("__Host-fabtyna_session=");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=");
    } finally {
      await app.close();
    }
  });

  it("kills sessions immediately when an admin is deactivated", async () => {
    const cookie = await login(h.actor.email, "a-new-correct-password");
    await h.prisma.adminUser.update({
      where: { id: h.actor.id },
      data: { isActive: false },
    });
    try {
      const me = await request("GET", "/auth/me", { cookie });
      expect(me.statusCode).toBe(401);
    } finally {
      await h.prisma.adminUser.update({
        where: { id: h.actor.id },
        data: { isActive: true },
      });
    }
    expect((await request("GET", "/auth/me", { cookie })).statusCode).toBe(401);
  });
});
