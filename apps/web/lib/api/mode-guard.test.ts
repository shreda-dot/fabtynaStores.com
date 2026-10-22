import { describe, expect, it } from "vitest";
import { productionApiModeProblem } from "./mode-guard";

describe("productionApiModeProblem", () => {
  it("never complains in dev or test", () => {
    expect(productionApiModeProblem("development", undefined, undefined)).toBeNull();
    expect(productionApiModeProblem("test", "mock", undefined)).toBeNull();
    expect(productionApiModeProblem(undefined, undefined, undefined)).toBeNull();
  });

  it("refuses production without real mode (including the unset default)", () => {
    expect(productionApiModeProblem("production", undefined, "https://api.example.com")).toMatch(/real/);
    expect(productionApiModeProblem("production", "mock", "https://api.example.com")).toMatch(/real/);
  });

  it("refuses production without a valid base URL", () => {
    expect(productionApiModeProblem("production", "real", undefined)).toMatch(/BASE_URL/);
    expect(productionApiModeProblem("production", "real", "  ")).toMatch(/BASE_URL/);
    expect(productionApiModeProblem("production", "real", "not a url")).toMatch(/valid absolute URL/);
  });

  it("accepts real mode with a base URL", () => {
    expect(productionApiModeProblem("production", "real", "https://api.example.com")).toBeNull();
  });
});
