import { describe, expect, it } from "vitest";
import { productionTimeZoneProblem } from "./timezone.js";

describe("productionTimeZoneProblem", () => {
  it("never complains outside production", () => {
    expect(productionTimeZoneProblem("development", "Africa/Lagos", "Africa/Lagos")).toBeNull();
    expect(productionTimeZoneProblem("test", undefined, "America/New_York")).toBeNull();
  });

  it("accepts UTC, declared or resolved", () => {
    expect(productionTimeZoneProblem("production", "UTC", "Africa/Lagos")).toBeNull();
    expect(productionTimeZoneProblem("production", undefined, "UTC")).toBeNull();
    expect(productionTimeZoneProblem("production", " Etc/UTC ", "UTC")).toBeNull();
  });

  it("refuses any other zone in production", () => {
    expect(productionTimeZoneProblem("production", "Africa/Lagos", "Africa/Lagos")).toMatch(/TZ must be UTC/);
    expect(productionTimeZoneProblem("production", undefined, "Africa/Lagos")).toMatch(/TZ must be UTC/);
  });
});
