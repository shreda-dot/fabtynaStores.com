import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken } from "../src/auth/session.js";
import { hashPassword } from "../src/lib/password.js";
import type { PasswordResetEmail } from "../src/lib/mailer.js";
import { createResendMailer, MailSendError } from "../src/lib/mailer.js";
import { createHarness, newId, type Harness } from "./sales-fixtures.js";

const WEB_ORIGIN = "http://localhost:3000";
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-passphrase-42";

const sent: PasswordResetEmail[] = [];
const recordingMailer = {
  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    sent.push(email);
  },
};

let h!: Harness;
let oldPasswordHash = "";

beforeAll(async () => {
  oldPasswordHash = await hashPassword(OLD_PASSWORD);
  h = await createHarness({ mailer: recordingMailer });
});

afterAll(async () => {
  await h.close();
});

/** A fresh admin per test, so the per-address request limiter never carries over. */
async function seedAdmin(): Promise<string> {
  const id = newId("reset_admin");
  const email = `${id}@example.test`;
  await h.pg.query(
    `INSERT INTO admin_users (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, now())`,
    [id, email, oldPasswordHash],
  );
  return email;
}

function post(url: string, body: unknown) {
  return h.injectAnonymous({
    method: "POST",
    url,
    payload: body as object,
    headers: { origin: WEB_ORIGIN },
  });
}

function forgot(email: string) {
  return post("/auth/forgot-password", { email });
}

function reset(token: string, newPassword = NEW_PASSWORD) {
  return post("/auth/reset-password", { token, newPassword });
}

function tokenFromLastEmail(): string {
  const email = sent[sent.length - 1];
  if (email === undefined) throw new Error("No reset email was sent.");
  const token = new URL(email.resetUrl).searchParams.get("token");
  if (token === null) throw new Error("The reset email carried no token.");
  return token;
}

async function passwordOf(email: string): Promise<string | null> {
  const user = await h.prisma.adminUser.findUnique({ where: { email }, select: { passwordHash: true } });
  return user?.passwordHash ?? null;
}

