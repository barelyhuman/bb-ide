import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@beanbag/db",
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
