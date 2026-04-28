import fs from "node:fs/promises";
import path from "node:path";
import { fuzzyMatchPaths } from "@bb/fuzzy-match";

export interface FinalizeListedFilesArgs {
  filePaths: string[];
  limit: number;
  query?: string;
}

export interface FinalizedFileList {
  files: Array<{ path: string; name: string }>;
  truncated: boolean;
}

export function finalizeListedFiles(
  args: FinalizeListedFilesArgs,
): FinalizedFileList {
  let filePaths = args.filePaths;
  if (args.query) {
    const matchLimit = args.limit + 1;
    filePaths = fuzzyMatchPaths({
      items: filePaths,
      query: args.query,
      getPath: (filePath) => filePath,
      limit: matchLimit,
    }).map((match) => match.item);
  }

  let truncated = false;
  if (filePaths.length > args.limit) {
    filePaths = filePaths.slice(0, args.limit);
    truncated = true;
  }

  return {
    files: filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
    })),
    truncated,
  };
}

export async function listFilesRecursively(
  dir: string,
  root: string,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(fullPath, root)));
      continue;
    }
    results.push(path.relative(root, fullPath));
  }
  return results;
}
