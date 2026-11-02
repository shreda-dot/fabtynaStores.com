import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getWriteMessage, writeMessages } from "./write-messages";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if ([".next", "node_modules", "coverage"].includes(entry.name)) return [];
      return sourceFiles(`${directory}/${entry.name}`);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)
      ? [`${directory}/${entry.name}`]
      : [];
  });
}

describe("write messages", () => {
  it("defines a non-empty default message for every operation", () => {
    for (const [operation, message] of Object.entries(writeMessages)) {
      expect(message({}).trim(), operation).not.toBe("");
    }
  });

  it("formats operation values", () => {
    // Hand calculation: the provided sale reference is inserted unchanged into the recorded sentence.
    expect(getWriteMessage("sale.create", { reference: "S-20261026-000019" }))
      .toBe("Sale S-20261026-000019 recorded.");
  });

  it("uses only declared operation keys in web source", () => {
    const declared = new Set(Object.keys(writeMessages));
    const source = sourceFiles(webRoot).map((file) => readFileSync(file, "utf8")).join("\n");
    const operationLiterals = [...source.matchAll(/["']([a-zA-Z]+(?:\.[a-zA-Z]+)+)["']/g)]
      .map((match) => match[1])
      .filter((value) =>
        /^(sale|purchase|payable|account|expense|expenseCategory|transfer|adjustment|loan|product|customer|supplier|debtor|empties|password|demo)\./.test(value),
      );
    expect([...new Set(operationLiterals)].filter((value) => !declared.has(value))).toEqual([]);
  });

  it("keeps toast.success calls in the success-message source and shared toast internals", () => {
    // Built in pieces so this guard does not match itself.
    const call = new RegExp(["toast", "\\s*\\.\\s*", "success", "\\s*\\("].join(""));
    const allowed = new Set([
      "lib/write-messages.ts",
      "hooks/use-write-flow.ts",
      "stores/toast-store.ts",
    ]);
    const violations = sourceFiles(webRoot).filter((file) => {
      const relative = file.slice(webRoot.length + 1).replaceAll("\\", "/");
      return !allowed.has(relative) && call.test(readFileSync(file, "utf8"));
    });
    expect(violations).toEqual([]);
  });
});
