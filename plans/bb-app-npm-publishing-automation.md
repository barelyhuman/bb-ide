# bb-app npm Publishing Automation

## Current Status

`bb-app` is published through the manual GitHub Actions workflow using npm
Trusted Publishing/OIDC. The local safety checks are:

- `pnpm exec turbo run typecheck test --filter=bb-app`
- `pnpm exec turbo run smoke:tarball --filter=bb-app --force`
- `npm publish --dry-run --tag latest`
- `npm publish --tag latest`

This plan keeps the first automated version intentionally conservative:
publishing remains a human-triggered release action, but CI owns the exact
build, smoke test, and publish steps.

## Recommended Shape

Use a GitHub Actions workflow with `workflow_dispatch` and npm Trusted
Publishing/OIDC.

Why:

- No long-lived npm write token is stored in GitHub.
- The workflow can require a protected GitHub environment approval before
  publishing.
- The version in `packages/bb-app/package.json` remains the release source of
  truth.
- `0.0.x` releases can keep moving quickly without teaching every contributor a
  manual npm publishing sequence.

Avoid fully automatic publish-on-merge for now. This package includes bundled app
and daemon artifacts, so a mistaken publish has a larger blast radius than a
typical small library. Manual dispatch is the right default until the release
path is boring.

## Feasibility And Control Model

This is feasible now, and it directly solves the OTP hassle.

The practical target is:

1. A human merges the exact release commit to `main`.
2. A human or agent opens GitHub Actions and manually runs `Publish bb-app`.
3. GitHub optionally pauses on a protected `npm-release` environment that
   requires approval.
4. The workflow publishes through npm Trusted Publishing/OIDC. There is no npm
   password, no npm write token, and no OTP to paste into an agent session.

This keeps release control human-owned while moving credentials and build
repeatability into CI. The release authority becomes GitHub repository access
plus the protected environment approval, not whoever currently has an npm OTP
open.

Feasible options:

| Option                                      | OTP burden | Release control                            | Security posture                                          | Recommendation                                            |
| ------------------------------------------- | ---------- | ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| Manual local publish                        | Every time | Whoever runs `npm publish` locally         | Good 2FA, weak reproducibility                            | Keep only as emergency fallback.                          |
| GitHub Actions + npm Trusted Publishing     | None       | Manual workflow dispatch + optional review | Best: short-lived OIDC credential, no stored write secret | Use this first.                                           |
| GitHub Actions + npm granular access token  | None       | Manual workflow dispatch + optional review | Acceptable but stores a long-lived publish secret         | Fallback only if Trusted Publishing setup is blocked.     |
| Publish automatically on every `main` merge | None       | Merge to `main` is the release trigger     | Can be secure, but easy to publish accidental versions    | Avoid until the release path is boring and fully guarded. |

Important constraints:

- npm Trusted Publishing currently requires npm CLI `11.5.1` or later and Node
  `22.14.0` or later in CI. Use Node 24 in the workflow and assert the npm
  version before publish; install a newer npm if the runner image lags.
- The trusted-publisher identity must exactly match the GitHub owner, repo,
  workflow filename, and optional environment configured in npm.
- npm dist-tags are mutable aliases. The package version is immutable after
  publish, but tags such as `alpha`/`latest` can be moved later with a separate
  authenticated `npm dist-tag` command.
- npm Trusted Publishing currently authenticates `npm publish`; post-publish
  tag edits such as `npm dist-tag add` still need traditional authentication.
- The OIDC-only workflow can set exactly one dist-tag through
  `npm publish --tag <tag>`. The normal release path uses `npm_tag=latest` so
  plain `npx bb-app` resolves to the newest stable `0.0.x` release.

The agent-facing operator doc should be
[`docs/releasing-bb-app.md`](../docs/releasing-bb-app.md). The intended user
prompt is:

> Do a bb-app release using `docs/releasing-bb-app.md`.

That document must be concrete enough for an agent to execute without filling
in policy gaps. It should name the exact validations, stop points, branch
requirements, workflow inputs, and verification commands.

## Phase 1: Add Manual Publish Workflow

Create `.github/workflows/publish-bb-app.yml`.

Workflow inputs:

- `npm_tag`: choice of `alpha`, `beta`, or `latest`; default `latest`.
- `allow_prerelease_latest`: boolean; default `false`. Set to `true` only
  when a release request explicitly says plain `npx bb-app` should track a
  prerelease.
- Optional `dry_run`: boolean; default `true` for first rollout, flip to
  `false` once the trusted publisher setup has been verified.

Workflow permissions:

- `contents: read`
- `id-token: write`

Workflow trigger and environment:

- Trigger only with `workflow_dispatch`.
- Run only from `main`.
- Use a protected GitHub environment such as `npm-release`.
- Configure required reviewers on that environment if we want an explicit
  approval click after dispatch but before publish.

Job setup:

- Use a GitHub-hosted runner.
- Use Node 24 so the runner satisfies npm Trusted Publishing requirements.
- Verify npm CLI is at least `11.5.1`; install `npm@latest` if needed.
- Install pnpm with `pnpm/action-setup` using the same major version as the
  root `packageManager` value.
- Run `pnpm install --frozen-lockfile`.
- Run the same Turbo checks we use locally.

Publish step:

```sh
cd packages/bb-app
npm publish --tag "$NPM_TAG"
```

