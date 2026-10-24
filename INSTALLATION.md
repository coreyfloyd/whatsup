# Installation and configuration

## Prerequisites

- Claude Code with the Mods API. Candidate checks use version 2.1.302.
- Python 3.10 or newer on `PATH` as `python3`; standard library only.
- macOS for the current `open` link action. Other systems can render reports,
  but destination opening requires an implementation for that platform.
- Optional: authenticated GitHub CLI (`gh`) or `GITHUB_TOKEN` for enrichment.
  Keep credentials in your normal credential manager or process environment.

## Installed layout

The repository is a marketplace. Its root `.claude-plugin/marketplace.json`
points to `mod/`, which contains its own `.claude-plugin/plugin.json`, hooks,
types and `reader/`. The plugin cache receives the whole `mod/` payload,
including Python. There is no second package to install.

## Install from the public repository

```bash
claude plugin marketplace add coreyfloyd/whatsup
claude plugin install whatsup@whatsup
```

Restart Claude Code after installation. The commands apply after the maintainer
publishes the repository using [RELEASING.md](RELEASING.md). This route installs
from the repository, not from verified release bytes.

## Install from a verified release

Signed releases start with 0.2.0. Download the five assets of a release from the
repository's Releases page into one directory, then verify the archive before
extracting it:

```bash
bash verify-release.sh whatsup-0.2.0.tar.gz whatsup-release.asc \
  09674AFF392661238F4ACBD9F32B3A412CD5EFC5
tar -xzf whatsup-0.2.0.tar.gz
```

The published fingerprint is `09674AFF392661238F4ACBD9F32B3A412CD5EFC5`, also in
[RELEASE_SIGNING_FINGERPRINT](RELEASE_SIGNING_FINGERPRINT). The verifier requires
a signature by that primary key and an archive matching the signed checksum.
Then install from the extracted `whatsup/` directory as a checkout, below, and
keep it available. Replace the version consistently for a later release.

## Install from a checkout

For an isolated development session from the checkout root:

```bash
claude --plugin-dir ./mod
```

This reads that checkout, so keep it available during the session. To test a
marketplace locally, register the checkout path instead of the repository name,
then use the same `whatsup@whatsup` install target. A local registration changes
your plugin configuration; use a disposable Claude configuration for testing.

## Shared and repository configuration

No file is required. The default template is `github`. User defaults come from
`$HOME/.config/whatsup/config.json`; repository overrides come from `.whatsup.json`
at the Git root (including worktrees). Outside Git, the starting directory owns
the repository file. Configuration is loaded at session start.

For a task list with still graphs:

```json
{"template":"task-list","motion":false}
```

The [interface](INTERFACE.md#templates-and-repository-configuration) specifies
all fields, precedence and validation. Unknown keys and malformed JSON are
startup errors. Never put tokens in either configuration file.

## Verify the installation

```bash
python3 --version
claude plugin list
```

Confirm Python is at least 3.10 and `whatsup@whatsup` is enabled. In a new
session, run `/whatsup`. Before a report, the pane shows a minimum call. Ask the
agent to report its current scope with `mcp__whatsup__report`; the scope should
replace the empty state. Reporting again replaces the previous sections and
workers. Missing GitHub credentials should preserve the report with enrichment
off. Use `claude plugin validate mod` when checking a source checkout.

## Uninstall

```bash
claude plugin uninstall whatsup@whatsup
claude plugin marketplace remove whatsup
```

User and repository configuration files are user-owned; remove them separately
if desired. Stored reports are plugin display state, never a work tracker.

## Test a checkout

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full offline suites and fixture
rebuild commands.
