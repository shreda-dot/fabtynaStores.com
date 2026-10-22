// Production build, run with `pnpm --filter @fabtyna/api build`:
//   1. prisma generate   (the generated client in apps/api/generated is git-ignored)
//   2. bundle src/server.ts and the TypeScript source of @fabtyna/shared into
//      ONE ESM file, dist/server.js, that plain `node` can run.
// Every other dependency stays external and is resolved from node_modules at
// runtime, so it must be listed in this package's "dependencies".
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// prisma.config.ts reads DIRECT_URL even for `generate`, which never connects.
// A build host has no database URL, so a non-secret placeholder is used when unset.
const generate = spawnSync("pnpm", ["exec", "prisma", "generate"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    DIRECT_URL: process.env.DIRECT_URL || "postgresql://build:build@localhost:5432/build",
  },
});
if (generate.status !== 0) {
  console.error("prisma generate failed.");
  process.exit(generate.status ?? 1);
}

const external = Object.keys(pkg.dependencies ?? {}).filter((name) => name !== "@fabtyna/shared");

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external,
  logLevel: "info",
});
