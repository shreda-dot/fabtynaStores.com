import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/lib/password.js";
import { buildLoggerOptions } from "../src/lib/logging.js";
import { createHarness, newId, type Harness } from "./sales-fixtures.js";

const lines: string[] = [];
const stream = new Writable({
  write(chunk, _encoding, callback) {
    lines.push(String(chunk));
    callback();
  },
});

let h!: Harness;

beforeAll(async () => {
  h = await createHarness({ logger: buildLoggerOptions({ stream }) });
});

afterAll(async () => {
  await h.close();
});

describe("log redaction", () => {
  it("a logged login request leaves no password, cookie or hash in the log output", async () => {
    const password = `Pw-${newId("redact")}-correct-horse`;
    const passwordHash = await hashPassword(password);
    const id = newId("redact_user");
    const email = `${id}@example.test`;
    await h.pg.query(`INSERT INTO admin_users (id, email, "passwordHash", "updatedAt") VALUES ($1,$2,$3,now())`, [
      id,
      email,
      passwordHash,
    ]);
    lines.length = 0;

    const response = await h.injectAnonymous({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        cookie: "fabtyna_session=incoming-cookie-secret",
        authorization: "Bearer incoming-bearer-secret",
      },
    });
    expect(response.statusCode).toBe(204);
    const setCookie = String(response.headers["set-cookie"]);
    const sessionToken = /fabtyna_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(sessionToken.length).toBeGreaterThan(20);

    const output = lines.join("");
    expect(output.length).toBeGreaterThan(0); // the request WAS logged
    for (const secret of [password, passwordHash, sessionToken, "incoming-cookie-secret", "incoming-bearer-secret"]) {
      expect(output).not.toContain(secret);
    }

    // The login wrote an immutable audit row, so the throwaway user stays (like other test actors).
    await h.pg.query(`DELETE FROM admin_sessions WHERE "adminUserId" = $1`, [id]);
  });

  it("explicitly logged headers and body fields are censored", () => {
    lines.length = 0;
    h.app.log.info(
      {
        req: { headers: { cookie: "cookie-secret-1", authorization: "auth-secret-1" } },
        res: { headers: { "set-cookie": "setcookie-secret-1" } },
        body: { password: "p-secret-1", currentPassword: "p-secret-2", newPassword: "p-secret-3", passwordHash: "p-secret-4" },
      },
      "redaction probe",
    );
    const output = lines.join("");
    expect(output).toContain("redaction probe");
    expect(output).toContain("[Redacted]");
    expect(output).not.toMatch(/(cookie|auth|setcookie)-secret-1|p-secret-[1-4]/);
  });
});
