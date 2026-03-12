const THREAD_COMMAND_OPTION_SPECS: Record<
  string,
  {
    optionsWithValues: Set<string>;
    flagOptions: Set<string>;
  }
> = {
  status: {
    optionsWithValues: new Set(["--recent-events", "--event-mode"]),
    flagOptions: new Set(["--include-low-signal"]),
  },
  show: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  archive: {
    optionsWithValues: new Set(),
    flagOptions: new Set(["--force"]),
  },
  unarchive: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  tell: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  steer: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  commit: {
    optionsWithValues: new Set(["--message"]),
    flagOptions: new Set(["--staged-only"]),
  },
  "squash-merge": {
    optionsWithValues: new Set([
      "--commit-message",
      "--squash-message",
      "--merge-base-branch",
    ]),
    flagOptions: new Set(["--commit-if-needed", "--staged-only"]),
  },
  stop: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  promote: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  demote: {
    optionsWithValues: new Set(["--project"]),
    flagOptions: new Set(),
  },
  log: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  output: {
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
};

function normalizeThreadSubcommandArgs(args: string[]): string[] {
  if (args.length < 2) {
    return args;
  }

  const [group, subcommand, ...rest] = args;
  if (group !== "thread") {
    return args;
  }
  if (rest.includes("--")) {
    return args;
  }

  const spec = THREAD_COMMAND_OPTION_SPECS[subcommand];
  if (!spec) {
    return args;
  }

  const normalized: string[] = [group, subcommand];
  let insertedSeparator = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!insertedSeparator && value.startsWith("-")) {
      if (spec.flagOptions.has(value)) {
        normalized.push(value);
        continue;
      }
      if (spec.optionsWithValues.has(value)) {
        normalized.push(value);
        index += 1;
        if (index < rest.length) {
          normalized.push(rest[index]);
        }
        continue;
      }
      normalized.push("--");
      insertedSeparator = true;
    } else if (!insertedSeparator) {
      insertedSeparator = true;
    }
    normalized.push(value);
  }

  return normalized;
}

export function normalizeCliArgv(argv: string[]): string[] {
  const [nodePath, scriptPath, ...args] = argv;
  if (args.length === 0) {
    return argv;
  }
  const normalizedArgs = normalizeThreadSubcommandArgs(args);
  return [nodePath, scriptPath, ...normalizedArgs];
}
