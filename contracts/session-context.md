# Session context read contract

## Authority and isolation

A context report describes one session's scope, sections and workers. It is
display state, never authorization or a replacement for a work tracker. The
engine supplies the immutable sending session identity; callers cannot choose
another session. Each valid report replaces the whole prior report. Invalid
reports retain the prior value. A new session begins empty.

The exact report schema and template/configuration formats live in
[INTERFACE.md](../INTERFACE.md). The Python API lives in
[read-module.md](../docs/read-module.md).

## Snapshot

The Python read operation returns one JSON-serializable object:

```json
{
  "report": {"scope":"Prepare the next release","sections":[],"workers":[]},
  "off_reason": null
}
```

The report is an independent display copy. Recognized GitHub section and item
identities gain an `enrichment` envelope: `state` (`present` or `unavailable`),
`value`, `reason` and `evidence`. Each evidence entry names source, identity,
observation time, optional source time/revision and availability. Present issue
values include title, status, body, labels, blockers and page. Milestone values
include title, status, page, members and closed/total counts. Section `counts`
contains nonnegative `done`, `active`, `total` integers. A failure omits counts;
it never represents a failed read as zero. `off_reason` is null when enrichment
is enabled and an explanatory string when credentials are unavailable.

The Mod joins this result with engine session facts, observed workers and display
preferences in session-scoped storage. It binds results to the exact report input
and refresh generation so an old subprocess cannot overwrite a new report.

## Membership and progress

Sections are ordered and independently counted. Their labels and verbs are
agent-supplied. With no membership identity, the section's reported items define
its set: done items count as done, active items as active, and queued items as
remaining. Sets can overlap and are never summed. An empty list hides the bar
and count while retaining the section box.

A milestone identity counts its direct GitHub members. An issue section whose
item kind is selected by `githubIssueKinds` counts distinct leaf sub-issues,
excluding grouping issues and rejecting cycles. All closed reasons count as
closed. Reported active state overrides an enriched closed issue; otherwise a
closed issue becomes done. Reported done is retained. Unknown identity formats
and text-only items remain useful without enrichment.

## Failures and destinations

Absent credentials preserve the report and show enrichment off. Partial,
unsupported, failed or corrupt reads make affected entities unavailable with a
fixed reason and no misleading count. Errors stay local; exception text and
credentials are never included. Adapters must read complete membership across
all pages before publishing a total.

Only canonical, verified destinations appear as open actions. A missing or
malformed page removes the action without discarding other known facts. Clicks
show one floating detail card; only its explicit `open ↗` opens the destination.

## Read and refresh boundary

The reader performs GET requests only and never writes to GitHub. Refresh runs
on pane open, every 60 seconds while open, and when a displayed report changes.
Closing cancels its timer and invalidates pending results. Session facts and
worker measurements are observed independently; reports may add external workers.

## Replay evidence

Tests retain sanitized API captures and explicitly derived scenarios. Owners,
URLs, session identifiers, opaque IDs and private prose have neutral stand-ins;
these fixtures do not assert facts about the example repositories. Capture roots
and exact derived patches are recorded in `tests/fixtures/manifest.json`.
The retired projection in `tests/legacy_reader.py` supports developer replay
only and is not the production API.
