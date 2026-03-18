# QA Artifacts

Use this folder for failure bundles and saved outputs from QA runs.

## Preferred artifact capture

For a thread-specific server/env-agent failure:

```bash
node scripts/qa/capture-thread-failure-bundle.mjs <thread-id> --scenario <short-name>
```

That writes a timestamped folder under `qa/artifacts/` containing:

- scenario metadata
- thread snapshot
- thread log
- thread output
- thread session inspection output
- server health snapshot
- server log copy when `BB_ROOT` is available

For a quick thread summary without a full bundle:

```bash
node scripts/qa/thread-summary.mjs <thread-id>
```

## Retention

- Keep artifacts long enough for triage and bug filing.
- Delete obsolete artifacts after the issue is resolved or the bundle is superseded.
- Do not commit one-off local failure bundles unless they are intentionally added as durable fixtures or repro assets.
