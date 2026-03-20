const ENVIRONMENT_DAEMON_ENVIRONMENT_CHANNEL_PREFIX = "environment:";

export function getEnvironmentDaemonEnvironmentChannelId(
  environmentId: string,
): string {
  return `${ENVIRONMENT_DAEMON_ENVIRONMENT_CHANNEL_PREFIX}${environmentId}`;
}

export function resolveEnvironmentIdForEnvironmentDaemonChannel(
  channelId: string,
): string | undefined {
  if (!channelId.startsWith(ENVIRONMENT_DAEMON_ENVIRONMENT_CHANNEL_PREFIX)) {
    return undefined;
  }

  const environmentId = channelId
    .slice(ENVIRONMENT_DAEMON_ENVIRONMENT_CHANNEL_PREFIX.length)
    .trim();
  return environmentId.length > 0 ? environmentId : undefined;
}
