# Session context read contract

## Authority and isolation

A context report describes one session's scope, decisions, sections and workers. It is
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

## Decision reading

Decisions are an ordered collection independent of progress sections and counts.
Each has a stable identity, question, why_now, relevant context, ordered options
(identity, label, benefit, cost), and recommendation (option identity and reason).
All text is required and nonblank; at least two uniquely identified options are
required. Decision identities are unique within the report, and the recommended
option must exist. Invalid decisions atomically refuse replacement with a field
error. Structural validation does not establish truth or context sufficiency.

Agents retain outstanding decisions in every complete report and remove resolved
or withdrawn decisions. Omission clears the collection. Cards start collapsed
after Session; only user expansion opens details, one at a time. Reporting,
opening, refreshing and same-session resume never expand a card automatically.
All context and tradeoffs remain available through wrapping and normal scrolling.
Reading and expansion send no input and confer no authorization. The report and
source enrichment remain display state.

The answer-relevant version includes question, why-now, context, ordered options
and recommendation; identity and version are checked against the current session
report before an expansion callback can act. No report can target another session.

## Decision actions

Selecting an option sends nothing; only **Send answer** submits the selected option
to the same session as input from the whatsup plugin. **Talk about this in chat**
submits a discussion request that carries no selected option and neither answers
nor resolves the decision. Each submission is checked against the current
decision identity and version and records a durable attempt that blocks duplicates.

An attempt is sent only when the engine confirms the submitted text with whatsup
plugin provenance, including acceptance queued during a busy turn; sent does not
mean the agent processed or resolved the decision. A known refusal fails and allows
an explicit retry. A missing or mismatched confirmation, or an attempt still
sending at same-session resume, is unconfirmed: it never displays as sent, is never
retried automatically, and blocks resubmission of that kind across reopening and
resume. Answer receipts and discussion feedback are tracked separately. The agent
removes a decision from its next complete report once resolved, including by a
custom answer in chat, or withdrawn. Submitted input confers no authorization; the
receiving session applies its normal authorization rules.
