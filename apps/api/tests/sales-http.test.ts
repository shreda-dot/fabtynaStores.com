import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { loadRuntimeEnv } from "../src/lib/env.js";
import {
  createHarness,
  newId,
  postSale,
  saleBody,
  seedAccount,
  seedProduct,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

describe("HTTP: success and error envelopes", () => {
  it("GET /health works without the database", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /sales returns 201 with the sale DTO and GET /sales/:id returns the same sale", async () => {
    const product = await seedProduct(h.pg, { stock: 3 });
    const account = await seedAccount(h.pg);
    const created = await postSale(
      h.app,
      saleBody({ productId: product.id, paidKobo: "10000", accountId: account.id, reference: `${newId("http")}-a` }),
    );
    expect(created.status).toBe(201);
    const fetched = await h.app.inject({ method: "GET", url: `/sales/${created.body.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject(created.body);
    expect(fetched.json().lines).toHaveLength(1);
  });

  it("GET /sales/:id returns the 404 envelope when missing", async () => {
    const res = await h.app.inject({ method: "GET", url: `/sales/${newId("missing")}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(res.json().error).toHaveProperty("details");
  });

  it("an unknown route returns the 404 envelope", async () => {
    const res = await h.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("a malformed money string is a 400 VALIDATION with the issue list", async () => {
    const product = await seedProduct(h.pg, { stock: 3 });
    for (const bad of ["12.5", "abc", "-5", "1e3", ""]) {
      const res = await postSale(h.app, saleBody({ productId: product.id, paidKobo: bad }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION");
      expect(Array.isArray(res.body.error.details)).toBe(true);
    }
    const price = await postSale(h.app, saleBody({ productId: product.id, unitPriceKobo: "10.50" }));
    expect(price.status).toBe(400);
  });

  it("malformed JSON and unknown fields are 400 VALIDATION", async () => {
    const broken = await h.app.inject({
      method: "POST",
      url: "/sales",
      payload: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json().error.code).toBe("VALIDATION");

    const product = await seedProduct(h.pg, { stock: 3 });
    const extra = await postSale(h.app, { ...saleBody({ productId: product.id }), surprise: true });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe("VALIDATION");
  });

  it("an unexpected failure is a 500 with a request id and no internal details", async () => {
    const broken = {
      $transaction: async () => {
        throw new Error("secret internal detail: password=hunter2");
      },
    } as unknown as PrismaClient;
    const app = buildApp({
      prisma: {
        ...broken,
        adminSession: {
          findUnique: async () => ({
            id: "test-session",
            adminUserId: h.actor.id,
            lastSeenAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            adminUser: { id: h.actor.id, email: h.actor.email, isActive: true },
          }),
        },
      } as unknown as PrismaClient,
      auth: {
        nodeEnv: "test",
        webOrigin: "http://localhost:3000",
        cookieDomain: null,
        sessionIdleTimeoutHours: 12,
        sessionAbsoluteTimeoutDays: 7,
      },
      trustProxy: false,
    });
    const product = await seedProduct(h.pg, { stock: 3 });
    const valid = await app.inject({
      method: "POST",
      url: "/sales",
      payload: saleBody({ productId: product.id, paidKobo: "10000", accountId: "acct-x" }) as object,
      headers: {
        origin: "http://localhost:3000",
        cookie: "fabtyna_session=test",
      },
    });
    expect(valid.statusCode).toBe(500);
    const body = valid.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(typeof body.error.details.requestId).toBe("string");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    await app.close();
  });

  it("a deadlock is retried 3 times and then returned as 503", async () => {
    let calls = 0;
    const deadlocking = {
      $transaction: async () => {
        calls += 1;
        throw { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40P01", originalMessage: "deadlock detected" } } } };
      },
    } as unknown as PrismaClient;
    const app = buildApp({
      prisma: {
        ...deadlocking,
        adminSession: {
          findUnique: async () => ({
            id: "test-session",
            adminUserId: h.actor.id,
            lastSeenAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            adminUser: { id: h.actor.id, email: h.actor.email, isActive: true },
          }),
        },
      } as unknown as PrismaClient,
      auth: {
        nodeEnv: "test",
        webOrigin: "http://localhost:3000",
        cookieDomain: null,
        sessionIdleTimeoutHours: 12,
        sessionAbsoluteTimeoutDays: 7,
      },
      trustProxy: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/sales",
      payload: saleBody({ productId: "p", paidKobo: "10000", accountId: "a" }) as object,
      headers: {
        origin: "http://localhost:3000",
        cookie: "fabtyna_session=test",
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("UNAVAILABLE");
    expect(calls).toBe(4);
    await app.close();
  });
});

describe("env validation", () => {
  it("requires DIRECT_URL and bounds DB_POOL_MAX without echoing values", () => {
    expect(() => loadRuntimeEnv({})).toThrow(/DIRECT_URL is missing/);
    const secret = "postgresql://user:topsecret@host/db";
    let message = "";
    try {
      loadRuntimeEnv({ DIRECT_URL: secret, DB_POOL_MAX: "99" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DB_POOL_MAX/);
    expect(message).not.toContain("topsecret");
    const ok = loadRuntimeEnv({ DIRECT_URL: "postgres://example.invalid/db" });
    expect(ok.dbPoolMax).toBe(10);
    expect(ok.host).toBe("127.0.0.1");
    expect(ok.webOrigin).toBe("http://localhost:3000");
  });

  it("requires an explicit HTTPS origin and HOST in production", () => {
    expect(() => loadRuntimeEnv({ DIRECT_URL: "postgres://host/db", NODE_ENV: "production" })).toThrow(/HOST/);
    const env = loadRuntimeEnv({
      DIRECT_URL: "postgres://host/db",
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      WEB_ORIGIN: "https://admin.example.test",
    });
    expect(env.host).toBe("0.0.0.0");
    expect(env.webOrigin).toBe("https://admin.example.test");
  });
});
