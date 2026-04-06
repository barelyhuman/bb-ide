export interface SandboxDaemonEnvConfig {
  anthropicApiKey: string;
  githubPat: string;
  openAiApiKey: string;
}

export function buildSandboxDaemonEnv(
  config: SandboxDaemonEnvConfig,
): Record<string, string> {
  const daemonEnv: Record<string, string> = {};

  if (config.githubPat !== "") {
    daemonEnv.GITHUB_TOKEN = config.githubPat;
  }
  if (config.openAiApiKey !== "") {
    daemonEnv.OPENAI_API_KEY = config.openAiApiKey;
  }
  if (config.anthropicApiKey !== "") {
    daemonEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }

  return daemonEnv;
}
