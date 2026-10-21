import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { classifyWriteError, createWriteFlow } from "./write-flow";

function counter() {
  let n = 0;
  return () => `key-${++n}-padding`;
}

const business = new ApiError("unknown", "Not enough stock.", { status: 409 });
const timeout = new ApiError("unknown-outcome", "Unknown outcome.");
const server = new ApiError("server", "Could not complete.", { status: 500 });

describe("classifyWriteError", () => {
  it("treats 4xx answers as failed", () => {
    expect(classifyWriteError(business)).toBe("failed");
    expect(
      classifyWriteError(new ApiError("validation", "x", { status: 422 })),
    ).toBe("failed");
  });
  it("treats timeout, network, 5xx and non-JSON as unknown", () => {
    expect(classifyWriteError(timeout)).toBe("unknown");
    expect(classifyWriteError(new ApiError("network", "x"))).toBe("unknown");
    expect(classifyWriteError(new ApiError("timeout", "x"))).toBe("unknown");
    expect(classifyWriteError(server)).toBe("unknown");
    expect(classifyWriteError(new ApiError("non-json", "x", { status: 502 }))).toBe("unknown");
    expect(classifyWriteError(new Error("boom"))).toBe("unknown");
  });
});

describe("write flow", () => {
  it("starts idle and goes pending on begin", () => {
    const flow = createWriteFlow(counter());
    expect(flow.getState().status).toBe("idle");
    expect(flow.begin()).toBe("key-1-padding");
    expect(flow.getState().status).toBe("pending");
  });

  it("refuses a double submit while pending", () => {
    const flow = createWriteFlow(counter());
    expect(flow.begin()).not.toBeNull();
    expect(flow.begin()).toBeNull();
    expect(flow.getState().status).toBe("pending");
  });

  it("reuses the SAME key after an unknown outcome", () => {
    const flow = createWriteFlow(counter());
    const first = flow.begin();
    expect(flow.fail(timeout)).toBe("unknown");
    expect(flow.getState().status).toBe("unknown");
    expect(flow.begin()).toBe(first);
  });

  it("renews the key after success", () => {
    const flow = createWriteFlow(counter());
    const first = flow.begin();
    flow.succeed();
    expect(flow.getState().status).toBe("success");
    expect(flow.begin()).not.toBe(first);
  });

  it("keeps the key after a business failure until the user edits", () => {
    const flow = createWriteFlow(counter());
    const first = flow.begin();
    expect(flow.fail(business)).toBe("failed");
    expect(flow.getState().status).toBe("failed");
    // Same form, no edit: same key.
    expect(flow.begin()).toBe(first);
    flow.fail(business);
    flow.edit();
    expect(flow.getState().status).toBe("idle");
    expect(flow.begin()).not.toBe(first);
  });

  it("renews the key when the form is edited after an unknown outcome", () => {
    const flow = createWriteFlow(counter());
    const first = flow.begin();
    flow.fail(server);
    flow.edit();
    expect(flow.getState().status).toBe("idle");
    expect(flow.begin()).not.toBe(first);
  });

  it("ignores edits while pending (the key must not change mid-flight)", () => {
    const flow = createWriteFlow(counter());
    const first = flow.begin();
    flow.edit();
    expect(flow.getState().status).toBe("pending");
    flow.fail(timeout);
    expect(flow.begin()).toBe(first);
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const flow = createWriteFlow(counter());
    let calls = 0;
    const off = flow.subscribe(() => {
      calls += 1;
    });
    flow.begin();
    flow.succeed();
    expect(calls).toBe(2);
    off();
    flow.reset();
    expect(calls).toBe(2);
  });
});
