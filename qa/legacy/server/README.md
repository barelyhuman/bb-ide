# Legacy Server QA

These docs are preserved while their scenarios are remapped into owned surfaces such as `server`, `env-daemon`, `providers`, `cli`, and `e2e`.

Use them when:

- you need the old umbrella standalone flow
- the scenario has not been fully relocated yet
- you are cross-checking that a legacy case is now covered by a new owned pass

Still useful here today:

- the full standalone setup and relaunch procedure
- the combined restart matrix that has not been fully split across `server/` and `env-daemon/`
- the legacy lifecycle invariant reference until the owned invariant docs fully replace all old references

As new docs absorb these scenarios, delete the legacy copies rather than maintaining two parallel runbooks indefinitely.
