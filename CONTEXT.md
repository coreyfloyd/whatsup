# Session Status Context

The language of agent-reported session context and its presentation. A report is display state; it does not authorize work or replace the systems that own that work.

## Areas

| Label | Definition |
|---|---|
| `area/read-model` | The session-context snapshot, source adapters, membership, counting and provenance semantics. |
| `area/presentation` | The Claude Mod: report sections, click-triggered floating cards, and explicit destination activation. |
| `area/fixtures` | Recorded source captures and derived-fixture manifests used by tests. |

## Legacy areas

| Label | Replacement |
|---|---|

There are no retained legacy area labels in the recorded GitHub label list.

## Language

**Session**:
A conversation with an agent identified by its provider and immutable session identity. A session is distinct from a run.
_Avoid_: run as a synonym.

**Interactive session**:
A conversation in which a person can steer the agent and respond to its questions.

**Project**:
A body of related work. A GitHub Project board is one possible representation of it.
_Avoid_: repository or GitHub Project board as synonyms.

**Milestone**:
A delivery with an exit criterion, containing the tickets required for that delivery.

**Epic**:
The breakdown of one piece of work into tickets. Its containing issue is distinct from the work tickets counted beneath it.

**Ticket**:
An item of actionable work with one authoritative record in its originating work source.

**Decision**:
A recorded choice requested from the user, or the resulting recorded answer, attributable to its authoritative source. A tool permission is a separate approval interaction.

**Context report**:
One agent's complete description of its session's scope, ordered progress sections and workers. A new report replaces the previous report for that session.

**Scope**:
One line of agent-supplied text describing what the session is working on. Before the agent reports, no scope has been supplied.
_Avoid_: goal, which names the `/goal` command in Claude and Codex.

**Section**:
One labeled progress group with an optional name and description, a count verb, an item kind and ordered items. Its done, active and remaining counts come from those items.

**Item**:
One entry in a section, with a title and a queued, active or done state. Its number, identity and link are optional; an item can be plain text.

**Progress set**:
The items counted by one section. Sets may overlap and are never summed.
_Avoid_: progress scope.

**Done count**:
The number of a section's items in the done state, shown out of its total items. Done describes reported progress, not a claim of delivery.

**In-progress ticket**:
A ticket represented by an item the agent reports as active. An active report state wins over a closed issue during enrichment.

**Worker**:
One named agent or external process contributing to the session, with a role, status word, execution state and optional task and usage. Observed and reported workers with the same name describe one worker.

**Session facts**:
The session's own measurements and environment: model, elapsed time, usage, context, folder, branch, worktree, repository, identity and current pull request. They are observed independently of the context report.

**Template**:
A named set of section definitions, display preferences and reporting instructions. A repository configuration can select and override it.

**Enrichment**:
Facts read from GitHub for an item's identity, such as its title, state, labels, blockers and page. Enrichment is derived display data and is never written back to GitHub.

**Snapshot**:
The context report, observed workers, session facts and enrichment joined at one time, with each section present, hidden or unavailable with a reason. It does not authorize work.

**Preview**:
Temporary details shown in a floating card when a reference is clicked, one at a time, until the same reference or anywhere else in the pane is clicked. A preview never appears on hover and does not navigate by itself; only its `open ↗` button opens the destination.

**Destination**:
The verified canonical URL associated with a displayed entity. A destination may be unavailable independently of the entity's other facts.
