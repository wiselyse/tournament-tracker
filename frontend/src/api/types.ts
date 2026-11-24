// Shapes returned by the backend (backend/src/wsf_tournament/engine/view.py, api.py).

export type Shape = 'rectangle' | 'square' | 'oval' | 'circle'
export type SpoonLayout = 'center' | 'between'

export interface TableConfig {
  shape: Shape
  max_long: number
  max_end: number
  max_side: number
  spoon_layout: SpoonLayout
}

export interface Seat {
  seat_no: number
  x: number
  y: number
  nx: number
  ny: number
  player_id?: string
  active?: boolean
}

export interface Spoon {
  x: number
  y: number
  rot: number // direction the head points, degrees: 0 right, 90 down
}

export interface EmptyGap {
  seats: [number, number]
  x: number
  y: number
}

export interface Geometry {
  table: TableConfig & { w: number; h: number }
  seats: Seat[]
  spoons: Spoon[]
  empty_gap: EmptyGap | null
}

export interface Round extends Geometry {
  no: number
  dealers: number[] // seat numbers: [dealer] or [dealer, second dealer]
  division_id: string
  started_at: number
  ended: boolean
  ended_at: number | null
  paused_ms: number
  paused_since: number | null
}

export type PlayerStatus = 'in' | 'waiting' | 'advanced' | 'out' | 'dq' | 'withdrawn'

export interface Player {
  id: string
  name: string
  status: PlayerStatus
  division_id: string | null
  penalties: Record<string, number>
  out_round: number | null
  finish_place: number | null
  finish_tied: boolean
}

export interface Division {
  id: string
  label: string
  status: 'waiting' | 'playing' | 'cutoff' | 'complete'
  player_ids: string[]
  advance_target: number | null
  advancing_ids: string[] | null
}

export interface Stage {
  no: number
  is_final: boolean
  divisions: Division[]
}

export interface TimelineEntry {
  seq: number
  group: number
  type: string
  at: number
  label: string
  round_no: number | null
  player_ids?: string[]
  stalemate_id?: string
  winner_ids?: string[]
  loser_ids?: string[]
  reason?: string
  kind?: string
  count?: number
}

export type Prompt =
  | { type: 'dq'; player_id: string; kind: string }
  | { type: 'cutoff'; division_id: string; advancing_ids: string[] }

export interface Rules {
  division_threshold: number
  max_per_table: number
  false_grab_dq_at: number
  card_pass_forfeit_at: number
  second_dealer_at: number
  immediate_dq: string[]
  spoon_layout: SpoonLayout
  between_inset: number
}

export interface TournamentState {
  id: string
  archived: boolean
  server_now: number
  tournament: {
    name: string
    date: string | null
    created_at: number
    started: boolean
    completed: boolean
    champion_id: string | null
    uses_divisions: boolean
  }
  rules: Rules
  table_config: TableConfig & { capacity: number | null }
  stages: Stage[]
  active_division_id: string | null
  next_division_id: string | null
  round: Round | null
  rounds_played: number
  open_stalemates: { id: string; player_ids: string[]; opened_at: number }[]
  players: Player[]
  prompts: Prompt[]
  timeline: TimelineEntry[]
  cursor: number
  head: number
  can_undo: boolean
  can_redo: boolean
}

export interface TournamentSummary {
  id: string
  name: string
  date: string | null
  archived: boolean
  created_at: number
  updated_at: number
  status: 'setup' | 'live' | 'complete' | 'error'
  players: number
  rounds: number
  champion: string | null
}

export type StagePlan = ({ sizes: number[] } | { final: number })[]

export interface Preview extends Geometry {
  players: number
  capacity: number | null
  largest_group: number
  fits: boolean
  uses_divisions: boolean
  stage_plan: StagePlan
}

export interface Settings {
  rules_overrides: Partial<Rules>
  default_table: Partial<TableConfig>
  rules: Rules
  rule_defaults: Rules
}

export type PenaltyKind =
  | 'delayed_pass'
  | 'false_grab'
  | 'premature_grab'
  | 'spoon_tamper'
  | 'card_pass'
  | 'hand_manipulation'
  | 'physical_harm'

export interface ReportMark {
  round: number
  type: 'won' | 'lost' | 'penalty' | 'out' | 'dq' | 'withdrawn'
}

export interface ReportPlayer {
  id: string
  name: string
  status: PlayerStatus | 'champion'
  place: number | null
  tied: boolean
  out_round: number | null
  rounds: number[]
  stalemates_won: number
  stalemates_lost: number
  penalties: number
  marks: ReportMark[]
}

export interface ReportRound {
  no: number
  division_id: string
  started_at: number
  ended_at: number | null
  ms: number | null // playing time, stoppages excluded
  players: number
  out: string[]
  stalemates: number
  penalties: number
}

export interface Report {
  completed: boolean
  champion_id: string | null
  rounds: ReportRound[]
  players: ReportPlayer[]
  stats: {
    players: number
    rounds: number
    total_ms: number
    stalemates: number
    penalties: number
    dqs: number
    stoppages: number
    divisions: number
    longest_round: { no: number; ms: number } | null
    shortest_round: { no: number; ms: number } | null
    most_stalemates_won: { player_id: string; count: number } | null
  }
}
