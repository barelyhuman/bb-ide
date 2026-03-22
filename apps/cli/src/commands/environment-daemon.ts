import { Command } from "commander";

export function registerEnvironmentDaemonCommand(program: Command): void {
  program
    .command("environment-daemon")
    .description("Environment-daemon has been removed during the clean-slate rebuild")
    .action(() => {
      console.error(
        "The standalone environment-daemon has been removed in this rebuild stage. Rebuild the new daemon service before using this command again.",
      );
      process.exit(1);
    });
}
