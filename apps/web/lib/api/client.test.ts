import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./client";
import {
  createIdempotencyIntent,
  createIdempotencyKey,
} from "./idempotency-intent";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:3001";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("maps the API validation envelope into ApiError with field details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request",
              details: { field: "name", message: "Name is required" },
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(requestJson("/products", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError",
      kind: "validation",
      code: "VALIDATION_ERROR",
      details: { field: "name", message: "Name is required" },
    });
  });

  it("classifies 401 responses as unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Login required" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(requestJson("/auth/me")).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("retries a GET once after a network error, then reports network kind", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    await expect(requestJson("/products")).rejects.toMatchObject({
      kind: "network",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves Retry-After on rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "RATE_LIMITED", message: "Slow down" } }),
          { status: 429, headers: { "content-type": "application/json", "retry-after": "45" } },
        ),
      ),
    );

    await expect(requestJson("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 45,
    });
  });

  it("classifies a timed-out write as an unknown outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    const pending = requestJson("/sales", {
      method: "POST",
      body: {},
      idempotencyKey: "intent-12345678",
      timeoutMs: 5,
    });
    await expect(pending).rejects.toMatchObject({
      kind: "unknown-outcome",
    });
  });

  it("does not reveal the server response body for a 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "INTERNAL", message: "private stack detail" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(requestJson("/products")).rejects.toMatchObject({
      kind: "server",
      userMessage: "The service could not complete the request. Please try again.",
    });
  });

  it("classifies a non-JSON proxy response separately from a JSON server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await expect(requestJson("/products")).rejects.toMatchObject({
      kind: "non-json",
      status: 502,
      userMessage: "The server returned an unreadable response. Please try again.",
    });
  });

  it("marks 503 responses as retryable without retrying the mutation", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "UNAVAILABLE", message: "Try again" } }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      requestJson("/sales", { method: "POST", body: {}, idempotencyKey: "intent-key-0001" }),
    ).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency intent", () => {
  it("creates UUID request keys within the API's accepted length range", () => {
    const key = createIdempotencyKey();

    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("reuses a key while retrying and renews it after success or reset", () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce("intent-key-0001")
      .mockReturnValueOnce("intent-key-0002")
      .mockReturnValueOnce("intent-key-0003");
    const intent = createIdempotencyIntent(createKey);

    const firstAttempt = intent.getKey();
    expect(firstAttempt).toHaveLength(15);
    expect(intent.getKey()).toBe(firstAttempt);
    intent.markSucceeded();
    expect(intent.getKey()).toBe("intent-key-0002");
    intent.reset();
    expect(intent.getKey()).toBe("intent-key-0003");
  });
});
