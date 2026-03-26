import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: workspaceTestAliases,
  },
  test: {
    hookTimeout: 30_000,
    include: ["fake/**/*.test.ts"],
    name: "@bb/integration-tests",
    silent: "passed-only",
    testTimeout: 30_000,
  },
});