Keep `--provenance` out if Trusted Publishing is active, because npm Trusted
Publishing automatically emits provenance. Use `--provenance` only if we fall
back to token-based publishing.

Exit criteria:

- `.github/workflows/publish-bb-app.yml` exists and is manually runnable.
- The workflow publishes only `packages/bb-app`, not the monorepo root.
- The workflow requires the existing `bb-app` checks before publishing.
- The workflow can publish stable versions under `latest` and prerelease
  versions under an explicit prerelease tag.

Validation:

```sh
pnpm exec turbo run typecheck test --filter=@bb/config --filter=@bb/server --filter=bb-app
pnpm exec turbo run smoke:tarball --filter=bb-app --force
```

After merging the workflow, run one GitHub Actions dry run and confirm it reaches
the publish command without making registry changes.

## Phase 1.5: Keep The Agent Runbook Executable

Keep [`docs/releasing-bb-app.md`](../docs/releasing-bb-app.md) aligned with the
workflow.

The runbook should tell an agent:

- how to refresh onto local primary `main`;
- how to choose and bump the next version;
- which validation commands are required;
- that publishing from a feature branch is forbidden;
- how to trigger the GitHub workflow;
- when to stop for human approval;
- how to verify npm dist-tags after publish;
- that local OTP publishing and post-publish dist-tag edits are explicit
  emergency fallbacks only.

Exit criteria:

- A fresh agent can start from the prompt "do a bb-app release using
  `docs/releasing-bb-app.md`" and reach the right stop point without extra
  tribal knowledge.
- The runbook does not ask for npm OTP in the normal path.
- The runbook does not instruct local `npm publish` except as an emergency
  fallback.

## Phase 2: Configure npm Trusted Publisher

In npm package settings for `bb-app`, add a trusted publisher:

- Provider: GitHub Actions
- Owner/repo: the GitHub repository that owns this codebase
- Workflow filename: `publish-bb-app.yml`
- Environment: the protected release environment name, if one is used

If we use a GitHub environment in the workflow, the npm trusted publisher must
include the same environment name. If we leave the environment blank in npm but
the workflow publishes from an environment, the OIDC identity will not match.

Exit criteria:

- npm accepts publishes from the workflow without `NPM_TOKEN`.
- The workflow logs show OIDC/trusted-publishing auth rather than token auth.
- No npm write token is required in repository or organization secrets.

Validation:

Run the workflow against the next stable version, for example `0.0.2`, with
`npm_tag=latest`. Then verify:

```sh
npm view bb-app@latest version
npm view bb-app dist-tags --json
npx --yes bb-app --help
```

## Fallback: Granular npm Token

If Trusted Publishing is unavailable for the package or repo, use a granular npm
access token as a temporary fallback:

- Restrict it to the `bb-app` package.
- Enable bypass 2FA for publishing.
- Store it as `NPM_TOKEN` in the protected `npm-release` GitHub environment,
  not as a broad repository secret.
- Keep the same manual `workflow_dispatch` trigger and required reviewer gate.
- Publish with `NODE_AUTH_TOKEN`.
- Use it only if we need post-publish commands such as moving or removing a
  legacy dist-tag.

This removes OTP prompts but stores a long-lived credential, so it is worse than
Trusted Publishing. Treat it as a bridge, not the target state.

## Phase 3: Add Release Guardrails

Add guardrails before the publish step:

- Read `packages/bb-app/package.json` and fail if the version already exists on
  npm.
- Fail if `github.ref_name` is not `main`.
- Print `github.sha` and require it to match the commit being published.
- Fail if `npm_tag=latest` is used with a prerelease version unless
  `allow_prerelease_latest=true`.
- Fail if `npm_tag=alpha` or `npm_tag=beta` is used with a stable version.
- Print the package contents using `npm pack --dry-run` or the existing tarball
  smoke output.

Exit criteria:

- A duplicate version fails before `npm publish`.
- Publishing from a branch or unmerged commit fails before `npm publish`.
- A prerelease cannot accidentally move `latest`.
- A stable release cannot accidentally publish under `alpha`.
- The workflow output includes enough package-file detail to review what is
  going out.

Validation:

Trigger dry-run workflows for these cases:

- Existing version: expected failure.
- `0.0.1-alpha.N` with `alpha`: expected success only for an explicit
  prerelease-channel request.
- `0.0.1-alpha.N` with `latest`: expected success only when the release request
  explicitly allows plain `npx bb-app` to follow a prerelease.
- Any version from a non-`main` ref: expected failure.
- `0.0.1` with `latest`: expected success once we are ready for stable.

## Phase 4: Decide Version Bump Workflow

Keep version bumps manual until publishing is boring. The normal stable loop is:

```sh
cd packages/bb-app
npm version patch --no-git-tag-version
```

Then commit the version change, merge it, and run the publish workflow.

Later, consider adding one of these:

- A `pnpm release:bb-app -- patch` script that bumps, validates, and prints the
  workflow command to run.
- Changesets if multiple packages start publishing together.
- semantic-release only if commit-message-driven releases become a team norm.

Exit criteria:

- The chosen version-bump path is documented in the package README or release
  docs.
- The release command does not publish locally; publishing stays in CI.
- The command cannot bump the root package by mistake.

## References

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers/
- npm publish CLI: https://docs.npmjs.com/cli/v11/commands/npm-publish/
- npm dist-tags: https://docs.npmjs.com/adding-dist-tags-to-packages/
- GitHub Actions npm publishing: https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages
