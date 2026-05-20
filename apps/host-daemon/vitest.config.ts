import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: workspaceTestAliases,
  },
  test: {
    silent: "passed-only",
    name: "@bb/host-daemon",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    env: {
      BB_DATA_DIR: "/tmp/bb-host-daemon-test",
      BB_SERVER_URL: "http://127.0.0.1:49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
    testTimeout: 15_000,
  },
});
