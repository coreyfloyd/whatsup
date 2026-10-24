# Interface

The plugin is named `whatsup`. At session start it registers exactly one model tool, `mcp__whatsup__report`. The pane opens through `/whatsup`; `/session-status` remains a compatibility alias. Startup and reporting do not open it.

## Tool description

Replace this session’s entire context report: scope text; optional ordered sections (label, name, verb, item_kind, description, items, fields); items (title, number, identity, link, queued/active/done state); optional workers (name, role, status, state, model, task, times and token usage). Minimum: {"scope":"What I am working on"}. Omitted sections, workers and decisions clear the previous lists. Decisions require stable identity, question, why_now, answer-sufficient context, at least two options (identity, label, benefit, cost), and recommendation (option identity, reason). Retain outstanding decisions in every complete report; update missing context and remove only resolved or withdrawn decisions. Keep identities stable across unchanged reports; changed question, context, options or recommendation creates a new version. Validation checks structure and nonempty text, not prose truth or sufficiency. This is display state, not authorization.

## Decision cards

Optional ordered decisions appear after Session and before progress and workers. Each pending card uses a red accent and the text ANSWER NEEDED. Cards start collapsed; use the triangle to expand or collapse one card at a time. Questions and full context wrap and remain reachable through normal scrolling and More/Back navigation. Refreshing a report, reopening the pane or resuming a session collapses decisions. Reading and expansion send no input and grant no authorization. No option starts selected. Selecting an option changes only the selection;
Clear selection removes it. Send answer appears only with a selection and submits
the displayed decision identity, question and complete selected option (identity,
label, benefit and cost) to this pane's own main conversation, retaining whatsup
plugin provenance. There is no hidden execution payload. The expanded first card
also supports d to expand/collapse, 1–9 for options, c to clear and s to send when
the pane holds keyboard focus. Longer labels wrap into reachable action rows.
Talk about this in chat (t) submits the displayed decision identity and question,
never the selected option, to the same conversation as a discussion request; it
neither answers nor resolves the decision. Discussion feedback is separate from
answer receipts: Discussion requested — answer still needed after acceptance, which
permits another request; Discussion not sent with a known refusal, which permits
explicit retry; and Discussion unconfirmed otherwise, which blocks another
discussion request across reopening and resume while selection and Send answer
remain available.

One attempt locks that answer against duplicate activation. Only the engine's
matching accepted text with whatsup provenance produces Sent — awaiting agent;
queue acceptance is distinct from processing and resolution. A known refusal
shows its reason and permits explicit retry. Missing acceptance confirmation,
transport exceptions or a 15-second wait produce Delivery unconfirmed. Its
collapsed receipt retains the question and attempted answer, blocks editing and
resubmission, and asks the user to check the main conversation and continue there
manually. This recovery sends nothing. A late confirmed result updates that same
attempt to Sent or known refusal. An interrupted in-flight attempt restores as
unconfirmed, never as a fresh pending answer. Unsupported prompt submission
explains unavailability and directs the user to the main conversation.

Receipts are stored by immutable engine session and decision version. Unchanged
complete reports, pane reopening and same-session resume retain Sent and
unconfirmed receipts. A different session inherits none. Removing or omitting a
decision clears its interaction state; a material revision starts collapsed and
unselected, without the previous receipt. A stale card cannot submit after report
replacement. The reporting agent alone removes resolved or withdrawn decisions;
the pane does not infer resolution from model text or time.

The pane provides session context with explicit user-input actions. Reporting,
source enrichment, reading, expansion and selection remain display-only. Answer
input never grants tool permissions, mutates tickets or bypasses authorization
rules in the receiving session.

Supply stable decision and option identities, a question, why_now, answer-sufficient context, two or more options with both benefit and cost, and a recommendation referencing an option identity with a reason. All decision text must be nonblank. Duplicate decision identities, duplicate option identities within a decision and absent recommended options reject the whole report before replacement. Errors identify the field; validation cannot judge truth or prose sufficiency. A changed question, why-now, context, ordered options or recommendation forms a new decision version. Object property order does not change the version.

Every report completely replaces decisions: retain outstanding decisions, improve missing context, and remove resolved or withdrawn decisions. Omission clears the collection. Decisions have no hidden execution payload and do not affect progress counts or source enrichment.

## JSON input schema

