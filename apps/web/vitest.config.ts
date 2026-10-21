import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
  },
});
