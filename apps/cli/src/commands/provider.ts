import { Command } from "commander";
import type { AvailableModel } from "@bb/domain";
import type { SystemProviderInfo } from "@bb/server-contract";
import { createClient, unwrap } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { getErrorMessage, outputJson } from "./helpers.js";

export function registerProviderCommands(program: Command, getUrl: () => string): void {
  const provider = program.command("provider").description("Inspect available providers and models");

  provider
    .command("list")
    .description("List available providers")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: { json?: boolean }) => {
      const client = createClient(getUrl());
      try {
        const providers = await unwrap<SystemProviderInfo[]>(
          client.api.v1.system.providers.$get({ query: {} }),
        );
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No providers available");
          return;
        }
        printProviderTable(providers);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  provider
    .command("models [providerId]")
    .description("List available models for a provider")
    .option("--json", "Print machine-readable JSON output")
    .action(async (providerId: string | undefined, opts: { json?: boolean }) => {
      const client = createClient(getUrl());
      try {
        const models = await unwrap<AvailableModel[]>(
          client.api.v1.system.models.$get({
            query: providerId ? { providerId } : {},
          }),
        );
        if (outputJson(opts, models)) return;
        if (models.length === 0) {
          console.log("No models available");
          return;
        }
        printModelTable(models, providerId);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}

function printProviderTable(providers: SystemProviderInfo[]): void {
  const rows = providers.map((provider) => [provider.id, provider.displayName]);
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Name"],
      colWidths: [idWidth, nameWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}

function printModelTable(models: AvailableModel[], providerId?: string): void {
  if (providerId) {
    console.log(`Models for ${providerId}:`);
  }

  const rows = models.map((model) => [
    model.model,
    model.displayName ?? model.model,
    model.isDefault ? "*" : "",
  ]);
  const modelWidth = Math.max(5, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const defaultWidth = Math.max(7, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["Model", "Name", "Default"],
      colWidths: [modelWidth, nameWidth, defaultWidth],
      trimTrailingWhitespace: true,
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
