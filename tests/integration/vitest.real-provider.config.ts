import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: workspaceTestAliases,
  },
  test: {
    hookTimeout: 120_000,
    include: ["real/**/*.test.ts"],
    name: "@bb/integration-tests:real",
    silent: "passed-only",
    testTimeout: 120_000,
  },
});
