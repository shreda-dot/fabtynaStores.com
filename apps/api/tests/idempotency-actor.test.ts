import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken, SESSION_COOKIE_BASE_NAME } from "../src/auth/session.js";
import { newId, createHarness, type Harness } from "./sales-fixtures.js";

let h: Harness | undefined;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  if (h !== undefined) await h.close();
});

async function createOtherAdminSession(harness: Harness) {
  const adminId = newId("idem_admin");
  const email = `${adminId}@example.test`;
  const token = randomBytes(32).toString("base64url");
  const sessionId = newId("idem_session");
  const now = new Date();

  await harness.pg.query(
    `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt")
     VALUES ($1, $2, 'not-a-real-hash', now())`,
    [adminId, email],
  );
  await harness.pg.query(
    `INSERT INTO admin_sessions (id, "adminUserId", "tokenHash", "createdAt", "lastSeenAt", "expiresAt")
     VALUES ($1, $2, $3, $4, $4, $5)`,
    [sessionId, adminId, hashSessionToken(token), now, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)],
  );

  return { adminId, cookie: `${SESSION_COOKIE_BASE_NAME}=${token}` };
}

describe("actor-scoped idempotency", () => {
  it("allows distinct admins to use the same key and replays only within each actor", async () => {
    const harness = h!;
    const other = await createOtherAdminSession(harness);
    const key = newId("shared_key");
    const payload = { name: `Actor scoped ${newId("customer")}`, type: "RETAIL", creditLimitKobo: "0" };

    const first = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload,
      headers: { "idempotency-key": key },
    });
    const second = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload,
      headers: { "idempotency-key": key, cookie: other.cookie },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).not.toBe(second.json().id);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.headers["idempotent-replayed"]).toBeUndefined();

    const firstReplay = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload,
      headers: { "idempotency-key": key },
    });
    const secondReplay = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload,
      headers: { "idempotency-key": key, cookie: other.cookie },
    });

    expect(firstReplay.statusCode).toBe(201);
    expect(firstReplay.headers["idempotent-replayed"]).toBe("true");
    expect(firstReplay.json()).toEqual(first.json());
    expect(secondReplay.statusCode).toBe(201);
    expect(secondReplay.headers["idempotent-replayed"]).toBe("true");
    expect(secondReplay.json()).toEqual(second.json());

    const claims = await harness.pg.query(
      `SELECT "actorId" FROM idempotency_keys
        WHERE key = $1 AND route = 'POST /customers'
        ORDER BY "actorId"`,
      [key],
    );
    expect(claims.rows.map((row) => row.actorId)).toEqual([harness.actor.id, other.adminId].sort());
  });

  it("preserves a live legacy claim and refuses to replay its stored response", async () => {
    const harness = h!;
    const key = newId("legacy_key");
    const secretLegacyBody = { id: "legacy-response-must-not-leak" };
    await harness.pg.query(
      `INSERT INTO idempotency_keys
         (id, key, route, "requestHash", "responseStatus", "responseBody", "expiresAt")
       VALUES ($1, $2, 'POST /customers', 'legacy-hash', 201, $3::jsonb, $4)`,
      [newId("legacy_claim"), key, JSON.stringify(secretLegacyBody), new Date(Date.now() + 60 * 60 * 1000)],
    );

    const response = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload: { name: `Legacy claim ${newId("customer")}` },
      headers: { "idempotency-key": key },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
    expect(JSON.stringify(response.json())).not.toContain(secretLegacyBody.id);
    const preserved = await harness.pg.query(
      `SELECT "actorId", "responseBody" FROM idempotency_keys WHERE key = $1 AND route = 'POST /customers'`,
      [key],
    );
    expect(preserved.rows).toEqual([{ actorId: null, responseBody: secretLegacyBody }]);
  });

  it("releases an expired legacy claim so an actor can claim the key", async () => {
    const harness = h!;
    const key = newId("expired_legacy");
    await harness.pg.query(
      `INSERT INTO idempotency_keys
         (id, key, route, "requestHash", "responseStatus", "responseBody", "expiresAt")
       VALUES ($1, $2, 'POST /customers', 'expired-hash', 201, '{}'::jsonb,
               (now() AT TIME ZONE 'UTC') - INTERVAL '1 minute')`,
      [newId("expired_claim"), key],
    );

    const response = await harness.app.inject({
      method: "POST",
      url: "/customers",
      payload: { name: `Expired claim ${newId("customer")}` },
      headers: { "idempotency-key": key },
    });

    expect(response.statusCode).toBe(201);
    const claim = await harness.pg.query(
      `SELECT "actorId", "responseStatus" FROM idempotency_keys WHERE key = $1 AND route = 'POST /customers'`,
      [key],
    );
    expect(claim.rows).toEqual([{ actorId: harness.actor.id, responseStatus: 201 }]);
  });
});
