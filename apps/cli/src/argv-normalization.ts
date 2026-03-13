const THREAD_COMMAND_OPTION_SPECS: Record<
  string,
  {
    positionalCount: number;
    optionsWithValues: Set<string>;
    flagOptions: Set<string>;
  }
> = {
  wait: {
    positionalCount: 1,
    optionsWithValues: new Set(["--status", "--event", "--timeout", "--poll-interval"]),
    flagOptions: new Set(),
  },
  sessions: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--json"]),
  },
  status: {
    positionalCount: 1,
    optionsWithValues: new Set(["--recent-events", "--event-mode"]),
    flagOptions: new Set(["--include-low-signal", "--json"]),
  },
  show: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--json"]),
  },
  archive: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--force"]),
  },
  unarchive: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  delete: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--yes"]),
  },
  tell: {
    positionalCount: 2,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--json"]),
  },
  steer: {
    positionalCount: 2,
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  commit: {
    positionalCount: 1,
    optionsWithValues: new Set(["--message"]),
    flagOptions: new Set(["--staged-only"]),
  },
  "squash-merge": {
    positionalCount: 1,
    optionsWithValues: new Set([
      "--commit-message",
      "--squash-message",
      "--merge-base-branch",
    ]),
    flagOptions: new Set(["--commit-if-needed", "--staged-only"]),
  },
  stop: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  promote: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(),
  },
  demote: {
    positionalCount: 1,
    optionsWithValues: new Set(["--project"]),
    flagOptions: new Set(),
  },
  log: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--json"]),
  },
  output: {
    positionalCount: 1,
    optionsWithValues: new Set(),
    flagOptions: new Set(["--json"]),
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

  const optionTokens: string[] = [];
  const positionalTokens: string[] = [];
  const trailingTokens: string[] = [];
  let sawDashPrefixedPositional = false;

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (spec.flagOptions.has(value)) {
      optionTokens.push(value);
      continue;
    }
    if (spec.optionsWithValues.has(value)) {
      optionTokens.push(value);
      index += 1;
      if (index < rest.length) {
        optionTokens.push(rest[index]);
      }
      continue;
    }
    if (positionalTokens.length < spec.positionalCount) {
      positionalTokens.push(value);
      if (value.startsWith("-")) {
        sawDashPrefixedPositional = true;
      }
      continue;
    }
    trailingTokens.push(value);
  }

  if (!sawDashPrefixedPositional) {
    return args;
  }

  const normalized: string[] = [group, subcommand, ...optionTokens, "--", ...positionalTokens];
  if (trailingTokens.length > 0) {
    normalized.push(...trailingTokens);
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
