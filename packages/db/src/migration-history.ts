export interface PublishedMigrationWhen {
  tag: string;
  when: number;
}

export interface AcceptedHistoricalMigrationHash {
  hash: string;
  tag: string;
  when: number;
}

export const publishedMigrationWhens = [
  { tag: "0000_baseline", when: 1778891867195 },
  { tag: "0001_terminal_session_user_input", when: 1779139400000 },
  { tag: "0002_closed_session_prune_indexes", when: 1779139400001 },
] as const satisfies readonly PublishedMigrationWhen[];

export const publishedMigrationWhensByTag: ReadonlyMap<string, number> =
  new Map(publishedMigrationWhens.map((entry) => [entry.tag, entry.when]));

export const acceptedHistoricalMigrationHashes = [
  {
    hash: "18f46aa3bf57a4abb2f938305edd9e05dd697173ed11dd952d1625918980b437",
    tag: "0016_salty_arclight",
    when: 1780692763264,
  },
] as const satisfies readonly AcceptedHistoricalMigrationHash[];
