import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["i"], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
