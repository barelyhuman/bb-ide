import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@beanbag/daemon",
    exclude: ["dist/**", "node_modules/**"],
  },
});
