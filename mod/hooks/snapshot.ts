// The read module's snapshot shape (docs/read-module.md), as far as the pane reads it.

export type Section<T> = {
  state: 'present' | 'hidden' | 'unavailable'
  value: T | null
  reason: string | null
}

export type NotRecorded = 'Not recorded'

export type Scope = {
  text: string
  authority: string | null
  reference: string | null
  label: string | null
  repository: string | null
}

export type Project = {
  identity: string | null
  name: string
  scope: string | null
  progress_sets: string[]
  page: string | null
}

export type Milestone = {
  identity: string
  name: string
  objective: string
  page: string | null
}

export type SetCard = {
  identity: string
  name?: string
  objective?: string
  revision?: number
  closed: number
  total: number
  blockers?: string[] | NotRecorded
  page: string | null
}

export type ProgressSet = {
  kind: 'milestone' | 'epic' | 'slate'
  identity: string
  revision: number | null
  closed: number
  total: number
  card: Section<SetCard>
}

export type TicketCard = {
  requested_outcome: string
  acceptance_criteria: string[] | NotRecorded
  status: { state: string; labels: string[] | NotRecorded }
  blockers: string[] | NotRecorded
  page: string | null
}

export type Row = {
  identity: string
  owner: string
  repository: string
  number: number
  title: string
  different_repository: boolean | null
  card: Section<TicketCard>
}

export type Snapshot = {
  scope: Section<Scope>
  project: Section<Project>
  milestone: Section<Milestone>
  progress: { milestone: Section<ProgressSet>; epic: Section<ProgressSet>; slate: Section<ProgressSet> }
  in_progress: Section<{ rows: Row[]; message: string | null }>
}

export type SnapshotEntry = {
  name: string
  fixture: string
  case: string | null
  purpose: string
  snapshot: Snapshot
}
