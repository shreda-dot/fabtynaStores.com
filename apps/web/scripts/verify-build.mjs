// Local `verify` build only: runs `next build` with explicit PLACEHOLDER values
// so the production-build guard in next.config.ts is satisfied. The output is
// never deployed; real hosts must set the real values (docs/DEPLOY.md).
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["exec", "next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NEXT_PUBLIC_API_MODE: "real",
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.placeholder.invalid",
  },
});
process.exit(result.status ?? 1);
