import { useCallback, useEffect, useState } from 'react'

export type Flag = 'SCALE' | 'FIX' | 'KILL' | 'WATCH'
export type Outcome = 'accepted' | 'edited' | 'rejected' | 'failed'
export type RangeKey = '1m' | '3m' | '6m'

export interface Metrics {
  runs: number
  runs_by_outcome: Record<Outcome, number>
  successful_runs: number
  acceptance_rate: number | null
  minutes_saved: number
  hours_saved: number
  value_by_outcome: Record<Outcome, number>
  value: number
  api_cost: number
  fixed_cost: number
  build_cost: number
  total_cost: number
  net_value: number
  roi: number | null
  cost_per_run: number | null
  cost_per_success: number | null
  wasted_human_minutes: number
  active_days: number
  monthly_run_rate: number
}

export interface Totals {
  runs: number
  successful_runs: number
  acceptance_rate: number | null
  hours_saved: number
  value: number
  api_cost: number
  fixed_cost: number
  build_cost: number
  total_cost: number
  net_value: number
  roi: number | null
  cost_per_success: number | null
  funnel?: FunnelStage[]
  active_users?: number
  headcount?: number
}

export interface FunnelStage {
  key: 'runs' | 'completed' | 'used' | 'as_is'
  label: string
  count: number
  share_of_runs: number | null
  conversion: number | null
  drop: number
}

export interface RunPrice {
  tool_id: number; tool: string; outcome: Outcome
  baseline_minutes: number; human_minutes: number; raw_minutes_saved: number
  credit: number; minutes_saved: number; hourly_rate: number
  value: number; api_cost: number; net: number
}

export interface FlagCheck { rule: Flag; test: string; observed: string; passed: boolean }

export interface Assumptions {
  baseline_minutes_per_task: number
  loaded_hourly_rate: number
  build_cost: number
  monthly_fixed_cost: number
  status_override: Flag | null
}

export interface Tool {
  id: number
  name: string
  description: string
  owner: string
  department: string
  department_id: number
  launch_date: string
  days_live: number
  assumptions: Assumptions
  metrics: Metrics
  active_users: number
  runs_per_user: number | null
  funnel: FunnelStage[]
  high_usage: boolean
  recent_monthly_roi: { month: string; roi: number | null }[]
  auto_flag: Flag
  flag: Flag
  overridden: boolean
  reason: string
  checks: FlagCheck[]
}

export interface Portfolio {
  range: RangeKey; start: string; end: string
  tools: Tool[]
  totals: Totals
  high_usage_threshold: number
}

export interface MonthPoint extends Omit<Totals, 'cost_per_success'> {
  month: string
  partial: boolean
  days: number
}

export interface SlimTool {
  id: number; name: string; department: string; flag: Flag; auto_flag: Flag; reason: string
  value: number; total_cost: number; net_value: number; roi: number | null; hours_saved: number
  acceptance_rate: number | null; runs: number
}

interface Delta { prev: number; cur: number; change: number | null }
export interface Summary {
  range: RangeKey; start: string; end: string
  totals: Totals
  series: MonthPoint[]
  mom: { previous_month: string; current_month: string; value: Delta; total_cost: Delta; hours_saved: Delta; roi: { prev: number | null; cur: number | null } }
  top_wins: SlimTool[]
  top_issue: SlimTool | null
  other_issues: SlimTool[]
  flag_counts: Record<Flag, number>
  by_tool: SlimTool[]
}

export interface ToolDetail extends Tool {
  series: (MonthPoint & { failures: Record<string, number> })[]
  weekly: { week: string; runs: number; active_users: number; runs_per_user: number | null; acceptance_rate: number | null; partial: boolean }[]
  failure_reasons: { reason: string; outcome: Outcome; runs: number; share_of_runs: number }[]
  models: { model: string; runs: number; api_cost: number; acceptance_rate: number | null; api_cost_per_success: number | null }[]
  recent_runs: {
    id: number; timestamp: string; human_minutes_with_ai: number; api_cost_usd: number; model_name: string
    outcome: Outcome; failure_reason: string | null; minutes_saved: number; value: number
  }[]
}

export interface Spend {
  range: RangeKey; start: string; end: string
  totals: Totals
  by_tool: { id: number; name: string; flag: Flag; runs: number; successful_runs: number; api_cost: number; fixed_cost: number; build_cost: number; total_cost: number; value: number; cost_per_run: number | null; cost_per_success: number | null; roi: number | null; acceptance_rate: number | null }[]
  by_model: { model: string; runs: number; api_cost: number; tools: number; acceptance_rate: number | null; api_cost_per_run: number | null; api_cost_per_success: number | null }[]
  series: (MonthPoint & { api_by_model: Record<string, number> })[]
  growth: { id: number; name: string; prev_cost: number; cur_cost: number; prev_value: number; cur_value: number; cost_growth: number | null; value_growth: number | null; outpacing: boolean }[]
  growth_months: [string, string]
}

export interface Department {
  id: number; name: string; headcount: number; manual_hours_per_month: number
  runs: number; value: number; hours_saved: number; total_cost: number; net_value: number; roi: number | null
  hours_saved_per_month: number; coverage: number | null
  active_users: number; adoption: number | null; hours_per_active_user_per_month: number | null; gap_hours_per_month: number; tools_owned: number
  tools_used: { id: number; name: string; value: number; hours_saved: number; runs: number; owned: boolean }[]
  backlog_ideas: { id: number; name: string; priority_score: number | null; est_monthly_hours_saved: number }[]
}

export interface IdeaInput {
  name: string; department_id: number; tasks_per_month: number; minutes_saved_per_task: number
  hourly_rate: number; expected_adoption_pct: number; build_hours: number; est_monthly_api_cost: number
}
export interface IdeaScore {
  est_monthly_hours_saved: number; est_monthly_value: number; est_annual_value: number
  est_build_cost: number; est_first_year_cost: number; priority_score: number | null; payback_months: number | null
}
export type Idea = IdeaInput & IdeaScore & { id: number; department: string; rank: number }

export interface Meta {
  as_of: string
  ranges: Record<RangeKey, number>
  departments: { id: number; name: string }[]
  tools: { id: number; name: string; department_id: number }[]
  models: string[]
  rules: {
    value_weight: Record<Outcome, number>
    scale_min_roi: number; scale_min_acceptance: number; kill_max_roi: number; kill_consecutive_months: number
    low_acceptance: number; watch_min_days: number; high_usage_top_fraction: number
    build_amortization_days: number; engineer_hourly_rate: number; failure_reasons: string[]
  }
}

/** Last response per GET path, so revisiting a screen paints instantly while it refreshes. */
const responseCache = new Map<string, unknown>()
const READ_ONLY_POSTS = new Set(['/api/runs/preview', '/api/ideas/score'])

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && !READ_ONLY_POSTS.has(path)) responseCache.clear()
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch { /* not json */ }
    throw new Error(detail)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Fetch on mount and whenever `path` changes. `version` lets callers force a refetch. */
export function useApi<T>(path: string | null, version = 0) {
  const [data, setData] = useState<T | null>(() => (path ? (responseCache.get(path) as T) ?? null : null))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    if (!path) return
    const cached = responseCache.get(path) as T | undefined
    if (cached !== undefined) setData(cached)
    setLoading(cached === undefined)
    try {
      const fresh = await api<T>(path)
      responseCache.set(path, fresh)
      setData(fresh)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [path])
  useEffect(() => { load() }, [load, version])
  return { data, error, loading, reload: load, setData }
}
