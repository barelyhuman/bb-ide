export interface PublishedMigrationWhen {
  tag: string;
  when: number;
}

export interface GetPublishedMigrationWhenArgs {
  tag: string;
}

export const publishedMigrationWhens = [
  { tag: "0000_baseline", when: 1778891867195 },
  { tag: "0001_terminal_session_user_input", when: 1779139400000 },
  { tag: "0002_closed_session_prune_indexes", when: 1779139400001 },
] as const satisfies readonly PublishedMigrationWhen[];

export const publishedMigrationWhensByTag: ReadonlyMap<string, number> =
  new Map(publishedMigrationWhens.map((entry) => [entry.tag, entry.when]));

export const latestPublishedMigrationWhen = Math.max(
  ...publishedMigrationWhens.map((entry) => entry.when),
);

export function getPublishedMigrationWhen(
  args: GetPublishedMigrationWhenArgs,
): number {
  const when = publishedMigrationWhensByTag.get(args.tag);
  if (when === undefined) {
    throw new Error(`No published migration timestamp for ${args.tag}`);
  }

  return when;
}
