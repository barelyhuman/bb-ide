# Pi Bridge Parity

## Goal

Make the bb Pi bridge behave as closely as practical to a normal Pi coding
session, unless we intentionally opt into a different mode and document that
difference.

## Why This Matters

The provider audit now shows a persistent behavior gap:

- direct Pi sessions default to the coding tool set `read`, `bash`, `edit`,
  `write`
- `grep`, `find`, and `ls` are real first-class Pi tools, but they are opt-in
- when those extra tools are not enabled, Pi usually routes that work through
  `bash`

That part is expected. The likely parity risk is that bb currently starts Pi in
something closer to a custom stripped-down session than to a normal Pi session.

## Current Evidence

### Direct Pi CLI behavior

- `pi --help` reports the default coding tools as `read,bash,edit,write`
- direct `pi --mode json` runs still prefer `bash` even when prompted to use
  `ls`, `find`, and `grep`
- direct `pi --mode json --tools read,bash,edit,write,grep,find,ls ...` emits
  real `ls` and `find` tool calls

### bb bridge behavior

- [packages/agent-runtime/src/pi/adapter.ts](/Users/michael/.codex/worktrees/b282/bb/packages/agent-runtime/src/pi/adapter.ts)
  always sends `baseInstructions` on `thread/start`
- [packages/agent-runtime/src/pi/bridge/sdk-session.ts](/Users/michael/.codex/worktrees/b282/bb/packages/agent-runtime/src/pi/bridge/sdk-session.ts)
  takes a custom `DefaultResourceLoader` path whenever a system prompt is
  present
- that loader path currently sets:
  - `noExtensions: true`
  - `noSkills: true`
  - `noPromptTemplates: true`
  - `noThemes: true`

This is closer to running Pi with a custom system prompt plus
`--no-extensions --no-skills --no-prompt-templates --no-themes` than to a plain
interactive Pi session.

## Questions To Answer

1. Does bb need parity with a normal Pi session, or do we intentionally want a
   stripped custom mode?
2. If parity is the goal, should bb append its instructions to Pi defaults
   rather than replacing loader behavior?
3. Which Pi-native surfaces are currently lost or changed by the custom loader
   path?
4. Are there tool-discovery differences beyond `grep` / `find` / `ls`, such as
   extensions, helper tools, prompt templates, or system behavior?

## Proposed Work

### Phase 1: Reproduce the gap cleanly

- capture a small matrix of equivalent prompts in:
  - direct interactive `pi`
  - direct `pi --mode json`
  - bb Pi bridge
- compare:
  - advertised tool access
  - actual emitted tool calls
  - presence or absence of skills, extensions, templates, and helper tools

### Phase 2: Audit the bridge startup path

- trace how bb builds Pi session options
- identify exactly why `baseInstructions` forces the custom loader path
- document whether that behavior is necessary or just the easiest current
  implementation

### Phase 3: Design the parity target

- define the intended startup contract for bb Pi sessions
- decide whether bb should:
  - preserve Pi defaults and append bb instructions
  - preserve Pi defaults but selectively disable specific surfaces
  - keep the current custom mode and explicitly document it as intentional

### Phase 4: Implement parity changes

- update the bridge/session startup path to match the chosen contract
- keep the change minimal and local to Pi startup/configuration
- avoid changing audit rendering until provider behavior is verified

### Phase 5: Re-capture and compare fixtures

- replay at least one targeted Pi audit capture before and after the parity
  change
- compare raw tool names, event shapes, and rendered output
- update docs if the effective Pi surface changes

## Exit Criteria

This plan is complete only when all of the following are true:

- we can explain, with code references, whether bb Pi sessions are intended to
  match normal Pi sessions or intentionally differ
- the bridge startup path matches that intent
- the observed tool surface in bb is no longer surprising relative to direct Pi
  runs for the same prompt and repo state
- any remaining differences are documented in
  [packages/agent-provider-audit/README.md](/Users/michael/.codex/worktrees/b282/bb/packages/agent-provider-audit/README.md)
- at least one targeted Pi fixture has been re-captured after the change and
  reviewed end to end

## Validation

### Automated

- `pnpm exec turbo run test --filter=@bb/agent-runtime --filter=@bb/agent-provider-audit --force`
- `pnpm --filter @bb/agent-provider-audit run ladle:prepare`

### Manual

- run the same prompt directly in native Pi and through bb against the same repo
  checkout
- inspect raw provider events for tool-name and event-shape differences
- inspect the CLI timeline text for the updated Pi fixture
- inspect the React/Ladle timeline for the updated Pi fixture
- explicitly ask Pi what tools it believes it has in both environments

### Comparison Checklist

- same or intentionally different advertised tool surface
- same or intentionally different emitted tool names
- same or intentionally different helper/custom tool availability
- no accidental loss of extensions, skills, templates, or themes unless that is
  the chosen product behavior
