# Contributing

## Prerequisites

Python 3.10+, Git and Claude Code with Mods support. The reference CLI version
is 2.1.302. The runtime has no third-party Python dependencies.

## Architecture and layout

- `mod/hooks/`: reporting, templates, session facts, workers, enrichment and UI.
- `mod/reader/`: bundled JSON bridge and Python package.
- `mod/types/`: plugin state declarations.
- `tests/`: Python contracts, sanitized replay inputs and snapshot builders.
- `mod/tests/`: engine contract and pane rendering tests.
- `.claude-plugin/marketplace.json`: marketplace entry pointing to `mod/`.

`src/session_status` links to the bundled package so the declared Python suite
uses the exact production implementation. Follow [CONTEXT.md](CONTEXT.md) for
terminology and [INTERFACE.md](INTERFACE.md) for the public contract.

## Verify a checkout

From the repository root:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
claude plugin test mod
claude plugin validate mod
claude plugin validate .claude-plugin/marketplace.json
git diff --check
```

These suites replay data without GitHub credentials or network requests. Mod
tests run inside the CLI's own engine; they do not launch model requests.
CI runs both suites and manifest validation on pushes and pull requests.

## Check against a live session

The mod tests feed hooks the event shapes the tests construct, so they cannot
catch a mismatch with the live engine. After changing a hook, run the plugin in
a real session. Without Herdr, start `claude --plugin-dir ./mod`, run `/whatsup`
and ask the agent to call `mcp__whatsup__report`. Inside a
[Herdr](https://herdr.dev) pane, `scripts/live-check.sh` drives that session
for you:

```bash
scripts/live-check.sh start probe
scripts/live-check.sh say probe /whatsup
scripts/live-check.sh say probe 'Call mcp__whatsup__report once with {"scope":"Live check"}.'
scripts/live-check.sh read probe        # the pane docks at the right of the screen
scripts/live-check.sh narrow probe 0.35 # below the dock width the pane opens framed
scripts/live-check.sh widen probe
scripts/live-check.sh stop probe
```

Edits under `mod/` reload into the running session when its next turn ends.

`say` exits 0 when Herdr reports the prompt settled. A slash command such as
`/whatsup` also exits 0 when Herdr reports `agent_prompt_stalled`: local commands
can complete without changing the agent's lifecycle state. This exception does
not verify the command's output; use `read` to inspect it. Other failures,
including timeouts and rejected submissions, print Herdr's error to stderr and
preserve its non-zero exit code (1 for server errors, 2 for CLI syntax errors).
`LIVE_CHECK_TIMEOUT` sets the wait timeout in milliseconds (default 180000);
`LIVE_CHECK_SETTLE` sets the pause before a successful return in seconds (default 2).

## Fixtures

Captured API shapes are sanitized before committing: replace identifying owners,
URLs, session IDs, opaque IDs and prose with neutral stand-ins. Preserve the
shape and membership relationships needed by the contract. Record the capture
source and sanitization in `tests/fixtures/manifest.json`; distinguish derived
cases from observed facts. Do not record credentials or private issue bodies.

Rebuild derived replay data and committed snapshots offline:

```bash
python3 tests/build_fixtures.py
python3 tests/build_in_progress_fixtures.py
python3 tests/build_pane_snapshots.py
```

`mod/tests/fixtures/chosen*.ts` retain illustrated design references, not runtime
observations. The README image is an illustrated chosen-design rendering with
neutral session data. Render tooling and design deliberations are not shipped.

## Changes and reviews

Keep a change scoped, add meaningful contract coverage for behavior changes and
run the full suites. Update the interface with schema or configuration changes.
Verify terminal and Desktop interactions when changing presentation. Describe
what was exercised and any remaining manual integration gaps in the review.
Use [RELEASING.md](RELEASING.md) for version changes and publishing.

## License

Contributions are under the project's Apache 2.0 license.