describe("POST /auth/forgot-password", () => {
  it("answers identically for an address that exists and one that does not", async () => {
    const email = await seedAdmin();
    const before = sent.length;
    const known = await forgot(email);
    const unknown = await forgot(`${newId("nobody")}@example.test`);

    expect(known.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(204);
    expect(sent.length).toBe(before + 1);
    expect(sent[sent.length - 1]?.to).toBe(email);
  });

  it("stores only the hash of the token and links to the web reset page", async () => {
    const email = await seedAdmin();
    expect((await forgot(email)).statusCode).toBe(204);

    const token = tokenFromLastEmail();
    expect(sent[sent.length - 1]?.expiresInMinutes).toBe(30);
    expect(sent[sent.length - 1]?.resetUrl.startsWith(`${WEB_ORIGIN}/reset-password?token=`)).toBe(true);

    const raw = await h.prisma.passwordResetToken.findFirst({ where: { tokenHash: token } });
    expect(raw).toBeNull();

    const stored = await h.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(stored).not.toBeNull();
    expect(stored?.usedAt).toBeNull();
  });

  it("retires the previous link when a new one is requested", async () => {
    const email = await seedAdmin();
    expect((await forgot(email)).statusCode).toBe(204);
    const first = tokenFromLastEmail();
    expect((await forgot(email)).statusCode).toBe(204);
    const second = tokenFromLastEmail();

    expect(first).not.toBe(second);
    expect((await reset(first)).statusCode).toBe(400);
    expect((await reset(second)).statusCode).toBe(204);
  });

  it("rate-limits repeated requests for one address", async () => {
    const email = await seedAdmin();
    const statuses: number[] = [];
    // 5 are allowed in the window; the 6th is refused.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await forgot(email);
      statuses.push(response.statusCode);
      if (response.statusCode === 429) {
        expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
      }
    }
    expect(statuses.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(statuses[5]).toBe(429);
  });
});

describe("POST /auth/reset-password", () => {
  it("sets the new password, revokes every session, and burns the link", async () => {
    const email = await seedAdmin();
    const user = await h.prisma.adminUser.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const sessionToken = "reset_test_session_token";
    await h.pg.query(
      `INSERT INTO admin_sessions (id, "adminUserId", "tokenHash", "createdAt", "lastSeenAt", "expiresAt")
       VALUES ($1, $2, $3, now(), now(), now() + interval '7 days')`,
      [newId("reset_session"), user.id, hashSessionToken(sessionToken)],
    );

    expect((await forgot(email)).statusCode).toBe(204);
    const token = tokenFromLastEmail();
    expect((await reset(token)).statusCode).toBe(204);

    const session = await h.prisma.adminSession.findFirst({ where: { tokenHash: hashSessionToken(sessionToken) } });
    expect(session?.revokedAt).not.toBeNull();

    const stored = await h.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(stored?.usedAt).not.toBeNull();

    const after = await passwordOf(email);
    expect(after).not.toBe(oldPasswordHash);

    // The new password signs in; the old one does not.
    const good = await post("/auth/login", { email, password: NEW_PASSWORD });
    expect(good.statusCode).toBe(204);
    const bad = await post("/auth/login", { email, password: OLD_PASSWORD });
    expect(bad.statusCode).toBe(401);

    // Single use: the same link a second time is refused.
    const replay = await reset(token, "yet-another-passphrase-7");
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({ error: { code: "INVALID_RESET_TOKEN" } });
    expect(await passwordOf(email)).toBe(after);
  });

  it("refuses an unknown, expired, or too-short input", async () => {
    const unknown = await reset("a-token-that-was-never-issued");
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: { code: "INVALID_RESET_TOKEN" } });

    const email = await seedAdmin();
    const user = await h.prisma.adminUser.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const expired = "expired-token-0123456789";
    await h.pg.query(
      `INSERT INTO password_reset_tokens (id, "adminUserId", "tokenHash", "createdAt", "expiresAt")
       VALUES ($1, $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [newId("reset_token"), user.id, hashSessionToken(expired)],
    );
    const stale = await reset(expired);
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toMatchObject({ error: { code: "INVALID_RESET_TOKEN" } });

    const short = await reset(expired, "short");
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ error: { code: "VALIDATION" } });
  });

  it("refuses a reset for a deactivated admin", async () => {
    const email = await seedAdmin();
    expect((await forgot(email)).statusCode).toBe(204);
    const token = tokenFromLastEmail();
    await h.prisma.adminUser.update({ where: { email }, data: { isActive: false } });

    const response = await reset(token);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_RESET_TOKEN" } });
  });
});

describe("password reset without a mail provider", () => {
  let bare!: Harness;

  beforeAll(async () => {
    bare = await createHarness();
  });

  afterAll(async () => {
    await bare.close();
  });

  it("answers 503 instead of pretending to send a link", async () => {
    const response = await bare.injectAnonymous({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "someone@example.test" },
      headers: { origin: WEB_ORIGIN },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "UNAVAILABLE" } });
  });
});

describe("the Resend mailer", () => {
  const request: PasswordResetEmail = {
    to: "owner@example.test",
    resetUrl: "https://app.example.test/reset-password?token=abc123",
    expiresInMinutes: 30,
  };

  it("posts the message to Resend and keeps the key out of the body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mailer = createResendMailer({
      apiKey: "re_secret_key",
      from: "Fabtyna Stores <no-reply@example.test>",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await mailer.sendPasswordReset(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer re_secret_key");
    const body = String(calls[0]?.init.body);
    expect(body).not.toContain("re_secret_key");
    expect(JSON.parse(body)).toMatchObject({
      from: "Fabtyna Stores <no-reply@example.test>",
      to: ["owner@example.test"],
    });
    expect(body).toContain("token=abc123");
  });

  it("reports a rejection as a status, without echoing the provider's body", async () => {
    const mailer = createResendMailer({
      apiKey: "re_secret_key",
      from: "no-reply@example.test",
      fetchImpl: (async () => new Response("api key re_secret_key is invalid", { status: 401 })) as typeof fetch,
    });

    await expect(mailer.sendPasswordReset(request)).rejects.toBeInstanceOf(MailSendError);
    await expect(mailer.sendPasswordReset(request)).rejects.toThrow(/status 401/);
    await expect(mailer.sendPasswordReset(request)).rejects.not.toThrow(/re_secret_key/);
  });
});
