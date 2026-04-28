# File @-Mention Fuzzy Search

## Problem

Typing `@` in the prompt box returns poor file suggestions. Concrete failure modes users hit today:

1. **No relevance ranking.** Matching is a plain `String.includes` filter at `apps/host-daemon/src/command-handlers/file-list.ts:21-23`, then truncated to `limit` in walk order. Typing `prompt` does not prioritize `apps/app/src/components/promptbox/PromptBox.tsx` over a deeply nested test fixture that happens to contain `prompt`.
2. **No subsequence / typo tolerance.** Substring-only — `pmtbx` returns nothing for `PromptBox.tsx`.
3. **Truncation happens before scoring.** Even if we added scoring on the client, the daemon already cuts to `limit=8` (`apps/host-daemon/src/command-handlers/workspace-files.ts:14-18`) using `.includes` walk order, so good matches are dropped before the client sees them.

Note: `.gitignore` *is* respected when the workspace is a git repo (`packages/host-workspace/src/workspace.ts:502-518` shells out to `git ls-files --cached --others --exclude-standard`). Only the non-git fallback walker is unfiltered, which is rare in practice.

## Reference: openai/codex

Codex's TUI uses Helix's [`nucleo`](https://github.com/helix-editor/nucleo) crate with `Config::DEFAULT.match_paths()` for path-aware scoring (filename boost, consecutive-char bonus, boundary bonus), `CaseMatching::Ignore`, `Normalization::Smart`. File source via the `ignore` crate's `WalkBuilder`. Tiebreaker: ascending path. See `codex-rs/file-search/src/lib.rs:489-575`.

We can't use `nucleo` directly (Rust). The closest JS equivalents:

- **[fzf-for-js](https://github.com/ajitid/fzf-for-js)** — port of fzf v1 algorithm. Path-aware via `tiebreakers: ['begin', 'length']` and `forward: true`. ~12kb gzipped. Subsequence matching with bonus for word-boundary and consecutive characters. Closest behaviorally to nucleo.
- **[fzy](https://github.com/jhawthorn/fzy.js)** — small (1kb), simple subsequence scoring. Less path-aware.
- **[uFuzzy](https://github.com/leeoniya/uFuzzy)** — fast, but tuned for prose, not paths.

**Recommendation: `fzf-for-js`.** It's the closest 1:1 to what codex does, has explicit path-mode tiebreakers, and is well-maintained.

## Proposed Design

Do scoring at the **daemon**, not the client. The daemon owns the full file list; the client should not need to pull every file across the wire to score locally. This also matches the existing contract — `limit` on the wire stays meaningful as "top N by score" instead of "first N in walk order."

### 1. Add `fzf-for-js` to `@bb/host-daemon` (or a shared util package)

If we expect to reuse the matcher elsewhere (thread search, command palette), put it in a small shared package — `packages/fuzzy-match` — exporting one function:

```ts
// packages/fuzzy-match/src/index.ts
export interface FuzzyMatch<T> {
  item: T;
  score: number;
  positions: number[]; // for highlighting
}

export function fuzzyMatchPaths<T>(
  items: T[],
  query: string,
  getPath: (item: T) => string,
  limit: number,
): FuzzyMatch<T>[];
```

Internally wraps `Fzf` with `tiebreakers: [byLengthAsc]`, `casing: 'smart-case'`, `forward: true`.

### 2. Replace the matcher in `finalizeListedFiles`

`apps/host-daemon/src/command-handlers/file-list.ts:15-39` currently does:

```ts
filePaths.filter(p => p.toLowerCase().includes(lowerQuery))
```

Replace with a call to `fuzzyMatchPaths(filePaths, query, p => p, limit)`. Return the sorted top-`limit` paths. Empty query → return first `limit` paths (current behavior preserved).

### 3. Decision: keep daemon truncation, raise the input pool if needed

`workspace.listFiles()` already returns the full ignore-aware list. The matcher runs on that full list, then truncates. No protocol change needed.

### 4. Optional UX wins (do separately, not in this change)

- **Highlight matched chars.** `FuzzyMatch.positions` is already returned. `PromptMentionMenu.tsx:76-78` can render bold/colored chars at those indices.
- **Recent-files boost.** Track the last N files referenced in the current thread and add a small score bonus. Skip until basic fuzzy works.
- **Reduce debounce.** With the daemon doing the work fast (we're matching against an already-loaded string array, not hitting disk), the 120ms debounce in `usePromptMentions.ts:18` could drop to ~50ms.

## Files to change

- New: `packages/fuzzy-match/package.json`, `src/index.ts`, `test/index.test.ts`
- `apps/host-daemon/package.json` — add `@bb/fuzzy-match` dep
- `apps/host-daemon/src/command-handlers/file-list.ts` — swap `.includes` for `fuzzyMatchPaths`
- `apps/host-daemon/test/...` — add tests for the new ranking
- (Optional follow-up) `apps/app/src/components/promptbox/PromptMentionMenu.tsx` — render highlights

## Exit criteria

- `pnpm exec turbo run test --filter=@bb/host-daemon --filter=@bb/fuzzy-match` passes.
- Typing `prompt` in the prompt box surfaces `PromptBox.tsx` in the top 3 results in this very repo.
- Typing `pmtbx` returns `PromptBox.tsx` (subsequence match works).
- Typing `comp/prompt` ranks files under `components/promptbox/` above same-named files elsewhere.
- Build artifacts (e.g. anything under `dist/`) do not appear, because gitignore is already honored upstream.

## Validation

Manual run after wiring:

```bash
pnpm exec turbo run typecheck --filter=@bb/host-daemon --filter=@bb/fuzzy-match
pnpm exec turbo run test --filter=@bb/host-daemon --filter=@bb/fuzzy-match
# Then in the dev app:
pnpm bb:dev
# Open a project, type "@prompt", "@pmtbx", "@comp/prompt", confirm ordering.
```

## Out of scope

- Rewriting the workspace file walker (already gitignore-aware via `git ls-files`).
- Indexing / persistent caches — file lists are short enough to score per-keystroke against debounced input.
- Highlighting matched chars in the menu (deferred follow-up).
- Recent-files boosting (deferred follow-up).
