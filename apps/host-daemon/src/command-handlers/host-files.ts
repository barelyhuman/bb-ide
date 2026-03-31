import path from "node:path";
import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { readTextFile } from "./file-read.js";

export async function readHostFile(
  command: CommandOf<"host.read_file">,
): Promise<HostDaemonCommandResult<"host.read_file">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError(
      "invalid_path",
      "Path must be absolute",
    );
  }

  return readTextFile(command.path, command.path);
}
