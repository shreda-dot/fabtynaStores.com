import { describe, expect, it } from "vitest";
import { resolveSslConfig } from "./ssl.js";

const REMOTE = "postgres://user:s3cret@db.example-host.test:5432/app";

describe("resolveSslConfig", () => {
  it("is on by default when there is no sslmode", () => {
    expect(resolveSslConfig(REMOTE)).toEqual({ rejectUnauthorized: false });
    expect(resolveSslConfig("postgres://u:p@localhost:5432/app")).toEqual({ rejectUnauthorized: false });
  });

  it("is on for require and verify-full", () => {
    expect(resolveSslConfig(`${REMOTE}?sslmode=require`)).toEqual({ rejectUnauthorized: false });
    expect(resolveSslConfig(`${REMOTE}?sslmode=verify-full`)).toEqual({ rejectUnauthorized: false });
  });

  it("is off for sslmode=disable on localhost, 127.0.0.1 and ::1", () => {
    expect(resolveSslConfig("postgres://u:p@localhost:5432/app?sslmode=disable")).toBe(false);
    expect(resolveSslConfig("postgres://u:p@127.0.0.1:5432/app?sslmode=disable")).toBe(false);
    expect(resolveSslConfig("postgres://u:p@[::1]:5432/app?sslmode=disable")).toBe(false);
  });

  it("refuses sslmode=disable on a remote host", () => {
    expect(() => resolveSslConfig(`${REMOTE}?sslmode=disable`)).toThrow(/only allowed for localhost/);
  });

  it("never puts the URL, password or host in an error message", () => {
    const messages: string[] = [];
    for (const input of [`${REMOTE}?sslmode=disable`, "not a url with s3cret"]) {
      try {
        resolveSslConfig(input);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toContain("s3cret");
      expect(message).not.toContain("example-host");
      expect(message).not.toContain("postgres://");
    }
  });
});
