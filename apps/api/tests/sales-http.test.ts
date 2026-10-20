import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { buildApp } from "../src/app.js";
import { assertUnauthenticatedModeAllowed, createDevActorResolver } from "../src/auth/actor.js";
import { loadRuntimeEnv, type RuntimeEnv } from "../src/lib/env.js";
import { startServer } from "../src/start.js";
import {
  connectionString,
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

function envWith(overrides: Partial<RuntimeEnv>): RuntimeEnv {
  return {
    apiDatabaseUrl: connectionString,
    databaseUrl: null,
    dbPoolMax: 2,
    port: 0,
    nodeEnv: "development",
    allowUnauthenticatedDev: true,
    devActorEmail: null,
    ...overrides,
  };
}

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
    expect(fetched.json()).toEqual(created.body);
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
    const app = buildApp({ prisma: broken, resolveActor: createDevActorResolver(h.actor) });
    const product = await seedProduct(h.pg, { stock: 3 });
    const valid = await app.inject({
      method: "POST",
      url: "/sales",
      payload: saleBody({ productId: product.id, paidKobo: "10000", accountId: "acct-x" }) as object,
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
    const app = buildApp({ prisma: deadlocking, resolveActor: createDevActorResolver(h.actor) });
    const res = await app.inject({
      method: "POST",
      url: "/sales",
      payload: saleBody({ productId: "p", paidKobo: "10000", accountId: "a" }) as object,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("UNAVAILABLE");
    expect(calls).toBe(4);
    await app.close();
  });
});

describe("13. unauthenticated guard", () => {
  it("refuses production, and refuses without the explicit dev flag", () => {
    expect(() => assertUnauthenticatedModeAllowed({ nodeEnv: "production", allowUnauthenticatedDev: true })).toThrow(
      /production/,
    );
    expect(() => assertUnauthenticatedModeAllowed({ nodeEnv: "development", allowUnauthenticatedDev: false })).toThrow(
      /ALLOW_UNAUTHENTICATED_DEV/,
    );
    expect(() => assertUnauthenticatedModeAllowed({ nodeEnv: "development", allowUnauthenticatedDev: true })).not.toThrow();
  });

  it("startServer refuses in production and without the flag before opening any connection", async () => {
    await expect(startServer(envWith({ nodeEnv: "production", apiDatabaseUrl: "postgres://nobody@127.0.0.1:1/x" }))).rejects.toThrow(
      /production/,
    );
    await expect(
      startServer(envWith({ allowUnauthenticatedDev: false, apiDatabaseUrl: "postgres://nobody@127.0.0.1:1/x" })),
    ).rejects.toThrow(/ALLOW_UNAUTHENTICATED_DEV/);
  });

  it("startServer refuses a missing, unknown or deactivated DEV_ACTOR_EMAIL", async () => {
    await expect(startServer(envWith({ devActorEmail: null }))).rejects.toThrow(/DEV_ACTOR_EMAIL is not set/);
    await expect(startServer(envWith({ devActorEmail: `${newId("ghost")}@example.test` }))).rejects.toThrow(
      /does not match any admin/,
    );
    const inactive = newId("inactive_actor");
    await h.pg.query(
      `INSERT INTO admin_users (id, email, "passwordHash", "isActive", "updatedAt") VALUES ($1, $2, 'x', false, now())`,
      [inactive, `${inactive}@example.test`],
    );
    await expect(startServer(envWith({ devActorEmail: `${inactive}@example.test` }))).rejects.toThrow(/deactivated/);
  });

  it("starts on 127.0.0.1 with a valid active admin and serves /health", async () => {
    const started = await startServer(envWith({ devActorEmail: h.actor.email }), { port: 0, logger: false });
    try {
      expect(started.address).toContain("127.0.0.1");
      const res = await fetch(`${started.address}/health`);
      expect(res.status).toBe(200);
    } finally {
      await started.app.close();
    }
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
    const ok = loadRuntimeEnv({ DIRECT_URL: secret, DEV_ACTOR_EMAIL: " Owner@Example.com ", ALLOW_UNAUTHENTICATED_DEV: "true" });
    expect(ok.dbPoolMax).toBe(10);
    expect(ok.devActorEmail).toBe("owner@example.com");
    expect(ok.allowUnauthenticatedDev).toBe(true);
  });
});