This is the schema passed to the engine verbatim. Property names use snake_case. Unknown properties are refused, including within decisions, options, recommendations, sections, items and workers. Only scope is required at the report level. A section requires label, verb and item_kind; its omitted items list is empty. Workers require name, role, status and state. Custom fields are accepted and retained but not rendered in this release.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "scope"
  ],
  "properties": {
    "scope": {
      "type": "string",
      "description": "One line describing what this session is working on."
    },
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "identity",
          "question",
          "why_now",
          "context",
          "options",
          "recommendation"
        ],
        "properties": {
          "identity": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          },
          "question": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          },
          "why_now": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          },
          "context": {
            "type": "string",
            "minLength": 1,
            "pattern": "\\S"
          },
          "options": {
            "type": "array",
            "minItems": 2,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "identity",
                "label",
                "benefit",
                "cost"
              ],
              "properties": {
                "identity": {
                  "type": "string",
                  "minLength": 1,
                  "pattern": "\\S"
                },
                "label": {
                  "type": "string",
                  "minLength": 1,
                  "pattern": "\\S"
                },
                "benefit": {
                  "type": "string",
                  "minLength": 1,
                  "pattern": "\\S"
                },
                "cost": {
                  "type": "string",
                  "minLength": 1,
                  "pattern": "\\S"
                }
              }
            }
          },
          "recommendation": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "option",
              "reason"
            ],
            "properties": {
              "option": {
                "type": "string",
                "minLength": 1,
                "pattern": "\\S"
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "pattern": "\\S"
              }
            }
          }
        }
      }
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "label",
          "verb",
          "item_kind"
        ],
        "properties": {
          "label": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "verb": {
            "type": "string"
          },
          "item_kind": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "identity": {
            "type": "string"
          },
          "link": {
            "type": "string"
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "title",
                "state"
              ],
              "properties": {
                "title": {
                  "type": "string"
                },
                "number": {
                  "type": "integer",
                  "minimum": 1
                },
                "identity": {
                  "type": "string"
                },
                "link": {
                  "type": "string"
                },
                "state": {
                  "type": "string",
                  "enum": [
                    "queued",
                    "active",
                    "done"
                  ]
                }
              }
            }
          },
          "fields": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "label",
                "value"
              ],
              "properties": {
                "label": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    },
    "workers": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name",
          "role",
          "status",
          "state"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "role": {
            "type": "string"
          },
          "status": {
            "type": "string"
          },
          "state": {
            "type": "string",
            "enum": [
              "running",
              "waiting",
              "done",
              "failed"
            ]
          },
          "model": {
            "type": "string"
          },
          "task": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "title",
                  "state"
                ],
                "properties": {
                  "title": {
                    "type": "string"
                  },
                  "number": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "identity": {
                    "type": "string"
                  },
                  "link": {
                    "type": "string"
                  },
                  "state": {
                    "type": "string",
                    "enum": [
                      "queued",
                      "active",
                      "done"
                    ]
                  }
                }
              }
            ]
          },
          "first_seen": {
            "type": "string"
          },
          "last_state_change": {
            "type": "string"
          },
          "tokens": {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 0
            }
          },
          "total": {
            "type": "integer",
            "minimum": 0
          },
          "context": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "tokens",
              "window"
            ],
            "properties": {
              "tokens": {
                "type": "integer",
                "minimum": 0
              },
              "window": {
                "type": "integer",
                "minimum": 1
              }
            }
          },
          "source": {
            "type": "string",
            "enum": [
              "observed",
              "reported",
              "both"
            ]
          }
        }
      }
    }
  }
}
```

## Replacement and isolation

Each accepted call replaces the entire report under the sending engine session's immutable identity in the plugin store. Omitted sections, workers or decisions clear their previous lists. Validation happens before persistence; refusal names the nested field (for example, `report.sections[0].items[0].state`) and leaves the previous report and pane unchanged. Reports never write to the working directory, run GitHub mutations, or grant work authorization. Session identity is read from the engine, never accepted from the caller. A new session starts with no report; resuming the same session can recover its stored report.

The minimum call is:

```json
{"scope":"Build the public release"}
```

Sections have no fixed names or hierarchy. The count badge reads `done/total verb`; done and active counts are derived only from the supplied items, and the remaining stretch represents queued items. A section with no name, description or items renders no box, regardless of what the agent sends. A section with a name or description but no items retains its box, title, description and item-kind heading while hiding its badge and bar. Markers expand and collapse descriptions and item lists. Section names and item rows open floating cards, one at a time; the same target or any other pane space dismisses the card. Links open only through the card's `open ↗` action. Text-only items have cards without that action. A replacement report clears the prior expansion and card state.

Optional section identity and link let a section name carry its own destination. Item number is a positive integer; identities remain opaque strings. Worker times are strings, tokens is an ordered per-minute series of nonnegative integer counts, and total is a nonnegative integer. Workers may supply `context: {tokens, window}` for their own gauge; the window must be positive. When only a token series is provided, its sum supplies the total. Templates guide reporting; engine session facts and GitHub enrichment are observed independently.

## Developer snapshots

The `snapshot` option defaults to `live`, which renders this session's report or the empty help line. Selecting a recorded snapshot explicitly retains the original developer fixture renderer. Recorded snapshots do not seed or replace session reports.

## Verification

Run the full Python suite with `PYTHONPATH=src python3 -m unittest discover -s tests -v` and the Mod suites with `claude plugin test mod`. The Mod tests drive report calls, persisted session state, validation refusals and pane interactions on terminal and desktop surfaces at 40 and 80 columns. They exercise the engine's render contract; real terminal hand checks remain a separate integration verification.

## Templates and repository configuration

Three built-in templates ship in `mod/hooks/templates.ts`. `github` is the default. Every template reports scope. Section definitions supply the label, count verb, item kind, title emoji, whether to include a description, and the initial collapsed state.

| Template | Section order | Labels / verbs / item kinds / emoji / description |
|---|---|---|
| `github` | project, milestone, epic, queue | Project / achieved / milestones / 🎯 / yes; Milestone / shipped / epics / ⛰️ / yes; Epic / closed / tickets / 🚀 / yes; Queue / finished / tasks / 📋 / no |
| `task-list` | queue | Queue / finished / tasks / 📋 / no |
| `bare` | queue | Queue / finished / tasks / no emoji / no |

All sections start collapsed. All three templates choose compact session density and motion enabled. Their worker status map is generating 🐝, reviewing 🧐, evaluating 🔬, testing 🧪, waiting 🪑, done ✅, failed ❌. The resolved preferences apply to the session and worker renderers; the engine's reduced-motion setting takes precedence over the configured motion preference.

Place `.whatsup.json` at the Git repository root (a `.git` directory or worktree file identifies that root). Starting in a subdirectory still reads the root file. Outside a Git repository, the starting directory owns `.whatsup.json`. An optional user file at `$HOME/.config/whatsup/config.json` supplies defaults. Neither file is required. Configuration is read once at session start; restart the session after editing it.

Resolution selects `template` from the repository file, then the user file, then `github`. It deep-merges the user overrides followed by repository overrides onto that built-in template. Objects merge by key; arrays replace entirely. A user override remains in effect when a repository selects a different template unless the repository overrides that value too. Resolution never changes the built-ins or writes either file.

For example, this repository configuration selects GitHub sections, renames Epic to Delivery, starts it expanded, uses full session density, and disables motion:

```json
{
  "template": "github",
  "sections": {
    "epic": { "label": "Delivery", "collapsed": false }
  },
  "session": { "density": "full" },
  "motion": false
}
```

The full format is a JSON object with these optional fields:

| Field | Meaning |
|---|---|
| `template` | `github`, `task-list`, or `bare`; selects the built-in baseline. |
| `sections` | Object keyed by section name. Each definition supports `label`, `verb`, `item_kind`, `emoji` (strings), `description` and `collapsed` (booleans). Partial definitions override built-ins. A new section must supply every field when included in `section_order`. |
| `section_order` | Ordered array of section keys to request from the model. Keys must exist and cannot repeat. Omit sections by leaving them out of this array. |
| `status_emoji` | Object mapping worker status words to emoji strings. Override or extend the defaults. |
| `session.density` | `compact` or `full`; selects the session box detail level. |
| `motion` | Boolean; requests token graph motion when the engine permits it. |
| `instruction` | Boolean, default `true`; `false` disables the automatic reporting instruction. |

Malformed JSON, unknown fields or template names, wrong types, invalid density, and unknown or duplicate section-order entries are configuration errors reported by the startup hook. A custom template whose instruction would reach 120 words is rejected; shorten its labels or reduce its section list. An empty object inherits all defaults. A file containing `null` is invalid.

## Automatic reporting instruction

At session start, the plugin registers the tool and commands and stores the resolved template under `template-config:<session-id>` in the plugin store. This is the display preference seam for the session box, worker and pane renderers; it is separate from `context-report:<session-id>`, which holds the report. It contains the resolved fields above.

The first model context receives one `whatsup` block of fewer than 120 words. It names the active sections in order with their labels, verbs, item kinds and description policy; requests scope, section fields and item title/state plus known identities and links; requests a complete replacement when a task starts or finishes, the scope shifts, or a ticket, milestone or decision is created; and requests workers launched by any means. It requires retaining outstanding decisions with answer-sufficient context, tradeoffs and recommendation, stable identities, updating discussion context, and removal after resolution (including custom chat answers) or withdrawal; the tool description supplies the complete contract. When the configured section order includes a queue, it describes the queue as the session's running work log: every piece of work in order, including unticketed and newly discovered work. Work waiting on a dependency moves to queued behind that dependency. `instruction: false` adds no block and leaves the report tool and `/whatsup` available. On organization-managed Claude installations, the engine permits this context hook only for plugins listed by that organization in managed settings.

Sections are reporting guidance, not required report fields: the tool still accepts scope alone and any ordered list of sections. A reported label matching a template section uses its configured initial collapsed state on replacement and reopening. Subsequent user expansion is local display state. Templates do not manufacture counts, scope or work items.


## Live workers

The Mod observes `agent.spawn`, `agent.list()`, streamed `turn.step` requests and `turn.complete`. Spawn metadata supplies the role, name, resolved model and start time. Each completed request adds uncached input, cache reads, cache writes and output to its completion minute. Context fill uses only the latest request’s input, including cache tokens. A measured session window is reused for another worker only when its resolved model id matches. When an observed worker has context tokens but no measured window, a matching report's `context.window` supplies the gauge denominator; the observed token count still wins over reported tokens. A measured window always wins over a reported window. The fallback belongs to the current report and disappears when that report omits the matching worker or its context. Report-only external workers use their reported `context` for both tokens and window.

The gauge shows `—` for an observed worker without context-token measurements, even if a matching report supplies context; for an observed worker with tokens but neither a measured window nor a matching reported window (including a different-model worker without either window); and for a report-only worker without context. A token series or total alone cannot supply context fill. A zero token count with a known window renders 0%, not `—`. Invalid reported context, including a zero or negative window, is refused by validation and leaves the previous report unchanged.

Observed and reported workers merge on name. Observations retain role, model, timing and usage; reports override status, execution state and task. A reported worker named `session`, or with role `main`, describes the main box; it is always first. Omitted reported workers disappear on replacement; observed workers remain. Terminal states remain for ten minutes from the recorded transition, including while the pane is closed, then are hidden. Done workers are dimmed; failed workers retain their role color. Repeated reports of the same state do not restart retention.

The graph uses one cell per minute, scaled independently for each worker relative to its busiest minute in the visible window. That minute fills all eight height steps; other minutes scale linearly, rounding up to the next step so any positive count stays visible. As the window scrolls, the scale follows its visible peak. Empty minutes and all-zero windows are blank; equal positive minutes all draw at full height. At 80 and 40 columns, 63 and 23 minutes fit when the usage column is twelve cells wide. The latest bar dips one step during an in-flight request. Waiting and terminal graphs stop at their transition minute. No usage series means no graph. `prefersReducedMotion` in engine settings, or `motion: false` in the template, disables the dip and scheduled graph updates; incoming reports and measurements still redraw the current data. `status_emoji` controls the status glyph map, with ◐ for unmapped words. Worker boxes have no collapse control; task cards use the pane’s existing explicit `open ↗` action.

## Snapshot and session facts

The [read contract](contracts/session-context.md#snapshot) specifies the JSON snapshot and enrichment envelopes. The [read module](docs/read-module.md) specifies subprocess input, token resolution and refresh. The snapshot is a display copy; the original report remains in session-scoped storage.

The session box observes model, elapsed time, available rate-limit percentages and reset times, context tokens/window, working folder, branch, worktree, repository, session identity and current pull request. Compact density shows the essential environment and usage; full density adds available reset times and context tokens. Missing measurements show an unavailable marker. Copy actions apply to folder and session identity; repository and pull-request destinations open through their cards.
