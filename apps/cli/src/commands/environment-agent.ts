import { Command } from "commander";
import { EnvironmentAgentRuntime } from "@beanbag/environment-agent";

interface EnvironmentAgentOptions {
  providerCommand: string;
  providerArg?: string[];
  providerLaunchCommand?: string;
  providerLaunchArg?: string[];
}

export function registerEnvironmentAgentCommand(program: Command): void {
  program
    .command("environment-agent")
    .description("Run the environment-agent relay process")
    .allowUnknownOption(false)
    .option(
      "--provider-command <command>",
      "Provider runtime command to launch inside the environment",
    )
    .option(
      "--provider-arg <arg>",
      "Provider runtime argument (repeatable)",
      collectRepeatableOption,
      [],
    )
    .option(
      "--provider-launch-command <command>",
      "Optional command wrapper used to launch the provider runtime",
    )
    .option(
      "--provider-launch-arg <arg>",
      "Optional provider launcher argument (repeatable)",
      collectRepeatableOption,
      [],
    )
    .action((opts: EnvironmentAgentOptions) => {
      const providerCommand = opts.providerCommand?.trim();
      if (!providerCommand) {
        console.error("Missing required --provider-command");
        process.exit(1);
        return;
      }

      const runtime = new EnvironmentAgentRuntime({
        threadId: process.env.BB_THREAD_ID,
        projectId: process.env.BB_PROJECT_ID,
        environmentId: process.env.BB_ENVIRONMENT_ID,
        providerCommand,
        providerArgs: opts.providerArg ?? [],
        providerLaunchCommand: opts.providerLaunchCommand?.trim(),
        providerLaunchArgs: opts.providerLaunchArg ?? [],
      });
      const child = runtime.start();

      const forwardSignal = (signal: NodeJS.Signals) => {
        try {
          child.kill(signal);
        } catch {
          // Ignore shutdown races.
        }
      };

      process.on("SIGINT", () => forwardSignal("SIGINT"));
      process.on("SIGTERM", () => forwardSignal("SIGTERM"));

      child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (signal) {
          process.kill(process.pid, signal);
          return;
        }
        process.exit(code ?? 1);
      });

      child.once("error", (error: Error) => {
        console.error(error.message);
        process.exit(1);
      });
    });
}

function collectRepeatableOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
