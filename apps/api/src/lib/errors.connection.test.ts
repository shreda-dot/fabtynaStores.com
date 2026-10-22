import { describe, expect, it } from "vitest";
import { isConnectionError, mapKnownError } from "./errors.js";

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("mapKnownError: connection-level failures become 503 UNAVAILABLE", () => {
  const cases: Array<[string, unknown]> = [
    ["ENOTFOUND", withCode("getaddrinfo ENOTFOUND db.example.test", "ENOTFOUND")],
    ["EAI_AGAIN", withCode("getaddrinfo EAI_AGAIN db.example.test", "EAI_AGAIN")],
    ["ECONNRESET", withCode("read ECONNRESET", "ECONNRESET")],
    ["ECONNREFUSED", withCode("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")],
    ["ETIMEDOUT", withCode("connect ETIMEDOUT 10.0.0.1:5432", "ETIMEDOUT")],
    ["Connection terminated unexpectedly (no code)", new Error("Connection terminated unexpectedly")],
    ["Connection terminated due to connection timeout", new Error("Connection terminated due to connection timeout")],
    ["timeout expired (no code)", new Error("timeout expired")],
    ["timeout exceeded when trying to connect", new Error("timeout exceeded when trying to connect")],
    [
      "wrapped by the Prisma driver adapter (meta.driverAdapterError.cause)",
      Object.assign(new Error("Driver adapter error"), {
        code: "P2010",
        meta: { driverAdapterError: { cause: withCode("read ECONNRESET", "ECONNRESET") } },
      }),
    ],
    ["wrapped in Error.cause", new Error("query failed", { cause: new Error("Connection terminated unexpectedly") })],
    [
      "AggregateError (dual-stack ECONNREFUSED)",
      Object.assign(new Error(""), {
        errors: [withCode("connect ECONNREFUSED ::1:5432", "ECONNREFUSED"), withCode("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")],
      }),
    ],
  ];

  it.each(cases)("%s", (_label, error) => {
    expect(isConnectionError(error)).toBe(true);
    const mapped = mapKnownError(error);
    expect(mapped?.status).toBe(503);
    expect(mapped?.toEnvelope().error.code).toBe("UNAVAILABLE");
    expect(JSON.stringify(mapped?.toEnvelope())).not.toMatch(/ENOTFOUND|ECONN|ETIMEDOUT|example\.test|127\.0\.0\.1/);
  });

  it("does not turn ordinary errors into 503", () => {
    expect(isConnectionError(new Error("something else"))).toBe(false);
    expect(isConnectionError(new Error("statement timeout"))).toBe(false);
    expect(mapKnownError(new Error("something else"))).toBeNull();
  });
});
