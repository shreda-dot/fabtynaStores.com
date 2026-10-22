import { describe, expect, it } from "vitest";
import {
  assertConfirmedDatabase,
  classifyDatabase,
  databaseNameOf,
  describeDatabase,
  parseTargetArgs,
  redactConnectionDetails,
  resolveConnectionString,
} from "./db-target.js";

const URL_TEXT = "postgresql://user:s3cretpw@db.example.com:5432/fabtyna_dev?sslmode=require";

describe("databaseNameOf / classifyDatabase", () => {
  it("reads only the database name", () => {
    expect(databaseNameOf(URL_TEXT)).toBe("fabtyna_dev");
  });

  it("classifies by name; unknown names are prod", () => {
    expect(classifyDatabase("fabtyna_dev")).toBe("dev");
    expect(classifyDatabase("fabtyna_test")).toBe("test");
    expect(classifyDatabase("neondb")).toBe("prod");
    expect(classifyDatabase("fabtyna")).toBe("prod");
    expect(describeDatabase("fabtyna_test")).toBe("fabtyna_test [test]");
  });
});

describe("assertConfirmedDatabase", () => {
  it("passes when the names match", () => {
    expect(() => assertConfirmedDatabase("neondb", "neondb")).not.toThrow();
  });

  it("refuses a missing, empty or different name, without revealing the real name or any URL", () => {
    for (const confirmed of [null, "", "  ", "fabtyna_dev"]) {
      let message = "";
      try {
        assertConfirmedDatabase("neondb", confirmed);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("Refusing to run");
      expect(message).not.toContain("neondb");
      expect(message).not.toMatch(/postgres(ql)?:\/\//);
    }
  });
});

describe("parseTargetArgs", () => {
  it("parses --url and --confirm-db in both forms plus flags", () => {
    const parsed = parseTargetArgs(["--url", "DIRECT_URL", "--confirm-db=neondb", "--additional"], {
      confirmDb: true,
      flags: ["--additional"],
    });
    expect(parsed.url).toBe("DIRECT_URL");
    expect(parsed.confirmDb).toBe("neondb");
    expect(parsed.flags.has("--additional")).toBe(true);
  });

  it("rejects unknown arguments and --confirm-db when not enabled", () => {
    expect(() => parseTargetArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseTargetArgs(["--confirm-db", "x"])).toThrow(/Unknown argument/);
    expect(() => parseTargetArgs(["--url"])).toThrow(/requires a value/);
  });
});

describe("resolveConnectionString", () => {
  it("uses the default variable when --url is omitted, and a literal URL as is", () => {
    const env = { DIRECT_URL: URL_TEXT } as NodeJS.ProcessEnv;
    expect(resolveConnectionString(null, "DIRECT_URL", "t", env).source).toBe("DIRECT_URL");
    expect(resolveConnectionString(URL_TEXT, "DIRECT_URL", "t", env).source).toBe("--url (literal)");
  });

  it("refuses an unset variable without printing a URL", () => {
    expect(() => resolveConnectionString("MISSING", "DIRECT_URL", "t", {})).toThrow(/MISSING is empty or not set/);
  });
});

describe("redactConnectionDetails", () => {
  it("removes the URL, password and host from child output", () => {
    const text = `error connecting to db.example.com with s3cretpw via ${URL_TEXT}`;
    const out = redactConnectionDetails(text, URL_TEXT);
    expect(out).not.toContain("s3cretpw");
    expect(out).not.toContain("db.example.com");
    expect(out).not.toContain("postgresql://");
  });
});
