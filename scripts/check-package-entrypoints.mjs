import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const workspaceRoots = ["apps", "packages"];
const entrypointFields = ["main", "types", "bin", "exports"];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listWorkspacePackages() {
  const packageDirs = [];

  for (const workspaceRoot of workspaceRoots) {
    const workspacePath = path.join(repoRoot, workspaceRoot);
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packagePath = path.join(workspacePath, entry.name);
      const manifestPath = path.join(packagePath, "package.json");

      try {
        readFileSync(manifestPath, "utf8");
        packageDirs.push(packagePath);
      } catch {
        continue;
      }
    }
  }

  return packageDirs.sort();
}

function collectEntrypoints(value, fieldPath, acc) {
  if (typeof value === "string") {
    acc.push({ fieldPath, target: value });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      collectEntrypoints(nested, `${fieldPath}[${index}]`, acc);
    });
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectEntrypoints(nested, `${fieldPath}.${key}`, acc);
    }
  }
}

function normalizePackPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized;
}

function isCoveredByFiles(target, files) {
  const normalizedTarget = normalizePackPath(target);

  return files.some((fileEntry) => {
    const normalizedFileEntry = normalizePackPath(fileEntry);
    return (
      normalizedTarget === normalizedFileEntry ||
      normalizedTarget.startsWith(`${normalizedFileEntry}/`)
    );
  });
}

function checkManifest(packagePath) {
  const manifestPath = path.join(packagePath, "package.json");
  const manifest = readJson(manifestPath);
  const publishedFiles = Array.isArray(manifest.files)
    ? manifest.files.filter((entry) => typeof entry === "string")
    : [];
  const entrypoints = [];
  const errors = [];

  for (const field of entrypointFields) {
    if (manifest[field] === undefined) {
      continue;
    }

    collectEntrypoints(manifest[field], field, entrypoints);
  }

  if (publishedFiles.length === 0) {
    return [];
  }

  for (const entrypoint of entrypoints) {
    if (!entrypoint.target.startsWith("./")) {
      continue;
    }

    if (!isCoveredByFiles(entrypoint.target, publishedFiles)) {
      errors.push(
        `${manifest.name}: ${entrypoint.fieldPath} -> ${entrypoint.target} is not included by files=[${publishedFiles.join(", ")}]`,
      );
    }
  }

  return errors;
}

const errors = listWorkspacePackages().flatMap(checkManifest);

if (errors.length > 0) {
  console.error("Package entrypoint validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Package entrypoint validation passed.");
