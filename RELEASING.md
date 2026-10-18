# Releasing whatsup

## Release contract

The public repository is `coreyfloyd/whatsup`. Its initial commit contains only
the reviewed release-ready tree. The private source repository retains its full
history. Do not rename its remote, make it public, or push its branches or tags
to the public repository. Publication is a separate, human-confirmed action;
preparing a candidate does not authorize running the publication commands below.

The marketplace entry and plugin manifest both carry version `0.1.0`. Keep them
in sync for later releases. The plugin payload is `mod/`; the reader ships inside
it. A GitHub marketplace install requires no release archive or pip dependency.

## Prerequisites

Use Git, Python 3.10+ and Claude Code 2.1.302 with Mods support. Publishing also
requires authenticated GitHub CLI access as the repository owner. Complete review
and integration verification before publication. Use a clean committed candidate;
untracked files are excluded by `git archive` and must be reviewed separately.

## Verify the candidate

From the release-ready source checkout:

```bash
set -euo pipefail
test -z "$(git status --porcelain)"
git diff --check
PYTHONPATH=src python3 -m unittest discover -s tests -v
claude plugin test mod
claude plugin validate mod
claude plugin validate .claude-plugin/marketplace.json
```

Review every tracked file, including hidden manifests, workflows, fixture bodies,
recorded snapshots, URLs and image pixels. Confirm no private tools, hosts,
repository references, quotes or personal data remain; the author and public
package URL are intentional attribution. Confirm the README image and examples
match the current design. Confirm no planning history, design proposals,
verification records, render tooling or local Claude settings are in the tree.
The release tests check packaging and neutral replay identities, but cannot
replace this content review.

## Build an isolated initial commit

Run in Bash from the verified source root. This exports tracked bytes only,
without `.git`, then creates a separate repository. It leaves source history and
remotes intact. Retain the printed candidate directory for review.

```bash
set -euo pipefail
RELEASE_SOURCE="$PWD"
RELEASE_COMMIT="$(git rev-parse HEAD)"
RELEASE_TREE="$(git rev-parse 'HEAD^{tree}')"
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/whatsup-release.XXXXXX")"
git archive --format=tar "$RELEASE_COMMIT" > "$RELEASE_DIR/source.tar"
mkdir "$RELEASE_DIR/whatsup"
tar -xf "$RELEASE_DIR/source.tar" -C "$RELEASE_DIR/whatsup"
(
  cd "$RELEASE_DIR/whatsup"
  git init -b main
  git add --all
  git commit -m 'Initial whatsup release'
  test "$(git rev-list --count HEAD)" = 1
  test "$(git rev-parse 'HEAD^{tree}')" = "$RELEASE_TREE"
  PYTHONPATH=src python3 -m unittest discover -s tests -v
  claude plugin test mod
  claude plugin validate mod
  claude plugin validate .claude-plugin/marketplace.json
)
printf 'Review isolated candidate: %s\nSource commit: %s\n' \
  "$RELEASE_DIR/whatsup" "$RELEASE_COMMIT"
```

Git needs the maintainer's normal author configuration. Do not copy source logs,
review reports or private issue references into the initial commit message.
Review the isolated `git log --all -p` as well as its tree: it must have exactly
one commit, no parents and no private history. The equality check above ensures
the initial commit has exactly the reviewed source tree. Do not run the export
again on an already published repository to replace its history.

## Publish (after human confirmation)

The maintainer explicitly approves the isolated candidate and creation of the
public repository. Then, in the same Bash shell with `RELEASE_DIR` still set:

```bash
set -euo pipefail
cd "$RELEASE_DIR/whatsup"
test "$(git rev-list --count HEAD)" = 1
test "$(git branch --show-current)" = main
# This must fail with repository-not-found. Authentication/network failure is
# not evidence of absence; resolve either before creating anything.
gh repo view coreyfloyd/whatsup
```

If that repository exists, stop and inspect it; never overwrite an existing
remote history. Once absence has been confirmed and publication authorized:

```bash
gh repo create coreyfloyd/whatsup --public --source . --remote origin --push
```

Only this newly initialized repository is pushed. Do not add the public remote
to the private source repository. Do not push any private branches or tags.

## Verify the published release

Confirm the public default branch has the initial commit and the `contracts`
workflow succeeds for the pushed commit. Then in a disposable directory:

```bash
VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/whatsup-verify.XXXXXX")"
git clone https://github.com/coreyfloyd/whatsup.git "$VERIFY_DIR/whatsup"
test "$(git -C "$VERIFY_DIR/whatsup" rev-list --count HEAD)" = 1
claude plugin validate "$VERIFY_DIR/whatsup/mod"
claude plugin validate "$VERIFY_DIR/whatsup/.claude-plugin/marketplace.json"
claude plugin marketplace add coreyfloyd/whatsup
claude plugin install whatsup@whatsup
```

Use a disposable Claude configuration to avoid changing a live installation.
Start a new session, open `/whatsup`, report a scope and a text-only progress item,
and verify replacement, worker display and explicit destination opening. Check
that the installed plugin cache includes `reader/main.py` and its package.
[INSTALLATION.md](INSTALLATION.md) lists prerequisites and credential behavior.
A validation pass alone does not attest an end-to-end public install.

## Later releases

Maintain the public repository's history normally after the initial publication.
Transfer only reviewed release-tree changes, synchronize both version fields,
run the same suites, and follow the public repository's review and branch policy.
Tags and GitHub release publication require their own commissioned release step;
this initial-tree procedure creates neither signed assets nor a release tag.

## Failure and recovery

A failed candidate check blocks publishing. Fix the source, commit it and export
a new isolated candidate. Before publication, a rejected candidate may be retained
for inspection; never rewrite the private source history. After publication,
correct mistakes with reviewed commits. Do not force-push or move published tags.
If private data is exposed, stop further publication, revoke any exposed credential
and have the maintainer handle repository/history remediation explicitly.
