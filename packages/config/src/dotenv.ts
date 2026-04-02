import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenvFlow from "dotenv-flow";

// At runtime this is packages/config/dist/dotenv.js.
// Three levels up reaches the repo root: dist/ → config/ → packages/ → root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Runs on import. Entry points import this module before any config modules
// so that process.env is populated before envsafe reads it.
dotenvFlow.config({ path: repoRoot });
