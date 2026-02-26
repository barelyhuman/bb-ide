import { Command } from "commander";
import { resolveContextSnapshot } from "../context-env.js";

export function registerStatusCommand(
  program: Command,
  _getUrl: () => string,
): void {
  program
    .command("status")
    .description("Show current context")
    .action(async () => {
      const context = resolveContextSnapshot();
      if (context.projectId) {
        console.log(`Project: ${context.projectId}`);
      } else {
        console.log("Project: <unset>");
      }
      if (context.threadId) {
        console.log(`Thread: ${context.threadId}`);
      } else {
        console.log("Thread: <unset>");
      }
    });
}
