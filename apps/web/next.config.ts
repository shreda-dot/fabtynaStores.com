import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const baseConfig: NextConfig = {
  transpilePackages: ["@fabtyna/shared"],
  allowedDevOrigins: ["127.0.0.1"],
  // `build:verify` sets NEXT_DIST_DIR so it never writes into the folder a running `next dev` uses
  // (interleaving the two corrupts chunks and causes endless page reloads).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

/**
 * `next build` fails unless the app is built for the real API. The default mode
 * is "mock" (the demo login, which accepts any email and password, and
 * browser-only data), and NEXT_PUBLIC_* values are inlined at build time, so a
 * wrong build cannot be corrected on the host afterwards. `next dev` and
 * `next start` are not affected. Keep the rules in step with lib/api/mode-guard.ts.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    const problems: string[] = [];
    if (process.env.NEXT_PUBLIC_API_MODE !== "real") {
      problems.push('NEXT_PUBLIC_API_MODE must be "real" (it is unset or "mock").');
    }
    const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
    if (baseUrl === "") {
      problems.push("NEXT_PUBLIC_API_BASE_URL must be set to the API's public origin.");
    } else {
      try {
        new URL(baseUrl);
      } catch {
        problems.push("NEXT_PUBLIC_API_BASE_URL must be a valid absolute URL.");
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `Refusing to build the web app for production:\n  - ${problems.join("\n  - ")}\n` +
          "See docs/DEPLOY.md. (For the local verify build use `pnpm --filter @fabtyna/web build:verify`.)",
      );
    }
  }
  return baseConfig;
}