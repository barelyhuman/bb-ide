import fs from "node:fs/promises";
import mimeTypes from "mime-types";
import { CommandDispatchError } from "../command-dispatch-support.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function isFsErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function readTextFile(
  resolvedPath: string,
  resultPath: string,
) {
  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      throw new CommandDispatchError(
        "invalid_path",
        "Path is a directory, not a file",
      );
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new CommandDispatchError(
        "file_too_large",
        `File size ${stat.size} bytes exceeds the 10 MB limit`,
      );
    }

    const content = await fs.readFile(resolvedPath, "utf-8");
    const mimeType = mimeTypes.lookup(resultPath) || undefined;
    return {
      path: resultPath,
      content,
      ...(mimeType ? { mimeType } : {}),
    };
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new CommandDispatchError(
        "ENOENT",
        `Path does not exist: ${resultPath}`,
      );
    }
    throw error;
  }
}
