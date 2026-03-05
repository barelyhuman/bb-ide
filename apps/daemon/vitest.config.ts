import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases";

export default defineConfig({
  resolve: {
    alias: workspaceTestAliases,
  },
  test: {
    name: "@beanbag/daemon",
    exclude: ["dist/**", "node_modules/**"],
  },
});
