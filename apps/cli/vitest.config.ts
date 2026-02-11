import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@beanbag/cli",
    exclude: ["dist/**", "node_modules/**"],
  },
});
