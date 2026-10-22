import { loadRuntimeEnv } from "./lib/env.js";
import { assertProductionTimeZone } from "./lib/timezone.js";
import { startServer } from "./start.js";

async function main(): Promise<void> {
  const env = loadRuntimeEnv();
  assertProductionTimeZone(env.nodeEnv);
  const { app } = await startServer(env);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  // Startup refusals (guard, missing actor) carry a safe, human-readable message.
  console.error(error instanceof Error ? error.message : "Failed to start the API.");
  process.exit(1);
});
