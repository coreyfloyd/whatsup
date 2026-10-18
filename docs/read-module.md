# Session context read module

## Current report enrichment interface

As of 2026-10-17, the public-release reader accepts an agent context report and enriches GitHub identities. The former provider/session projection is retired from production and retained in `tests/legacy_reader.py` only to reproduce historical developer snapshots. Naming, project-store, slate, run and claim adapters are not part of the shipped reader. The [read contract](../contracts/session-context.md) defines the current semantics.

The canonical Python package is `mod/reader/session_status/`, inside the plugin payload. `src/session_status` is a repository symlink for the existing `PYTHONPATH=src` test command. No package installation or dependency beyond Python 3.10+ is needed by the plugin.

```python
from session_status import GitHubReader, RecordedReaders, enrich_report

snapshot = enrich_report(report, reader, issue_kinds=["tickets", "epics"])
```

`reader` is an injected `SourceReader` object or callable with `read(source, identity)`; `None` preserves the report and returns the enrichment-off reason. The operation makes an independent copy and caches attributed source reads for that observation. It never writes to GitHub or changes the stored report.

The Mod runs `python3 <plugin-root>/reader/main.py` using an argument vector and JSON on stdin: `{"report": <context report>, "issue_kinds": ["tickets", "epics"]}`. Stdout is one JSON object with `report` (the enriched display copy) and `off_reason` (null when enabled). The bridge stores it by immutable session identity and the exact input report; superseded or out-of-order results cannot replace a newer report. Nonzero exits, malformed/incomplete JSON, truncation and process timeouts mark GitHub entities unavailable without publishing stderr.

Token resolution tries `gh auth token --hostname github.com` with token environment overrides removed, then `GITHUB_TOKEN`. The CLI is optional. With neither credential, the report is unchanged and one dim line in the session box says enrichment is off and why. With credentials but a failed read, the entity receives an unavailable envelope instead of silently falling back to zero.

### GitHub adapter

`GitHubReader(token, request=...)` implements the existing attributed envelope protocol for six sources:

| Source | Identity | API read and normalized value |
| --- | --- | --- |
| issues | `owner/repo#N` | Issue definition: id, title, body, open/closed state, labels, milestone identity, source page. |
| children | issue identity | All immediate native sub-issues, including cross-repository identities. |
| parents | issue identity | Native ancestors, nearest first; repeated ancestors are corrupt. |
| milestones | `owner/repo@milestone/N` | Milestone id, name, objective, state and source page. |
| members | milestone identity | All milestone issues across open and closed states; pull requests excluded. |
| blockers | issue identity | Native blocked-by issue identities; projection keeps only open blockers. |

The default transport uses the standard library, GET only, request timeouts and paginated lists. Pagination failures remain partial; loops and a 100-page limit fail closed. Credentials are sent only to `api.github.com`. Transport errors publish fixed availability reasons, never exception text. Tests inject sanitized recorded responses from `tests/fixtures/github-capture.json`; derived closed-state and relationship variants are identified alongside their exact changes in the tests. CI does not call GitHub.

### Projection and counting

Each recognized item gains an `enrichment` envelope (`state`, `value`, `reason`, `evidence`). Present issues supply title, status, all labels, open blockers and page. Milestones supply title, page, distinct members and closed/total counts. Missing or malformed pages remove the destination without discarding other facts. Unknown identity formats and text-only items retain reported fields.

A reported active state wins over a closed issue. Other closed issues become done; reported done states are retained. The agent's report remains the source for fallback fields when access is off.

The plugin setting `githubIssueKinds` selects which template item-kind strings request GitHub membership counting; it is a comma-separated list defaulting to `tickets,issues,epics`. Custom templates that rename those kinds configure the matching names; an empty string disables membership counting. Neither section names nor labels select a counting rule. For a selected section with an issue identity, iterative native sub-issue traversal counts distinct leaves, excluding grouping issues and rejecting cycles. A milestone identity counts its direct members. With no section identity, the explicit item list defines its set. Counts are independent across sections, include all close reasons, and respect active overrides; they are never summed. Partial or failed membership omits counts.

Refresh runs on pane open, every 60 seconds while open, and when a shown report changes. Close cancels the timer and invalidates in-flight results. The pane shows no observation/freshness time. Unavailable entities and their affected section have grey, dim warnings and a reason; the section's bar/count is suppressed.

Run all suites with `PYTHONPATH=src python3 -m unittest discover -s tests -v` and `claude plugin test mod`.
