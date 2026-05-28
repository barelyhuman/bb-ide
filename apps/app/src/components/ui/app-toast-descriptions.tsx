interface AppToastCommandDescriptionProps {
  command: string;
}

interface AppToastCommitDescriptionProps {
  commitSha: string;
  commitSubject: string;
}

const GIT_SHA_DETAIL_LENGTH = 7;

export function AppToastCommandDescription({
  command,
}: AppToastCommandDescriptionProps) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden whitespace-nowrap leading-5"
      title={`Running ${command}`}
    >
      <span className="shrink-0 whitespace-pre text-muted-foreground">
        Running
      </span>{" "}
      <span className="min-w-0 truncate whitespace-pre font-semibold text-foreground">
        {command}
      </span>
    </span>
  );
}

export function AppToastCommitDescription({
  commitSha,
  commitSubject,
}: AppToastCommitDescriptionProps) {
  const shortSha = commitSha.slice(0, GIT_SHA_DETAIL_LENGTH);

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap leading-5"
      title={`${shortSha} · ${commitSubject}`}
    >
      <span className="shrink-0 whitespace-pre font-mono text-foreground">
        {shortSha}
      </span>
      <span className="shrink-0 whitespace-pre text-muted-foreground">·</span>
      <span className="min-w-0 truncate whitespace-pre text-muted-foreground">
        {commitSubject}
      </span>
    </span>
  );
}
