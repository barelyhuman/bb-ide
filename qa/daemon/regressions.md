# Daemon / Env-Agent Regression QA

Use this pass to capture stable repros for previously discovered bugs.

## Goal

Make sure once a daemon/env-agent lifecycle bug is fixed, it stays fixed.

## How to use

Add one entry per regression with:
- short name
- original bug / incident reference
- minimal repro steps
- expected outcome
- invariants protected by the regression

## Automation entrypoint

For the checked-in regression seed suite:

```bash
pnpm qa:daemon:regression
pnpm qa:daemon:recovery:fake
```

The checked-in regression seed suite targets the real provider by default. Recovery regressions that require fake Codex control should also be covered by `qa:daemon:recovery:fake`.

## Current seed regression areas

Add entries here as fixes land for issues such as:
- immediate follow-up after idle failing with session-closed behavior
- restart while active leaving thread stuck instead of converging
- missing-worker restart incorrectly landing in `idle`
- duplicate live session acceptance after replacement
- queued follow-up being dropped during worker-loss recovery
- archive/unarchive resurrecting stale session state
- late old-agent traffic mutating recovered thread state

## Template

### `<regression name>`

- **Source:** `<issue / PR / incident>`
- **Setup:** `<minimal environment assumptions>`
- **Steps:**
  1. ...
  2. ...
  3. ...
- **Expected:**
  - ...
  - ...
- **Protected invariants:**
  - ...
  - ...
